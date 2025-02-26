import { AbortException, Dict, DictKey, DocumentEvaluatorOptions, FormatError, info, isNumberArray, Name, OPS, Ref, shiftable, warn, WorkerTask } from "seren-common";
import { ColorSpace } from "../../color/colorspace";
import { DictImpl } from "../../document/dict_impl";
import { XRefImpl } from "../../document/xref";
import { GlobalImageCache, LocalColorSpaceCache, LocalGStateCache, LocalImageCache, LocalTilingPatternCache, RegionalImageCache } from "../../image/image_utils";
import { BaseStream } from "../../stream/base_stream";
import { OperatorList } from "../operator_list";
import { addLocallyCachedImageOps, EvalState, EvaluatorContext, EvaluatorPreprocessor, State, StateManager, TimeSlotManager } from "./evaluator";
import { OperatorListHandler, OVER, ProcessOperation, SKIP } from "./evaluator_base";
import { EvaluatorColorHandler } from "./evaluator_color_handler";
import { EvaluatorFontHandler } from "./evaluator_font_handler";
import { EvaluatorGeneralHandler } from "./evaluator_general_handler";
import { EvaluatorImageHandler } from "./evaluator_image_handler";

const MethodMap = new Map<OPS, keyof GeneralOperator>();

// 这里应该要有handle完的arg类型，但是这种arg类型不太好强制管理起来
// 强制起来得打开一个开关，开关检测args处理的对不对
function handle(ops: OPS) {
  return function (_target: GeneralOperator, propertyKey: keyof GeneralOperator) {
    if (MethodMap.has(ops)) {
      throw new Error("不能够为一个操作配置多个方法");
    }
    MethodMap.set(ops, propertyKey);
  }
}

// 所有的处理都围绕着ProcessContext来，包括next方法
// 所有的处理方法都是静态函数，避免大量的创建对象
export interface ProcessContext extends ProcessOperation {
  fallbackFontDict: Dict | null;
  task: WorkerTask;
  patterns: Dict;
  options: DocumentEvaluatorOptions;
  xref: XRefImpl;
  pageIndex: number;
  xobjs: Dict;
  resources: Dict;
  ignoreErrors: boolean;
  stateManager: StateManager;
  parsingText: boolean;
  operatorList: OperatorList;
  tsm: TimeSlotManager;
  preprocessor: EvaluatorPreprocessor;
  localImageCache: LocalImageCache;
  localColorSpaceCache: LocalColorSpaceCache;
  localGStateCache: LocalGStateCache;
  localTilingPatternCache: LocalTilingPatternCache;
  localShadingPatternCache: Map<Dict, string | null>;
  regionalImageCache: RegionalImageCache;
  globalImageCache: GlobalImageCache;
  next: (promise: Promise<unknown> | undefined) => void;
}

class GeneralOperator {

  protected generalHandler: EvaluatorGeneralHandler;

  protected fontHandler: EvaluatorFontHandler;

  protected imageHandler: EvaluatorImageHandler;

  protected colorHandler: EvaluatorColorHandler;

  protected operator = new Map<OPS, (context: ProcessContext) => void | /* SKIP */1 | /* OVER */2>();

  constructor(context: EvaluatorContext) {
    this.generalHandler = context.generalHandler;
    this.fontHandler = context.fontHandler;
    this.imageHandler = context.imageHandler;
    this.colorHandler = context.colorHandler;
    for (const [k, v] of MethodMap) {
      const fn = this[v];
      if (fn == null || typeof fn !== 'function') {
        throw new Error("操作符和操作方法不匹配");
      }
      this.operator.set(k, <(context: ProcessContext) => void | 1 | 2>fn);
    }
  }

  execute(ops: OPS, context: ProcessContext): void | 1 | 2 {
    const fn = this.operator.get(ops);
    return fn ? fn(context) : this.handleDefault(context);
  }


  @handle(OPS.paintXObject)
  paintXObject(ctx: ProcessContext) {
    const isValidName = ctx.args![0] instanceof Name;
    const name = ctx.args![0].name;

    if (isValidName) {
      const localImage = ctx.localImageCache.getByName(name);
      if (localImage) {
        addLocallyCachedImageOps(ctx.operatorList, localImage);
        ctx.args = null;
        return SKIP;
      }
    }

    const next = new Promise<void>((resolve, reject) => {
      if (!isValidName) {
        throw new FormatError("XObject must be referred to by name.");
      }
      let xobj = ctx.xobjs.getRaw(<DictKey>name!);
      if (xobj instanceof Ref) {
        const localImage = ctx.localImageCache.getByRef(xobj) || ctx.regionalImageCache.getByRef(xobj);
        if (localImage) {
          addLocallyCachedImageOps(ctx.operatorList, localImage);
          resolve();
          return;
        }

        const globalImage = ctx.globalImageCache.getData(xobj, ctx.pageIndex);

        if (globalImage) {
          ctx.operatorList.addDependency(globalImage.objId!);
          ctx.operatorList.addImageOps(
            globalImage.fn, globalImage.args, globalImage.optionalContent
          );

          resolve();
          return;
        }

        xobj = ctx.xref.fetch(xobj);
      }

      if (!(xobj instanceof BaseStream)) {
        throw new FormatError("XObject should be a stream");
      }

      const type = xobj.dict!.getValue(DictKey.Subtype);
      if (!(type instanceof Name)) {
        throw new FormatError("XObject should have a Name subtype");
      }

      if (type.name === "Form") {
        ctx.stateManager.save();
        this.generalHandler.buildFormXObject(
          ctx.resources, xobj, null, ctx.operatorList, ctx.task,
          ctx.stateManager.state.clone(), ctx.localColorSpaceCache
        ).then(() => {
          ctx.stateManager.restore();
          resolve();
        }, reject);
        return;
      } else if (type.name === "Image") {
        this.imageHandler.buildPaintImageXObject(
          ctx.resources, xobj, false, ctx.operatorList, name,
          ctx.localImageCache, ctx.localColorSpaceCache
        ).then(resolve, reject);
        return;
      } else if (type.name === "PS") {
        // PostScript XObjects are unused when viewing documents.
        // See section 4.7.1 of Adobe's PDF reference.
        info("Ignored XObject subtype PS");
      } else {
        throw new FormatError(`Unhandled XObject subtype ${type.name}`);
      }
      resolve();
    }).catch(function (reason) {
      if (reason instanceof AbortException) {
        return;
      }
      if (ctx.ignoreErrors) {
        warn(`getOperatorList - ignoring XObject: "${reason}".`);
        return;
      }
      throw reason;
    })

    ctx.next(next);
    return OVER
  }

  @handle(OPS.setFont)
  setFont(ctx: ProcessContext) {
    const fontSize = ctx.args![1];
    ctx.next(this.fontHandler.handleSetFont(
      ctx.resources, <[Name | string, number]>ctx.args, null,
      ctx.operatorList, ctx.task, ctx.stateManager.state, ctx.fallbackFontDict
    ).then(loadedName => {
      ctx.operatorList.addDependency(loadedName);
      ctx.operatorList.addOp(OPS.setFont, [loadedName, fontSize])
    }));
  }

  @handle(OPS.beginText)
  beginText(ctx: ProcessContext) {
    ctx.parsingText = true;
  }

  @handle(OPS.endText)
  endText(ctx: ProcessContext) {
    ctx.parsingText = false;
  }

  @handle(OPS.endInlineImage)
  endInlineImage(ctx: ProcessContext) {
    const cacheKey = ctx.args![0].cacheKey;
    if (cacheKey) {
      const localImage = ctx.localImageCache.getByName(cacheKey);
      if (localImage) {
        addLocallyCachedImageOps(ctx.operatorList, localImage);
        return
      }
    }
    ctx.next(this.imageHandler.buildPaintImageXObject(
      ctx.resources, ctx.args![0], true, ctx.operatorList,
      cacheKey, ctx.localImageCache, ctx.localColorSpaceCache
    ))
    return OVER
  }

  @handle(OPS.showText)
  showText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      this.fontHandler.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    ctx.args![0] = this.generalHandler.handleText(ctx.args![0], ctx.stateManager.state);
  }

  @handle(OPS.showSpacedText)
  showSpacedText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      this.fontHandler.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    const combinedGlyphs = [];
    for (const arrItem of ctx.args![0]) {
      if (typeof arrItem === "string") {
        combinedGlyphs.push(...this.generalHandler.handleText(arrItem, ctx.stateManager.state));
      } else if (typeof arrItem === "number") {
        combinedGlyphs.push(arrItem);
      }
    }
    ctx.args![0] = combinedGlyphs;
    ctx.fn = OPS.showText;
  }

  @handle(OPS.nextLineShowText)
  nextLineShowText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      this.fontHandler.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    ctx.operatorList.addOp(OPS.nextLine, null);
    ctx.args![0] = this.generalHandler.handleText(ctx.args![0], ctx.stateManager.state);
    ctx.fn = OPS.showText;
  }

  @handle(OPS.nextLineSetSpacingShowText)
  nextLineSetSpacingShowText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      this.fontHandler.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    ctx.operatorList.addOp(OPS.nextLine, null);
    if (shiftable(ctx.args)) {
      ctx.operatorList.addOp(OPS.setWordSpacing, [ctx.args!.shift()]);
      ctx.operatorList.addOp(OPS.setCharSpacing, [ctx.args!.shift()]);
    }
    ctx.args![0] = this.generalHandler.handleText(ctx.args![0], ctx.stateManager.state);
    ctx.fn = OPS.showText;
  }

  @handle(OPS.setTextRenderingMode)
  setTextRenderingMode(ctx: ProcessContext) {
    ctx.stateManager.state.textRenderingMode = ctx.args![0];
  }

  @handle(OPS.setFillColorSpace)
  setFillColorSpace(ctx: ProcessContext) {
    const cachedColorSpace = ColorSpace.getCached(
      ctx.args![0], ctx.xref, ctx.localColorSpaceCache
    );
    if (cachedColorSpace) {
      ctx.stateManager.state.fillColorSpace = cachedColorSpace;
      return SKIP
    }

    ctx.next(this.colorHandler.parseColorSpace(
      ctx.args![0], ctx.resources, ctx.localColorSpaceCache,
    ).then(colorSpace => {
      ctx.stateManager.state.fillColorSpace =
        colorSpace || ColorSpace.singletons.gray;
    }));
    return OVER;
  }

  @handle(OPS.setStrokeColorSpace)
  setStrokeColorSpace(ctx: ProcessContext) {
    const cachedColorSpace = ColorSpace.getCached(
      ctx.args![0], ctx.xref, ctx.localColorSpaceCache
    );
    if (cachedColorSpace) {
      ctx.stateManager.state.strokeColorSpace = cachedColorSpace;
      return SKIP
    }

    ctx.next(this.colorHandler.parseColorSpace(
      ctx.args![0], ctx.resources, ctx.localColorSpaceCache,
    ).then(colorSpace => {
      ctx.stateManager.state.strokeColorSpace = colorSpace || ColorSpace.singletons.gray;
    }));
    return;
  }

  @handle(OPS.setFillColor)
  setFillColor(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.fillColorSpace!;
    ctx.args = cs.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeColor)
  setStrokeColor(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.strokeColorSpace!;
    ctx.args = cs.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillGray)
  setFillGray(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.gray;
    ctx.args = ColorSpace.singletons.gray.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeGray)
  setStrokeGray(ctx: ProcessContext) {
    ctx.stateManager.state.strokeColorSpace = ColorSpace.singletons.gray;
    ctx.args = ColorSpace.singletons.gray.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillCMYKColor)
  setFillCMYKColor(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.cmyk;
    ctx.args = ColorSpace.singletons.cmyk.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeCMYKColor)
  setStrokeCMYKColor(ctx: ProcessContext) {
    ctx.stateManager.state.strokeColorSpace = ColorSpace.singletons.cmyk;
    ctx.args = ColorSpace.singletons.cmyk.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillRGBColor)
  setFillRGBColor(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.rgb;
    ctx.args = ColorSpace.singletons.rgb.getRgb(ctx.args!, 0);
  }

  @handle(OPS.setStrokeRGBColor)
  setStrokeRGBColor(ctx: ProcessContext) {
    ctx.stateManager.state.strokeColorSpace = ColorSpace.singletons.rgb;
    ctx.args = ColorSpace.singletons.rgb.getRgb(ctx.args!, 0);
  }

  @handle(OPS.setFillColorN)
  setFillColorN(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.patternFillColorSpace;
    if (!cs) {
      if (isNumberArray(ctx.args, null)) {
        ctx.args = ColorSpace.singletons.gray.getRgb(ctx.args, 0);
        ctx.fn = OPS.setFillRGBColor;
        return
      }
      ctx.args = [];
      ctx.fn = OPS.setFillTransparent;
      return
    }
    if (cs.name === "Pattern") {
      ctx.next(this.colorHandler.handleColorN(
        ctx.operatorList, OPS.setFillColorN, ctx.args!, cs, ctx.patterns, ctx.resources,
        ctx.task, ctx.localColorSpaceCache, ctx.localTilingPatternCache, ctx.localShadingPatternCache
      ));
      return OVER
    }
    ctx.args = cs.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeColorN)
  setStrokeColorN(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.patternStrokeColorSpace;
    if (!cs) {
      if (isNumberArray(ctx.args, null)) {
        ctx.args = ColorSpace.singletons.gray.getRgb(ctx.args, 0);
        ctx.fn = OPS.setStrokeRGBColor;
        return
      }
      ctx.args = [];
      ctx.fn = OPS.setStrokeTransparent;
      return
    }
    if (cs.name === "Pattern") {
      ctx.next(this.colorHandler.handleColorN(
        ctx.operatorList, OPS.setStrokeColorN, ctx.args!, cs, ctx.patterns,
        ctx.resources, ctx.task, ctx.localColorSpaceCache,
        ctx.localTilingPatternCache, ctx.localShadingPatternCache
      ));
      return OVER;
    }
    ctx.args = cs.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.shadingFill)
  shadingFill(ctx: ProcessContext) {
    let shading;
    try {
      const shadingRes = ctx.resources.getValue(DictKey.Shading);
      if (!shadingRes) {
        throw new FormatError("No shading resource found");
      }
      shading = <Dict>shadingRes.getValue(ctx.args![0].name);
      if (!shading) {
        throw new FormatError("No shading object found");
      }
    } catch (reason) {
      if (reason instanceof AbortException) {
        return SKIP
      }
      if (ctx.ignoreErrors) {
        warn(`getOperatorList - ignoring Shading: "${reason}".`);
        return SKIP;
      }
      throw reason;
    }
    const patternId = this.colorHandler.parseShading(
      shading, ctx.resources, ctx.localColorSpaceCache, ctx.localShadingPatternCache
    );
    if (!patternId) {
      return SKIP
    }
    ctx.args = [patternId];
    ctx.fn = OPS.shadingFill;
  }

  @handle(OPS.setGState)
  setGState(ctx: ProcessContext) {
    const isValidName = ctx.args![0] instanceof Name;
    const name = ctx.args![0].name;

    if (isValidName) {
      const localGStateObj = ctx.localGStateCache.getByName(name);
      if (localGStateObj) {
        if ((<[DictKey, any][]>localGStateObj).length > 0) {
          ctx.operatorList.addOp(OPS.setGState, [localGStateObj]);
        }
        ctx.args = null;
        return SKIP
      }
    }
    ctx.next(new Promise<void>((resolve, reject) => {
      if (!isValidName) {
        throw new FormatError("GState must be referred to by name.");
      }

      const extGState = ctx.resources.getValue(DictKey.ExtGState);
      if (!(extGState instanceof DictImpl)) {
        throw new FormatError("ExtGState should be a dictionary.");
      }

      const gState = extGState.getValue(<DictKey>name!);
      // TODO: Attempt to lookup cached GStates by reference as well,
      //       if and only if there are PDF documents where doing so
      //       would significantly improve performance.
      if (!(gState instanceof DictImpl)) {
        throw new FormatError("GState should be a dictionary.");
      }

      this.generalHandler.setGState(
        ctx.resources, gState, ctx.operatorList, name, ctx.task,
        ctx.stateManager, ctx.localGStateCache, ctx.localColorSpaceCache
      ).then(resolve, reject);
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return OVER;
      }
      if (ctx.ignoreErrors) {
        warn(`getOperatorList - ignoring ExtGState: "${reason}".`);
        return OVER;
      }
      throw reason;
    }));
    return;
  }

  @handle(OPS.moveTo)
  moveTo(ctx: ProcessContext) {
    this.generalHandler.buildPath(ctx.operatorList, ctx.fn!, <number[]>ctx.args!, ctx.parsingText);
  }

  @handle(OPS.lineTo)
  lineTo(ctx: ProcessContext) {
    this.generalHandler.buildPath(ctx.operatorList, ctx.fn!, <number[]>ctx.args, ctx.parsingText);
  }

  @handle(OPS.curveTo)
  curveTo(ctx: ProcessContext) {
    this.generalHandler.buildPath(ctx.operatorList, ctx.fn!, <number[]>ctx.args, ctx.parsingText);
  }

  @handle(OPS.curveTo2)
  curveTo2(ctx: ProcessContext) {
    this.generalHandler.buildPath(ctx.operatorList, ctx.fn!, <number[]>ctx.args, ctx.parsingText);
  }

  @handle(OPS.curveTo3)
  curveTo3(ctx: ProcessContext) {
    this.generalHandler.buildPath(ctx.operatorList, ctx.fn!, <number[]>ctx.args, ctx.parsingText);
  }

  @handle(OPS.closePath)
  closePath(ctx: ProcessContext) {
    this.generalHandler.buildPath(ctx.operatorList, ctx.fn!, <number[]>ctx.args, ctx.parsingText);
  }

  @handle(OPS.rectangle)
  rectangle(ctx: ProcessContext) {
    this.generalHandler.buildPath(ctx.operatorList, ctx.fn!, <number[]>ctx.args, ctx.parsingText);
  }


  /** 
   * Ignore operators where the corresponding handlers are known to
   * be no-op in CanvasGraphics (display/canvas.js). This prevents
   * serialization errors and is also a bit more efficient.
   * We could also try to serialize all objects in a general way,
   * e.g. as done in https://github.com/mozilla/pdf.js/pull/6266,
   * but doing so is meaningless without knowing the semantics.
   */
  @handle(OPS.markPoint)
  markPoint(_ctx: ProcessContext) {
  }

  /**
   * @see {@link GeneralOperator.markPoint}
   */
  @handle(OPS.markPointProps)
  markPointProps(_ctx: ProcessContext) { }

  /** 
   * @see {@link GeneralOperator.markPoint}
   */
  @handle(OPS.beginCompat)
  beginCompat(_ctx: ProcessContext) { }

  /**
   * @see {@link GeneralOperator.markPoint}
   */
  @handle(OPS.endCompat)
  endCompat(_ctx: ProcessContext) { }

  /**
   * @see {@link GeneralOperator.markPoint}
   */
  @handle(OPS.beginMarkedContentProps)
  beginMarkedContentProps(_ctx: ProcessContext) {

  }

  handleDefault(ctx: ProcessContext) {
    // Note: Ignore the operator if it has `Dict` arguments, since
    // those are non-serializable, otherwise postMessage will throw
    // "An object could not be cloned.".
    if (ctx.args !== null) {
      let i = 0, ii = ctx.args.length;
      for (; i < ii; i++) {
        if (ctx.args[i] instanceof DictImpl) {
          break;
        }
      }
      if (i < ii) {
        // 这里可以优化一下，报错只是一个数字，不太好
        warn("getOperatorList - ignoring operator: " + ctx.fn);
        return
      }
    }
  }
}

const deferred = Promise.resolve();

export class GetOperatorListHandler implements OperatorListHandler {

  protected operatorList: OperatorList;

  protected task: WorkerTask;

  protected timeSlotManager = new TimeSlotManager();

  protected stateManager: StateManager;

  protected preprocessor: EvaluatorPreprocessor;

  protected resources: Dict;

  protected fallbackFontDict: Dict | null;

  protected ignoreErrors: boolean;

  protected evalCtx: EvaluatorContext;

  protected operator: GeneralOperator;

  constructor(
    evalCtx: EvaluatorContext,
    stream: BaseStream,
    task: WorkerTask,
    resources: Dict,
    operatorList: OperatorList,
    initialState: State | null = null,
    fallbackFontDict: Dict | null = null
  ) {
    if (!operatorList) {
      throw new Error('getOperatorList: missing "operatorList" parameter');
    }
    this.resources = resources;
    this.stateManager = new StateManager(initialState ?? new EvalState());
    this.task = task;
    this.operatorList = operatorList;
    this.preprocessor = new EvaluatorPreprocessor(stream, evalCtx.xref, this.stateManager)
    this.ignoreErrors = evalCtx.options.ignoreErrors;
    this.evalCtx = evalCtx;
    this.fallbackFontDict = fallbackFontDict;
    this.operator = new GeneralOperator(evalCtx);
  }

  async handle() {
    const operatorList = this.operatorList;
    const ignoreErrors = this.ignoreErrors;
    const task = this.task;
    // evalCtx是全局的，procCtx是一次请求的，要考虑递归的问题
    const handler = new Promise<void>((resolve, reject) => {
      // 确保context值初始化一次
      const context: ProcessContext = {
        fn: null,
        args: null,
        ignoreErrors,
        stateManager: this.stateManager,
        operatorList: this.operatorList,
        parsingText: false,
        tsm: new TimeSlotManager(),
        resources: this.resources,
        preprocessor: this.preprocessor,
        localImageCache: new LocalImageCache(),
        localColorSpaceCache: new LocalColorSpaceCache(),
        localGStateCache: new LocalGStateCache(),
        localTilingPatternCache: new LocalTilingPatternCache(),
        localShadingPatternCache: new Map<Dict, string | null>(),
        next: (promise: Promise<unknown> | undefined) => {
          Promise.all([promise, operatorList.ready]).then(() => {
            try {
              this.process(resolve, reject, context);
            } catch (ex) {
              reject(ex);
            }
          }, reject);
        },
        fallbackFontDict: this.fallbackFontDict,
        task: this.task,
        patterns: this.resources.getValue(DictKey.Pattern) || DictImpl.empty,
        options: this.evalCtx.options,
        xref: this.evalCtx.xref,
        pageIndex: this.evalCtx.pageIndex,
        xobjs: this.resources.getValue(DictKey.XObject) || DictImpl.empty,
        regionalImageCache: new RegionalImageCache,
        globalImageCache: new GlobalImageCache,
      }
      this.process(resolve, reject, context);
    });
    return handler.catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (ignoreErrors) {
        warn(`getOperatorList - ignoring errors during "${task.name}" task: "${reason}".`);
        this.closePendingRestoreOPS();
        return;
      }
      throw reason;
    });
  }

  process(resolve: (value: void | PromiseLike<void>) => void, _reject: (reason?: any) => void, context: ProcessContext) {
    this.task.ensureNotTerminated();
    context.tsm.reset();
    // 尽量减少变量的定义，不然会多耗费很多时间
    let stop: boolean;
    while (!(stop = context.tsm.check())) {
      context.args = null;
      if (!context.preprocessor.read(context)) {
        break;
      }
      let fn = context.fn!;
      const ret = this.operator.execute(fn, context);
      if (ret === SKIP) {
        continue;
      } else if (ret === OVER) {
        return;
      }
      context.operatorList.addOp(context.fn!, context.args!)
    }
    if (stop) {
      // 直接递归执行
      context.next(deferred);
    }
    this.closePendingRestoreOPS();
    resolve();
  }

  closePendingRestoreOPS() {
    for (let i = 0, ii = this.preprocessor.savedStatesDepth; i < ii; i++) {
      this.operatorList.addOp(OPS.restore, []);
    }
  }
}