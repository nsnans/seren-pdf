import {
  Uint8TypedArray,
  MurmurHash3_64,
  TransformType,
  DictKey,
  Name,
  Ref,
  AbortException,
  assert,
  FONT_IDENTITY_MATRIX,
  FormatError,
  info,
  stringToPDFString,
  warn, Dict
} from "seren-common";
import { BaseStream } from "../../stream/base_stream";
import { CMapFactory, IdentityCMap } from "../../cmap/cmap";
import { PreEvaluatedFont } from "../../common/core_types";
import { isNumberArray, lookupMatrix, lookupNormalRect } from "../../../../seren-common/src/utils/core_utils";
import { DecodeStream } from "../../stream/decode_stream";
import { getEncoding, MacRomanEncoding, StandardEncoding, SymbolSetEncoding, WinAnsiEncoding, ZapfDingbatsEncoding } from "../../tables/encodings";
import { EvaluatorContext, EvaluatorProperties, State, TranslatedFont } from "./evaluator";
import { CssFontInfo } from "packages/seren-common/src/types/font_types";
import { EvaluatorGeneralHandler } from "./evaluator_general_handler";
import { getFontSubstitution } from "../../document/font/font_substitutions";
import { ErrorFont, Font } from "../../document/font/fonts";
import { FontFlags } from "../../document/font/fonts_utils";
import { getGlyphsUnicode } from "../../document/font/glyphlist";
import { getMetrics } from "../../document/font/metrics";
import { OperatorList } from "../operator_list";
import { getFontNameToFileMap, getSerifFonts, getStandardFontName, getStdFontMap, getSymbolsFonts, isKnownFontName } from "../../document/font/standard_fonts";
import { Stream } from "../../stream/stream";
import { IdentityToUnicodeMap, ToUnicodeMap } from "../../document/font/to_unicode_map";
import { getUnicodeForGlyph } from "../../tables/unicode";
import { WorkerTask } from "../../worker/worker";
import { DictImpl } from "../../document/dict_impl";

export class EvaluatorFontHandler {

  protected readonly context: EvaluatorContext;

  constructor(context: EvaluatorContext) {
    this.context = context;
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
        // 用context构建出
        await translated.loadType3Data(this.context, resources, task);
        // Add the dependencies to the parent operatorList so they are
        // resolved before Type3 operatorLists are executed synchronously.
        operatorList.addDependencies(translated.type3Dependencies!);
      } catch (reason) {
        translated = new TranslatedFont(
          "g_font_error",
          new ErrorFont(`Type3 font load error: ${reason}`),
          // 这里是个坑爹的问题，估计出问题的时候，直接拿这个font来存dict了
          translated.font as unknown as Dict,
          this.context.options,
        );
      }
    }

    state.font = translated.font;
    translated.send(this.context.handler);
    return translated.loadedName;
  }

  async readToUnicode(cmapObj: Name | BaseStream) {
    if (!cmapObj) {
      return null;
    }
    if (cmapObj instanceof Name) {
      const cmap = await CMapFactory.create(
        cmapObj, this.context.fetchBuiltInCMapBound, null
      );

      if (cmap instanceof IdentityCMap) {
        return new IdentityToUnicodeMap(0, 0xffff);
      }
      return new ToUnicodeMap(<string[]>cmap.getMap());
    }
    if (cmapObj instanceof BaseStream) {
      try {
        const cmap = await CMapFactory.create(
          cmapObj, this.context.fetchBuiltInCMapBound, null
        );

        if (cmap instanceof IdentityCMap) {
          return new IdentityToUnicodeMap(0, 0xffff);
        }
        const map = new Array(cmap.length);
        // Convert UTF-16BE
        // NOTE: cmap can be a sparse array, so use forEach instead of
        // `for(;;)` to iterate over all keys.
        cmap.forEach((charCode, token) => {
          // Some cmaps contain *only* CID characters (fixes issue9367.pdf).
          if (typeof token === "number") {
            map[charCode] = String.fromCodePoint(token);
            return;
          }
          // Add back omitted leading zeros on odd length tokens
          // (fixes issue #18099)
          if (token.length % 2 !== 0) {
            token = "\u0000" + token;
          }
          const str = [];
          for (let k = 0; k < token.length; k += 2) {
            const w1 = (token.charCodeAt(k) << 8) | token.charCodeAt(k + 1);
            if ((w1 & 0xf800) !== 0xd800) {
              // w1 < 0xD800 || w1 > 0xDFFF
              str.push(w1);
              continue;
            }
            k += 2;
            const w2 = (token.charCodeAt(k) << 8) | token.charCodeAt(k + 1);
            str.push(((w1 & 0x3ff) << 10) + (w2 & 0x3ff) + 0x10000);
          }
          map[charCode] = String.fromCodePoint(...str);
        });
        return new ToUnicodeMap(map);
      } catch (reason) {
        if (reason instanceof AbortException) {
          return null;
        }
        if (this.context.options.ignoreErrors) {
          warn(`readToUnicode - ignoring ToUnicode data: "${reason}".`);
          return null;
        }
        throw reason;
      }
    }
    return null;
  }

  async extractDataStructures(dict: Dict, properties: EvaluatorProperties) {
    const xref = this.context.xref;
    let cidToGidBytes: Uint8TypedArray | null = null;
    // 9.10.2
    const toUnicodePromise = this.readToUnicode(<BaseStream>properties.toUnicode);

    if (properties.composite) {
      // CIDSystemInfo helps to match CID to glyphs
      const cidSystemInfo = dict.getValue(DictKey.CIDSystemInfo);
      if (cidSystemInfo instanceof DictImpl) {
        properties.cidSystemInfo = {
          registry: stringToPDFString(cidSystemInfo.getValue(DictKey.Registry)),
          ordering: stringToPDFString(cidSystemInfo.getValue(DictKey.Ordering)),
          supplement: cidSystemInfo.getValue(DictKey.Supplement),
        };
      }

      try {
        const cidToGidMap = dict.getValue(DictKey.CIDToGIDMap);
        if (cidToGidMap instanceof BaseStream) {
          cidToGidBytes = cidToGidMap.getBytes();
        }
      } catch (ex) {
        if (!this.context.options.ignoreErrors) {
          throw ex;
        }
        warn(`extractDataStructures - ignoring CIDToGIDMap data: "${ex}".`);
      }
    }

    // Based on 9.6.6 of the spec the encoding can come from multiple places
    // and depends on the font type. The base encoding and differences are
    // read here, but the encoding that is actually used is chosen during
    // glyph mapping in the font.
    // TODO: Loading the built in encoding in the font would allow the
    // differences to be merged in here not require us to hold on to it.
    const differences = [];
    let baseEncodingName = null;
    let encoding;
    if (dict.has(DictKey.Encoding)) {
      encoding = dict.getValue(DictKey.Encoding);
      if (encoding instanceof DictImpl) {
        baseEncodingName = encoding.getValue(DictKey.BaseEncoding);
        baseEncodingName =
          baseEncodingName instanceof Name ? baseEncodingName.name : null;
        // Load the differences between the base and original
        if (encoding.has(DictKey.Differences)) {
          const diffEncoding = encoding.getValue(DictKey.Differences);
          let index = 0;
          for (const entry of diffEncoding) {
            const data = xref.fetchIfRef(entry);
            if (typeof data === "number") {
              index = data;
            } else if (data instanceof Name) {
              differences[index++] = data.name;
            } else {
              throw new FormatError(
                `Invalid entry in 'Differences' array: ${data}`
              );
            }
          }
        }
      } else if (encoding instanceof Name) {
        baseEncodingName = encoding.name;
      } else {
        const msg = "Encoding is not a Name nor a Dict";

        if (!this.context.options.ignoreErrors) {
          throw new FormatError(msg);
        }
        warn(msg);
      }
      // According to table 114 if the encoding is a named encoding it must be
      // one of these predefined encodings.
      if (
        baseEncodingName !== "MacRomanEncoding" &&
        baseEncodingName !== "MacExpertEncoding" &&
        baseEncodingName !== "WinAnsiEncoding"
      ) {
        baseEncodingName = null;
      }
    }

    const nonEmbeddedFont = !properties.file || properties.isInternalFont;
    const symbolsFonts: Record<string, boolean> = getSerifFonts();
    const isSymbolsFontName = symbolsFonts[properties.name];
    // Ignore an incorrectly specified named encoding for non-embedded
    // symbol fonts (fixes issue16464.pdf).
    if (baseEncodingName && nonEmbeddedFont && isSymbolsFontName) {
      baseEncodingName = null;
    }

    if (baseEncodingName) {
      properties.defaultEncoding = getEncoding(baseEncodingName);
    } else {
      const isSymbolicFont = !!(properties.flags & FontFlags.Symbolic);
      const isNonsymbolicFont = !!(properties.flags & FontFlags.Nonsymbolic);
      // According to "Table 114" in section "9.6.6.1 General" (under
      // "9.6.6 Character Encoding") of the PDF specification, a Nonsymbolic
      // font should use the `StandardEncoding` if no encoding is specified.
      encoding = StandardEncoding;
      if (properties.type === "TrueType" && !isNonsymbolicFont) {
        encoding = WinAnsiEncoding;
      }
      // The Symbolic attribute can be misused for regular fonts
      // Heuristic: we have to check if the font is a standard one also
      if (isSymbolicFont || isSymbolsFontName) {
        encoding = MacRomanEncoding;
        if (nonEmbeddedFont) {
          if (/Symbol/i.test(properties.name)) {
            encoding = SymbolSetEncoding;
          } else if (/Dingbats/i.test(properties.name)) {
            encoding = ZapfDingbatsEncoding;
          } else if (/Wingdings/i.test(properties.name)) {
            encoding = WinAnsiEncoding;
          }
        }
      }
      properties.defaultEncoding = encoding;
    }

    properties.differences = differences;
    properties.baseEncodingName = baseEncodingName;
    properties.hasEncoding = !!baseEncodingName || differences.length > 0;
    properties.dict = dict;

    properties.toUnicode = (await toUnicodePromise)!;

    const builtToUnicode = await this.buildToUnicode(properties);
    properties.toUnicode = builtToUnicode;

    if (cidToGidBytes) {
      properties.cidToGidMap = this.readCidToGidMap(
        cidToGidBytes, builtToUnicode
      );
    }
    return properties;
  }

  /**
   * Builds a char code to unicode map based on section 9.10 of the spec.
   * @param properties Font properties object.
   * @returns A Promise that is resolved with a
   *   {ToUnicodeMap|IdentityToUnicodeMap} object.
   */
  async buildToUnicode(properties: EvaluatorProperties): Promise<ToUnicodeMap | IdentityToUnicodeMap> {
    properties.hasIncludedToUnicodeMap = (<ToUnicodeMap | IdentityToUnicodeMap>properties.toUnicode)?.length > 0;

    // Section 9.10.2 Mapping Character Codes to Unicode Values
    if (properties.hasIncludedToUnicodeMap) {
      // Some fonts contain incomplete ToUnicode data, causing issues with
      // text-extraction. For simple fonts, containing encoding information,
      // use a fallback ToUnicode map to improve this (fixes issue8229.pdf).
      if (!properties.composite && properties.hasEncoding) {
        properties.fallbackToUnicode = this._simpleFontToUnicode(properties);
      }
      return <ToUnicodeMap | IdentityToUnicodeMap>properties.toUnicode;
    }

    // According to the spec if the font is a simple font we should only map
    // to unicode if the base encoding is MacRoman, MacExpert, or WinAnsi or
    // the differences array only contains adobe standard or symbol set names,
    // in pratice it seems better to always try to create a toUnicode map
    // based of the default encoding.
    if (!properties.composite /* is simple font */) {
      return new ToUnicodeMap(this._simpleFontToUnicode(properties));
    }

    // If the font is a composite font that uses one of the predefined CMaps
    // listed in Table 118 (except Identity–H and Identity–V) or whose
    // descendant CIDFont uses the Adobe-GB1, Adobe-CNS1, Adobe-Japan1, or
    // Adobe-Korea1 character collection:
    if (
      properties.composite &&
      ((properties.cMap!.builtInCMap &&
        !(properties.cMap instanceof IdentityCMap)) ||
        // The font is supposed to have a CIDSystemInfo dictionary, but some
        // PDFs don't include it (fixes issue 17689), hence the `?'.
        (properties.cidSystemInfo?.registry === "Adobe" &&
          (properties.cidSystemInfo.ordering === "GB1" ||
            properties.cidSystemInfo.ordering === "CNS1" ||
            properties.cidSystemInfo.ordering === "Japan1" ||
            properties.cidSystemInfo.ordering === "Korea1")))
    ) {
      // Then:
      // a) Map the character code to a character identifier (CID) according
      // to the font’s CMap.
      // b) Obtain the registry and ordering of the character collection used
      // by the font’s CMap (for example, Adobe and Japan1) from its
      // CIDSystemInfo dictionary.
      const { registry, ordering } = properties.cidSystemInfo!;
      // c) Construct a second CMap name by concatenating the registry and
      // ordering obtained in step (b) in the format registry–ordering–UCS2
      // (for example, Adobe–Japan1–UCS2).
      const ucs2CMapName = Name.get(`${registry}-${ordering}-UCS2`);
      // d) Obtain the CMap with the name constructed in step (c) (available
      // from the ASN Web site; see the Bibliography).
      const ucs2CMap = await CMapFactory.create(
        ucs2CMapName, this.context.fetchBuiltInCMapBound, null
      );
      const toUnicode: string[] = [];
      const buf: number[] = [];
      properties.cMap!.forEach(function (charcode, cid) {
        if (<number>cid > 0xffff) {
          throw new FormatError("Max size of CID is 65,535");
        }
        // e) Map the CID obtained in step (a) according to the CMap
        // obtained in step (d), producing a Unicode value.
        const ucs2 = ucs2CMap.lookup(<number>cid);
        if (ucs2) {
          buf.length = 0;
          // Support multi-byte entries (fixes issue16176.pdf).
          for (let i = 0, ii = (<string>ucs2).length; i < ii; i += 2) {
            buf.push(((<string>ucs2).charCodeAt(i) << 8) + (<string>ucs2).charCodeAt(i + 1));
          }
          toUnicode[charcode] = String.fromCharCode(...buf);
        }
      });
      return new ToUnicodeMap(toUnicode);
    }

    // The viewer's choice, just use an identity map.
    return new IdentityToUnicodeMap(properties.firstChar, properties.lastChar);
  }

  async translateFont({
    descriptor,
    dict,
    baseDict,
    composite,
    type,
    firstChar,
    lastChar,
    toUnicode,
    cssFontInfo,
  }: PreEvaluatedFont) {
    const isType3Font = type === "Type3";

    if (!descriptor) {
      if (isType3Font) {
        const bbox = lookupNormalRect(dict.getArrayValue(DictKey.FontBBox), [0, 0, 0, 0]);
        // FontDescriptor is only required for Type3 fonts when the document
        // is a tagged pdf. Create a barbebones one to get by.
        descriptor = new DictImpl(null);
        descriptor.set(DictKey.FontName, Name.get(type)!);
        descriptor.set(DictKey.FontBBox, bbox!);
      } else {
        // Before PDF 1.5 if the font was one of the base 14 fonts, having a
        // FontDescriptor was not required.
        // This case is here for compatibility.
        let baseFontName: string | Name | undefined = dict.getValue(DictKey.BaseFont);
        if (!(baseFontName instanceof Name)) {
          throw new FormatError("Base font is not specified");
        }

        // Using base font name as a font name.
        baseFontName = baseFontName.name.replaceAll(/[,_]/g, "-");
        const metrics = this.getBaseFontMetrics(baseFontName);

        // Simulating descriptor flags attribute
        const fontNameWoStyle = baseFontName.split("-", 1)[0];
        const symbolsFonts: Record<string, boolean> = getSymbolsFonts();
        const flags =
          (this.isSerifFont(fontNameWoStyle) ? FontFlags.Serif : 0) |
          (metrics.monospace ? FontFlags.FixedPitch : 0) |
          (symbolsFonts[fontNameWoStyle] ? FontFlags.Symbolic : FontFlags.Nonsymbolic);

        const properties: EvaluatorProperties = {
          type,
          name: baseFontName,
          loadedName: baseDict.loadedName,
          systemFontInfo: null,
          widths: metrics.widths as any, // 又是属性的动态赋值引起的
          defaultWidth: metrics.defaultWidth,
          isSimulatedFlags: true,
          flags,
          firstChar,
          lastChar,
          toUnicode,
          xHeight: 0,
          capHeight: 0,
          italicAngle: 0,
          isType3Font,
          composite: false,
          cidSystemInfo: null,
          defaultEncoding: null,
          file: null,
          hasIncludedToUnicodeMap: false,
          dict: null,
          hasEncoding: false,
          baseEncodingName: null,
          differences: [],
          cidToGidMap: [],
          fallbackToUnicode: [],
          cMap: null,
          vertical: false,
          cidEncoding: "",
          defaultVMetrics: [],
          vmetrics: [],
          subtype: null,
          length1: null,
          length2: null,
          length3: null,
          fixedPitch: false,
          fontMatrix: null,
          bbox: null,
          ascent: null,
          descent: null,
          cssFontInfo: null,
          scaleFactors: null,
          builtInEncoding: [],
          privateData: null,
          glyphNames: [],
          seacMap: null,
          ascentScaled: false,
        };
        const widths = dict.getValue(DictKey.Widths);

        const standardFontName = getStandardFontName(baseFontName);
        let file = null;
        if (standardFontName) {
          file = await this.fetchStandardFontData(standardFontName);
          properties.isInternalFont = !!file;
        }
        if (!properties.isInternalFont && this.context.options.useSystemFonts) {
          properties.systemFontInfo = getFontSubstitution(
            this.context.systemFontCache,
            this.context.idFactory,
            this.context.options.standardFontDataUrl!,
            baseFontName,
            standardFontName,
            type
          );
        }

        const newProperties = await this.extractDataStructures(
          dict,
          properties
        );
        if (Array.isArray(widths)) {
          const glyphWidths = [];
          let j = firstChar;
          for (const w of widths) {
            const width = this.context.xref.fetchIfRef(w);
            if (typeof width === "number") {
              glyphWidths[j] = width;
            }
            j++;
          }
          newProperties.widths = <Record<number, number>>glyphWidths;
        } else {
          newProperties.widths = <Record<number, number>>this.buildCharCodeToWidth(
            metrics.widths, newProperties
          );
        }
        return new Font(baseFontName, file!, newProperties);
      }
    }

    // According to the spec if 'FontDescriptor' is declared, 'FirstChar',
    // 'LastChar' and 'Widths' should exist too, but some PDF encoders seem
    // to ignore this rule when a variant of a standard font is used.
    // TODO Fill the width array depending on which of the base font this is
    // a variant.

    let fontName: Name | null = (<Dict>descriptor).getValue(DictKey.FontName);
    let baseFont = <Name | null>dict.getValue(DictKey.BaseFont);
    // Some bad PDFs have a string as the font name.
    if (typeof fontName === "string") {
      fontName = <Name | null>Name.get(fontName);
    }
    if (typeof baseFont === "string") {
      baseFont = <Name | null>Name.get(baseFont);
    }

    const fontNameStr = fontName?.name;
    const baseFontStr = baseFont?.name;
    if (!isType3Font && fontNameStr !== baseFontStr) {
      info(
        `The FontDescriptor's FontName is "${fontNameStr}" but ` +
        `should be the same as the Font's BaseFont "${baseFontStr}".`
      );
      // - Workaround for cases where e.g. fontNameStr = 'Arial' and
      //   baseFontStr = 'Arial,Bold' (needed when no font file is embedded).
      //
      // - Workaround for cases where e.g. fontNameStr = 'wg09np' and
      //   baseFontStr = 'Wingdings-Regular' (fixes issue7454.pdf).
      if (
        fontNameStr && baseFontStr && (baseFontStr.startsWith(fontNameStr) ||
          (!isKnownFontName(fontNameStr) && isKnownFontName(baseFontStr)))
      ) {
        fontName = null;
      }
    }
    fontName ||= baseFont;

    if (!(fontName instanceof Name)) {
      throw new FormatError("invalid font name");
    }

    let fontFile: BaseStream | null, subtype;
    let length1: number | null = null;
    let length2: number | null = null;
    let length3: number | null = null;
    try {

      fontFile = (<Dict>descriptor).getValueWithFallback2(
        DictKey.FontFile, DictKey.FontFile2, DictKey.FontFile3
      );

      if (fontFile) {
        if (!(fontFile instanceof BaseStream)) {
          throw new FormatError("FontFile should be a stream");
        } else if (fontFile.isEmpty) {
          throw new FormatError("FontFile is empty");
        }
      }
    } catch (ex) {
      if (!this.context.options.ignoreErrors) {
        throw ex;
      }
      warn(`translateFont - fetching "${fontName.name}" font file: "${ex}".`);
      fontFile = null;
    }
    let isInternalFont = false;
    let glyphScaleFactors = null;
    let systemFontInfo = null;
    if (fontFile) {
      if (fontFile.dict) {
        const subtypeEntry = fontFile.dict.getValue(DictKey.Subtype);
        if (subtypeEntry instanceof Name) {
          subtype = subtypeEntry.name;
        }
        length1 = fontFile.dict.getValue(DictKey.Length1);
        length2 = fontFile.dict.getValue(DictKey.Length2);
        length3 = fontFile.dict.getValue(DictKey.Length3);
      }
    } else if (cssFontInfo) {
      // tomb for xfa
    } else if (!isType3Font) {
      const standardFontName = getStandardFontName(fontName.name);
      if (standardFontName) {
        fontFile = await this.fetchStandardFontData(standardFontName);
        isInternalFont = !!fontFile;
      }
      if (!isInternalFont && this.context.options.useSystemFonts) {
        systemFontInfo = getFontSubstitution(
          this.context.systemFontCache,
          this.context.idFactory,
          this.context.options.standardFontDataUrl!,
          fontName.name,
          standardFontName,
          type
        );
      }
    }

    const fontMatrix = <TransformType>lookupMatrix(
      dict.getArrayValue(DictKey.FontMatrix), FONT_IDENTITY_MATRIX
    );
    const bbox = lookupNormalRect(
      (<Dict>descriptor).getArrayValue(DictKey.FontBBox) || dict.getArrayValue(DictKey.FontBBox),
      null
    );
    let ascent: number | undefined = (<Dict>descriptor).getValue(DictKey.Ascent);
    if (typeof ascent !== "number") {
      ascent = undefined;
    }
    let descent: number | undefined = (<Dict>descriptor).getValue(DictKey.Descent);
    if (typeof descent !== "number") {
      descent = undefined;
    }
    let xHeight = (<Dict>descriptor).getValue(DictKey.XHeight);
    if (typeof xHeight !== "number") {
      xHeight = 0;
    }
    let capHeight = (<Dict>descriptor).getValue(DictKey.CapHeight);
    if (typeof capHeight !== "number") {
      capHeight = 0;
    }
    let flags = (<Dict>descriptor).getValue(DictKey.Flags);
    if (!Number.isInteger(flags)) {
      flags = 0;
    }
    let italicAngle = (<Dict>descriptor).getValue(DictKey.ItalicAngle);
    if (typeof italicAngle !== "number") {
      italicAngle = 0;
    }

    const properties: EvaluatorProperties = {
      type,
      name: fontName.name,
      subtype: <string | null>subtype,
      file: fontFile,
      length1,
      length2,
      length3,
      isInternalFont,
      loadedName: baseDict.loadedName,
      composite,
      fixedPitch: false,
      fontMatrix: fontMatrix,
      firstChar,
      lastChar,
      toUnicode,
      bbox,
      ascent: <number | null>ascent,
      descent: <number | null>descent,
      xHeight,
      capHeight,
      flags,
      italicAngle,
      isType3Font,
      cssFontInfo,
      scaleFactors: <number[]>glyphScaleFactors!,
      systemFontInfo,
      widths: <Record<number, number>>[],
      defaultWidth: 0,
      isSimulatedFlags: false,
      cidSystemInfo: null,
      defaultEncoding: null,
      hasIncludedToUnicodeMap: false,
      dict: null,
      hasEncoding: false,
      baseEncodingName: null,
      differences: [],
      cidToGidMap: [],
      fallbackToUnicode: [],
      cMap: null,
      vertical: false,
      cidEncoding: "",
      defaultVMetrics: [],
      vmetrics: [],
      privateData: null,
      glyphNames: [],
      seacMap: null,
      ascentScaled: false,
      builtInEncoding: []
    };

    if (composite) {
      const cidEncoding = baseDict.getValue(DictKey.Encoding);
      if (cidEncoding instanceof Name) {
        properties.cidEncoding = cidEncoding.name;
      }
      const cMap = await CMapFactory.create(
        <Name | BaseStream>cidEncoding, this.context.fetchBuiltInCMapBound, null
      );
      properties.cMap = cMap;
      properties.vertical = properties.cMap.vertical;
    }

    const newProperties = await this.extractDataStructures(dict, properties);
    this.extractWidths(dict, <Dict>descriptor, newProperties);

    return new Font(fontName.name, <Stream>fontFile!, newProperties);
  }

  async fetchStandardFontData(name: string) {
    const cachedData = this.context.standardFontDataCache.get(name);
    if (cachedData) {
      return new Stream(cachedData);
    }

    // The symbol fonts are not consistent across platforms, always load the
    // standard font data for them.
    if (this.context.options.useSystemFonts && name !== "Symbol" && name !== "ZapfDingbats") {
      return null;
    }

    const lookup: Record<string, string> = getFontNameToFileMap();
    const filename = lookup![name];

    let data: Uint8Array<ArrayBuffer> | null = null;

    if (this.context.options.standardFontDataUrl !== null) {
      const url = `${this.context.options.standardFontDataUrl}${filename}`;
      const response = await fetch(url);
      if (!response.ok) {
        warn(`fetchStandardFontData: failed to fetch file "${url}" with "${response.statusText}".`);
      } else {
        data = new Uint8Array(await response.arrayBuffer());
      }
    } else {
      // Get the data on the main-thread instead.
      try {
        data = await this.context.handler.FetchStandardFontData(filename);
      } catch (e) {
        warn(`fetchStandardFontData: failed to fetch file "${filename}" with "${e}".`);
      }
    }

    if (!data) {
      return null;
    }

    // Cache the "raw" standard font data, to avoid fetching it repeatedly
    // (see e.g. issue 11399).
    this.context.standardFontDataCache.set(name, data);
    return new Stream(data);
  }

  readCidToGidMap(glyphsData: Uint8TypedArray, toUnicode: ToUnicodeMap | IdentityToUnicodeMap) {
    // Extract the encoding from the CIDToGIDMap

    // Set encoding 0 to later verify the font has an encoding
    const result = [];
    for (let j = 0, jj = glyphsData.length; j < jj; j++) {
      const glyphID = (glyphsData[j++] << 8) | glyphsData[j];
      const code = j >> 1;
      if (glyphID === 0 && !toUnicode.has(code)) {
        continue;
      }
      result[code] = glyphID;
    }
    return result;
  }

  extractWidths(dict: Dict, descriptor: Dict, properties: EvaluatorProperties) {
    const xref = this.context.xref;
    let glyphsWidths: number[] = [];
    let defaultWidth = 0;
    const glyphsVMetrics: number[][] = [];
    let defaultVMetrics;
    if (properties.composite) {
      const dw = dict.getValue(DictKey.DW);
      defaultWidth = typeof dw === "number" ? Math.ceil(dw) : 1000;

      const widths = dict.getValue(DictKey.W);
      if (Array.isArray(widths)) {
        for (let i = 0, ii = widths.length; i < ii; i++) {
          let start = <number>xref.fetchIfRef(widths[i++]);
          if (!Number.isInteger(start)) {
            break; // Invalid /W data.
          }
          const code = xref.fetchIfRef(widths[i]);

          if (Array.isArray(code)) {
            for (const c of code) {
              const width = xref.fetchIfRef(c);
              if (typeof width === "number") {
                glyphsWidths[start] = width;
              }
              start++;
            }
          } else if (Number.isInteger(code)) {
            const width = xref.fetchIfRef(widths[++i]);
            if (typeof width !== "number") {
              continue;
            }
            for (let j = start; j <= <number>code; j++) {
              glyphsWidths[j] = width;
            }
          } else {
            break; // Invalid /W data.
          }
        }
      }

      if (properties.vertical) {
        const dw2 = dict.getArrayValue(DictKey.DW2);
        let vmetrics = isNumberArray(dw2, 2) ? dw2 : [880, -1000];
        defaultVMetrics = [vmetrics[1], defaultWidth * 0.5, vmetrics[0]];
        vmetrics = <number[]>dict.getValue(DictKey.W2);
        if (Array.isArray(vmetrics)) {
          for (let i = 0, ii = vmetrics.length; i < ii; i++) {
            let start = <number>xref.fetchIfRef(vmetrics[i++]);
            if (!Number.isInteger(start)) {
              break; // Invalid /W2 data.
            }
            const code = xref.fetchIfRef(vmetrics[i]);

            if (Array.isArray(code)) {
              for (let j = 0, jj = code.length; j < jj; j++) {
                const vmetric: number[] = [
                  <number>xref.fetchIfRef(code[j++]),
                  <number>xref.fetchIfRef(code[j++]),
                  <number>xref.fetchIfRef(code[j]),
                ];
                if (isNumberArray(vmetric, null)) {
                  glyphsVMetrics[start] = vmetric;
                }
                start++;
              }
            } else if (Number.isInteger(code)) {
              const vmetric = [
                xref.fetchIfRef(vmetrics[++i]),
                xref.fetchIfRef(vmetrics[++i]),
                xref.fetchIfRef(vmetrics[++i]),
              ];
              if (!isNumberArray(vmetric, null)) {
                continue;
              }
              for (let j = start; j <= <number>code; j++) {
                glyphsVMetrics[j] = vmetric;
              }
            } else {
              break; // Invalid /W2 data.
            }
          }
        }
      }
    } else {
      const widths = dict.getValue(DictKey.Widths);
      if (Array.isArray(widths)) {
        let j = properties.firstChar;
        for (const w of widths) {
          const width = xref.fetchIfRef(w);
          if (typeof width === "number") {
            glyphsWidths[j] = width;
          }
          j++;
        }
        const missingWidth = descriptor.getValue(DictKey.MissingWidth);
        defaultWidth = typeof missingWidth === "number" ? missingWidth : 0;
      } else {
        // Trying get the BaseFont metrics (see comment above).
        const baseFontName = dict.getValue(DictKey.BaseFont);
        if (baseFontName instanceof Name) {
          const metrics = this.getBaseFontMetrics(baseFontName.name);

          glyphsWidths = this.buildCharCodeToWidth(metrics.widths, properties);
          defaultWidth = metrics.defaultWidth;
        }
      }
    }

    // Heuristic: detection of monospace font by checking all non-zero widths
    let isMonospace = true;
    let firstWidth = defaultWidth;
    for (const glyph in glyphsWidths) {
      const glyphWidth = glyphsWidths[glyph];
      if (!glyphWidth) {
        continue;
      }
      if (!firstWidth) {
        firstWidth = glyphWidth;
        continue;
      }
      if (firstWidth !== glyphWidth) {
        isMonospace = false;
        break;
      }
    }
    if (isMonospace) {
      properties.flags |= FontFlags.FixedPitch;
    } else {
      // Clear the flag.
      properties.flags &= ~FontFlags.FixedPitch;
    }

    properties.defaultWidth = defaultWidth;
    properties.widths = <Record<number, number>>glyphsWidths;
    properties.defaultVMetrics = defaultVMetrics!;
    properties.vmetrics = glyphsVMetrics;
  }

  isSerifFont(baseFontName: string) {
    // Simulating descriptor flags attribute
    const fontNameWoStyle = baseFontName.split("-", 1)[0];
    return (
      fontNameWoStyle in getSerifFonts()! || /serif/gi.test(fontNameWoStyle)
    );
  }

  getBaseFontMetrics(name: string) {

    let defaultWidth = 0;
    let widths: Record<string, number> = Object.create(null);
    let monospace = false;

    const stdFontMap: Record<string, string> = getStdFontMap();
    let lookupName = stdFontMap[name] || name;
    const Metrics: Record<string, number | (() => Record<string, number>)> = getMetrics();

    if (!(lookupName in Metrics)) {
      // Use default fonts for looking up font metrics if the passed
      // font is not a base font
      lookupName = this.isSerifFont(name) ? "Times-Roman" : "Helvetica";
    }
    const glyphWidths = Metrics[lookupName];

    if (typeof glyphWidths === "number") {
      defaultWidth = glyphWidths;
      monospace = true;
    } else {
      widths = glyphWidths(); // expand lazy widths array
    }

    return {
      defaultWidth,
      monospace,
      widths,
    };
  }

  /**
 * @returns {Array}
 * @private
 */
  _simpleFontToUnicode(properties: EvaluatorProperties, forceGlyphs = false): string[] {
    assert(!properties.composite, "Must be a simple font.");

    const toUnicode = <string[]>[];
    const encoding = properties.defaultEncoding!.slice();
    const baseEncodingName = properties.baseEncodingName;
    // Merge in the differences array.
    const differences = properties.differences;
    for (const charcode in differences) {
      const glyphName = differences[charcode];
      if (glyphName === ".notdef") {
        // Skip .notdef to prevent rendering errors, e.g. boxes appearing
        // where there should be spaces (fixes issue5256.pdf).
        continue;
      }
      encoding[charcode] = glyphName;
    }
    const glyphsUnicodeMap: Record<string, number> = getGlyphsUnicode();
    for (const charcode in encoding) {
      // a) Map the character code to a character name.
      let glyphName = encoding[charcode];
      if (glyphName === "") {
        continue;
      }
      // b) Look up the character name in the Adobe Glyph List (see the
      //    Bibliography) to obtain the corresponding Unicode value.
      let unicode = glyphsUnicodeMap[glyphName];
      if (unicode !== undefined) {
        toUnicode[charcode] = String.fromCharCode(unicode);
        continue;
      }
      // (undocumented) c) Few heuristics to recognize unknown glyphs
      // NOTE: Adobe Reader does not do this step, but OSX Preview does
      let code = 0;
      switch (glyphName[0]) {
        case "G": // Gxx glyph
          if (glyphName.length === 3) {
            code = parseInt(glyphName.substring(1), 16);
          }
          break;
        case "g": // g00xx glyph
          if (glyphName.length === 5) {
            code = parseInt(glyphName.substring(1), 16);
          }
          break;
        case "C": // Cdd{d} glyph
        case "c": // cdd{d} glyph
          if (glyphName.length >= 3 && glyphName.length <= 4) {
            const codeStr = glyphName.substring(1);

            if (forceGlyphs) {
              code = parseInt(codeStr, 16);
              break;
            }
            // Normally the Cdd{d}/cdd{d} glyphName format will contain
            // regular, i.e. base 10, charCodes (see issue4550.pdf)...
            code = +codeStr;

            // ... however some PDF generators violate that assumption by
            // containing glyph, i.e. base 16, codes instead.
            // In that case we need to re-parse the *entire* encoding to
            // prevent broken text-selection (fixes issue9655_reduced.pdf).
            if (Number.isNaN(code) && Number.isInteger(parseInt(codeStr, 16))) {
              return this._simpleFontToUnicode(
                properties,
                  /* forceGlyphs */ true
              );
            }
          }
          break;
        case "u": // 'uniXXXX'/'uXXXX{XX}' glyphs
          unicode = getUnicodeForGlyph(glyphName, glyphsUnicodeMap!);
          if (unicode !== -1) {
            code = unicode;
          }
          break;
        default:
          // Support (some) non-standard ligatures.
          switch (glyphName) {
            case "f_h":
            case "f_t":
            case "T_h":
              toUnicode[charcode] = glyphName.replaceAll("_", "");
              continue;
          }
          break;
      }
      if (code > 0 && code <= 0x10ffff && Number.isInteger(code)) {
        // If `baseEncodingName` is one the predefined encodings, and `code`
        // equals `charcode`, using the glyph defined in the baseEncoding
        // seems to yield a better `toUnicode` mapping (fixes issue 5070).
        if (baseEncodingName && code === +charcode) {
          const baseEncoding = getEncoding(baseEncodingName);
          if (baseEncoding && (glyphName = baseEncoding[charcode])) {
            toUnicode[charcode] = String.fromCharCode(
              glyphsUnicodeMap![glyphName]
            );
            continue;
          }
        }
        toUnicode[charcode] = String.fromCodePoint(code);
      }
    }
    return toUnicode;
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
      const errFont = new ErrorFont(`Font "${fontName}" is not available.`);
      return new TranslatedFont(
        "g_font_error", errFont, <Dict>font, this.context.options
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
      if (this.context.type3FontRefs?.has(fontRef)) {
        return errorFont();
      }

      if (this.context.fontCache.has(fontRef.toString())) {
        return this.context.fontCache.get(fontRef.toString())!;
      }

      try {
        font = <Dict>this.context.xref.fetchIfRef(fontRef);
      } catch (ex) {
        warn(`loadFont - lookup failed: "${ex}".`);
      }
    }

    if (!(font instanceof DictImpl)) {
      if (!this.context.options.ignoreErrors && !this.context.parsingType3Font) {
        warn(`Font "${fontName}" is not available.`);
        return errorFont();
      }
      warn(
        `Font "${fontName}" is not available -- attempting to fallback to a default font.`
      );

      // Falling back to a default font to avoid completely broken rendering,
      // but note that there're no guarantees that things will look "correct".
      font = fallbackFontDict || EvaluatorGeneralHandler.fallbackFontDict;
    }

    // We are holding `font.cacheKey` references only for `fontRef`s that
    // are not actually `Ref`s, but rather `Dict`s. See explanation below.
    if (font.cacheKey && this.context.fontCache.has(font.cacheKey)) {
      return this.context.fontCache.get(font.cacheKey)!;
    }

    const { promise, resolve } = Promise.withResolvers<TranslatedFont>();

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

    if (hash && descriptor instanceof DictImpl) {
      const fontAliases = (descriptor.fontAliases ||= Object.create(null));

      if (fontAliases[hash]) {
        const aliasFontRef = fontAliases[hash].aliasRef;
        if (fontRefIsRef && aliasFontRef && this.context.fontCache.has(aliasFontRef)) {
          this.context.fontCache.putAlias(fontRef!.toString(), aliasFontRef);
          return this.context.fontCache.get(fontRef!.toString())!;
        }
      } else {
        fontAliases[hash] = {
          fontID: this.context.idFactory.createFontId(),
        };
      }

      if (fontRefIsRef) {
        fontAliases[hash].aliasRef = fontRef;
      }
      fontID = fontAliases[hash].fontID;
    } else {
      fontID = this.context.idFactory.createFontId();
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
      this.context.fontCache.put(fontRef!.toString(), promise);
    } else {
      const cacheKey = `cacheKey_${fontID}`;
      this.context.fontKeyCache.set(font, cacheKey);
      this.context.fontCache.put(cacheKey, promise);
    }

    // Keep track of each font we translated so the caller can
    // load them asynchronously before calling display on a page.
    font.loadedName = `${this.context.idFactory.getDocId()}_${fontID}`;

    this.translateFont(preEvaluatedFont).then(translatedFont => {
      resolve(new TranslatedFont(
        font.loadedName!, translatedFont, font, this.context.options,
      ));
    }).catch(reason => {
      // TODO reject?
      warn(`loadFont - translateFont failed: "${reason}".`);
      const errFont = new ErrorFont(reason instanceof Error ? reason.message : reason)
      resolve(
        new TranslatedFont(font.loadedName!, errFont, font, this.context.options)
      );
    });
    return promise;
  }

  preEvaluateFont(dict: Dict): PreEvaluatedFont {
    const baseDict = dict;
    let type = dict.getValue(DictKey.Subtype);
    if (!(type instanceof Name)) {
      throw new FormatError("invalid font Subtype");
    }

    let composite = false;
    let hash;
    if (type.name === "Type0") {
      // If font is a composite
      //  - get the descendant font
      //  - set the type according to the descendant font
      //  - get the FontDescriptor from the descendant font
      const df = dict.getValue(DictKey.DescendantFonts);
      if (!df) {
        throw new FormatError("Descendant fonts are not specified");
      }
      dict = Array.isArray(df) ? <Dict>this.context.xref.fetchIfRef(df[0]) : df;

      if (!(dict instanceof DictImpl)) {
        throw new FormatError("Descendant font is not a dictionary.");
      }
      type = dict.getValue(DictKey.Subtype);
      if (!(type instanceof Name)) {
        throw new FormatError("invalid font Subtype");
      }
      composite = true;
    }

    let firstChar = dict.getValue(DictKey.FirstChar);
    if (!Number.isInteger(firstChar)) {
      firstChar = 0;
    }
    let lastChar = dict.getValue(DictKey.LastChar);
    if (!Number.isInteger(lastChar)) {
      lastChar = composite ? 0xffff : 0xff;
    }
    const descriptor = dict.getValue(DictKey.FontDescriptor);
    const toUnicode = dict.getValue(DictKey.ToUnicode) || baseDict.getValue(DictKey.ToUnicode);

    if (descriptor) {
      hash = new MurmurHash3_64();

      const encoding = baseDict.getRaw(DictKey.Encoding);
      if (encoding instanceof Name) {
        hash.update(encoding.name);
      } else if (encoding instanceof Ref) {
        hash.update(encoding.toString());
      } else if (encoding instanceof DictImpl) {
        for (const entry of encoding.getRawValues()) {
          if (entry instanceof Name) {
            hash.update(entry.name);
          } else if (entry instanceof Ref) {
            hash.update(entry.toString());
          } else if (Array.isArray(entry)) {
            // 'Differences' array (fixes bug1157493.pdf).
            const diffLength = entry.length;
            const diffBuf = new Array(diffLength);

            for (let j = 0; j < diffLength; j++) {
              const diffEntry = entry[j];
              if (diffEntry instanceof Name) {
                diffBuf[j] = diffEntry.name;
              } else if (
                typeof diffEntry === "number" ||
                diffEntry instanceof Ref
              ) {
                diffBuf[j] = diffEntry.toString();
              }
            }
            hash.update(diffBuf.join());
          }
        }
      }

      hash.update(`${firstChar}-${lastChar}`); // Fixes issue10665_reduced.pdf

      if (toUnicode instanceof BaseStream) {
        // stream可能不是DecodeStream，这里的强转可能存在问题
        const stream = <DecodeStream>(toUnicode.stream || toUnicode);
        const uint8array = stream.buffer
          ? new Uint8Array(stream.buffer.buffer, 0, stream.bufferLength)
          : new Uint8Array(stream.bytes.buffer, stream.start, stream.end - stream.start);
        hash.update(uint8array);
      } else if (toUnicode instanceof Name) {
        hash.update(toUnicode.name);
      }

      const widths = dict.getValue(DictKey.Widths) || baseDict.getValue(DictKey.Widths);
      if (Array.isArray(widths)) {
        const widthsBuf = [];
        for (const entry of widths) {
          if (typeof entry === "number" || entry instanceof Ref) {
            widthsBuf.push(entry.toString());
          }
        }
        hash.update(widthsBuf.join());
      }

      if (composite) {
        hash.update("compositeFont");

        const compositeWidths = dict.getValue(DictKey.W) || baseDict.getValue(DictKey.W);
        if (Array.isArray(compositeWidths)) {
          const widthsBuf = [];
          for (const entry of compositeWidths) {
            if (typeof entry === "number" || entry instanceof Ref) {
              widthsBuf.push(entry.toString());
            } else if (Array.isArray(entry)) {
              const subWidthsBuf = [];
              for (const element of entry) {
                if (typeof element === "number" || element instanceof Ref) {
                  subWidthsBuf.push(element.toString());
                }
              }
              widthsBuf.push(`[${subWidthsBuf.join()}]`);
            }
          }
          hash.update(widthsBuf.join());
        }

        const cidToGidMap =
          dict.getRaw(DictKey.CIDToGIDMap) || baseDict.getRaw(DictKey.CIDToGIDMap);
        if (cidToGidMap instanceof Name) {
          hash.update(cidToGidMap.name);
        } else if (cidToGidMap instanceof Ref) {
          hash.update(cidToGidMap.toString());
        } else if (cidToGidMap instanceof BaseStream) {
          hash.update(cidToGidMap.peekBytes());
        }
      }
    }

    return {
      descriptor,
      dict,
      baseDict,
      composite,
      type: type.name,
      firstChar,
      lastChar,
      toUnicode,
      hash: hash ? hash.hexdigest() : "",
      cssFontInfo: null
    };
  }

  buildCharCodeToWidth(widthsByGlyphName: Record<string, number>, properties: EvaluatorProperties) {
    const widths = [];
    const differences = properties.differences;
    const encoding = properties.defaultEncoding!;
    for (let charCode = 0; charCode < 256; charCode++) {
      if (charCode in differences && widthsByGlyphName[differences[charCode]]) {
        widths[charCode] = widthsByGlyphName[differences[charCode]];
        continue;
      }
      if (charCode in encoding && widthsByGlyphName[encoding[charCode]]) {
        widths[charCode] = widthsByGlyphName[encoding[charCode]];
        continue;
      }
    }
    return widths;
  }

  ensureStateFont(state: State) {
    if (state.font) {
      return;
    }
    const reason = new FormatError(
      "Missing setFont (Tf) operator before text rendering operator."
    );

    if (this.context.options.ignoreErrors) {
      warn(`ensureStateFont: "${reason}".`);
      return;
    }
    throw reason;
  }
}