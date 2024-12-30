import { OPS } from "../pdf";
import { AbortException, FormatError, info, warn } from "../shared/util";
import { BaseStream } from "./base_stream";
import { ColorSpace } from "./colorspace";
import { isNumberArray } from "./core_utils";
import { addLocallyCachedImageOps, EvalState, EvaluatorPreprocessor, State, StateManager, TimeSlotManager } from "./evaluator";
import { OperatorList } from "./operator_list";
import { Dict, DictKey, Name, Ref } from "./primitives";
import { WorkerTask } from "./worker";
import { XRef } from "./xref";

const MethodMap = new Map<OPS, keyof typeof Operator>();

const DEFAULT = "DEFAULT";

// 这里应该要有handle完的arg类型，但是这种arg类型不太好强制管理起来
// 强制起来得打开一个开关，开关检测args处理的对不对
function handle(ops: OPS | "DEFAULT") {
  return function (target: typeof Operator, propertyKey: keyof typeof Operator) {
    if (ops === DEFAULT) {
      return
    }
    if (MethodMap.has(ops)) {
      throw new Error("不能够重复为同一个操作符定义多个操作对象")
    }
    if (typeof target[propertyKey] === "function") {
      MethodMap.set(ops, propertyKey);
    }
  }
}

const SKIP = 1;
const OVER = 2;

class Operator {

  protected next: (promise: Promise<unknown>) => void;

  constructor(next: (promise: Promise<unknown>) => void) {
    this.next = next;
  }

  static buildOperatorMap() {
    const map = new Map<OPS, (context: ProcessContext) => void | /* SKIP */1 | /* OVER */2>();
    for (const [k, v] of MethodMap) {
      const fn = Operator[v];
      if (fn == null || typeof fn !== 'function') {
        throw new Error("操作符和操作方法不匹配");
      }
      map.set(k, <(context: ProcessContext) => void | 1 | 2>fn);
    }
    return map;
  }


  @handle(OPS.beginAnnotation)
  static beginAnnotation() {
  }

  @handle(OPS.paintXObject)
  static paintXObject(ctx: ProcessContext) {
    const isValidName = ctx.operation.args![0] instanceof Name;
    const name = ctx.operation.args![0].name;

    if (isValidName) {
      const localImage = ctx.localImageCache.getByName(name);
      if (localImage) {
        addLocallyCachedImageOps(ctx.operatorList, localImage);
        ctx.operation.args = null;
        return SKIP;
      }
    }

    const next = new Promise<void>((resolve, reject) => {
      if (!isValidName) {
        throw new FormatError("XObject must be referred to by name.");
      }
      let xobj = ctx.xobjs.getRaw(<DictKey>name!);
      if (xobj instanceof Ref) {
        const localImage = ctx.localImageCache.getByRef(xobj) || ctx._regionalImageCache.getByRef(xobj);
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
        Operator.buildFormXObject(ctx).then(() => {
          ctx.stateManager.restore();
          resolve();
        }, reject);
        return;
      } else if (type.name === "Image") {
        Operator.buildPaintImageXObject(ctx).then(resolve, reject);
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
      if (ctx.options.ignoreErrors) {
        warn(`getOperatorList - ignoring XObject: "${reason}".`);
        return;
      }
      throw reason;
    })

    ctx.next(next);
    return OVER
  }

  @handle(OPS.setFont)
  static setFont(ctx: ProcessContext) {
    const fontSize = ctx.operation.args![1];
    ctx.next(Operator.handleSetFont(

    ).then(loadedName => {
      ctx.operatorList.addDependency(loadedName);
      ctx.operatorList.addOp(OPS.setFont, [loadedName, fontSize])
    }));
  }

  static handleSetFont(): Promise<string> {
    throw new Error("Method not implemented.");
  }

  @handle(OPS.beginText)
  static beginText(ctx: ProcessContext) {
    ctx.parsingText = true;
  }

  @handle(OPS.endText)
  static endText(ctx: ProcessContext) {
    ctx.parsingText = false;
  }

  @handle(OPS.endInlineImage)
  static endInlineImage(ctx: ProcessContext) {
    const cacheKey = ctx.operation.args![0].cacheKey;
    if (cacheKey) {
      const localImage = ctx.localImageCache.getByName(cacheKey);
      if (localImage) {
        addLocallyCachedImageOps(ctx.operatorList, localImage);
        return
      }
    }
    ctx.next(Operator.buildPaintImageXObject(ctx))
    return OVER
  }

  @handle(OPS.showText)
  static showText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      Operator.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    ctx.operation.args![0] = Operator.handleText(
      ctx.operation.args![0], ctx.stateManager.state
    );
  }

  @handle(OPS.showSpacedText)
  static showSpacedText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      Operator.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    const combinedGlyphs = [];
    for (const arrItem of ctx.operation.args![0]) {
      if (typeof arrItem === "string") {
        combinedGlyphs.push(...Operator.handleText(arrItem, state));
      } else if (typeof arrItem === "number") {
        combinedGlyphs.push(arrItem);
      }
    }
    ctx.args![0] = combinedGlyphs;
    ctx.fn = OPS.showText;
  }

  @handle(OPS.nextLineShowText)
  static nextLineShowText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      Operator.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    ctx.operatorList.addOp(OPS.nextLine, null);
    ctx.args![0] = Operator.handleText(ctx.args![0], ctx.stateManager.state);
    ctx.fn = OPS.showText;
  }

  @handle(OPS.nextLineSetSpacingShowText)
  static nextLineSetSpacingShowText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      Operator.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    ctx.operatorList.addOp(OPS.nextLine, null);
    ctx.operatorList.addOp(OPS.setWordSpacing, [ctx.args!.shift()]);
    ctx.operatorList.addOp(OPS.setCharSpacing, [ctx.args!.shift()]);
    ctx.args![0] = Operator.handleText(ctx.args![0], ctx.stateManager.state);
    ctx.fn = OPS.showText;
  }

  @handle(OPS.setTextRenderingMode)
  static setTextRenderingMode(ctx: ProcessContext) {
    ctx.stateManager.state.textRenderingMode = ctx.args![0];
  }

  @handle(OPS.setFillColorSpace)
  static setFillColorSpace(ctx: ProcessContext) {
    const cachedColorSpace = ColorSpace.getCached(
      ctx.args![0], ctx.xref, ctx.localColorSpaceCache
    );
    if (cachedColorSpace) {
      ctx.stateManager.state.fillColorSpace = cachedColorSpace;
      return SKIP
    }

    ctx.next(Operator.parseColorSpace(
      ctx.args![0], ctx.resources, ctx.localColorSpaceCache,
    ).then(colorSpace => {
      ctx.stateManager.state.fillColorSpace =
        colorSpace || ColorSpace.singletons.gray;
    }));
    return OVER;
  }

  @handle(OPS.setStrokeColorSpace)
  static setStrokeColorSpace(ctx: ProcessContext) {
    const cachedColorSpace = ColorSpace.getCached(
      ctx.args![0], ctx.xref, ctx.localColorSpaceCache
    );
    if (cachedColorSpace) {
      ctx.stateManager.state.strokeColorSpace = cachedColorSpace;
      return SKIP
    }

    ctx.next(Operator.parseColorSpace(
      ctx.args![0], ctx.resources, ctx.localColorSpaceCache,
    ).then(colorSpace => {
      ctx.stateManager.state.strokeColorSpace = colorSpace || ColorSpace.singletons.gray;
    }));
    return;
  }

  @handle(OPS.setFillColor)
  static setFillColor(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.fillColorSpace!;
    ctx.args = cs.getRgb(ctx.args!, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeColor)
  static setStrokeColor(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.strokeColorSpace!;
    ctx.args = cs.getRgb(ctx.args as unknown as TypedArray, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillGray)
  static setFillGray(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.gray;
    ctx.args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeGray)
  static setStrokeGray(ctx: ProcessContext) {
    ctx.stateManager.state.strokeColorSpace = ColorSpace.singletons.gray;
    ctx.args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillCMYKColor)
  static setFillCMYKColor(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.cmyk;
    ctx.args = ColorSpace.singletons.cmyk.getRgb(ctx.args as unknown as TypedArray, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeCMYKColor)
  static setStrokeCMYKColor(ctx: ProcessContext) {
    ctx.stateManager.state.strokeColorSpace = ColorSpace.singletons.cmyk;
    ctx.args = ColorSpace.singletons.cmyk.getRgb(ctx.args, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillRGBColor)
  static setFillRGBColor(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.rgb;
    ctx.args = ColorSpace.singletons.rgb.getRgb(ctx.args, 0);
  }

  @handle(OPS.setStrokeRGBColor)
  static setStrokeRGBColor(ctx: ProcessContext) {
    ctx.stateManager.state.strokeColorSpace = ColorSpace.singletons.rgb;
    ctx.args = ColorSpace.singletons.rgb.getRgb(ctx.args, 0);
  }

  @handle(OPS.setFillColorN)
  static setFillColorN(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.patternFillColorSpace;
    if (!cs) {
      if (isNumberArray(ctx.args, null)) {
        ctx.args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
        ctx.fn = OPS.setFillRGBColor;
        return
      }
      ctx.args = [];
      ctx.fn = OPS.setFillTransparent;
      return
    }
    if (cs.name === "Pattern") {
      ctx.next(Operator.handleColorN(ctx));
      return OVER
    }
    ctx.args = cs.getRgb(args as unknown as TypedArray, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeColorN)
  static setStrokeColorN(ctx: ProcessContext) {
    const cs = ctx.stateManager.state.patternStrokeColorSpace;
    if (!cs) {
      if (isNumberArray(ctx.args, null)) {
        ctx.args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
        ctx.fn = OPS.setStrokeRGBColor;
        return
      }
      ctx.args = [];
      ctx.fn = OPS.setStrokeTransparent;
      return
    }
    if (cs.name === "Pattern") {
      ctx.next(Operator.handleColorN(ctx));
      return OVER;
    }
    ctx.args = cs.getRgb(args as unknown as TypedArray, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.shadingFill)
  static shadingFill(ctx: ProcessContext) {
    let shading;
    try {
      const shadingRes = ctx.resources.getValue(DictKey.Shading);
      if (!shadingRes) {
        throw new FormatError("No shading resource found");
      }
      shading = shadingRes.get(ctx.args![0].name);
      if (!shading) {
        throw new FormatError("No shading object found");
      }
    } catch (reason) {
      if (reason instanceof AbortException) {
        return SKIP
      }
      if (ctx.options.ignoreErrors) {
        warn(`getOperatorList - ignoring Shading: "${reason}".`);
        return SKIP;
      }
      throw reason;
    }
    const patternId = Operator.parseShading(ctx, shading);
    if (!patternId) {
      return SKIP
    }
    ctx.args = [patternId];
    ctx.fn = OPS.shadingFill;
  }

  @handle(OPS.setGState)
  static setGState(ctx: ProcessContext) {
    const isValidName = ctx.args![0] instanceof Name;
    const name = ctx.args![0].name;

    if (isValidName) {
      const localGStateObj = ctx.localGStateCache.getByName(name);
      if (localGStateObj) {
        if (localGStateObj.length > 0) {
          ctx.operatorList.addOp(OPS.setGState, [localGStateObj]);
        }
        ctx.args = null;
        return SKIP
      }
    }
    ctx.next(new Promise(function (resolve, reject) {
      if (!isValidName) {
        throw new FormatError("GState must be referred to by name.");
      }

      const extGState = ctx.resources.getValue(DictKey.ExtGState);
      if (!(extGState instanceof Dict)) {
        throw new FormatError("ExtGState should be a dictionary.");
      }

      const gState = extGState.getValue(<DictKey>name!);
      // TODO: Attempt to lookup cached GStates by reference as well,
      //       if and only if there are PDF documents where doing so
      //       would significantly improve performance.
      if (!(gState instanceof Dict)) {
        throw new FormatError("GState should be a dictionary.");
      }

      Operator.setGState(ctx).then(resolve, reject);
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return OVER;
      }
      if (ctx.options.ignoreErrors) {
        warn(`getOperatorList - ignoring ExtGState: "${reason}".`);
        return OVER;
      }
      throw reason;
    }));
    return;
  }

  @handle(OPS.moveTo)
  static moveTo(ctx: ProcessContext) {
    Operator.buildPath(operatorList, fn!, args, parsingText);
  }

  @handle(OPS.lineTo)
  static lineTo(ctx: ProcessContext) {
    Operator.buildPath(operatorList, fn!, args, parsingText);

  }

  @handle(OPS.curveTo)
  static curveTo(ctx: ProcessContext) {
    Operator.buildPath(operatorList, fn!, args, parsingText);

  }

  @handle(OPS.curveTo2)
  static curveTo2(ctx: ProcessContext) {
    Operator.buildPath(operatorList, fn!, args, parsingText);

  }

  @handle(OPS.curveTo3)
  static curveTo3(ctx: ProcessContext) {
    Operator.buildPath(operatorList, fn!, args, parsingText);

  }

  @handle(OPS.closePath)
  static closePath(ctx: ProcessContext) {
    Operator.buildPath(operatorList, fn!, args, parsingText);

  }

  @handle(OPS.rectangle)
  static rectangle(ctx: ProcessContext) {
    Operator.buildPath(operatorList, fn!, args, parsingText);

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
  static markPoint(_ctx: ProcessContext) {
  }

  /**
   * @see {@link Operator.markPoint}
   */
  @handle(OPS.markPointProps)
  static markPointProps(_ctx: ProcessContext) { }

  /** 
   * @see {@link Operator.markPoint}
   */
  @handle(OPS.beginCompat)
  static beginCompat(_ctx: ProcessContext) { }

  /**
   * @see {@link Operator.markPoint}
   */
  @handle(OPS.endCompat)
  static endCompat(_ctx: ProcessContext) { }

  /**
   * @see {@link Operator.markPoint}
   */
  @handle(OPS.beginMarkedContentProps)
  static beginMarkedContentProps(_ctx: ProcessContext) {

  }

  @handle(DEFAULT)
  static defaultHandler(ctx: ProcessContext) {
    // Note: Ignore the operator if it has `Dict` arguments, since
    // those are non-serializable, otherwise postMessage will throw
    // "An object could not be cloned.".
    if (ctx.args !== null) {
      let i = 0, ii = ctx.args.length;
      for (; i < ii; i++) {
        if (ctx.args[i] instanceof Dict) {
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

class Operators {

  protected readonly operators: Map<OPS, (context: ProcessContext) => void>;

  protected readonly defaultHandler: Function;

  constructor() {
    this.operators = Operator.buildOperatorMap();
    this.defaultHandler = Operator.defaultHandler;
  }

  execute(ops: OPS, context: ProcessContext): void | /* SKIP */1 | /* OVER */ 2 {
    return (this.operators.get(ops) ?? this.defaultHandler)(context)
  }
}

interface ProcessOperation {
  fn: OPS | null;
  args: any[] | null;
}


// 所有的处理都围绕着ProcessContext来，包括next方法
// 所有的处理方法都是静态函数，避免大量的创建对象
interface ProcessContext extends ProcessOperation {
  stateManager: StateManager;
  parsingText: boolean;
  operatorList: OperatorList;
  tsm: TimeSlotManager;
  preprocessor: EvaluatorPreprocessor;
  next: (promise: Promise<unknown>) => void;
}

export class GetOperatorListHandler {

  protected operators: Operators;

  protected operatorList: OperatorList;

  protected task: WorkerTask;

  protected timeSlotManager = new TimeSlotManager();

  protected stateManager: StateManager;

  protected preprocessor: EvaluatorPreprocessor;

  constructor(
    stream: BaseStream,
    task: WorkerTask,
    xref: XRef,
    resources: Dict,
    operatorList: OperatorList,
    initialState: State = new EvalState(),
    fallbackFontDict: Dict | null = null,
  ) {
    if (!operatorList) {
      throw new Error('getOperatorList: missing "operatorList" parameter');
    }
    this.stateManager = new StateManager(initialState);
    this.task = task;
    this.operatorList = operatorList;
    this.preprocessor = new EvaluatorPreprocessor(stream, xref, this.stateManager)
    this.operators = new Operators();
  }

  initOperators() {
    this.operators = new Operators();
  }

  async handle() {
    const operatorList = this.operatorList;
    const options = this.options;
    const handler = new Promise<void>((resolve, reject) => {
      // 确保context值初始化一次
      const context: ProcessContext = {
        fn: null,
        args: null,
        stateManager: this.stateManager,
        operatorList: this.operatorList,
        parsingText: false,
        tsm: new TimeSlotManager(),
        preprocessor: this.preprocessor,
        next: (promise: Promise<unknown>) => {
          Promise.all([promise, operatorList.ready]).then(() => {
            try {
              this.process(resolve, reject, context)
            } catch (ex) {
              reject(ex);
            }
          }, reject);
        }
      }
      this.process(resolve, reject, context);
    });
    return handler.catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.options.ignoreErrors) {
        warn(
          `getOperatorList - ignoring errors during "${task.name}" ` +
          `task: "${reason}".`
        );

        this.closePendingRestoreOPS();
        return;
      }
      throw reason;
    });
  }

  process(
    resolve: (value: void | PromiseLike<void>) => void,
    _reject: (reason?: any) => void, context: ProcessContext
  ) {
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
      const ret = this.operators.execute(fn, context);
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
    this.closePendingRestoreOPS(context);
    resolve();
  }

  closePendingRestoreOPS() {
    for (let i = 0, ii = this.preprocessor.savedStatesDepth; i < ii; i++) {
      this.operatorList.addOp(OPS.restore, []);
    }
  }
}