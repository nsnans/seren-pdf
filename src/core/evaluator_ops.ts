import { DocumentEvaluatorOptions } from "../display/api";
import { RectType, TransformType } from "../display/display_utils";
import { OPS } from "../pdf";
import { CommonObjType, MessageHandler, ObjType } from "../shared/message_handler";
import { AbortException, assert, FormatError, info, TextRenderingMode, warn } from "../shared/util";
import { MutableArray } from "../types";
import { BaseStream } from "./base_stream";
import { ColorSpace } from "./colorspace";
import { ImageMask } from "./core_types";
import { isNumberArray, lookupMatrix, lookupNormalRect } from "./core_utils";
import { addLocallyCachedImageOps, CssFontInfo, EvalState, EvaluatorPreprocessor, normalizeBlendMode, PartialEvaluator, State, StateManager, TimeSlotManager, TranslatedFont } from "./evaluator";
import { ErrorFont } from "./fonts";
import { PDFImage } from "./image";
import { GlobalImageCache, GroupOptions, ImageCacheData, LocalColorSpaceCache, LocalGStateCache, LocalImageCache, LocalTilingPatternCache, OptionalContent, RegionalImageCache } from "./image_utils";
import { OperatorList } from "./operator_list";
import { getTilingPatternIR, Pattern } from "./pattern";
import { Dict, DictKey, isName, Name, Ref } from "./primitives";
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

  @handle(OPS.paintXObject)
  static paintXObject(ctx: ProcessContext) {
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
        this.buildFormXObject(ctx).then(() => {
          ctx.stateManager.restore();
          resolve();
        }, reject);
        return;
      } else if (type.name === "Image") {
        this.buildPaintImageXObject(ctx).then(resolve, reject);
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
  static setFont(ctx: ProcessContext) {
    const fontSize = ctx.args![1];
    ctx.next(this.handleSetFont(ctx).then(loadedName => {
      ctx.operatorList.addDependency(loadedName);
      ctx.operatorList.addOp(OPS.setFont, [loadedName, fontSize])
    }));
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
    const cacheKey = ctx.args![0].cacheKey;
    if (cacheKey) {
      const localImage = ctx.localImageCache.getByName(cacheKey);
      if (localImage) {
        addLocallyCachedImageOps(ctx.operatorList, localImage);
        return
      }
    }
    ctx.next(this.buildPaintImageXObject(ctx))
    return OVER
  }

  @handle(OPS.showText)
  static showText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      Operator.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    ctx.args![0] = this.handleText(ctx, ctx.args![0], ctx.stateManager.state);
  }

  @handle(OPS.showSpacedText)
  static showSpacedText(ctx: ProcessContext) {
    if (!ctx.stateManager.state.font) {
      Operator.ensureStateFont(ctx.stateManager.state);
      return SKIP
    }
    const combinedGlyphs = [];
    for (const arrItem of ctx.args![0]) {
      if (typeof arrItem === "string") {
        combinedGlyphs.push(...this.handleText(ctx, arrItem, ctx.stateManager.state));
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
    ctx.args![0] = this.handleText(ctx, ctx.args![0], ctx.stateManager.state);
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
    ctx.args![0] = this.handleText(ctx, ctx.args![0], ctx.stateManager.state);
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
    ctx.args = cs.getRgb(ctx.args, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillGray)
  static setFillGray(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.gray;
    ctx.args = ColorSpace.singletons.gray.getRgb(args, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeGray)
  static setStrokeGray(ctx: ProcessContext) {
    ctx.stateManager.state.strokeColorSpace = ColorSpace.singletons.gray;
    ctx.args = ColorSpace.singletons.gray.getRgb(args, 0);
    ctx.fn = OPS.setStrokeRGBColor;
  }

  @handle(OPS.setFillCMYKColor)
  static setFillCMYKColor(ctx: ProcessContext) {
    ctx.stateManager.state.fillColorSpace = ColorSpace.singletons.cmyk;
    ctx.args = ColorSpace.singletons.cmyk.getRgb(ctx.args, 0);
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
        ctx.args = ColorSpace.singletons.gray.getRgb(args, 0);
        ctx.fn = OPS.setFillRGBColor;
        return
      }
      ctx.args = [];
      ctx.fn = OPS.setFillTransparent;
      return
    }
    if (cs.name === "Pattern") {
      ctx.next(this.handleColorN(ctx));
      return OVER
    }
    ctx.args = cs.getRgb(ctx.args, 0);
    ctx.fn = OPS.setFillRGBColor;
  }

  @handle(OPS.setStrokeColorN)
  static setStrokeColorN(ctx: ProcessContext) {
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
      ctx.next(Operator.handleColorN(ctx));
      return OVER;
    }
    ctx.args = cs.getRgb(ctx.args, 0);
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
      if (ctx.ignoreErrors) {
        warn(`getOperatorList - ignoring Shading: "${reason}".`);
        return SKIP;
      }
      throw reason;
    }
    const patternId = this.parseShading(ctx, shading);
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
    ctx.next(new Promise<void>((resolve, reject) => {
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

      Operator._setGState(ctx, gState, name).then(resolve, reject);
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
  static moveTo(ctx: ProcessContext) {
    Operator.buildPath(ctx.operatorList, ctx.fn!, ctx.args, ctx.parsingText);
  }

  @handle(OPS.lineTo)
  static lineTo(ctx: ProcessContext) {
    Operator.buildPath(ctx.operatorList, ctx.fn!, ctx.args, ctx.parsingText);

  }

  @handle(OPS.curveTo)
  static curveTo(ctx: ProcessContext) {
    Operator.buildPath(ctx.operatorList, ctx.fn!, ctx.args, ctx.parsingText);

  }

  @handle(OPS.curveTo2)
  static curveTo2(ctx: ProcessContext) {
    Operator.buildPath(ctx.operatorList, ctx.fn!, ctx.args, ctx.parsingText);

  }

  @handle(OPS.curveTo3)
  static curveTo3(ctx: ProcessContext) {
    Operator.buildPath(ctx.operatorList, ctx.fn!, ctx.args, ctx.parsingText);

  }

  @handle(OPS.closePath)
  static closePath(ctx: ProcessContext) {
    Operator.buildPath(ctx.operatorList, ctx.fn!, ctx.args, ctx.parsingText);

  }

  @handle(OPS.rectangle)
  static rectangle(ctx: ProcessContext) {
    Operator.buildPath(ctx.operatorList, ctx.fn!, ctx.args, ctx.parsingText);
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

  static async handleSetFont(ctx: ProcessContext): Promise<string> {
    const fontName = fontArgs?.[0] instanceof Name ? fontArgs[0].name : null;

    let translated = await this.loadFont(
      fontName, fontRef, resources, fallbackFontDict, cssFontInfo
    );

    if (translated.font.isType3Font) {
      try {
        await translated.loadType3Data(this, resources, task);
        // Add the dependencies to the parent operatorList so they are
        // resolved before Type3 operatorLists are executed synchronously.
        ctx.operatorList.addDependencies(translated.type3Dependencies!);
      } catch (reason) {
        translated = new TranslatedFont(
          "g_font_error",
          new ErrorFont(`Type3 font load error: ${reason}`),
          // 这里是个坑爹的问题，估计出问题的时候，直接拿这个font来存dict了
          translated.font as unknown as Dict,
          ctx.options,
        );
      }
    }

    state.font = translated.font;
    translated.send(ctx.handler);
    return translated.loadedName;
  }

  loadFont(
    fontName: string | null,
    font: Ref | Dict | null,
    resources: Dict,
    fallbackFontDict: Dict | null = null,
    cssFontInfo: CssFontInfo | null = null
  ): Promise<TranslatedFont> {
    // eslint-disable-next-line arrow-body-style
    const errorFont = async () => {
      return new TranslatedFont(
        "g_font_error",
        new ErrorFont(`Font "${fontName}" is not available.`),
        <Dict>font,
        this.options,
      );
    };

    let fontRef: Ref | null = null;
    if (font) {
      // Loading by ref.
      if (font instanceof Ref) {
        fontRef = font;
      }
    } else {
      // Loading by name.
      const fontRes = resources.getValue(DictKey.Font);
      if (fontRes) {
        fontRef = <Ref>(<Dict>fontRes).getRaw(<DictKey>fontName);
      }
    }
    if (fontRef) {
      if (this.type3FontRefs?.has(fontRef)) {
        return errorFont();
      }

      if (this.fontCache.has(fontRef)) {
        return this.fontCache.get(fontRef);
      }

      try {
        font = this.xref.fetchIfRef(fontRef);
      } catch (ex) {
        warn(`loadFont - lookup failed: "${ex}".`);
      }
    }

    if (!(font instanceof Dict)) {
      if (!this.options.ignoreErrors && !this.parsingType3Font) {
        warn(`Font "${fontName}" is not available.`);
        return errorFont();
      }
      warn(
        `Font "${fontName}" is not available -- attempting to fallback to a default font.`
      );

      // Falling back to a default font to avoid completely broken rendering,
      // but note that there're no guarantees that things will look "correct".
      font = fallbackFontDict || PartialEvaluator.fallbackFontDict;
    }

    // We are holding `font.cacheKey` references only for `fontRef`s that
    // are not actually `Ref`s, but rather `Dict`s. See explanation below.
    if (font.cacheKey && this.fontCache.has(font.cacheKey)) {
      return this.fontCache.get(font.cacheKey);
    }

    const { promise, resolve } = <PromiseWithResolvers<TranslatedFont>>Promise.withResolvers();

    let preEvaluatedFont;
    try {
      preEvaluatedFont = this.preEvaluateFont(font);
      preEvaluatedFont.cssFontInfo = cssFontInfo;
    } catch (reason) {
      warn(`loadFont - preEvaluateFont failed: "${reason}".`);
      return errorFont();
    }
    const { descriptor, hash } = preEvaluatedFont;

    const fontRefIsRef = fontRef instanceof Ref;
    let fontID;

    if (hash && descriptor instanceof Dict) {
      const fontAliases = (descriptor.fontAliases ||= Object.create(null));

      if (fontAliases[hash]) {
        const aliasFontRef = fontAliases[hash].aliasRef;
        if (fontRefIsRef && aliasFontRef && this.fontCache.has(aliasFontRef)) {
          this.fontCache.putAlias(fontRef!, aliasFontRef);
          return this.fontCache.get(fontRef!);
        }
      } else {
        fontAliases[hash] = {
          fontID: this.idFactory.createFontId(),
        };
      }

      if (fontRefIsRef) {
        fontAliases[hash].aliasRef = fontRef;
      }
      fontID = fontAliases[hash].fontID;
    } else {
      fontID = this.idFactory.createFontId();
    }

    assert(fontID?.startsWith("f"), 'The "fontID" must be (correctly) defined.');

    // Workaround for bad PDF generators that reference fonts incorrectly,
    // where `fontRef` is a `Dict` rather than a `Ref` (fixes bug946506.pdf).
    // In this case we cannot put the font into `this.fontCache` (which is
    // a `RefSetCache`), since it's not possible to use a `Dict` as a key.
    //
    // However, if we don't cache the font it's not possible to remove it
    // when `cleanup` is triggered from the API, which causes issues on
    // subsequent rendering operations (see issue7403.pdf) and would force us
    // to unnecessarily load the same fonts over and over.
    //
    // Instead, we cheat a bit by using a modified `fontID` as a key in
    // `this.fontCache`, to allow the font to be cached.
    // NOTE: This works because `RefSetCache` calls `toString()` on provided
    //       keys. Also, since `fontRef` is used when getting cached fonts,
    //       we'll not accidentally match fonts cached with the `fontID`.
    if (fontRefIsRef) {
      this.fontCache.put(fontRef!, promise);
    } else {
      font.cacheKey = `cacheKey_${fontID}`;
      this.fontCache.put(font.cacheKey, promise);
    }

    // Keep track of each font we translated so the caller can
    // load them asynchronously before calling display on a page.
    font.loadedName = `${this.idFactory.getDocId()}_${fontID}`;

    this.translateFont(preEvaluatedFont)
      .then(translatedFont => {
        resolve(
          new TranslatedFont(
            font.loadedName!,
            translatedFont,
            font,
            this.options,
          )
        );
      })
      .catch(reason => {
        // TODO reject?
        warn(`loadFont - translateFont failed: "${reason}".`);

        resolve(
          new TranslatedFont(
            font.loadedName!,
            new ErrorFont(
              reason instanceof Error ? reason.message : reason
            ),
            font,
            this.options,
          )
        );
      });
    return promise;
  }

  static loadFont(
    fontName: string | null,
    font: Ref | Dict | null,
    resources: Dict,
    fallbackFontDict: Dict | null = null,
    cssFontInfo: CssFontInfo | null = null
  ): Promise<TranslatedFont> {
    // eslint-disable-next-line arrow-body-style
    const errorFont = async () => {
      return new TranslatedFont(
        "g_font_error",
        new ErrorFont(`Font "${fontName}" is not available.`),
        <Dict>font,
        this.options,
      );
    };

    let fontRef: Ref | null = null;
    if (font) {
      // Loading by ref.
      if (font instanceof Ref) {
        fontRef = font;
      }
    } else {
      // Loading by name.
      const fontRes = resources.getValue(DictKey.Font);
      if (fontRes) {
        fontRef = <Ref>(<Dict>fontRes).getRaw(<DictKey>fontName);
      }
    }
    if (fontRef) {
      if (this.type3FontRefs?.has(fontRef)) {
        return errorFont();
      }

      if (this.fontCache.has(fontRef)) {
        return this.fontCache.get(fontRef);
      }

      try {
        font = this.xref.fetchIfRef(fontRef);
      } catch (ex) {
        warn(`loadFont - lookup failed: "${ex}".`);
      }
    }

    if (!(font instanceof Dict)) {
      if (!this.options.ignoreErrors && !this.parsingType3Font) {
        warn(`Font "${fontName}" is not available.`);
        return errorFont();
      }
      warn(
        `Font "${fontName}" is not available -- attempting to fallback to a default font.`
      );

      // Falling back to a default font to avoid completely broken rendering,
      // but note that there're no guarantees that things will look "correct".
      font = fallbackFontDict || PartialEvaluator.fallbackFontDict;
    }

    // We are holding `font.cacheKey` references only for `fontRef`s that
    // are not actually `Ref`s, but rather `Dict`s. See explanation below.
    if (font.cacheKey && this.fontCache.has(font.cacheKey)) {
      return this.fontCache.get(font.cacheKey);
    }

    const { promise, resolve } = <PromiseWithResolvers<TranslatedFont>>Promise.withResolvers();

    let preEvaluatedFont;
    try {
      preEvaluatedFont = this.preEvaluateFont(font);
      preEvaluatedFont.cssFontInfo = cssFontInfo;
    } catch (reason) {
      warn(`loadFont - preEvaluateFont failed: "${reason}".`);
      return errorFont();
    }
    const { descriptor, hash } = preEvaluatedFont;

    const fontRefIsRef = fontRef instanceof Ref;
    let fontID;

    if (hash && descriptor instanceof Dict) {
      const fontAliases = (descriptor.fontAliases ||= Object.create(null));

      if (fontAliases[hash]) {
        const aliasFontRef = fontAliases[hash].aliasRef;
        if (fontRefIsRef && aliasFontRef && this.fontCache.has(aliasFontRef)) {
          this.fontCache.putAlias(fontRef!, aliasFontRef);
          return this.fontCache.get(fontRef!);
        }
      } else {
        fontAliases[hash] = {
          fontID: this.idFactory.createFontId(),
        };
      }

      if (fontRefIsRef) {
        fontAliases[hash].aliasRef = fontRef;
      }
      fontID = fontAliases[hash].fontID;
    } else {
      fontID = this.idFactory.createFontId();
    }
    assert(
      fontID?.startsWith("f"),
      'The "fontID" must be (correctly) defined.'
    );

    // Workaround for bad PDF generators that reference fonts incorrectly,
    // where `fontRef` is a `Dict` rather than a `Ref` (fixes bug946506.pdf).
    // In this case we cannot put the font into `this.fontCache` (which is
    // a `RefSetCache`), since it's not possible to use a `Dict` as a key.
    //
    // However, if we don't cache the font it's not possible to remove it
    // when `cleanup` is triggered from the API, which causes issues on
    // subsequent rendering operations (see issue7403.pdf) and would force us
    // to unnecessarily load the same fonts over and over.
    //
    // Instead, we cheat a bit by using a modified `fontID` as a key in
    // `this.fontCache`, to allow the font to be cached.
    // NOTE: This works because `RefSetCache` calls `toString()` on provided
    //       keys. Also, since `fontRef` is used when getting cached fonts,
    //       we'll not accidentally match fonts cached with the `fontID`.
    if (fontRefIsRef) {
      this.fontCache.put(fontRef!, promise);
    } else {
      font.cacheKey = `cacheKey_${fontID}`;
      this.fontCache.put(font.cacheKey, promise);
    }

    // Keep track of each font we translated so the caller can
    // load them asynchronously before calling display on a page.
    font.loadedName = `${this.idFactory.getDocId()}_${fontID}`;

    this.translateFont(preEvaluatedFont)
      .then(translatedFont => {
        resolve(
          new TranslatedFont(
            font.loadedName!,
            translatedFont,
            font,
            this.options,
          )
        );
      })
      .catch(reason => {
        // TODO reject?
        warn(`loadFont - translateFont failed: "${reason}".`);

        resolve(
          new TranslatedFont(
            font.loadedName!,
            new ErrorFont(reason instanceof Error ? reason.message : reason),
            font,
            this.options,
          )
        );
      });
    return promise;
  }

  static buildPath(operatorList: OperatorList, fn: OPS, args: MutableArray<any> | null, parsingText: boolean) {
    const lastIndex = operatorList.length - 1;
    if (!args) {
      args = [];
    }
    if (lastIndex < 0 || operatorList.fnArray[lastIndex] !== OPS.constructPath) {
      // Handle corrupt PDF documents that contains path operators inside of
      // text objects, which may shift subsequent text, by enclosing the path
      // operator in save/restore operators (fixes issue10542_reduced.pdf).
      //
      // Note that this will effectively disable the optimization in the
      // `else` branch below, but given that this type of corruption is
      // *extremely* rare that shouldn't really matter much in practice.
      if (parsingText) {
        warn(`Encountered path operator "${fn}" inside of a text object.`);
        operatorList.addOp(OPS.save, null);
      }

      let minMax: RectType;
      switch (fn) {
        case OPS.rectangle:
          const x = args[0] + args[2];
          const y = args[1] + args[3];
          minMax = [
            Math.min(args[0], x), Math.min(args[1], y), Math.max(args[0], x), Math.max(args[1], y)
          ];
          break;
        case OPS.moveTo:
        case OPS.lineTo:
          minMax = [args[0], args[1], args[0], args[1]];
          break;
        default:
          minMax = [Infinity, Infinity, -Infinity, -Infinity];
          break;
      }
      operatorList.addOp(OPS.constructPath, [[fn], args, minMax]);

      if (parsingText) {
        operatorList.addOp(OPS.restore, null);
      }
    } else {
      const opArgs = operatorList.argsArray[lastIndex]!;
      opArgs[0].push(fn);
      opArgs[1].push(...args);
      const minMax = opArgs[2];

      // Compute min/max in the worker instead of the main thread.
      // If the current matrix (when drawing) is a scaling one
      // then min/max can be easily computed in using those values.
      // Only rectangle, lineTo and moveTo are handled here since
      // Bezier stuff requires to have the starting point.
      switch (fn) {
        case OPS.rectangle:
          const x = args[0] + args[2];
          const y = args[1] + args[3];
          minMax[0] = Math.min(minMax[0], args[0], x);
          minMax[1] = Math.min(minMax[1], args[1], y);
          minMax[2] = Math.max(minMax[2], args[0], x);
          minMax[3] = Math.max(minMax[3], args[1], y);
          break;
        case OPS.moveTo:
        case OPS.lineTo:
          minMax[0] = Math.min(minMax[0], args[0]);
          minMax[1] = Math.min(minMax[1], args[1]);
          minMax[2] = Math.max(minMax[2], args[0]);
          minMax[3] = Math.max(minMax[3], args[1]);
          break;
      }
    }
  }

  static async _setGState(ctx: ProcessContext, gState: Dict, cacheKey: string) {
    const gStateRef = gState.objId;
    let isSimpleGState = true;
    // This array holds the converted/processed state data.
    const gStateObj: [DictKey, any][] = [];
    let promise = Promise.resolve();
    for (const key of gState.getKeys()) {
      const value = gState.getValue(key);
      switch (key) {
        case DictKey.Type:
          break;
        case DictKey.LW:
        case DictKey.LC:
        case DictKey.LJ:
        case DictKey.ML:
        case DictKey.D:
        case DictKey.RI:
        case DictKey.FL:
        case DictKey.CA:
        case DictKey.ca:
          gStateObj.push([key, value]);
          break;
        case DictKey.Font:
          isSimpleGState = false;

          promise = promise.then(() =>
            this.handleSetFont(
              resources,
              null,
              (<(Ref | null)[]>value)[0],
              operatorList,
              task,
              stateManager.state
            ).then(function (loadedName) {
              ctx.operatorList.addDependency(loadedName);
              gStateObj.push([key, [loadedName, (<Dict[]>value)[1]]]);
            })
          );
          break;
        case DictKey.BM:
          gStateObj.push([key, normalizeBlendMode(<Name>value)]);
          break;
        case "SMask":
          if (isName(value, "None")) {
            gStateObj.push([key, false]);
            break;
          }
          if (value instanceof Dict) {
            isSimpleGState = false;

            promise = promise.then(() =>
              this.handleSMask(
                value,
                resources,
                operatorList,
                task,
                stateManager,
                localColorSpaceCache
              )
            );
            gStateObj.push([key, true]);
          } else {
            warn("Unsupported SMask type");
          }
          break;
        case DictKey.TR:
          const transferMaps = this.handleTransferFunction(<Dict | BaseStream>value);
          gStateObj.push([key, transferMaps]);
          break;
        // Only generate info log messages for the following since
        // they are unlikely to have a big impact on the rendering.
        case DictKey.OP:
        case DictKey.op:
        case DictKey.OPM:
        case DictKey.BG:
        case DictKey.BG2:
        case DictKey.UCR:
        case DictKey.UCR2:
        case DictKey.TR2:
        case DictKey.HT:
        case DictKey.SM:
        case DictKey.SA:
        case DictKey.AIS:
        case DictKey.TK:
          // TODO implement these operators.
          info("graphic state operator " + key);
          break;
        default:
          info("Unknown graphic state operator " + key);
          break;
      }
    }
    await promise;

    if (gStateObj.length > 0) {
      ctx.operatorList.addOp(OPS.setGState, [gStateObj]);
    }

    if (isSimpleGState) {
      ctx.localGStateCache.set(cacheKey!, gStateRef!, gStateObj);
    }
  }

  static async buildFormXObject(ctx: ProcessContext) {
    const dict = xobj.dict!;
    const matrix = <TransformType | null>lookupMatrix(dict.getArrayValue(DictKey.Matrix), null);
    const bbox = lookupNormalRect(dict.getArrayValue(DictKey.BBox), null);

    let optionalContent, groupOptions: GroupOptions | null = null;
    if (dict.has(DictKey.OC)) {
      optionalContent = await this.parseMarkedContentProps(
        dict.getValue(DictKey.OC), ctx.resources
      );
    }
    if (optionalContent !== undefined) {
      ctx.operatorList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    const group = dict.getValue(DictKey.Group);
    if (group) {
      groupOptions = {
        matrix, bbox, smask, isolated: false, knockout: false
      };

      const groupSubtype = group.get(DictKey.S);
      let colorSpace = null;
      if (isName(groupSubtype, "Transparency")) {
        groupOptions!.isolated = group.get(DictKey.I) || false;
        groupOptions!.knockout = group.get(DictKey.K) || false;
        if (group.has(DictKey.CS)) {
          const cs = group.getRaw(DictKey.CS);

          const cachedColorSpace = ColorSpace.getCached(
            cs, ctx.xref, ctx.localColorSpaceCache
          );
          if (cachedColorSpace) {
            colorSpace = cachedColorSpace;
          } else {
            colorSpace = await this.parseColorSpace(
              cs, ctx.resources, ctx.localColorSpaceCache,
            );
          }
        }
      }

      if (smask?.backdrop) {
        colorSpace ||= ColorSpace.singletons.rgb;
        smask.backdrop = colorSpace.getRgb(smask.backdrop, 0);
      }

      ctx.operatorList.addOp(OPS.beginGroup, [groupOptions]);
    }

    // If it's a group, a new canvas will be created that is the size of the
    // bounding box and translated to the correct position so we don't need to
    // apply the bounding box to it.
    const args: [TransformType | null, RectType | null] = group ? [matrix, null] : [matrix, bbox];
    ctx.operatorList.addOp(OPS.paintFormXObjectBegin, args);

    await ctx.handle();
    ctx.operatorList.addOp(OPS.paintFormXObjectEnd, []);

    if (group) {
      ctx.operatorList.addOp(OPS.endGroup, [groupOptions!]);
    }

    if (optionalContent !== undefined) {
      ctx.operatorList.addOp(OPS.endMarkedContent, []);
    }
  }

  static async parseMarkedContentProps(contentProperties: Name | Dict, resources: Dict | null): Promise<OptionalContent | null> {
    let optionalContent: Dict;
    if (contentProperties instanceof Name) {
      const properties = resources!.getValue(DictKey.Properties);
      optionalContent = properties.get(<DictKey>contentProperties.name);
    } else if (contentProperties instanceof Dict) {
      optionalContent = contentProperties;
    } else {
      throw new FormatError("Optional content properties malformed.");
    }

    const optionalContentType = optionalContent.get(DictKey.Type)?.name;
    if (optionalContentType === "OCG") {
      return {
        type: optionalContentType,
        id: optionalContent.objId,
      };
    } else if (optionalContentType === "OCMD") {
      const expression = optionalContent.get(DictKey.VE);
      if (Array.isArray(expression)) {
        const result = [] as (string | string[])[];
        this._parseVisibilityExpression(expression, 0, result);
        if (result.length > 0) {
          return {
            type: "OCMD",
            expression: result,
          };
        }
      }

      const optionalContentGroups = optionalContent.get(DictKey.OCGs);
      if (
        Array.isArray(optionalContentGroups) ||
        optionalContentGroups instanceof Dict
      ) {
        const groupIds: (string | null)[] = [];
        if (Array.isArray(optionalContentGroups)) {
          for (const ocg of optionalContentGroups) {
            groupIds.push(ocg.toString());
          }
        } else {
          // Dictionary, just use the obj id.
          groupIds.push(optionalContentGroups.objId);
        }

        return {
          type: optionalContentType,
          ids: groupIds,
          policy: optionalContent.get(DictKey.P) instanceof Name
            ? optionalContent.get(DictKey.P).name : null,
          expression: null,
        };
      } else if (optionalContentGroups instanceof Ref) {
        return {
          type: optionalContentType,
          id: optionalContentGroups.toString(),
        };
      }
    }
    return null;
  }

  static _parseVisibilityExpression(array: any[], nestingCounter: number, currentResult: (string | string[])[]) {
    const MAX_NESTING = 10;
    if (++nestingCounter > MAX_NESTING) {
      warn("Visibility expression is too deeply nested");
      return;
    }
    const length = array.length;
    const operator = this.xref.fetchIfRef(array[0]);
    if (length < 2 || !(operator instanceof Name)) {
      warn("Invalid visibility expression");
      return;
    }
    switch (operator.name) {
      case "And":
      case "Or":
      case "Not":
        currentResult.push(operator.name);
        break;
      default:
        warn(`Invalid operator ${operator.name} in visibility expression`);
        return;
    }
    for (let i = 1; i < length; i++) {
      const raw = array[i];
      const object = this.xref.fetchIfRef(raw);
      if (Array.isArray(object)) {
        const nestedResult = <string[]>[];
        currentResult.push(nestedResult);
        // Recursively parse a subarray.
        this._parseVisibilityExpression(object, nestingCounter, nestedResult);
      } else if (raw instanceof Ref) {
        // Reference to an OCG dictionary.
        currentResult.push(raw.toString());
      }
    }
  }

  static async parseColorSpace(cs: Name | Ref | (Ref | Name)[], resources: Dict | null
    , localColorSpaceCache: LocalColorSpaceCache) {
    return ColorSpace.parseAsync(
      cs, this.xref, resources, this._pdfFunctionFactory, localColorSpaceCache,
    ).catch(reason => {
      if (reason instanceof AbortException) {
        return null;
      }
      if (this.options.ignoreErrors) {
        warn(`parseColorSpace - ignoring ColorSpace: "${reason}".`);
        return null;
      }
      throw reason;
    });
  }

  static async buildPaintImageXObject(
    ctx: ProcessContext,
    image: BaseStream,
    isInline: boolean,
    cacheKey: string | null
  ) {
    const dict = image.dict!;
    const imageRef = dict.objId;
    const w = dict.getValueWithFallback(DictKey.W, DictKey.Width);
    const h = dict.getValueWithFallback(DictKey.H, DictKey.Height);

    if (!(w && typeof w === "number") || !(h && typeof h === "number")) {
      warn("Image dimensions are missing, or not numbers.");
      return;
    }
    const maxImageSize = ctx.options.maxImageSize;
    if (maxImageSize !== -1 && w * h > maxImageSize) {
      const msg = "Image exceeded maximum allowed size and was removed.";

      if (this.options.ignoreErrors) {
        warn(msg);
        return;
      }
      throw new Error(msg);
    }

    let optionalContent = null;
    if (dict.has(DictKey.OC)) {
      optionalContent = await this.parseMarkedContentProps(
        dict.getValue(DictKey.OC),
        resources
      );
    }

    const imageMask = dict.getValueWithFallback(DictKey.IM, DictKey.ImageMask) || false;
    let imgData: ImageMask, args;
    if (imageMask) {
      // This depends on a tmpCanvas being filled with the
      // current fillStyle, such that processing the pixel
      // data can't be done here. Instead of creating a
      // complete PDFImage, only read the information needed
      // for later.
      const interpolate = dict.getValueWithFallback(DictKey.I, DictKey.Interpolate);
      const bitStrideLength = (w + 7) >> 3;
      const imgArray = image.getBytes(bitStrideLength * h);
      const decode = <number[]>dict.getArrayWithFallback(DictKey.D, DictKey.Decode);

      if (this.parsingType3Font) {
        imgData = PDFImage.createRawMask(
          imgArray,
          w,
          h,
          image instanceof DecodeStream,
          decode?.[0] > 0,
          interpolate,
        );

        imgData.cached = !!cacheKey;
        args = [imgData];

        operatorList.addImageOps(
          OPS.paintImageMaskXObject,
          <[ImageMask]>args,
          <OptionalContent | null>optionalContent
        );

        if (cacheKey) {
          const cacheData = {
            fn: OPS.paintImageMaskXObject,
            args,
            optionalContent,
          };
          localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

          if (imageRef) {
            this._regionalImageCache.set(
              /* name = */ null,
              imageRef,
              <ImageCacheData>cacheData
            );
          }
        }
        return;
      }

      const result = await PDFImage.createMask(
        imgArray,
        w,
        h,
        image instanceof DecodeStream,
        decode?.[0] > 0,
        interpolate,
        this.options.isOffscreenCanvasSupported,
      );

      if ((<SingleOpaquePixelImageMask>result).isSingleOpaquePixel) {
        // Handles special case of mainly LaTeX documents which use image
        // masks to draw lines with the current fill style.
        operatorList.addImageOps(
          OPS.paintSolidColorImageMask,
          [],
          optionalContent
        );

        if (cacheKey) {
          const cacheData = {
            fn: OPS.paintSolidColorImageMask,
            args: [],
            optionalContent,
          };
          localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

          if (imageRef) {
            this._regionalImageCache.set(
              /* name = */ null,
              imageRef,
              <ImageCacheData>cacheData
            );
          }
        }
        return;
      }

      imgData = <ImageMask>result;

      const objId = `mask_${this.idFactory.createObjId()}`;
      operatorList.addDependency(objId);
      imgData.dataLen = imgData.bitmap
        ? imgData.width * imgData.height * 4
        : imgData.data!.length;
      this._sendImgData(objId, imgData);

      args = [
        {
          data: objId,
          width: imgData.width,
          height: imgData.height,
          interpolate: imgData.interpolate,
          count: 1,
        },
      ];
      operatorList.addImageOps(
        OPS.paintImageMaskXObject,
        <[ImageMaskXObject]>args,
        optionalContent
      );

      if (cacheKey) {
        const cacheData = {
          objId,
          fn: OPS.paintImageMaskXObject,
          args,
          optionalContent,
        };
        localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

        if (imageRef) {
          this._regionalImageCache.set(/* name = */ null, imageRef, <ImageCacheData>cacheData);
        }
      }
      return;
    }

    const SMALL_IMAGE_DIMENSIONS = 200;
    // Inlining small images into the queue as RGB data
    if (
      isInline &&
      w + h < SMALL_IMAGE_DIMENSIONS &&
      !dict.has(DictKey.SMask) &&
      !dict.has(DictKey.Mask)
    ) {
      try {
        const imageObj = new PDFImage(
          this.xref,
          resources,
          image,
          isInline,
          null,
          null,
          false,
          this._pdfFunctionFactory,
          localColorSpaceCache,
        );
        // We force the use of RGBA_32BPP images here, because we can't handle
        // any other kind.
        imgData = await imageObj.createImageData(
          /* forceRGBA = */ true,
          /* isOffscreenCanvasSupported = */ false
        );
        operatorList.isOffscreenCanvasSupported =
          this.options.isOffscreenCanvasSupported;
        operatorList.addImageOps(
          OPS.paintInlineImageXObject,
          [imgData],
          optionalContent
        );
      } catch (reason) {
        const msg = `Unable to decode inline image: "${reason}".`;

        if (!this.options.ignoreErrors) {
          throw new Error(msg);
        }
        warn(msg);
      }
      return;
    }

    // If there is no imageMask, create the PDFImage and a lot
    // of image processing can be done here.
    let objId = `img_${this.idFactory.createObjId()}`,
      cacheGlobally = false;

    if (this.parsingType3Font) {
      objId = `${this.idFactory.getDocId()}_type3_${objId}`;
    } else if (cacheKey && imageRef) {
      cacheGlobally = this.globalImageCache.shouldCache(
        imageRef,
        this.pageIndex
      );

      if (cacheGlobally) {
        assert(!isInline, "Cannot cache an inline image globally.");

        objId = `${this.idFactory.getDocId()}_${objId}`;
      }
    }

    // Ensure that the dependency is added before the image is decoded.
    operatorList.addDependency(objId);
    args = <[string, number, number]>[objId, w, h];
    operatorList.addImageOps(OPS.paintImageXObject, args, optionalContent);

    if (cacheGlobally) {
      if (this.globalImageCache.hasDecodeFailed(imageRef!)) {
        this.globalImageCache.setData(imageRef!, <GlobalImageCacheData>{
          objId,
          fn: OPS.paintImageXObject,
          args,
          optionalContent,
          byteSize: 0, // Data is `null`, since decoding failed previously.
        });

        this._sendImgData(objId, /* imgData = */ null, cacheGlobally);
        return;
      }

      // For large (at least 500x500) or more complex images that we'll cache
      // globally, check if the image is still cached locally on the main-thread
      // to avoid having to re-parse the image (since that can be slow).
      if (w * h > 250000 || dict.has(DictKey.SMask) || dict.has(DictKey.Mask)) {

        const handler = this.handler;

        const localLength = await handler.commonobjPromise(objId, CommonObjType.CopyLocalImage, { imageRef: imageRef! });

        if (localLength) {
          this.globalImageCache.setData(imageRef!, <GlobalImageCacheData>{
            objId,
            fn: OPS.paintImageXObject,
            args,
            optionalContent,
            byteSize: 0, // Temporary entry, to avoid `setData` returning early.
          });
          this.globalImageCache.addByteSize(imageRef!, localLength);
          return;
        }
      }
    }

    PDFImage.buildImage({
      xref: this.xref,
      res: resources,
      image,
      isInline,
      pdfFunctionFactory: this._pdfFunctionFactory,
      localColorSpaceCache,
    })
      .then(async imageObj => {
        imgData = await imageObj.createImageData(false, this.options.isOffscreenCanvasSupported);
        imgData.dataLen = imgData.bitmap ? imgData.width * imgData.height * 4 : imgData.data!.length;
        imgData.ref = imageRef;

        if (cacheGlobally) {
          this.globalImageCache.addByteSize(imageRef!, imgData.dataLen);
        }
        return this._sendImgData(objId, imgData, cacheGlobally);
      })
      .catch(reason => {
        warn(`Unable to decode image "${objId}": "${reason}".`);

        if (imageRef) {
          this.globalImageCache.addDecodeFailed(imageRef);
        }
        return this._sendImgData(objId, /* imgData = */ null, cacheGlobally);
      });

    if (cacheKey) {
      const cacheData = {
        objId,
        fn: OPS.paintImageXObject,
        args,
        optionalContent,
      };
      localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

      if (imageRef) {
        this._regionalImageCache.set(/* name = */ null, imageRef, <ImageCacheData>cacheData);

        if (cacheGlobally) {
          this.globalImageCache.setData(imageRef!, <GlobalImageCacheData>{
            objId,
            fn: OPS.paintImageXObject,
            args,
            optionalContent,
            byteSize: 0, // Temporary entry, note `addByteSize` above.
          });
        }
      }
    }
  }

  static _sendImgData(objId: string, imgData: ImageMask | null, cacheGlobally = false) {

    const transfers = imgData ? [imgData.bitmap || imgData.data!.buffer] : null;

    if (this.parsingType3Font || cacheGlobally) {
      return this.handler.commonobj(objId, CommonObjType.Image, imgData, transfers);
    }
    return this.handler.obj(objId, this.pageIndex, ObjType.Image, imgData, transfers);
  }

  static ensureStateFont(state: State) {
    if (state.font) {
      return;
    }
    const reason = new FormatError(
      "Missing setFont (Tf) operator before text rendering operator."
    );

    if (this.options.ignoreErrors) {
      warn(`ensureStateFont: "${reason}".`);
      return;
    }
    throw reason;
  }

  static handleText(ctx: ProcessContext, chars: string, state: State) {
    const font = state.font;
    const glyphs = font!.charsToGlyphs(chars);

    if (font!.data) {
      const isAddToPathSet = !!(state.textRenderingMode! & TextRenderingMode.ADD_TO_PATH_FLAG);
      if (
        isAddToPathSet ||
        state.fillColorSpace!.name === "Pattern" ||
        font!.disableFontFace ||
        ctx.options.disableFontFace
      ) {
        PartialEvaluator.buildFontPaths(
          font!, glyphs, ctx.handler, ctx.options
        );
      }
    }
    return glyphs;
  }

  static handleColorN(
    operatorList: OperatorList,
    fn: OPS, // 值应当是OPS.setFillColorN | OPS.setFillColorN,
    args: any[],
    cs: ColorSpace,
    patterns: Dict,
    resources: Dict,
    task: WorkerTask,
    localColorSpaceCache: LocalColorSpaceCache,
    localTilingPatternCache: LocalTilingPatternCache,
    localShadingPatternCache: Map<Dict, string | null>
  ) {
    // compile tiling patterns
    const patternName = args.pop();
    // SCN/scn applies patterns along with normal colors
    if (patternName instanceof Name) {
      const rawPattern = <Ref | BaseStream | Dict>patterns.getRaw(<DictKey>patternName.name);

      const localTilingPattern =
        rawPattern instanceof Ref &&
        localTilingPatternCache.getByRef(rawPattern);
      if (localTilingPattern) {
        try {
          const color = cs.base ? cs.base.getRgb(args as unknown as TypedArray, 0) : null;
          const tilingPatternIR = getTilingPatternIR(
            localTilingPattern.operatorListIR,
            localTilingPattern.dict,
            color
          );
          operatorList.addOp(fn, <any>tilingPatternIR);
          return undefined;
        } catch {
          // Handle any errors during normal TilingPattern parsing.
        }
      }

      const pattern = this.xref.fetchIfRef(rawPattern);
      if (pattern) {
        const dict: Dict = pattern instanceof BaseStream ? pattern.dict : pattern;
        const typeNum = dict.get(DictKey.PatternType);

        if (typeNum === PatternType.TILING) {
          const color = cs.base ? cs.base.getRgb(args as unknown as TypedArray, 0) : null;
          return this.handleTilingType(
            fn,
            color,
            resources,
            pattern,
            dict,
            operatorList,
            task,
            localTilingPatternCache
          );
        } else if (typeNum === PatternType.SHADING) {
          const shading = dict.getValue(DictKey.Shading);
          const objId = this.parseShading(
            shading,
            resources,
            localColorSpaceCache,
            localShadingPatternCache,
          );
          if (objId) {
            const matrix = <TransformType | null>lookupMatrix(dict.getArrayValue(DictKey.Matrix), null);
            operatorList.addOp(fn, <any>["Shading", objId, matrix]);
          }
          return undefined;
        }
        throw new FormatError(`Unknown PatternType: ${typeNum}`);
      }
    }
    throw new FormatError(`Unknown PatternName: ${patternName}`);
  }

  static parseShading(
    shading: Dict,
    resources: Dict,
    localColorSpaceCache: LocalColorSpaceCache,
    localShadingPatternCache: Map<Dict, string | null>,
  ) {
    // Shadings and patterns may be referenced by the same name but the resource
    // dictionary could be different so we can't use the name for the cache key.
    let id = localShadingPatternCache.get(shading);
    if (id) {
      return id;
    }
    let patternIR;

    try {
      const shadingFill = Pattern.parseShading(
        shading, this.xref, resources, this._pdfFunctionFactory, localColorSpaceCache
      );
      patternIR = shadingFill.getIR();
    } catch (reason) {
      if (reason instanceof AbortException) {
        return null;
      }
      if (this.options.ignoreErrors) {
        warn(`parseShading - ignoring shading: "${reason}".`);

        localShadingPatternCache.set(shading, null);
        return null;
      }
      throw reason;
    }

    id = `pattern_${this.idFactory.createObjId()}`;
    if (this.parsingType3Font) {
      id = `${this.idFactory.getDocId()}_type3_${id}`;
    }
    localShadingPatternCache.set(shading, id);

    if (this.parsingType3Font) {
      this.handler.commonobj(id, CommonObjType.Pattern, patternIR);
    } else {
      this.handler.obj(id, this.pageIndex, ObjType.Pattern, patternIR);
    }
    return id;
  }

  handleTilingType(
    fn: OPS,
    color: Uint8ClampedArray | null,
    resources: Dict,
    pattern: BaseStream,
    patternDict: Dict,
    operatorList: OperatorList,
    task: WorkerTask,
    localTilingPatternCache: LocalTilingPatternCache
  ) {
    // Create an IR of the pattern code.
    const tilingOpList = new OperatorList();
    // Merge the available resources, to prevent issues when the patternDict
    // is missing some /Resources entries (fixes issue6541.pdf).
    const patternResources = Dict.merge({
      xref: this.xref,
      dictArray: [patternDict.get(DictKey.Resources), resources],
      mergeSubDicts: false
    });

    return this.getOperatorList(
      pattern,
      task,
      patternResources,
      tilingOpList,
    ).then(function () {
      const operatorListIR = tilingOpList.getIR();
      const tilingPatternIR = getTilingPatternIR(
        operatorListIR,
        patternDict,
        color
      );
      // Add the dependencies to the parent operator list so they are
      // resolved before the sub operator list is executed synchronously.
      operatorList.addDependencies(tilingOpList.dependencies);
      operatorList.addOp(fn, <any>tilingPatternIR);

      if (patternDict.objId) {
        localTilingPatternCache.set(/* name = */ null, patternDict.objId, {
          operatorListIR,
          dict: patternDict,
        });
      }
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.options.ignoreErrors) {
        warn(`handleTilingType - ignoring pattern: "${reason}".`);
        return;
      }
      throw reason;
    });
  }
}

const deferred = Promise.resolve();

class Operators {

  protected readonly operators: Map<OPS, (context: ProcessContext) => void>;

  protected readonly defaultHandler: (ctx: ProcessContext) => void;

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
  args: MutableArray<any> | null;
}


// 所有的处理都围绕着ProcessContext来，包括next方法
// 所有的处理方法都是静态函数，避免大量的创建对象
interface ProcessContext extends ProcessOperation {
  handler: MessageHandler;
  options: DocumentEvaluatorOptions;
  xref: XRef;
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
  next: (promise: Promise<unknown>) => void;
  // 要考虑自己调自己的这种情况
  handle: () => Promise<void>;
}

export class GetOperatorListHandler {

  protected operators: Operators;

  protected operatorList: OperatorList;

  protected task: WorkerTask;

  protected timeSlotManager = new TimeSlotManager();

  protected stateManager: StateManager;

  protected preprocessor: EvaluatorPreprocessor;

  protected resources: Dict;

  protected ignoreErrors: boolean;

  constructor(
    stream: BaseStream,
    task: WorkerTask,
    xref: XRef,
    resources: Dict,
    operatorList: OperatorList,
    initialState: State = new EvalState(),
    fallbackFontDict: Dict | null = null,
    ignoreErrors: boolean,
  ) {
    if (!operatorList) {
      throw new Error('getOperatorList: missing "operatorList" parameter');
    }
    this.resources = resources;
    this.stateManager = new StateManager(initialState);
    this.task = task;
    this.operatorList = operatorList;
    this.preprocessor = new EvaluatorPreprocessor(stream, xref, this.stateManager)
    this.operators = new Operators();
    this.ignoreErrors = ignoreErrors;
  }

  initOperators() {
    this.operators = new Operators();
  }

  async handle() {
    const operatorList = this.operatorList;
    const ignoreErrors = this.ignoreErrors;
    const task = this.task;
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
        next: (promise: Promise<unknown>) => {
          Promise.all([promise, operatorList.ready]).then(() => {
            try {
              this.process(resolve, reject, context)
            } catch (ex) {
              reject(ex);
            }
          }, reject);
        },
        handle: this.handle
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
    this.closePendingRestoreOPS();
    resolve();
  }

  closePendingRestoreOPS() {
    for (let i = 0, ii = this.preprocessor.savedStatesDepth; i < ii; i++) {
      this.operatorList.addOp(OPS.restore, []);
    }
  }
}