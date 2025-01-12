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
import { CommonObjType, MessageHandler, ObjType } from "../shared/message_handler";
import { MurmurHash3_64 } from "../shared/murmurhash3";
import {
  AbortException,
  assert,
  FONT_IDENTITY_MATRIX,
  FormatError,
  IDENTITY_MATRIX,
  info,
  isArrayEqual,
  normalizeUnicode,
  OPS,
  shadow,
  stringToPDFString,
  TextRenderingMode,
  Util,
  warn,
} from "../shared/util";
import { MutableArray, TypedArray } from "../types";
import { BaseStream } from "./base_stream";
import { bidi } from "./bidi";
import { CMap, CMapFactory, IdentityCMap } from "./cmap";
import { ColorSpace } from "./colorspace";
import { DefaultTextContentItem, EvaluatorTextContent, ImageMask, PreEvaluatedFont, SingleOpaquePixelImageMask, SMaskOptions, StreamSink, TextContentSinkProxy } from "./core_types";
import { isNumberArray, lookupMatrix, lookupNormalRect } from "./core_utils";
import { DecodeStream } from "./decode_stream";
import {
  getEncoding,
  MacRomanEncoding,
  StandardEncoding,
  SymbolSetEncoding,
  WinAnsiEncoding,
  ZapfDingbatsEncoding,
} from "./encodings";
import { EvaluatorColorHandler } from "./evaluator_color_handler";
import { EvaluatorFontHandler } from "./evaluator_font_handler";
import { EvaluatorGeneralHandler } from "./evaluator_general_handler";
import { GetOperatorListHandler as GeneratorOperatorHandler } from "./evaluator_general_operator";
import { EvaluatorImageHandler } from "./evaluator_image_handler";
import { GetTextContentHandler } from "./evaluator_text_content_operator";
import { FontSubstitutionInfo, getFontSubstitution } from "./font_substitutions";
import { ErrorFont, Font, Glyph } from "./fonts";
import { FontFlags } from "./fonts_utils";
import { isPDFFunction, PDFFunctionFactory } from "./function";
import { GlobalIdFactory } from "./global_id_factory";
import { getGlyphsUnicode } from "./glyphlist";
import { PDFImage } from "./image";
import { ImageResizer } from "./image_resizer";
import {
  GlobalImageCache,
  GlobalImageCacheData,
  GroupOptions,
  ImageCacheData,
  ImageMaskXObject,
  LocalColorSpaceCache,
  LocalGStateCache,
  LocalImageCache,
  LocalTilingPatternCache,
  OptionalContent,
  RegionalImageCache,
} from "./image_utils";
import { getMetrics } from "./metrics";
import { OperatorList, OperatorListIR } from "./operator_list";
import { Lexer, Parser } from "./parser";
import { getTilingPatternIR, Pattern } from "./pattern";
import { Cmd, Dict, DictKey, EOF, isName, Name, Ref, RefSet, RefSetCache } from "./primitives";
import {
  getFontNameToFileMap,
  getSerifFonts,
  getStandardFontName,
  getStdFontMap,
  getSymbolsFonts,
  isKnownFontName,
} from "./standard_fonts";
import { Stream } from "./stream";
import { IdentityToUnicodeMap, ToUnicodeMap } from "./to_unicode_map";
import { getUnicodeForGlyph } from "./unicode";
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
  glyphNames: string[];
  seacMap: Map<number, SeacMapValue>;
  ascentScaled: boolean;
  builtInEncoding: (string | number)[];
  type: string;
  name: string;
  subtype: string | null;
  loadedName: string | null;
  systemFontInfo: FontSubstitutionInfo | null;
  widths: number[];
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

// Optionally avoid sending individual, or very few, text chunks to reduce
// `postMessage` overhead with ReadableStream (see issue 13962).
//
// PLEASE NOTE: This value should *not* be too large (it's used as a lower limit
// in `enqueueChunk`), since that would cause streaming of textContent to become
// essentially useless in practice by sending all (or most) chunks at once.
// Also, a too large value would (indirectly) affect the main-thread `textLayer`
// building negatively by forcing all textContent to be handled at once, which
// could easily end up hurting *overall* performance (e.g. rendering as well).
const TEXT_CHUNK_BATCH_SIZE = 10;

const deferred = Promise.resolve();

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

interface EvaluatorCMapData {
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
    const fontName = fontArgs?.[0] instanceof Name ? fontArgs[0].name : null;

    let translated = await this.loadFont(
      fontName, fontRef, resources, fallbackFontDict, cssFontInfo
    );

    if (translated.font.isType3Font) {
      try {
        await translated.loadType3Data(this, resources, task);
        // Add the dependencies to the parent operatorList so they are
        // resolved before Type3 operatorLists are executed synchronously.
        operatorList.addDependencies(translated.type3Dependencies!);
      } catch (reason) {
        translated = new TranslatedFont(
          "g_font_error",
          new ErrorFont(`Type3 font load error: ${reason}`),
          // 这里是个坑爹的问题，估计出问题的时候，直接拿这个font来存dict了
          translated.font as unknown as Dict,
          this.options,
        );
      }
    }

    state.font = translated.font;
    translated.send(this.handler);
    return translated.loadedName;
  }

  async parseMarkedContentProps(
    contentProperties: Name | Dict, resources: Dict | null
  ): Promise<OptionalContent | null> {
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

  async getOperatorList(
    stream: BaseStream,
    task: WorkerTask,
    resources: Dict,
    operatorList: OperatorList,
    initialState: State | null = null,
    fallbackFontDict: Dict | null = null,
  ) {
    // Ensure that `resources`/`initialState` is correctly initialized,
    // even if the provided parameter is e.g. `null`.
    resources ||= Dict.empty;
    initialState ||= new EvalState();

    if (!operatorList) {
      throw new Error('getOperatorList: missing "operatorList" parameter');
    }

    const self = this;
    const xref = this.xref;
    let parsingText = false;
    const localImageCache = new LocalImageCache();
    const localColorSpaceCache = new LocalColorSpaceCache();
    const localGStateCache = new LocalGStateCache();
    const localTilingPatternCache = new LocalTilingPatternCache();
    const localShadingPatternCache = new Map<Dict, string | null>();

    const xobjs = resources.getValue(DictKey.XObject) || Dict.empty;
    const patterns = resources.getValue(DictKey.Pattern) || Dict.empty;
    const stateManager = new StateManager(initialState);
    const preprocessor = new EvaluatorPreprocessor(stream, xref, stateManager);
    const timeSlotManager = new TimeSlotManager();

    // 此处删除了一个参数
    function closePendingRestoreOPS() {
      for (let i = 0, ii = preprocessor.savedStatesDepth; i < ii; i++) {
        operatorList.addOp(OPS.restore, []);
      }
    }

    // 这里是一个较为复杂的递归调用，一个promise调用结束后，从头开始执行promiseBody方法
    // 遇见next就知道要从头开始嵌套调用了
    return new Promise<void>(function promiseBody(resolve, reject) {
      const next = function (promise: Promise<any> | undefined) {
        Promise.all([promise, operatorList.ready]).then(() => {
          try {
            promiseBody(resolve, reject);
          } catch (ex) {
            reject(ex);
          }
        }, reject);
      };
      task.ensureNotTerminated();
      timeSlotManager.reset();

      const operation: { fn?: OPS, args?: any[] | null } = {};
      // 复用对象，可以节省资源
      let stop, i, ii, cs, name: string | null;
      let isValidName: boolean | null = null;
      while (!(stop = timeSlotManager.check())) {
        // The arguments parsed by read() are used beyond this loop, so we
        // cannot reuse the same array on each iteration. Therefore we pass
        // in |null| as the initial value (see the comment on
        // EvaluatorPreprocessor_read() for why).
        operation.args = null;
        if (!preprocessor.read(operation)) {
          break;
        }
        let args: any[] | Uint8ClampedArray | null = operation.args as unknown as any[];
        let fn = operation.fn;

        switch (fn! | 0) {
          case OPS.paintXObject:
            // eagerly compile XForm objects
            isValidName = args![0] instanceof Name;
            name = args[0].name;

            if (isValidName) {
              const localImage = localImageCache.getByName(name);
              if (localImage) {
                addLocallyCachedImageOps(operatorList, localImage);
                args = null;
                continue;
              }
            }

            next(new Promise<void>(function (resolveXObject, rejectXObject) {
              if (!isValidName) {
                throw new FormatError("XObject must be referred to by name.");
              }

              let xobj = xobjs.getRaw(<DictKey>name!);
              if (xobj instanceof Ref) {
                const localImage =
                  localImageCache.getByRef(xobj) ||
                  self._regionalImageCache.getByRef(xobj);
                if (localImage) {
                  addLocallyCachedImageOps(operatorList, localImage);
                  resolveXObject();
                  return;
                }

                const globalImage = self.globalImageCache.getData(xobj, self.pageIndex);

                if (globalImage) {
                  operatorList.addDependency(globalImage.objId!);
                  operatorList.addImageOps(
                    globalImage.fn,
                    globalImage.args,
                    globalImage.optionalContent
                  );

                  resolveXObject();
                  return;
                }

                xobj = xref.fetch(xobj);
              }

              if (!(xobj instanceof BaseStream)) {
                throw new FormatError("XObject should be a stream");
              }

              const type = xobj.dict!.getValue(DictKey.Subtype);
              if (!(type instanceof Name)) {
                throw new FormatError("XObject should have a Name subtype");
              }

              if (type.name === "Form") {
                stateManager.save();
                self.buildFormXObject(
                  resources, xobj, null, operatorList, task, stateManager.state.clone(), localColorSpaceCache
                ).then(() => {
                  stateManager.restore();
                  resolveXObject();
                }, rejectXObject);
                return;
              } else if (type.name === "Image") {
                self.buildPaintImageXObject(
                  resources, xobj, false, operatorList, name,
                  localImageCache, localColorSpaceCache,
                ).then(resolveXObject, rejectXObject);
                return;
              } else if (type.name === "PS") {
                // PostScript XObjects are unused when viewing documents.
                // See section 4.7.1 of Adobe's PDF reference.
                info("Ignored XObject subtype PS");
              } else {
                throw new FormatError(`Unhandled XObject subtype ${type.name}`);
              }
              resolveXObject();
            }).catch(function (reason) {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                warn(`getOperatorList - ignoring XObject: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.setFont:
            var fontSize = args[1];
            // eagerly collect all fonts
            next(self.handleSetFont(
              resources,
              <[Name | string, number]>args,
              null,
              operatorList,
              task,
              stateManager.state,
              fallbackFontDict
            ).then(function (loadedName) {
              operatorList.addDependency(loadedName);
              operatorList.addOp(OPS.setFont, [loadedName, <number>fontSize]);
            }));
            return;
          case OPS.beginText:
            parsingText = true;
            break;
          case OPS.endText:
            parsingText = false;
            break;
          case OPS.endInlineImage:
            var cacheKey = args[0].cacheKey;
            if (cacheKey) {
              const localImage = localImageCache.getByName(cacheKey);
              if (localImage) {
                addLocallyCachedImageOps(operatorList, localImage);
                args = null;
                continue;
              }
            }
            next(self.buildPaintImageXObject(
              resources, args[0], true, operatorList,
              cacheKey, localImageCache, localColorSpaceCache,
            ));
            return;
          case OPS.showText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            args[0] = self.handleText(args[0], stateManager.state);
            break;
          case OPS.showSpacedText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            var combinedGlyphs = [];
            var state = stateManager.state;
            for (const arrItem of args[0]) {
              if (typeof arrItem === "string") {
                combinedGlyphs.push(...self.handleText(arrItem, state));
              } else if (typeof arrItem === "number") {
                combinedGlyphs.push(arrItem);
              }
            }
            args[0] = combinedGlyphs;
            fn = OPS.showText;
            break;
          case OPS.nextLineShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            operatorList.addOp(OPS.nextLine, null);
            args[0] = self.handleText(args[0], stateManager.state);
            fn = OPS.showText;
            break;
          case OPS.nextLineSetSpacingShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            operatorList.addOp(OPS.nextLine, null);
            operatorList.addOp(OPS.setWordSpacing, [args.shift()]);
            operatorList.addOp(OPS.setCharSpacing, [args.shift()]);
            args[0] = self.handleText(args[0], stateManager.state);
            fn = OPS.showText;
            break;
          case OPS.setTextRenderingMode:
            stateManager.state.textRenderingMode = args[0];
            break;

          case OPS.setFillColorSpace: {
            const cachedColorSpace = ColorSpace.getCached(
              args[0],
              xref,
              localColorSpaceCache
            );
            if (cachedColorSpace) {
              stateManager.state.fillColorSpace = cachedColorSpace;
              continue;
            }

            next(self.parseColorSpace(
              args[0],
              resources,
              localColorSpaceCache,
            ).then(colorSpace => {
              stateManager.state.fillColorSpace =
                colorSpace || ColorSpace.singletons.gray;
            }));
            return;
          }
          case OPS.setStrokeColorSpace: {
            const cachedColorSpace = ColorSpace.getCached(
              args[0], xref, localColorSpaceCache
            );
            if (cachedColorSpace) {
              stateManager.state.strokeColorSpace = cachedColorSpace;
              continue;
            }

            next(self.parseColorSpace(
              args[0],
              resources,
              localColorSpaceCache,
            ).then(colorSpace => {
              stateManager.state.strokeColorSpace =
                colorSpace || ColorSpace.singletons.gray;
            }));
            return;
          }
          case OPS.setFillColor:
            cs = stateManager.state.fillColorSpace!;
            args = cs.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeColor:
            cs = stateManager.state.strokeColorSpace!;
            args = cs.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setStrokeRGBColor;
            break;
          case OPS.setFillGray:
            stateManager.state.fillColorSpace = ColorSpace.singletons.gray;
            args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeGray:
            stateManager.state.strokeColorSpace = ColorSpace.singletons.gray;
            args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setStrokeRGBColor;
            break;
          case OPS.setFillCMYKColor:
            stateManager.state.fillColorSpace = ColorSpace.singletons.cmyk;
            args = ColorSpace.singletons.cmyk.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeCMYKColor:
            stateManager.state.strokeColorSpace = ColorSpace.singletons.cmyk;
            args = ColorSpace.singletons.cmyk.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setStrokeRGBColor;
            break;
          case OPS.setFillRGBColor:
            stateManager.state.fillColorSpace = ColorSpace.singletons.rgb;
            args = ColorSpace.singletons.rgb.getRgb(args as unknown as TypedArray, 0);
            break;
          case OPS.setStrokeRGBColor:
            stateManager.state.strokeColorSpace = ColorSpace.singletons.rgb;
            args = ColorSpace.singletons.rgb.getRgb(args as unknown as TypedArray, 0);
            break;
          case OPS.setFillColorN:
            cs = stateManager.state.patternFillColorSpace;
            if (!cs) {
              if (isNumberArray(args, null)) {
                args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
                fn = OPS.setFillRGBColor;
                break;
              }
              args = [];
              fn = OPS.setFillTransparent;
              break;
            }
            if (cs.name === "Pattern") {
              next(self.handleColorN(
                operatorList,
                OPS.setFillColorN,
                args,
                cs,
                patterns,
                resources,
                task,
                localColorSpaceCache,
                localTilingPatternCache,
                localShadingPatternCache
              ));
              return;
            }
            args = cs.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setFillRGBColor;
            break;
          case OPS.setStrokeColorN:
            cs = stateManager.state.patternStrokeColorSpace;
            if (!cs) {
              if (isNumberArray(args, null)) {
                args = ColorSpace.singletons.gray.getRgb(args as unknown as TypedArray, 0);
                fn = OPS.setStrokeRGBColor;
                break;
              }
              args = [];
              fn = OPS.setStrokeTransparent;
              break;
            }
            if (cs.name === "Pattern") {
              next(self.handleColorN(
                operatorList,
                OPS.setStrokeColorN,
                args,
                cs,
                patterns,
                resources,
                task,
                localColorSpaceCache,
                localTilingPatternCache,
                localShadingPatternCache
              ));
              return;
            }
            args = cs.getRgb(args as unknown as TypedArray, 0);
            fn = OPS.setStrokeRGBColor;
            break;

          case OPS.shadingFill:
            let shading;
            try {
              const shadingRes = resources.getValue(DictKey.Shading);
              if (!shadingRes) {
                throw new FormatError("No shading resource found");
              }

              shading = shadingRes.get(args[0].name);
              if (!shading) {
                throw new FormatError("No shading object found");
              }
            } catch (reason) {
              if (reason instanceof AbortException) {
                continue;
              }
              if (self.options.ignoreErrors) {
                warn(`getOperatorList - ignoring Shading: "${reason}".`);
                continue;
              }
              throw reason;
            }
            const patternId = self.parseShading(
              shading,
              resources,
              localColorSpaceCache,
              localShadingPatternCache,
            );
            if (!patternId) {
              continue;
            }
            args = [patternId];
            fn = OPS.shadingFill;
            break;
          case OPS.setGState:
            isValidName = args[0] instanceof Name;
            name = args[0].name;

            if (isValidName) {
              const localGStateObj = localGStateCache.getByName(name);
              if (localGStateObj) {
                if (localGStateObj.length > 0) {
                  operatorList.addOp(OPS.setGState, [localGStateObj]);
                }
                args = null;
                continue;
              }
            }

            next(new Promise(function (resolveGState, rejectGState) {
              if (!isValidName) {
                throw new FormatError("GState must be referred to by name.");
              }

              const extGState = resources.getValue(DictKey.ExtGState);
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

              self.setGState(
                resources,
                gState,
                operatorList,
                name,
                task,
                stateManager,
                localGStateCache,
                localColorSpaceCache,
              ).then(resolveGState, rejectGState);
            }).catch(function (reason) {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                warn(`getOperatorList - ignoring ExtGState: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.moveTo:
          case OPS.lineTo:
          case OPS.curveTo:
          case OPS.curveTo2:
          case OPS.curveTo3:
          case OPS.closePath:
          case OPS.rectangle:
            self.buildPath(operatorList, fn!, args, parsingText);
            continue;
          case OPS.markPoint:
          case OPS.markPointProps:
          case OPS.beginCompat:
          case OPS.endCompat:
            // Ignore operators where the corresponding handlers are known to
            // be no-op in CanvasGraphics (display/canvas.js). This prevents
            // serialization errors and is also a bit more efficient.
            // We could also try to serialize all objects in a general way,
            // e.g. as done in https://github.com/mozilla/pdf.js/pull/6266,
            // but doing so is meaningless without knowing the semantics.
            continue;
          case OPS.beginMarkedContentProps:
            if (!(args[0] instanceof Name)) {
              warn(`Expected name for beginMarkedContentProps arg0=${args[0]}`);
              operatorList.addOp(OPS.beginMarkedContentProps, ["OC", null]);
              continue;
            }
            if (args[0].name === "OC") {
              next(self.parseMarkedContentProps(args[1], resources).then(
                data => operatorList.addOp(OPS.beginMarkedContentProps, ["OC", data,])
              ).catch(reason => {
                if (reason instanceof AbortException) {
                  return;
                }
                if (self.options.ignoreErrors) {
                  warn(`getOperatorList - ignoring beginMarkedContentProps: "${reason}".`);
                  operatorList.addOp(OPS.beginMarkedContentProps, ["OC", null]);
                  return;
                }
                throw reason;
              }));
              return;
            }
            // Other marked content types aren't supported yet.
            args = [
              args[0].name,
              args[1] instanceof Dict ? args[1].getValue(DictKey.MCID) : null,
            ];
            break;
          case OPS.beginMarkedContent:
          case OPS.endMarkedContent:
          default:
            // Note: Ignore the operator if it has `Dict` arguments, since
            // those are non-serializable, otherwise postMessage will throw
            // "An object could not be cloned.".
            if (args !== null) {
              for (i = 0, ii = args.length; i < ii; i++) {
                if (args[i] instanceof Dict) {
                  break;
                }
              }
              if (i < ii) {
                warn("getOperatorList - ignoring operator: " + fn);
                continue;
              }
            }
        }
        operatorList.addOp(fn!, <any>args);
      }
      if (stop) {
        next(deferred);
        return;
      }
      // Some PDFs don't close all restores inside object/form.
      // Closing those for them.
      closePendingRestoreOPS();
      resolve();
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.options.ignoreErrors) {
        warn(
          `getOperatorList - ignoring errors during "${task.name}" ` +
          `task: "${reason}".`
        );

        closePendingRestoreOPS();
        return;
      }
      throw reason;
    });
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
    // Ensure that `resources`/`stateManager` is correctly initialized,
    // even if the provided parameter is e.g. `null`.
    resources ||= Dict.empty;
    stateManager ||= new StateManager(new TextState());

    if (includeMarkedContent) {
      markedContentData ||= { level: 0 };
    }

    const textContent: EvaluatorTextContent = {
      items: [],
      styles: new Map(),
      lang,
    };

    const textContentItem: DefaultTextContentItem = {
      initialized: false,
      str: [],
      totalWidth: 0,
      totalHeight: 0,
      width: 0,
      height: 0,
      vertical: false,
      prevTransform: <TransformType | null>null,
      textAdvanceScale: 0,
      spaceInFlowMin: 0,
      spaceInFlowMax: 0,
      trackingSpaceMin: Infinity,
      negativeSpaceMax: -Infinity,
      notASpace: -Infinity,
      transform: <TransformType | null>null,
      fontName: <string | null>null,
      hasEOL: false,
    };

    // Use a circular buffer (length === 2) to save the last chars in the
    // text stream.
    // This implementation of the circular buffer is using a fixed array
    // and the position of the next element:
    // function addElement(x) {
    //   buffer[pos] = x;
    //   pos = (pos + 1) % buffer.length;
    // }
    // It's a way faster than:
    // function addElement(x) {
    //   buffer.push(x);
    //   buffer.shift();
    // }
    //
    // It's useful to know when we need to add a whitespace in the
    // text chunk.
    const twoLastChars = [" ", " "];
    let twoLastCharsPos = 0;

    /**
     * Save the last char.
     * @param {string} char
     * @returns {boolean} true when the two last chars before adding the new one
     * are a non-whitespace followed by a whitespace.
     */
    function saveLastChar(char: string): boolean {
      const nextPos = (twoLastCharsPos + 1) % 2;
      const ret =
        twoLastChars[twoLastCharsPos] !== " " && twoLastChars[nextPos] === " ";
      twoLastChars[twoLastCharsPos] = char;
      twoLastCharsPos = nextPos;

      return !keepWhiteSpace && ret;
    }

    function shouldAddWhitepsace() {
      return (
        !keepWhiteSpace &&
        twoLastChars[twoLastCharsPos] !== " " &&
        twoLastChars[(twoLastCharsPos + 1) % 2] === " "
      );
    }

    function resetLastChars() {
      twoLastChars[0] = twoLastChars[1] = " ";
      twoLastCharsPos = 0;
    }

    // Used in addFakeSpaces.

    // A white <= fontSize * TRACKING_SPACE_FACTOR is a tracking space
    // so it doesn't count as a space.
    const TRACKING_SPACE_FACTOR = 0.102;

    // When a white <= fontSize * NOT_A_SPACE_FACTOR, there is no space
    // even if one is present in the text stream.
    const NOT_A_SPACE_FACTOR = 0.03;

    // A negative white < fontSize * NEGATIVE_SPACE_FACTOR induces
    // a break (a new chunk of text is created).
    // It doesn't change anything when the text is copied but
    // it improves potential mismatch between text layer and canvas.
    const NEGATIVE_SPACE_FACTOR = -0.2;

    // A white with a width in [fontSize * MIN_FACTOR; fontSize * MAX_FACTOR]
    // is a space which will be inserted in the current flow of words.
    // If the width is outside of this range then the flow is broken
    // (which means a new span in the text layer).
    // It's useful to adjust the best as possible the span in the layer
    // to what is displayed in the canvas.
    const SPACE_IN_FLOW_MIN_FACTOR = 0.102;
    const SPACE_IN_FLOW_MAX_FACTOR = 0.6;

    // If a char is too high/too low compared to the previous we just create
    // a new chunk.
    // If the advance isn't in the +/-VERTICAL_SHIFT_RATIO * height range then
    // a new chunk is created.
    const VERTICAL_SHIFT_RATIO = 0.25;

    const self = this;
    const xref = this.xref;
    const showSpacedTextBuffer = <string[]>[];

    // The xobj is parsed iff it's needed, e.g. if there is a `DO` cmd.
    let xobjs: Dict | null = null;
    // 这个不能是LocalImageCache
    const emptyXObjectCache = new LocalImageCache();
    const emptyGStateCache = new LocalGStateCache();

    const preprocessor = new EvaluatorPreprocessor(stream, xref, stateManager);

    let textState: TextState | null = null;

    function pushWhitespace(
      width = 0, height = 0, transform = textContentItem.prevTransform, fontName = textContentItem.fontName,
    ): void {
      textContent.items.push({
        str: " ",
        dir: "ltr",
        width,
        height,
        transform,
        fontName: fontName!,
        hasEOL: false,
      });
    }

    function getCurrentTextTransform() {
      // 9.4.4 Text Space Details
      const font = textState!.font!;
      const fontSize = textState!.fontSize;
      const textHScale = textState!.textHScale;
      const textRise = textState!.textRise;
      const tsm = [fontSize * textHScale, 0, 0, fontSize, 0, textRise];

      if (
        font.isType3Font &&
        (textState!.fontSize <= 1 || font.isCharBBox) &&
        !isArrayEqual(textState!.fontMatrix, FONT_IDENTITY_MATRIX)
      ) {
        const glyphHeight = (<Font>font).bbox![3] - (<Font>font).bbox![1];
        if (glyphHeight > 0) {
          tsm[3] *= glyphHeight * textState!.fontMatrix[3];
        }
      }

      return Util.transform(
        textState!.ctm, Util.transform(textState!.textMatrix, tsm)
      );
    }

    function ensureTextContentItem() {
      if (textContentItem.initialized) {
        return textContentItem;
      }
      const font = textState!.font!;
      const loadedName = textState!.loadedName!;
      if (!seenStyles.has(loadedName)) {
        const validFont = <Font>font;
        seenStyles.add(loadedName);
        const style = {
          fontFamily: (validFont).fallbackName,
          ascent: (validFont).ascent,
          descent: (validFont).descent,
          vertical: (validFont).vertical!,
          fontSubstitution: null,
          fontSubstitutionLoadedName: null,
        }
        textContent.styles.set(loadedName, style);
        if (self.options.fontExtraProperties && (validFont).systemFontInfo) {
          const style = textContent.styles.get(loadedName)!;
          style.fontSubstitution = (validFont).systemFontInfo!.css;
          style.fontSubstitutionLoadedName = (validFont).systemFontInfo!.loadedName;
        }
      }
      textContentItem.fontName = loadedName;

      const trm = (textContentItem.transform = getCurrentTextTransform());
      if (!font.vertical) {
        textContentItem.width = textContentItem.totalWidth = 0;
        textContentItem.height = textContentItem.totalHeight = Math.hypot(trm[2], trm[3]);
        textContentItem.vertical = false;
      } else {
        textContentItem.width = textContentItem.totalWidth = Math.hypot(trm[0], trm[1]);
        textContentItem.height = textContentItem.totalHeight = 0;
        textContentItem.vertical = true;
      }

      const scaleLineX = Math.hypot(
        textState!.textLineMatrix[0], textState!.textLineMatrix[1]
      );

      const scaleCtmX = Math.hypot(textState!.ctm[0], textState!.ctm[1]);
      textContentItem.textAdvanceScale = scaleCtmX * scaleLineX;

      const { fontSize } = textState!;
      textContentItem.trackingSpaceMin = fontSize * TRACKING_SPACE_FACTOR;
      textContentItem.notASpace = fontSize * NOT_A_SPACE_FACTOR;
      textContentItem.negativeSpaceMax = fontSize * NEGATIVE_SPACE_FACTOR;
      textContentItem.spaceInFlowMin = fontSize * SPACE_IN_FLOW_MIN_FACTOR;
      textContentItem.spaceInFlowMax = fontSize * SPACE_IN_FLOW_MAX_FACTOR;
      textContentItem.hasEOL = false;

      textContentItem.initialized = true;
      return textContentItem;
    }

    function updateAdvanceScale() {
      if (!textContentItem.initialized) {
        return;
      }

      const scaleLineX = Math.hypot(
        textState!.textLineMatrix[0],
        textState!.textLineMatrix[1]
      );
      const scaleCtmX = Math.hypot(textState!.ctm[0], textState!.ctm[1]);
      const scaleFactor = scaleCtmX * scaleLineX;
      if (scaleFactor === textContentItem.textAdvanceScale) {
        return;
      }

      if (!textContentItem.vertical) {
        textContentItem.totalWidth +=
          textContentItem.width * textContentItem.textAdvanceScale;
        textContentItem.width = 0;
      } else {
        textContentItem.totalHeight +=
          textContentItem.height * textContentItem.textAdvanceScale;
        textContentItem.height = 0;
      }

      textContentItem.textAdvanceScale = scaleFactor;
    }

    function runBidiTransform(textChunk: DefaultTextContentItem) {
      let text = textChunk.str.join("");
      if (!disableNormalization) {
        text = normalizeUnicode(text);
      }
      const bidiResult = bidi(text, -1, textChunk.vertical);
      return {
        str: bidiResult.str,
        dir: bidiResult.dir,
        width: Math.abs(textChunk.totalWidth),
        height: Math.abs(textChunk.totalHeight),
        transform: textChunk.transform,
        fontName: textChunk.fontName!,
        hasEOL: textChunk.hasEOL,
      };
    }

    async function handleSetFont(fontName: string | null, fontRef: Ref | null) {
      const translated = await self.loadFont(fontName, fontRef, resources!);

      if (translated.font.isType3Font) {
        try {
          await translated.loadType3Data(self, resources!, task);
        } catch {
          // Ignore Type3-parsing errors, since we only use `loadType3Data`
          // here to ensure that we'll always obtain a useful /FontBBox.
        }
      }

      textState!.loadedName = translated.loadedName;
      textState!.font = translated.font!;
      textState!.fontMatrix = translated.font.fontMatrix || FONT_IDENTITY_MATRIX;
    }

    function applyInverseRotation(x: number, y: number, matrix: TransformType) {
      const scale = Math.hypot(matrix[0], matrix[1]);
      return [
        (matrix[0] * x + matrix[1] * y) / scale,
        (matrix[2] * x + matrix[3] * y) / scale,
      ];
    }

    function compareWithLastPosition(glyphWidth: number) {
      const currentTransform = getCurrentTextTransform();
      let posX = currentTransform[4];
      let posY = currentTransform[5];

      // Check if the glyph is in the viewbox.
      if (textState!.font?.vertical) {
        if (
          posX < viewBox[0] ||
          posX > viewBox[2] ||
          posY + glyphWidth < viewBox[1] ||
          posY > viewBox[3]
        ) {
          return false;
        }
      } else if (
        posX + glyphWidth < viewBox[0] ||
        posX > viewBox[2] ||
        posY < viewBox[1] ||
        posY > viewBox[3]
      ) {
        return false;
      }

      if (!textState!.font || !textContentItem.prevTransform) {
        return true;
      }

      let lastPosX = textContentItem.prevTransform[4];
      let lastPosY = textContentItem.prevTransform[5];

      if (lastPosX === posX && lastPosY === posY) {
        return true;
      }

      let rotate = -1;
      // Take into account the rotation is the current transform.
      if (
        currentTransform[0] &&
        currentTransform[1] === 0 &&
        currentTransform[2] === 0
      ) {
        rotate = currentTransform[0] > 0 ? 0 : 180;
      } else if (
        currentTransform[1] &&
        currentTransform[0] === 0 &&
        currentTransform[3] === 0
      ) {
        rotate = currentTransform[1] > 0 ? 90 : 270;
      }

      switch (rotate) {
        case 0:
          break;
        case 90:
          [posX, posY] = [posY, posX];
          [lastPosX, lastPosY] = [lastPosY, lastPosX];
          break;
        case 180:
          [posX, posY, lastPosX, lastPosY] = [-posX, -posY, -lastPosX, -lastPosY];
          break;
        case 270:
          [posX, posY] = [-posY, -posX];
          [lastPosX, lastPosY] = [-lastPosY, -lastPosX];
          break;
        default:
          // This is not a 0, 90, 180, 270 rotation so:
          //  - remove the scale factor from the matrix to get a rotation matrix
          //  - apply the inverse (which is the transposed) to the positions
          // and we can then compare positions of the glyphes to detect
          // a whitespace.
          [posX, posY] = applyInverseRotation(posX, posY, currentTransform);
          [lastPosX, lastPosY] = applyInverseRotation(
            lastPosX, lastPosY, textContentItem.prevTransform
          );
      }

      if (textState!.font.vertical) {
        const advanceY = (lastPosY - posY) / textContentItem.textAdvanceScale;
        const advanceX = posX - lastPosX;

        // When the total height of the current chunk is negative
        // then we're writing from bottom to top.
        const textOrientation = Math.sign(textContentItem.height);
        if (advanceY < textOrientation * textContentItem.negativeSpaceMax) {
          /* not the same column */
          if (Math.abs(advanceX) > 0.5 * textContentItem.width) {
            appendEOL();
            return true;
          }

          resetLastChars();
          flushTextContentItem();
          return true;
        }

        if (Math.abs(advanceX) > textContentItem.width) {
          appendEOL();
          return true;
        }

        if (advanceY <= textOrientation * textContentItem.notASpace) {
          // The real spacing between 2 consecutive chars is thin enough to be
          // considered a non-space.
          resetLastChars();
        }

        if (advanceY <= textOrientation * textContentItem.trackingSpaceMin) {
          if (shouldAddWhitepsace()) {
            // The space is very thin, hence it deserves to have its own span in
            // order to avoid too much shift between the canvas and the text
            // layer.
            resetLastChars();
            flushTextContentItem();
            pushWhitespace(0, Math.abs(advanceY));
          } else {
            textContentItem.height += advanceY;
          }
        } else if (!addFakeSpaces(advanceY, textContentItem.prevTransform, textOrientation)) {
          if (textContentItem.str.length === 0) {
            resetLastChars();
            pushWhitespace(0, Math.abs(advanceY));
          } else {
            textContentItem.height += advanceY;
          }
        }

        if (Math.abs(advanceX) > textContentItem.width * VERTICAL_SHIFT_RATIO) {
          flushTextContentItem();
        }

        return true;
      }

      const advanceX = (posX - lastPosX) / textContentItem.textAdvanceScale;
      const advanceY = posY - lastPosY;

      // When the total width of the current chunk is negative
      // then we're writing from right to left.
      const textOrientation = Math.sign(textContentItem.width);
      if (advanceX < textOrientation * textContentItem.negativeSpaceMax) {
        /* not the same line */
        if (Math.abs(advanceY) > 0.5 * textContentItem.height) {
          appendEOL();
          return true;
        }

        // We're moving back so in case the last char was a whitespace
        // we cancel it: it doesn't make sense to insert it.
        resetLastChars();
        flushTextContentItem();
        return true;
      }

      if (Math.abs(advanceY) > textContentItem.height) {
        appendEOL();
        return true;
      }

      if (advanceX <= textOrientation * textContentItem.notASpace) {
        // The real spacing between 2 consecutive chars is thin enough to be
        // considered a non-space.
        resetLastChars();
      }

      if (advanceX <= textOrientation * textContentItem.trackingSpaceMin) {
        if (shouldAddWhitepsace()) {
          // The space is very thin, hence it deserves to have its own span in
          // order to avoid too much shift between the canvas and the text
          // layer.
          resetLastChars();
          flushTextContentItem();
          pushWhitespace(Math.abs(advanceX));
        } else {
          textContentItem.width += advanceX;
        }
      } else if (!addFakeSpaces(advanceX, textContentItem.prevTransform, textOrientation)) {
        if (textContentItem.str.length === 0) {
          resetLastChars();
          pushWhitespace(Math.abs(advanceX));
        } else {
          textContentItem.width += advanceX;
        }
      }

      if (Math.abs(advanceY) > textContentItem.height * VERTICAL_SHIFT_RATIO) {
        flushTextContentItem();
      }

      return true;
    }

    function buildTextContentItem(chars: string, extraSpacing: number) {
      const font = textState!.font!;
      if (!chars) {
        // Just move according to the space we have.
        const charSpacing = textState!.charSpacing + extraSpacing;
        if (charSpacing) {
          if (!font!.vertical) {
            textState!.translateTextMatrix(charSpacing * textState!.textHScale, 0);
          } else {
            textState!.translateTextMatrix(0, -charSpacing);
          }
        }

        if (keepWhiteSpace) {
          compareWithLastPosition(0);
        }

        return;
      }

      const glyphs = font!.charsToGlyphs(chars);
      const scale = textState!.fontMatrix[0] * textState!.fontSize;

      for (let i = 0, ii = glyphs.length; i < ii; i++) {
        const glyph = glyphs[i];
        const { category } = glyph;

        if (category.isInvisibleFormatMark) {
          continue;
        }
        let charSpacing = textState!.charSpacing + (i + 1 === ii ? extraSpacing : 0);

        let glyphWidth = glyph.width;
        if (font!.vertical) {
          glyphWidth = glyph.vmetric ? glyph.vmetric[0] : -glyphWidth;
        }
        let scaledDim = glyphWidth * scale;

        if (!keepWhiteSpace && category.isWhitespace) {
          // Don't push a " " in the textContentItem
          // (except when it's between two non-spaces chars),
          // it will be done (if required) in next call to
          // compareWithLastPosition.
          // This way we can merge real spaces and spaces due to cursor moves.
          if (!font!.vertical) {
            charSpacing += scaledDim + textState!.wordSpacing;
            textState!.translateTextMatrix(charSpacing * textState!.textHScale, 0);
          } else {
            charSpacing += -scaledDim + textState!.wordSpacing;
            textState!.translateTextMatrix(0, -charSpacing);
          }
          saveLastChar(" ");
          continue;
        }

        if (!category.isZeroWidthDiacritic && !compareWithLastPosition(scaledDim)) {
          // The glyph is not in page so just skip it but move the cursor.
          if (!font!.vertical) {
            textState!.translateTextMatrix(scaledDim * textState!.textHScale, 0);
          } else {
            textState!.translateTextMatrix(0, scaledDim);
          }
          continue;
        }

        // Must be called after compareWithLastPosition because
        // the textContentItem could have been flushed.
        const textChunk = ensureTextContentItem();
        if (category.isZeroWidthDiacritic) {
          scaledDim = 0;
        }

        if (!font!.vertical) {
          scaledDim *= textState!.textHScale;
          textState!.translateTextMatrix(scaledDim, 0);
          textChunk.width += scaledDim;
        } else {
          textState!.translateTextMatrix(0, scaledDim);
          scaledDim = Math.abs(scaledDim);
          textChunk.height += scaledDim;
        }

        if (scaledDim) {
          // Save the position of the last visible character.
          textChunk.prevTransform = getCurrentTextTransform();
        }

        const glyphUnicode = glyph.unicode;
        if (saveLastChar(glyphUnicode)) {
          // The two last chars are a non-whitespace followed by a whitespace
          // and then this non-whitespace, so we insert a whitespace here.
          // Replaces all whitespaces with standard spaces (0x20), to avoid
          // alignment issues between the textLayer and the canvas if the text
          // contains e.g. tabs (fixes issue6612.pdf).
          textChunk.str.push(" ");
        }
        textChunk.str.push(glyphUnicode);

        if (charSpacing) {
          if (!font!.vertical) {
            textState!.translateTextMatrix(charSpacing * textState!.textHScale, 0);
          } else {
            textState!.translateTextMatrix(0, -charSpacing);
          }
        }
      }
    }

    function appendEOL() {
      resetLastChars();
      if (textContentItem.initialized) {
        textContentItem.hasEOL = true;
        flushTextContentItem();
      } else {
        textContent.items.push({
          str: "",
          dir: "ltr",
          width: 0,
          height: 0,
          transform: getCurrentTextTransform(),
          fontName: textState!.loadedName!,
          hasEOL: true,
        });
      }
    }

    function addFakeSpaces(width: number, transf: TransformType | null, textOrientation: number) {
      if (
        textOrientation * textContentItem.spaceInFlowMin <= width &&
        width <= textOrientation * textContentItem.spaceInFlowMax
      ) {
        if (textContentItem.initialized) {
          resetLastChars();
          textContentItem.str.push(" ");
        }
        return false;
      }

      const fontName = textContentItem.fontName;

      let height = 0;
      if (textContentItem.vertical) {
        height = width;
        width = 0;
      }

      flushTextContentItem();
      resetLastChars();
      pushWhitespace(
        Math.abs(width), Math.abs(height), transf || getCurrentTextTransform(), fontName
      );

      return true;
    }

    function flushTextContentItem() {
      if (!textContentItem.initialized || !textContentItem.str) {
        return;
      }

      // Do final text scaling.
      if (!textContentItem.vertical) {
        textContentItem.totalWidth +=
          textContentItem.width * textContentItem.textAdvanceScale;
      } else {
        textContentItem.totalHeight +=
          textContentItem.height * textContentItem.textAdvanceScale;
      }

      textContent.items.push(runBidiTransform(textContentItem));
      textContentItem.initialized = false;
      textContentItem.str.length = 0;
    }

    function enqueueChunk(batch = false) {
      const length = textContent.items.length;
      if (length === 0) {
        return;
      }
      if (batch && length < TEXT_CHUNK_BATCH_SIZE) {
        return;
      }
      sink.enqueue(textContent, length);
      textContent.items = [];
      textContent.styles = new Map();
    }

    const timeSlotManager = new TimeSlotManager();

    return new Promise<void>(function promiseBody(resolve, reject) {
      const next = function (promise: Promise<unknown>) {
        enqueueChunk(true);
        Promise.all([promise, sink.ready]).then(() => {
          try {
            promiseBody(resolve, reject);
          } catch (ex) {
            reject(ex);
          }
        }, reject);
      };
      task.ensureNotTerminated();
      timeSlotManager.reset();

      const operation: { fn?: OPS, args?: any[] } = {};
      let stop;
      let args = <any[]>[];
      while (!(stop = timeSlotManager.check())) {
        // The arguments parsed by read() are not used beyond this loop, so
        // we can reuse the same array on every iteration, thus avoiding
        // unnecessary allocations.
        args.length = 0;
        operation.args = args;
        if (!preprocessor.read(operation)) {
          break;
        }

        const previousState = textState;
        textState = <TextState>stateManager.state;
        assert(textState instanceof TextState, "textState应当是TextState类型");
        const fn = operation.fn;
        args = operation.args;

        switch (fn! | 0) {
          case OPS.setFont:
            // Optimization to ignore multiple identical Tf commands.
            var fontNameArg = args[0].name,
              fontSizeArg = args[1];
            if (
              textState.font &&
              fontNameArg === textState.fontName &&
              fontSizeArg === textState.fontSize
            ) {
              break;
            }

            flushTextContentItem();
            textState.fontName = fontNameArg;
            textState.fontSize = fontSizeArg;
            next(handleSetFont(fontNameArg, null));
            return;
          case OPS.setTextRise:
            textState.textRise = args[0];
            break;
          case OPS.setHScale:
            textState.textHScale = args[0] / 100;
            break;
          case OPS.setLeading:
            textState.leading = args[0];
            break;
          case OPS.moveText:
            textState.translateTextLineMatrix(args[0], args[1]);
            textState.textMatrix = textState.textLineMatrix.slice();
            break;
          case OPS.setLeadingMoveText:
            textState.leading = -args[1];
            textState.translateTextLineMatrix(args[0], args[1]);
            textState.textMatrix = textState.textLineMatrix.slice();
            break;
          case OPS.nextLine:
            textState.carriageReturn();
            break;
          case OPS.setTextMatrix:
            textState.setTextMatrix(args[0], args[1], args[2], args[3], args[4], args[5]);
            textState.setTextLineMatrix(args[0], args[1], args[2], args[3], args[4], args[5]);
            updateAdvanceScale();
            break;
          case OPS.setCharSpacing:
            textState.charSpacing = args[0];
            break;
          case OPS.setWordSpacing:
            textState.wordSpacing = args[0];
            break;
          case OPS.beginText:
            textState.textMatrix = IDENTITY_MATRIX.slice();
            textState.textLineMatrix = IDENTITY_MATRIX.slice();
            break;
          case OPS.showSpacedText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }

            const spaceFactor = ((textState.font!.vertical ? 1 : -1) * textState.fontSize) / 1000;
            const elements = args[0];
            for (let i = 0, ii = elements.length; i < ii; i++) {
              const item = elements[i];
              if (typeof item === "string") {
                showSpacedTextBuffer.push(item);
              } else if (typeof item === "number" && item !== 0) {
                // PDF Specification 5.3.2 states:
                // The number is expressed in thousandths of a unit of text
                // space.
                // This amount is subtracted from the current horizontal or
                // vertical coordinate, depending on the writing mode.
                // In the default coordinate system, a positive adjustment
                // has the effect of moving the next glyph painted either to
                // the left or down by the given amount.
                const str = showSpacedTextBuffer.join("");
                showSpacedTextBuffer.length = 0;
                buildTextContentItem(str, item * spaceFactor);
              }
            }

            if (showSpacedTextBuffer.length > 0) {
              const str = showSpacedTextBuffer.join("");
              showSpacedTextBuffer.length = 0;
              buildTextContentItem(str, 0);
            }
            break;
          case OPS.showText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            buildTextContentItem(args[0], 0);
            break;
          case OPS.nextLineShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            textState.carriageReturn();
            buildTextContentItem(args[0], 0);
            break;
          case OPS.nextLineSetSpacingShowText:
            if (!stateManager.state.font) {
              self.ensureStateFont(stateManager.state);
              continue;
            }
            textState.wordSpacing = args[0];
            textState.charSpacing = args[1];
            textState.carriageReturn();
            buildTextContentItem(args[2], 0);
            break;
          case OPS.paintXObject:
            flushTextContentItem();
            if (!xobjs) {
              xobjs = resources.getValue(DictKey.XObject) || Dict.empty;
            }

            var isValidName = args[0] instanceof Name;
            var name = args[0].name;

            if (isValidName && emptyXObjectCache.getByName(name)) {
              break;
            }

            next(new Promise<void>((resolveXObject, rejectXObject) => {
              if (!isValidName) {
                throw new FormatError("XObject must be referred to by name.");
              }
              let xobj = xobjs!.getRaw(name);
              if (xobj instanceof Ref) {
                if (emptyXObjectCache.getByRef(xobj)) {
                  resolveXObject();
                  return;
                }
                const globalImage = self.globalImageCache.getData(xobj, self.pageIndex);
                if (globalImage) {
                  resolveXObject();
                  return;
                }
                xobj = xref.fetch(xobj);
              }

              if (!(xobj instanceof BaseStream)) {
                throw new FormatError("XObject should be a stream");
              }
              const type = xobj.dict!.getValue(DictKey.Subtype);
              if (!(type instanceof Name)) {
                throw new FormatError("XObject should have a Name subtype");
              }

              if (type.name !== "Form") {
                emptyXObjectCache.set(name, xobj.dict!.objId, true);
                resolveXObject();
                return;
              }

              // Use a new `StateManager` to prevent incorrect positioning
              // of textItems *after* the Form XObject, since errors in the
              // data can otherwise prevent `restore` operators from
              // executing.
              // NOTE: Only an issue when `options.ignoreErrors === true`.
              const currentState = stateManager.state.clone();
              const xObjStateManager = new StateManager(currentState);

              const matrix = <TransformType | null>lookupMatrix(xobj.dict!.getArrayValue(DictKey.Matrix), null);
              if (matrix) {
                xObjStateManager.transform(matrix!);
              }

              // Enqueue the `textContent` chunk before parsing the /Form
              // XObject.
              enqueueChunk();

              const sinkWrapper = new TextContentSinkProxy(sink);

              self.getTextContent(
                xobj,
                task,
                xobj.dict!.getValue(DictKey.Resources) || resources,
                sinkWrapper,
                viewBox,
                includeMarkedContent,
                keepWhiteSpace,
                seenStyles,
                xObjStateManager,
                lang,
                markedContentData,
                disableNormalization,
              ).then(() => {
                if (!sinkWrapper.enqueueInvoked) {
                  emptyXObjectCache.set(name, xobj.dict!.objId, true);
                }
                resolveXObject();
              }, rejectXObject);
            }).catch(reason => {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                // Error(s) in the XObject -- allow text-extraction to
                // continue.
                warn(`getTextContent - ignoring XObject: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.setGState:
            isValidName = args[0] instanceof Name;
            name = args[0].name;

            if (isValidName && emptyGStateCache.getByName(name)) {
              break;
            }

            next(new Promise((resolveGState, rejectGState) => {
              if (!isValidName) {
                throw new FormatError("GState must be referred to by name.");
              }

              const extGState = resources.getValue(DictKey.ExtGState);
              if (!(extGState instanceof Dict)) {
                throw new FormatError("ExtGState should be a dictionary.");
              }

              const gState = extGState.getValue(name);
              // TODO: Attempt to lookup cached GStates by reference as well,
              //       if and only if there are PDF documents where doing so
              //       would significantly improve performance.
              if (!(gState instanceof Dict)) {
                throw new FormatError("GState should be a dictionary.");
              }

              const gStateFont = <[Ref, number]>gState.getValue(DictKey.Font);
              if (!gStateFont) {
                emptyGStateCache.set(name, gState.objId!, true);
                resolveGState(undefined);
                return;
              }

              flushTextContentItem();

              textState!.fontName = null;
              textState!.fontSize = gStateFont[1];
              handleSetFont(null, gStateFont[0]).then(resolveGState, rejectGState);
            }).catch(function (reason) {
              if (reason instanceof AbortException) {
                return;
              }
              if (self.options.ignoreErrors) {
                // Error(s) in the ExtGState -- allow text-extraction to
                // continue.
                warn(`getTextContent - ignoring ExtGState: "${reason}".`);
                return;
              }
              throw reason;
            }));
            return;
          case OPS.beginMarkedContent:
            flushTextContentItem();
            if (includeMarkedContent) {
              markedContentData!.level++;

              textContent.items.push({
                type: "beginMarkedContent",
                id: null,
                tag: args[0] instanceof Name ? args[0].name : null,
              });
            }
            break;
          case OPS.beginMarkedContentProps:
            flushTextContentItem();
            if (includeMarkedContent) {
              markedContentData!.level++;

              let mcid = null;
              if (args[1] instanceof Dict) {
                mcid = args[1].getValue(DictKey.MCID);
              }
              textContent.items.push({
                type: "beginMarkedContentProps",
                id: Number.isInteger(mcid)
                  ? `${self.idFactory.getPageObjId()}_mc${mcid}`
                  : null,
                tag: args[0] instanceof Name ? args[0].name : null,
              });
            }
            break;
          case OPS.endMarkedContent:
            flushTextContentItem();
            if (includeMarkedContent) {
              if (markedContentData!.level === 0) {
                // Handle unbalanced beginMarkedContent/endMarkedContent
                // operators (fixes issue15629.pdf).
                break;
              }
              markedContentData!.level--;

              textContent.items.push({
                id: null, tag: null,
                type: "endMarkedContent",
              });
            }
            break;
          case OPS.restore:
            if (
              previousState &&
              (previousState.font !== textState.font ||
                previousState.fontSize !== textState.fontSize ||
                previousState.fontName !== textState.fontName)
            ) {
              flushTextContentItem();
            }
            break;
        } // switch
        if (textContent.items.length >= sink.desiredSize) {
          // Wait for ready, if we reach highWaterMark.
          stop = true;
          break;
        }
      } // while
      if (stop) {
        next(deferred);
        return;
      }
      flushTextContentItem();
      enqueueChunk();
      resolve();
    }).catch(reason => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.options.ignoreErrors) {
        // Error(s) in the TextContent -- allow text-extraction to continue.
        warn(`getTextContent - ignoring errors during "${task.name}" task: "${reason}".`);

        flushTextContentItem();
        enqueueChunk();
        return;
      }
      throw reason;
    });
  }

  static buildFontPaths(
    font: Font, glyphs: Glyph[], handler: MessageHandler, evaluatorOptions: DocumentEvaluatorOptions
  ) {
    function buildPath(fontChar: string) {
      const glyphName = `${font.loadedName}_path_${fontChar}`;
      try {
        if (font.renderer.hasBuiltPath(fontChar)) {
          return;
        }
        const pathJs = font.renderer.getPathJs(fontChar);
        handler.commonobj(glyphName, CommonObjType.FontPath, pathJs);
      } catch (reason) {
        if (evaluatorOptions.ignoreErrors) {
          warn(`buildFontPaths - ignoring ${glyphName} glyph: "${reason}".`);
          return;
        }
        throw reason;
      }
    }

    for (const glyph of glyphs) {
      buildPath(glyph.fontChar);

      // If the glyph has an accent we need to build a path for its
      // fontChar too, otherwise CanvasGraphics_paintChar will fail.
      const accent = glyph.accent;
      if (accent?.fontChar) {
        buildPath(accent.fontChar);
      }
    }
  }

  static get fallbackFontDict() {
    const dict = new Dict();
    dict.set(DictKey.BaseFont, Name.get("Helvetica"));
    dict.set(DictKey.Type, Name.get("FallbackType"));
    dict.set(DictKey.Subtype, Name.get("FallbackType"));
    dict.set(DictKey.Encoding, Name.get("WinAnsiEncoding"));

    return shadow(this, "fallbackFontDict", dict);
  }
}

export class TranslatedFont {

  protected sent = false;

  public loadedName;

  public font: Font | ErrorFont;

  protected dict: Dict;

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
    PartialEvaluator.buildFontPaths(
      this.font,
      /* glyphs = */ this.font.glyphCacheValues,
      handler,
      this._evaluatorOptions
    );
  }

  // 这里这个函数只要做个改写就好了
  loadType3Data(evaluator: PartialEvaluator, resources: Dict, task: WorkerTask) {
    if (this.type3Loaded) {
      return this.type3Loaded;
    }
    if (!this.font.isType3Font) {
      throw new Error("Must be a Type3 pfont.");
    }
    // When parsing Type3 glyphs, always ignore them if there are errors.
    // Compared to the parsing of e.g. an entire page, it doesn't really
    // make sense to only be able to render a Type3 glyph partially.
    const type3Evaluator = evaluator.clone(false);
    // Prevent circular references in Type3 fonts.
    const type3FontRefs = new RefSet(evaluator.type3FontRefs);
    if (this.dict.objId && !type3FontRefs.has(this.dict.objId)) {
      type3FontRefs.put(this.dict.objId);
    }
    type3Evaluator.type3FontRefs = type3FontRefs;

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
        return type3Evaluator
          .getOperatorList({
            stream: glyphStream,
            task,
            resources: fontResources,
            operatorList,
          })
          .then(() => {
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
          })
          .catch(function (_reason: unknown) {
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

class EvaluatorPreprocessor {

  // 是一个参数类型
  protected nonProcessedArgs: any[];

  static get opMap() {
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
              nonProcessedArgs.push(args!.shift()!);
              argsLength--;
            }
            while (argsLength < numArgs && nonProcessedArgs.length !== 0) {
              if (args === null) {
                args = [];
              }
              args!.unshift(nonProcessedArgs.pop());
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
        args!.push(obj);
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
