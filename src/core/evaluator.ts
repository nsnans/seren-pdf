/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable no-var */

import { DocumentEvaluatorOptions } from "../display/api";
import { RectType, TransformType } from "../display/display_utils";
import { PlatformHelper } from "../platform/platform_helper";
import { CommonObjType, MessageHandler } from "../shared/message_handler";
import {
  assert,
  FONT_IDENTITY_MATRIX,
  FormatError,
  IDENTITY_MATRIX,
  info,
  OPS,
  shadow,
  TextRenderingMode,
  Util,
  warn
} from "../shared/util";
import { MutableArray } from "../types";
import { BaseStream } from "./base_stream";
import { CMap, IdentityCMap } from "./cmap";
import { ColorSpace } from "./colorspace";
import { EvaluatorTextContent, StreamSink } from "./core_types";
import { EvaluatorColorHandler } from "./evaluator_color_handler";
import { EvaluatorFontHandler } from "./evaluator_font_handler";
import { EvaluatorGeneralHandler } from "./evaluator_general_handler";
import { GetOperatorListHandler as GeneratorOperatorHandler } from "./evaluator_general_operator";
import { EvaluatorImageHandler } from "./evaluator_image_handler";
import { GetTextContentHandler } from "./evaluator_text_content_operator";
import { FontSubstitutionInfo } from "./font_substitutions";
import { ErrorFont, Font } from "./fonts";
import { PDFFunctionFactory } from "./function";
import { GlobalIdFactory } from "./global_id_factory";
import { ImageResizer } from "./image_resizer";
import {
  GlobalImageCache,
  ImageCacheData,
  ImageMaskXObject,
  OptionalContent,
  RegionalImageCache
} from "./image_utils";
import { OperatorList, OperatorListIR } from "./operator_list";
import { Lexer, Parser } from "./parser";
import { Cmd, Dict, DictKey, EOF, Name, Ref, RefSet, RefSetCache } from "./primitives";
import { IdentityToUnicodeMap, ToUnicodeMap } from "./to_unicode_map";
import { FontProgramPrivateData } from "./type1_parser";
import { WorkerTask } from "./worker";
import { XRef } from "./xref";

export interface SeacMapValue {
  baseFontCharCode: number;
  accentFontCharCode: number;
  accentOffset: {
    x: number;
    y: number;
  };
}

export interface EvaluatorProperties {
  privateData: FontProgramPrivateData;
  glyphNames: string[];
  seacMap: Map<number, SeacMapValue>;
  ascentScaled: boolean;
  builtInEncoding: (string | number)[];
  type: string;
  name: string;
  subtype: string | null;
  loadedName: string | null;
  systemFontInfo: FontSubstitutionInfo | null;
  widths: Record<string | number, number>;
  defaultWidth: number;
  isSimulatedFlags: boolean;
  flags: number;
  firstChar: number;
  lastChar: number;
  // 应该弄个toUnicodeSource，这种像什么话
  toUnicode: BaseStream | Name | ToUnicodeMap | IdentityToUnicodeMap;
  xHeight: number;
  capHeight: number;
  italicAngle: number;
  isType3Font: boolean;
  isInternalFont?: boolean;
  composite: boolean;
  cidSystemInfo: {
    registry: string,
    ordering: string,
    supplement: number,
  } | null,
  defaultEncoding: string[] | null;
  file: BaseStream | null;
  hasIncludedToUnicodeMap: boolean;
  dict: Dict | null;
  hasEncoding: boolean;
  baseEncodingName: string | null;
  differences: string[];
  cidToGidMap: number[];
  fallbackToUnicode: string[];
  cMap: IdentityCMap | CMap | null;
  vertical: boolean;
  cidEncoding: string;
  defaultVMetrics: number[];
  vmetrics: number[][];
  length1: number | null;
  length2: number | null;
  length3: number | null;
  fixedPitch: boolean;
  fontMatrix: TransformType | null;
  bbox: RectType | null;
  ascent: number | null;
  descent: number | null;
  cssFontInfo: CssFontInfo | null;
  scaleFactors: number[] | null;
}

export interface CssFontInfo {
  fontFamily: string,
  fontWeight: number,
  italicAngle: number,
  lineHeight?: number,
  metrics: { lineHeight: number, lineGap: number }
}

// 取代原来的Object.freeze，这里可能类型会更明显一点
// 在vscode中，可以使用ctrl+p来查看每一个变量对应的值
const DefaultDocParamEvaluatorOptions = new DocumentEvaluatorOptions(
  -1, false, false, true, false, false, -1, false, true, null, null
);

export enum PatternType {
  TILING = 1,
  SHADING = 2,
};

// Convert PDF blend mode names to HTML5 blend mode names.
export function normalizeBlendMode(value: Name | Name[], parsingArray = false): string | null {
  if (Array.isArray(value)) {
    // Use the first *supported* BM value in the Array (fixes issue11279.pdf).
    for (const val of value) {
      const maybeBM = normalizeBlendMode(val, /* parsingArray = */ true);
      if (maybeBM) {
        return maybeBM;
      }
    }
    warn(`Unsupported blend mode Array: ${value}`);
    return "source-over";
  }

  if (!(value instanceof Name)) {
    if (parsingArray) {
      return null;
    }
    return "source-over";
  }
  switch (value.name) {
    case "Normal":
    case "Compatible":
      return "source-over";
    case "Multiply":
      return "multiply";
    case "Screen":
      return "screen";
    case "Overlay":
      return "overlay";
    case "Darken":
      return "darken";
    case "Lighten":
      return "lighten";
    case "ColorDodge":
      return "color-dodge";
    case "ColorBurn":
      return "color-burn";
    case "HardLight":
      return "hard-light";
    case "SoftLight":
      return "soft-light";
    case "Difference":
      return "difference";
    case "Exclusion":
      return "exclusion";
    case "Hue":
      return "hue";
    case "Saturation":
      return "saturation";
    case "Color":
      return "color";
    case "Luminosity":
      return "luminosity";
  }
  if (parsingArray) {
    return null;
  }
  warn(`Unsupported blend mode: ${value.name}`);
  return "source-over";
}

export function addLocallyCachedImageOps(opList: OperatorList, data: ImageCacheData) {
  if (data.objId) {
    opList.addDependency(data.objId);
  }
  opList.addImageOps(data.fn, <any>data.args, data.optionalContent);

  // 既然fn知道了，那么fn对应的参数类型也应该要明确
  // 现在的问题就是，fn明明已经知道了，但是却获取不到fn对应的参数类型
  // 以至于无法对参数做一个详实的声明，继而无法准确的使用参数
  // 有没有一个优雅且高效，只基于TypeScript的声明，而不影响史记开发的方法？
  if (data.fn === OPS.paintImageMaskXObject && (<ImageMaskXObject>data.args[0])?.count > 0) {
    (<ImageMaskXObject>data.args[0]).count++;
  }
}

// Trying to minimize Date.now() usage and check every 100 time.
export class TimeSlotManager {

  static TIME_SLOT_DURATION_MS = 20;

  static CHECK_TIME_EVERY = 100;

  protected endTime = 0;

  protected checked = 0;

  constructor() {
    this.reset();
  }

  check() {
    if (++this.checked < TimeSlotManager.CHECK_TIME_EVERY) {
      return false;
    }
    this.checked = 0;
    return this.endTime <= Date.now();
  }

  reset() {
    this.endTime = Date.now() + TimeSlotManager.TIME_SLOT_DURATION_MS;
    this.checked = 0;
  }
}

export interface EvaluatorCMapData {
  cMapData: Uint8Array<ArrayBuffer>;
  isCompressed: boolean;
}

export class EvaluatorOperatorFactory {

  protected context: EvaluatorContext;

  constructor(context: EvaluatorContext) {
    this.context = context;
  }

  createGeneralHandler(
    stream: BaseStream,
    task: WorkerTask,
    resources: Dict,
    operatorList: OperatorList,
    initialState: State | null = null,
    fallbackFontDict: Dict | null = null
  ) {
    return new GeneratorOperatorHandler(
      this.context, stream, task, resources, operatorList, initialState, fallbackFontDict
    );
  }

  createTextContentHandler(
    stream: BaseStream,
    task: WorkerTask,
    resources: Dict | null,
    sink: StreamSink<EvaluatorTextContent>,
    viewBox: number[],
    includeMarkedContent = false,
    keepWhiteSpace = false,
    seenStyles = new Set<string>(),
    stateManager: StateManager | null = null,
    lang: string | null = null,
    markedContentData: { level: 0 } | null = null,
    disableNormalization = false,
  ) {
    return new GetTextContentHandler(
      this.context, stream, task, resources, sink, viewBox,
      includeMarkedContent, keepWhiteSpace, seenStyles,
      stateManager, lang, markedContentData, disableNormalization
    );
  }
}

/**
 * 这个Context主要是针对，一整个Evaluator的，区别于ProcessContext
 * ProcessContext是针对每一次的计算的，EvaluatorContext则是伴随整个PartialEvaluator生命周期的
 * 它可能还是要写成类的形式，不能以接口的形式。
 */
export class EvaluatorContext {

  readonly xref: XRef;

  readonly handler: MessageHandler;

  readonly pageIndex: number;

  readonly idFactory: GlobalIdFactory;

  readonly fontCache: RefSetCache<string, Promise<TranslatedFont>>;

  readonly builtInCMapCache: Map<string, EvaluatorCMapData>;

  readonly standardFontDataCache: Map<string, Uint8Array<ArrayBuffer>>;

  readonly globalImageCache: GlobalImageCache;

  readonly systemFontCache: Map<string, FontSubstitutionInfo | null>;

  readonly regionalImageCache = new RegionalImageCache();

  readonly fetchBuiltInCMapBound: (name: string) => Promise<EvaluatorCMapData>;

  readonly options: DocumentEvaluatorOptions;

  readonly fontHandler = new EvaluatorFontHandler(this);

  readonly colorHandler = new EvaluatorColorHandler(this);

  readonly imageHandler = new EvaluatorImageHandler(this);

  readonly generalHandler = new EvaluatorGeneralHandler(this);

  public type3FontRefs: RefSet | null = null;

  protected _pdfFunctionFactory: PDFFunctionFactory | null = null;

  readonly operatorFactory = new EvaluatorOperatorFactory(this);

  constructor(
    xref: XRef,
    handler: MessageHandler,
    pageIndex: number,
    idFactory: GlobalIdFactory,
    fontCache: RefSetCache<string, Promise<TranslatedFont>>,
    builtInCMapCache: Map<string, EvaluatorCMapData>,
    standardFontDataCache: Map<string, Uint8Array<ArrayBuffer>>,
    globalImageCache: GlobalImageCache,
    systemFontCache: Map<string, FontSubstitutionInfo | null>,
    options: DocumentEvaluatorOptions,
  ) {
    this.xref = xref;
    this.handler = handler;
    this.pageIndex = pageIndex;
    this.idFactory = idFactory;
    this.fontCache = fontCache;
    this.builtInCMapCache = builtInCMapCache;
    this.standardFontDataCache = standardFontDataCache;
    this.globalImageCache = globalImageCache;
    this.systemFontCache = systemFontCache;
    this.options = options;
    this.fetchBuiltInCMapBound = this.generalHandler.fetchBuiltInCMap.bind(this.generalHandler);
  }

  /**
   * Since Functions are only cached (locally) by reference, we can share one
   * `PDFFunctionFactory` instance within this `PartialEvaluator` instance.
   */
  get pdfFunctionFactory() {
    if (!this._pdfFunctionFactory) {
      this._pdfFunctionFactory = new PDFFunctionFactory(
        this.xref, this.options.isEvalSupported
      );
    }
    return this._pdfFunctionFactory!;
  }

  get parsingType3Font() {
    return !!this.type3FontRefs;
  }

  clone(ignoreErrors: boolean) {
    const options = Object.assign(
      Object.create(null), this.options, { ignoreErrors }
    );
    return new EvaluatorContext(
      this.xref, this.handler, this.pageIndex, this.idFactory,
      this.fontCache, this.builtInCMapCache, this.standardFontDataCache,
      this.globalImageCache, this.systemFontCache, options
    )
  }

}

class PartialEvaluator {

  protected readonly context: EvaluatorContext;

  constructor(
    xref: XRef,
    handler: MessageHandler,
    pageIndex: number,
    idFactory: GlobalIdFactory,
    fontCache: RefSetCache<string, Promise<TranslatedFont>>,
    builtInCMapCache: Map<string, EvaluatorCMapData>,
    standardFontDataCache: Map<string, Uint8Array<ArrayBuffer>>,
    globalImageCache: GlobalImageCache,
    systemFontCache: Map<string, FontSubstitutionInfo | null>,
    options: DocumentEvaluatorOptions | null = null,
  ) {
    this.context = new EvaluatorContext(
      xref, handler, pageIndex, idFactory, fontCache, builtInCMapCache, standardFontDataCache,
      globalImageCache, systemFontCache, options || DefaultDocParamEvaluatorOptions
    )
    if (PlatformHelper.isMozCental()) {
      ImageResizer.setMaxArea(options!.canvasMaxAreaInBytes);
    } else {
      ImageResizer.setOptions(options!.canvasMaxAreaInBytes, options!.isChrome);
    }
  }

  get xref() {
    return this.context.xref;
  }

  get options() {
    return this.context.options;
  }

  // 这个克隆可能是一个麻烦的问题。
  clone(ignoreErrors = false): PartialEvaluator {
    const context = this.context;
    const options = context.options;
    Object.assign(Object.create(null), options, { ignoreErrors });
    const newEvaluator = new PartialEvaluator(
      context.xref, context.handler, context.pageIndex, context.idFactory,
      context.fontCache, context.builtInCMapCache, context.standardFontDataCache,
      context.globalImageCache, context.systemFontCache, options
    )
    return newEvaluator;
  }

  async handleSetFont(
    resources: Dict,
    fontArgs: [Name | string, number] | null,
    fontRef: Ref | null,
    operatorList: OperatorList,
    task: WorkerTask,
    state: { font: Font | ErrorFont | null },
    fallbackFontDict: Dict | null = null,
    cssFontInfo: CssFontInfo | null = null
  ) {
    return this.context.fontHandler.handleSetFont(
      resources, fontArgs, fontRef, operatorList, task, state, fallbackFontDict, cssFontInfo
    );
  }

  async parseMarkedContentProps(
    contentProperties: Name | Dict, resources: Dict | null
  ): Promise<OptionalContent | null> {
    return this.context.generalHandler.parseMarkedContentProps(
      contentProperties, resources
    )
  }

  async getOperatorList(
    stream: BaseStream,
    task: WorkerTask,
    resources: Dict,
    operatorList: OperatorList,
    initialState: State | null = null,
    fallbackFontDict: Dict | null = null,
  ) {
    return this.context.operatorFactory.createGeneralHandler(
      stream, task, resources, operatorList, initialState, fallbackFontDict
    ).handle();
  }

  async getTextContent(
    stream: BaseStream,
    task: WorkerTask,
    resources: Dict | null,
    sink: StreamSink<EvaluatorTextContent>,
    viewBox: number[],
    includeMarkedContent = false,
    keepWhiteSpace = false,
    seenStyles = new Set<string>(),
    stateManager: StateManager | null = null,
    lang: string | null = null,
    markedContentData: { level: 0 } | null = null,
    disableNormalization = false
  ) {
    return this.context.operatorFactory.createTextContentHandler(
      stream, task, resources, sink, viewBox, includeMarkedContent, keepWhiteSpace,
      seenStyles, stateManager, lang, markedContentData, disableNormalization
    )
  }

  hasBlendModes(resources: Dict, nonBlendModesSet: RefSet) {
    return this.context.generalHandler.hasBlendModes(resources, nonBlendModesSet);
  }
}

export class TranslatedFont {

  protected sent = false;

  public loadedName;

  public font: Font | ErrorFont;

  public dict: Dict;

  protected _evaluatorOptions;

  protected type3Loaded: Promise<void> | null;

  public type3Dependencies: Set<string> | null;

  protected _bbox: RectType | null = null;

  constructor(loadedName: string, font: Font | ErrorFont,
    dict: Dict, evaluatorOptions: DocumentEvaluatorOptions) {
    this.loadedName = loadedName;
    this.font = font;
    this.dict = dict;
    this._evaluatorOptions = evaluatorOptions || DefaultDocParamEvaluatorOptions;
    this.type3Loaded = null;
    this.type3Dependencies = font.isType3Font ? new Set() : null;
  }

  send(handler: MessageHandler) {
    if (this.sent) {
      return;
    }
    this.sent = true;
    const exportData = this.font.exportData(this._evaluatorOptions.fontExtraProperties);
    handler.commonobj(this.loadedName, CommonObjType.Font, exportData);
  }

  fallback(handler: MessageHandler) {
    if (!this.font.data) {
      return;
    }
    // When font loading failed, fall back to the built-in font renderer.
    this.font.disableFontFace = true;
    // An arbitrary number of text rendering operators could have been
    // encountered between the point in time when the 'Font' message was sent
    // to the main-thread, and the point in time when the 'FontFallback'
    // message was received on the worker-thread.
    // To ensure that all 'FontPath's are available on the main-thread, when
    // font loading failed, attempt to resend *all* previously parsed glyphs.
    EvaluatorGeneralHandler.buildFontPaths(
      this.font,
      /* glyphs = */ this.font.glyphCacheValues,
      handler,
      this._evaluatorOptions
    );
  }

  // 这里这个函数只要做个改写就好了
  loadType3Data(context: EvaluatorContext, resources: Dict, task: WorkerTask) {
    if (this.type3Loaded) {
      return this.type3Loaded;
    }
    if (!this.font.isType3Font) {
      throw new Error("Must be a Type3 pfont.");
    }
    // When parsing Type3 glyphs, always ignore them if there are errors.
    // Compared to the parsing of e.g. an entire page, it doesn't really
    // make sense to only be able to render a Type3 glyph partially.
    const type3Context = context.clone(false);
    // Prevent circular references in Type3 fonts.
    const type3FontRefs = new RefSet(context.type3FontRefs);
    if (this.dict.objId && !type3FontRefs.has(this.dict.objId)) {
      type3FontRefs.put(this.dict.objId);
    }
    type3Context.type3FontRefs = type3FontRefs;

    const translatedFont = this.font;
    const type3Dependencies = this.type3Dependencies;
    let loadCharProcsPromise = Promise.resolve();
    const charProcs: Dict = this.dict.getValue(DictKey.CharProcs);
    const fontResources = this.dict.getValue(DictKey.Resources) || resources;
    const charProcOperatorList: Map<DictKey, OperatorListIR> = new Map();

    const fontBBox = Util.normalizeRect(translatedFont.bbox || [0, 0, 0, 0]);
    const width = fontBBox[2] - fontBBox[0];
    const height = fontBBox[3] - fontBBox[1];
    const fontBBoxSize = Math.hypot(width, height);

    for (const key of charProcs.getKeys()) {
      loadCharProcsPromise = loadCharProcsPromise.then(async () => {
        const glyphStream = charProcs.get(key);
        const operatorList = new OperatorList();
        return type3Context.operatorFactory.createGeneralHandler(
          glyphStream, task, fontResources, operatorList
        ).handle().then(() => {
          // According to the PDF specification, section "9.6.5 Type 3 Fonts"
          // and "Table 113":
          //  "A glyph description that begins with the d1 operator should
          //   not execute any operators that set the colour (or other
          //   colour-related parameters) in the graphics state;
          //   any use of such operators shall be ignored."
          if (operatorList.fnArray[0] === OPS.setCharWidthAndBounds) {
            this._removeType3ColorOperators(operatorList, fontBBoxSize);
          }
          charProcOperatorList.set(key, operatorList.getIR());

          for (const dependency of operatorList.dependencies) {
            type3Dependencies!.add(dependency);
          }
        }).catch(function (_reason: unknown) {
          warn(`Type3 font resource "${key}" is not available.`);
          const dummyOperatorList = new OperatorList();
          charProcOperatorList.set(key, dummyOperatorList.getIR());
        });
      });
    }
    this.type3Loaded = loadCharProcsPromise.then(() => {
      (<Font>translatedFont).charProcOperatorList = charProcOperatorList;
      if (this._bbox) {
        (<Font>translatedFont).isCharBBox = true;
        (<Font>translatedFont).bbox = this._bbox;
      }
    });
    return this.type3Loaded;
  }

  /**
   * @private
   */
  _removeType3ColorOperators(operatorList: OperatorList, fontBBoxSize = NaN) {
    if (PlatformHelper.isTesting()) {
      assert(
        operatorList.fnArray[0] === OPS.setCharWidthAndBounds,
        "Type3 glyph shall start with the d1 operator."
      );
    }
    const charBBox = Util.normalizeRect(<RectType>(<number[]>operatorList.argsArray[0])!.slice(2)!),
      width = charBBox[2] - charBBox[0],
      height = charBBox[3] - charBBox[1];
    const charBBoxSize = Math.hypot(width, height);

    if (width === 0 || height === 0) {
      // Skip the d1 operator when its bounds are bogus (fixes issue14953.pdf).
      operatorList.fnArray.splice(0, 1);
      operatorList.argsArray.splice(0, 1);
    } else if (
      fontBBoxSize === 0 ||
      Math.round(charBBoxSize / fontBBoxSize) >= 10
    ) {
      // Override the fontBBox when it's undefined/empty, or when it's at least
      // (approximately) one order of magnitude smaller than the charBBox
      // (fixes issue14999_reduced.pdf).
      if (!this._bbox) {
        this._bbox = [Infinity, Infinity, -Infinity, -Infinity];
      }
      this._bbox[0] = Math.min(this._bbox[0], charBBox[0]);
      this._bbox[1] = Math.min(this._bbox[1], charBBox[1]);
      this._bbox[2] = Math.max(this._bbox[2], charBBox[2]);
      this._bbox[3] = Math.max(this._bbox[3], charBBox[3]);
    }

    let i = 0,
      ii = operatorList.length;
    while (i < ii) {
      switch (operatorList.fnArray[i]) {
        case OPS.setCharWidthAndBounds:
          break; // Handled above.
        case OPS.setStrokeColorSpace:
        case OPS.setFillColorSpace:
        case OPS.setStrokeColor:
        case OPS.setStrokeColorN:
        case OPS.setFillColor:
        case OPS.setFillColorN:
        case OPS.setStrokeGray:
        case OPS.setFillGray:
        case OPS.setStrokeRGBColor:
        case OPS.setFillRGBColor:
        case OPS.setStrokeCMYKColor:
        case OPS.setFillCMYKColor:
        case OPS.shadingFill:
        case OPS.setRenderingIntent:
          operatorList.fnArray.splice(i, 1);
          operatorList.argsArray.splice(i, 1);
          ii--;
          continue;

        case OPS.setGState:
          const [gStateObj] = operatorList.argsArray[i]!;
          let j = 0,
            jj = gStateObj.length;
          while (j < jj) {
            const [gStateKey] = gStateObj[j];
            switch (gStateKey) {
              case "TR":
              case "TR2":
              case "HT":
              case "BG":
              case "BG2":
              case "UCR":
              case "UCR2":
                gStateObj.splice(j, 1);
                jj--;
                continue;
            }
            j++;
          }
          break;
      }
      i++;
    }
  }
}

export class StateManager {

  public state: State;

  public stateStack: State[];

  constructor(initialState: State = new EvalState()) {
    this.state = initialState;
    this.stateStack = [];
  }

  save() {
    const old = this.state;
    this.stateStack.push(this.state);
    this.state = old.clone();
  }

  restore() {
    const prev = this.stateStack.pop();
    if (prev) {
      this.state = prev;
    }
  }

  transform(args: TransformType) {
    this.state.ctm = Util.transform(this.state.ctm, args);
  }
}

export class TextState implements State {

  public ctm: Float32Array;
  public fontName: null;
  public fontSize: number;
  public loadedName: string | null;
  public font: Font | ErrorFont | null;
  public fontMatrix: number[];
  public textMatrix: number[];
  public textLineMatrix: number[];
  public charSpacing: number;
  public wordSpacing: number;
  public leading: number;
  public textHScale: number;
  public textRise: number;

  // 下面的属性都是原来没有的，从代码里推断出来的
  public textRenderingMode: number | null = null;
  public fillColorSpace: ColorSpace | null = null;
  public strokeColorSpace: ColorSpace | null = null;
  public patternFillColorSpace: ColorSpace | null = null;
  public patternStrokeColorSpace: ColorSpace | null = null;

  constructor() {
    this.ctm = new Float32Array(IDENTITY_MATRIX);
    this.fontName = null;
    this.fontSize = 0;
    this.loadedName = null;
    this.font = null;
    this.fontMatrix = FONT_IDENTITY_MATRIX;
    this.textMatrix = IDENTITY_MATRIX.slice();
    this.textLineMatrix = IDENTITY_MATRIX.slice();
    this.charSpacing = 0;
    this.wordSpacing = 0;
    this.leading = 0;
    this.textHScale = 1;
    this.textRise = 0;
  }

  // TODO 这里先默认都是number，或许后面会调整？
  setTextMatrix(a: number, b: number, c: number, d: number, e: number, f: number) {
    const m = this.textMatrix;
    m[0] = a;
    m[1] = b;
    m[2] = c;
    m[3] = d;
    m[4] = e;
    m[5] = f;
  }

  setTextLineMatrix(a: number, b: number, c: number, d: number, e: number, f: number) {
    const m = this.textLineMatrix;
    m[0] = a; m[1] = b; m[2] = c; m[3] = d; m[4] = e; m[5] = f;
  }

  translateTextMatrix(x: number, y: number) {
    const m = this.textMatrix;
    m[4] = m[0] * x + m[2] * y + m[4];
    m[5] = m[1] * x + m[3] * y + m[5];
  }

  translateTextLineMatrix(x: number, y: number) {
    const m = this.textLineMatrix;
    m[4] = m[0] * x + m[2] * y + m[4];
    m[5] = m[1] * x + m[3] * y + m[5];
  }

  carriageReturn() {
    this.translateTextLineMatrix(0, -this.leading);
    this.textMatrix = this.textLineMatrix.slice();
  }

  clone() {
    const clone = Object.create(this);
    clone.textMatrix = this.textMatrix.slice();
    clone.textLineMatrix = this.textLineMatrix.slice();
    clone.fontMatrix = this.fontMatrix.slice();
    return clone;
  }
}

export interface State {
  font: Font | ErrorFont | null;
  ctm: Float32Array | number[];
  textRenderingMode: number | null;
  fillColorSpace: ColorSpace | null;
  strokeColorSpace: ColorSpace | null;
  patternFillColorSpace: ColorSpace | null;
  patternStrokeColorSpace: ColorSpace | null;
  clone(): State;
}

export class EvalState implements State {

  public ctm: Float32Array;

  public textRenderingMode: number;

  public font: null;

  protected _fillColorSpace: ColorSpace;

  protected _strokeColorSpace: ColorSpace;

  public patternFillColorSpace: ColorSpace | null;

  public patternStrokeColorSpace: ColorSpace | null;

  constructor() {
    this.ctm = new Float32Array(IDENTITY_MATRIX);
    this.font = null;
    this.textRenderingMode = TextRenderingMode.FILL;
    this._fillColorSpace = ColorSpace.singletons.gray;
    this._strokeColorSpace = ColorSpace.singletons.gray;
    this.patternFillColorSpace = null;
    this.patternStrokeColorSpace = null;
  }

  get fillColorSpace() {
    return this._fillColorSpace;
  }

  set fillColorSpace(colorSpace: ColorSpace) {
    this._fillColorSpace = this.patternFillColorSpace = colorSpace;
  }

  get strokeColorSpace() {
    return this._strokeColorSpace;
  }

  set strokeColorSpace(colorSpace: ColorSpace) {
    this._strokeColorSpace = this.patternStrokeColorSpace = colorSpace;
  }

  clone() {
    return Object.create(this);
  }
}

export interface EvaluatorOpType {
  id: OPS;
  numArgs: number;
  variableArgs: boolean;
}

export interface EvaluatorOpMap {

  w: { id: OPS.setLineWidth, numArgs: 1, variableArgs: false }
  J: { id: OPS.setLineCap, numArgs: 1, variableArgs: false }
  j: { id: OPS.setLineJoin, numArgs: 1, variableArgs: false }
  M: { id: OPS.setMiterLimit, numArgs: 1, variableArgs: false }
  d: { id: OPS.setDash, numArgs: 2, variableArgs: false }
  ri: { id: OPS.setRenderingIntent, numArgs: 1, variableArgs: false }
  i: { id: OPS.setFlatness, numArgs: 1, variableArgs: false }
  gs: { id: OPS.setGState, numArgs: 1, variableArgs: false }
  q: { id: OPS.save, numArgs: 0, variableArgs: false }
  Q: { id: OPS.restore, numArgs: 0, variableArgs: false }
  cm: { id: OPS.transform, numArgs: 6, variableArgs: false }

  // Path
  m: { id: OPS.moveTo, numArgs: 2, variableArgs: false }
  l: { id: OPS.lineTo, numArgs: 2, variableArgs: false }
  c: { id: OPS.curveTo, numArgs: 6, variableArgs: false }
  v: { id: OPS.curveTo2, numArgs: 4, variableArgs: false }
  y: { id: OPS.curveTo3, numArgs: 4, variableArgs: false }
  h: { id: OPS.closePath, numArgs: 0, variableArgs: false }
  re: { id: OPS.rectangle, numArgs: 4, variableArgs: false }
  S: { id: OPS.stroke, numArgs: 0, variableArgs: false }
  s: { id: OPS.closeStroke, numArgs: 0, variableArgs: false }
  f: { id: OPS.fill, numArgs: 0, variableArgs: false }
  F: { id: OPS.fill, numArgs: 0, variableArgs: false }
  "f*": { id: OPS.eoFill, numArgs: 0, variableArgs: false }
  B: { id: OPS.fillStroke, numArgs: 0, variableArgs: false }
  "B*": { id: OPS.eoFillStroke, numArgs: 0, variableArgs: false }
  b: { id: OPS.closeFillStroke, numArgs: 0, variableArgs: false }
  "b*": { id: OPS.closeEOFillStroke, numArgs: 0, variableArgs: false }
  n: { id: OPS.endPath, numArgs: 0, variableArgs: false }

  // Clipping
  W: { id: OPS.clip, numArgs: 0, variableArgs: false }
  "W*": { id: OPS.eoClip, numArgs: 0, variableArgs: false }

  // Text
  BT: { id: OPS.beginText, numArgs: 0, variableArgs: false }
  ET: { id: OPS.endText, numArgs: 0, variableArgs: false }
  Tc: { id: OPS.setCharSpacing, numArgs: 1, variableArgs: false }
  Tw: { id: OPS.setWordSpacing, numArgs: 1, variableArgs: false }
  Tz: { id: OPS.setHScale, numArgs: 1, variableArgs: false }
  TL: { id: OPS.setLeading, numArgs: 1, variableArgs: false }
  Tf: { id: OPS.setFont, numArgs: 2, variableArgs: false }
  Tr: { id: OPS.setTextRenderingMode, numArgs: 1, variableArgs: false }
  Ts: { id: OPS.setTextRise, numArgs: 1, variableArgs: false }
  Td: { id: OPS.moveText, numArgs: 2, variableArgs: false }
  TD: { id: OPS.setLeadingMoveText, numArgs: 2, variableArgs: false }
  Tm: { id: OPS.setTextMatrix, numArgs: 6, variableArgs: false }
  "T*": { id: OPS.nextLine, numArgs: 0, variableArgs: false }
  Tj: { id: OPS.showText, numArgs: 1, variableArgs: false }
  TJ: { id: OPS.showSpacedText, numArgs: 1, variableArgs: false }
  "'": { id: OPS.nextLineShowText, numArgs: 1, variableArgs: false }
  '"': { id: OPS.nextLineSetSpacingShowText, numArgs: 3, variableArgs: false }

  // Type3 fonts
  d0: { id: OPS.setCharWidth, numArgs: 2, variableArgs: false }
  d1: { id: OPS.setCharWidthAndBounds, numArgs: 6, variableArgs: false }

  // Color
  CS: { id: OPS.setStrokeColorSpace, numArgs: 1, variableArgs: false }
  cs: { id: OPS.setFillColorSpace, numArgs: 1, variableArgs: false }
  SC: { id: OPS.setStrokeColor, numArgs: 4, variableArgs: true }
  SCN: { id: OPS.setStrokeColorN, numArgs: 33, variableArgs: true }
  sc: { id: OPS.setFillColor, numArgs: 4, variableArgs: true }
  scn: { id: OPS.setFillColorN, numArgs: 33, variableArgs: true }
  G: { id: OPS.setStrokeGray, numArgs: 1, variableArgs: false }
  g: { id: OPS.setFillGray, numArgs: 1, variableArgs: false }
  RG: { id: OPS.setStrokeRGBColor, numArgs: 3, variableArgs: false }
  rg: { id: OPS.setFillRGBColor, numArgs: 3, variableArgs: false }
  K: { id: OPS.setStrokeCMYKColor, numArgs: 4, variableArgs: false }
  k: { id: OPS.setFillCMYKColor, numArgs: 4, variableArgs: false }

  // Shading
  sh: { id: OPS.shadingFill, numArgs: 1, variableArgs: false }

  // Images
  BI: { id: OPS.beginInlineImage, numArgs: 0, variableArgs: false }
  ID: { id: OPS.beginImageData, numArgs: 0, variableArgs: false }
  EI: { id: OPS.endInlineImage, numArgs: 1, variableArgs: false }

  // XObjects
  Do: { id: OPS.paintXObject, numArgs: 1, variableArgs: false }
  MP: { id: OPS.markPoint, numArgs: 1, variableArgs: false }
  DP: { id: OPS.markPointProps, numArgs: 2, variableArgs: false }
  BMC: { id: OPS.beginMarkedContent, numArgs: 1, variableArgs: false }
  BDC: { id: OPS.beginMarkedContentProps, numArgs: 2, variableArgs: false }
  EMC: { id: OPS.endMarkedContent, numArgs: 0, variableArgs: false }

  // Compatibility
  BX: { id: OPS.beginCompat, numArgs: 0, variableArgs: false }
  EX: { id: OPS.endCompat, numArgs: 0, variableArgs: false }

  // (reserved partial commands for the lexer)
  BM: null
  BD: null
  true: null
  fa: null
  fal: null
  fals: null
  false: null
  nu: null
  nul: null
  null: null
  // 为了方便访问添加的
  [key: string]: EvaluatorOpType | null,
}

class EvaluatorPreprocessor {

  // 是一个参数类型
  protected nonProcessedArgs: any[];

  static get opMap(): EvaluatorOpMap {
    // Specifies properties for each command
    //
    // If variableArgs === true: [0, `numArgs`] expected
    // If variableArgs === false: exactly `numArgs` expected
    return shadow(
      this,
      "opMap",
      Object.assign(Object.create(null), {
        // Graphic state
        w: { id: OPS.setLineWidth, numArgs: 1, variableArgs: false },
        J: { id: OPS.setLineCap, numArgs: 1, variableArgs: false },
        j: { id: OPS.setLineJoin, numArgs: 1, variableArgs: false },
        M: { id: OPS.setMiterLimit, numArgs: 1, variableArgs: false },
        d: { id: OPS.setDash, numArgs: 2, variableArgs: false },
        ri: { id: OPS.setRenderingIntent, numArgs: 1, variableArgs: false },
        i: { id: OPS.setFlatness, numArgs: 1, variableArgs: false },
        gs: { id: OPS.setGState, numArgs: 1, variableArgs: false },
        q: { id: OPS.save, numArgs: 0, variableArgs: false },
        Q: { id: OPS.restore, numArgs: 0, variableArgs: false },
        cm: { id: OPS.transform, numArgs: 6, variableArgs: false },

        // Path
        m: { id: OPS.moveTo, numArgs: 2, variableArgs: false },
        l: { id: OPS.lineTo, numArgs: 2, variableArgs: false },
        c: { id: OPS.curveTo, numArgs: 6, variableArgs: false },
        v: { id: OPS.curveTo2, numArgs: 4, variableArgs: false },
        y: { id: OPS.curveTo3, numArgs: 4, variableArgs: false },
        h: { id: OPS.closePath, numArgs: 0, variableArgs: false },
        re: { id: OPS.rectangle, numArgs: 4, variableArgs: false },
        S: { id: OPS.stroke, numArgs: 0, variableArgs: false },
        s: { id: OPS.closeStroke, numArgs: 0, variableArgs: false },
        f: { id: OPS.fill, numArgs: 0, variableArgs: false },
        F: { id: OPS.fill, numArgs: 0, variableArgs: false },
        "f*": { id: OPS.eoFill, numArgs: 0, variableArgs: false },
        B: { id: OPS.fillStroke, numArgs: 0, variableArgs: false },
        "B*": { id: OPS.eoFillStroke, numArgs: 0, variableArgs: false },
        b: { id: OPS.closeFillStroke, numArgs: 0, variableArgs: false },
        "b*": { id: OPS.closeEOFillStroke, numArgs: 0, variableArgs: false },
        n: { id: OPS.endPath, numArgs: 0, variableArgs: false },

        // Clipping
        W: { id: OPS.clip, numArgs: 0, variableArgs: false },
        "W*": { id: OPS.eoClip, numArgs: 0, variableArgs: false },

        // Text
        BT: { id: OPS.beginText, numArgs: 0, variableArgs: false },
        ET: { id: OPS.endText, numArgs: 0, variableArgs: false },
        Tc: { id: OPS.setCharSpacing, numArgs: 1, variableArgs: false },
        Tw: { id: OPS.setWordSpacing, numArgs: 1, variableArgs: false },
        Tz: { id: OPS.setHScale, numArgs: 1, variableArgs: false },
        TL: { id: OPS.setLeading, numArgs: 1, variableArgs: false },
        Tf: { id: OPS.setFont, numArgs: 2, variableArgs: false },
        Tr: { id: OPS.setTextRenderingMode, numArgs: 1, variableArgs: false },
        Ts: { id: OPS.setTextRise, numArgs: 1, variableArgs: false },
        Td: { id: OPS.moveText, numArgs: 2, variableArgs: false },
        TD: { id: OPS.setLeadingMoveText, numArgs: 2, variableArgs: false },
        Tm: { id: OPS.setTextMatrix, numArgs: 6, variableArgs: false },
        "T*": { id: OPS.nextLine, numArgs: 0, variableArgs: false },
        Tj: { id: OPS.showText, numArgs: 1, variableArgs: false },
        TJ: { id: OPS.showSpacedText, numArgs: 1, variableArgs: false },
        "'": { id: OPS.nextLineShowText, numArgs: 1, variableArgs: false },
        '"': {
          id: OPS.nextLineSetSpacingShowText,
          numArgs: 3,
          variableArgs: false,
        },

        // Type3 fonts
        d0: { id: OPS.setCharWidth, numArgs: 2, variableArgs: false },
        d1: {
          id: OPS.setCharWidthAndBounds,
          numArgs: 6,
          variableArgs: false,
        },

        // Color
        CS: { id: OPS.setStrokeColorSpace, numArgs: 1, variableArgs: false },
        cs: { id: OPS.setFillColorSpace, numArgs: 1, variableArgs: false },
        SC: { id: OPS.setStrokeColor, numArgs: 4, variableArgs: true },
        SCN: { id: OPS.setStrokeColorN, numArgs: 33, variableArgs: true },
        sc: { id: OPS.setFillColor, numArgs: 4, variableArgs: true },
        scn: { id: OPS.setFillColorN, numArgs: 33, variableArgs: true },
        G: { id: OPS.setStrokeGray, numArgs: 1, variableArgs: false },
        g: { id: OPS.setFillGray, numArgs: 1, variableArgs: false },
        RG: { id: OPS.setStrokeRGBColor, numArgs: 3, variableArgs: false },
        rg: { id: OPS.setFillRGBColor, numArgs: 3, variableArgs: false },
        K: { id: OPS.setStrokeCMYKColor, numArgs: 4, variableArgs: false },
        k: { id: OPS.setFillCMYKColor, numArgs: 4, variableArgs: false },

        // Shading
        sh: { id: OPS.shadingFill, numArgs: 1, variableArgs: false },

        // Images
        BI: { id: OPS.beginInlineImage, numArgs: 0, variableArgs: false },
        ID: { id: OPS.beginImageData, numArgs: 0, variableArgs: false },
        EI: { id: OPS.endInlineImage, numArgs: 1, variableArgs: false },

        // XObjects
        Do: { id: OPS.paintXObject, numArgs: 1, variableArgs: false },
        MP: { id: OPS.markPoint, numArgs: 1, variableArgs: false },
        DP: { id: OPS.markPointProps, numArgs: 2, variableArgs: false },
        BMC: { id: OPS.beginMarkedContent, numArgs: 1, variableArgs: false },
        BDC: {
          id: OPS.beginMarkedContentProps,
          numArgs: 2,
          variableArgs: false,
        },
        EMC: { id: OPS.endMarkedContent, numArgs: 0, variableArgs: false },

        // Compatibility
        BX: { id: OPS.beginCompat, numArgs: 0, variableArgs: false },
        EX: { id: OPS.endCompat, numArgs: 0, variableArgs: false },

        // (reserved partial commands for the lexer)
        BM: null,
        BD: null,
        true: null,
        fa: null,
        fal: null,
        fals: null,
        false: null,
        nu: null,
        nul: null,
        null: null,
      })
    );
  }

  static MAX_INVALID_PATH_OPS = 10;

  protected stateManager: StateManager;

  protected parser: Parser;

  protected _isPathOp = false;

  protected _numInvalidPathOPS = 0;

  constructor(stream: BaseStream, xref: XRef | null = null, stateManager = new StateManager()) {
    // TODO(mduan): pass array of knownCommands rather than this.opMap
    // dictionary
    this.parser = new Parser(new Lexer(stream, EvaluatorPreprocessor.opMap), xref);
    this.stateManager = stateManager;
    this.nonProcessedArgs = [];
  }

  get savedStatesDepth() {
    return this.stateManager.stateStack.length;
  }

  // |operation| is an object with two fields:
  //
  // - |fn| is an out param.
  //
  // - |args| is an inout param. On entry, it should have one of two values.
  //
  //   - An empty array. This indicates that the caller is providing the
  //     array in which the args will be stored in. The caller should use
  //     this value if it can reuse a single array for each call to read().
  //
  //   - |null|. This indicates that the caller needs this function to create
  //     the array in which any args are stored in. If there are zero args,
  //     this function will leave |operation.args| as |null| (thus avoiding
  //     allocations that would occur if we used an empty array to represent
  //     zero arguments). Otherwise, it will replace |null| with a new array
  //     containing the arguments. The caller should use this value if it
  //     cannot reuse an array for each call to read().
  //
  // These two modes are present because this function is very hot and so
  // avoiding allocations where possible is worthwhile.
  //
  read(operation: { fn: OPS | null, args: MutableArray<any> | null }) {
    let args = operation.args;
    while (true) {
      const obj = this.parser.getObj();
      if (obj instanceof Cmd) {
        const cmd = obj.cmd;
        // Check that the command is valid
        const opSpec = EvaluatorPreprocessor.opMap[cmd];
        if (!opSpec) {
          warn(`Unknown command "${cmd}".`);
          continue;
        }

        const fn = opSpec.id;
        const numArgs = opSpec.numArgs;
        let argsLength = args !== null ? args!.length : 0;

        // If the *previous* command wasn't a path operator, reset the heuristic
        // used with incomplete path operators below (fixes issue14917.pdf).
        if (!this._isPathOp) {
          this._numInvalidPathOPS = 0;
        }
        this._isPathOp = fn >= OPS.moveTo && fn <= OPS.endPath;

        if (!opSpec.variableArgs) {
          // Postscript commands can be nested, e.g. /F2 /GS2 gs 5.711 Tf
          if (argsLength !== numArgs) {
            const nonProcessedArgs = this.nonProcessedArgs;
            while (argsLength > numArgs) {
              nonProcessedArgs.push((<any[]>args).shift()!);
              argsLength--;
            }
            while (argsLength < numArgs && nonProcessedArgs.length !== 0) {
              if (args === null) {
                args = [];
              }
              (<any[]>args).unshift(nonProcessedArgs.pop());
              argsLength++;
            }
          }

          if (argsLength < numArgs) {
            const partialMsg =
              `command ${cmd}: expected ${numArgs} args, ` +
              `but received ${argsLength} args.`;

            // Incomplete path operators, in particular, can result in fairly
            // chaotic rendering artifacts. Hence the following heuristics is
            // used to error, rather than just warn, once a number of invalid
            // path operators have been encountered (fixes bug1443140.pdf).
            if (
              this._isPathOp &&
              ++this._numInvalidPathOPS >
              EvaluatorPreprocessor.MAX_INVALID_PATH_OPS
            ) {
              throw new FormatError(`Invalid ${partialMsg}`);
            }
            // If we receive too few arguments, it's not possible to execute
            // the command, hence we skip the command.
            warn(`Skipping ${partialMsg}`);
            if (args !== null) {
              args!.length = 0;
            }
            continue;
          }
        } else if (argsLength > numArgs) {
          info(
            `Command ${cmd}: expected [0, ${numArgs}] args, ` +
            `but received ${argsLength} args.`
          );
        }

        // TODO figure out how to type-check vararg functions
        this.preprocessCommand(fn, args);

        operation.fn = fn;
        operation.args = args;
        return true;
      }
      if (obj === EOF) {
        return false; // no more commands
      }
      // argument
      if (obj !== null) {
        if (args === null) {
          args = [];
        }
        (<any>args).push(obj);
        if (args!.length > 33) {
          throw new FormatError("Too many arguments");
        }
      }
    }
  }

  preprocessCommand(fn: OPS, args?: TransformType | unknown) {
    switch (fn | 0) {
      case OPS.save:
        this.stateManager.save();
        break;
      case OPS.restore:
        this.stateManager.restore();
        break;
      case OPS.transform:
        this.stateManager.transform(<TransformType>args!);
        break;
    }
  }
}

export { EvaluatorPreprocessor, PartialEvaluator };
