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

import {
  MessageHandler,
  createValidAbsoluteUrl,
  DestinationType,
  DocumentActionEventType,
  FormatError,
  info,
  PermissionFlag,
  shadow,
  stringToPDFString,
  stringToUTF8String,
  warn,
  isNumberArray,
  FileSpecSerializable, FontSubstitutionInfo, PDFMetadataInfo,
  Dict
} from "seren-common";
import { BaseStream } from "../stream/base_stream";
import { clearGlobalCaches } from "../utils/cleanup_helper";
import { ColorSpace } from "../color/colorspace";
import {
  collectActions,
  MissingDataException,
  PDF_VERSION_REGEXP,
  recoverJsURL,
  toRomanNumerals,
  XRefEntryException,
} from "../utils/core_utils";
import { TranslatedFont } from "../parser/evaluator/evaluator";
import { FileSpec } from "./file_spec";
import { GlobalImageCache } from "../image/image_utils";
import { MetadataParser } from "./metadata_parser";
import { NameTree, NumberTree } from "./name_number_tree";
import { PDFManager } from "../worker/pdf_manager";
import {
  DictKey,
  isName,
  isRefsEqual,
  Name,
  Ref,
  RefSet,
  RefSetCache,
  CatalogMarkInfo,
  CatalogOpenAction,
  CatalogOptionalContentConfig,
  CatalogOutlineItem,
  OptionalContentDataGroup,
  OptionalContentOrder,
  ViewerPreferenceKeys,
  ViewerPreferenceValueTypes
} from "seren-common";
import { StructTreeRoot } from "./struct_tree";
import { XRefImpl } from "./xref";
import { DictImpl, isDict } from "./dict_impl";

// 传进来的值可能是DestinationType，也可能是其它莫名其妙的类型
function isValidExplicitDest(dest: DestinationType | unknown) {
  if (!Array.isArray(dest) || dest.length < 2) {
    return false;
  }
  const [page, zoom, ...args] = dest;
  if (!(page instanceof Ref) && !Number.isInteger(page)) {
    return false;
  }
  if (!(zoom instanceof Name)) {
    return false;
  }
  const argsLen = args.length;
  let allowNull = true;
  switch (zoom.name) {
    case "XYZ":
      if (argsLen < 2 || argsLen > 3) {
        return false;
      }
      break;
    case "Fit":
    case "FitB":
      return argsLen === 0;
    case "FitH":
    case "FitBH":
    case "FitV":
    case "FitBV":
      if (argsLen > 1) {
        return false;
      }
      break;
    case "FitR":
      if (argsLen !== 4) {
        return false;
      }
      allowNull = false;
      break;
    default:
      return false;
  }
  for (const arg of args) {
    if (!(typeof arg === "number" || (allowNull && arg === null))) {
      return false;
    }
  }
  return true;
}

function fetchDest(dest: Dict | DestinationType | unknown) {
  if (dest instanceof DictImpl) {
    dest = <DestinationType>dest.getValue(DictKey.D);
  }
  return isValidExplicitDest(dest) ? <DestinationType>dest : null;
}

function fetchRemoteDest(action: Dict) {
  let dest: Dict | Name | string | number[] | DestinationType = action.getValue(DictKey.D);
  if (dest) {
    if (dest instanceof Name) {
      dest = dest.name;
    }
    if (typeof dest === "string") {
      return stringToPDFString(dest);
    } else if (isValidExplicitDest(dest)) {
      return JSON.stringify(dest);
    }
  }
  return null;
}

interface ParsedDestDictionary {
  resetForm?: {
    fields: string[];
    refs: string[];
    include: boolean;
  };
  newWindow?: boolean;
  attachment?: FileSpecSerializable;
  attachmentDest?: string | null;
  action: string | null;
  setOCGState?: {
    state: string[];
    preserveRB: boolean;
  };
  url: string | null;
  unsafeUrl?: string;
  dest: string | DestinationType | null;
}

export class Catalog {

  protected pdfManager: PDFManager;

  protected xref: XRefImpl;

  public fontCache = new RefSetCache<string, Promise<TranslatedFont>>();

  public fontKeyCache = new Map<Dict, string>();

  public builtInCMapCache = new Map<string, any>();

  public standardFontDataCache = new Map<string, any>();

  public globalImageCache = new GlobalImageCache();

  public pageKidsCountCache = new RefSetCache<Ref | string, number>();

  public pageIndexCache = new RefSetCache<Ref, number>();

  protected pageDictCache = new RefSetCache<Ref, Promise<Dict>>();

  public nonBlendModesSet = new RefSet();

  public systemFontCache = new Map<string, FontSubstitutionInfo | null>();

  protected _catDict: Dict;

  protected _actualNumPages: number | null;

  constructor(pdfManager: PDFManager, xref: XRefImpl) {
    this.pdfManager = pdfManager;
    this.xref = xref;

    const _catDict = xref.getCatalogObj();
    if (!(_catDict instanceof DictImpl)) {
      throw new FormatError("Catalog object is not a dictionary.");
    }
    this._catDict = _catDict!;
    // Given that `XRef.parse` will both fetch *and* validate the /Pages-entry,
    // the following call must always succeed here:
    this.toplevelPagesDict; // eslint-disable-line no-unused-expressions

    this._actualNumPages = null;
  }

  cloneDict() {
    return this._catDict.clone();
  }

  get version() {
    const version = this._catDict.getValue(DictKey.Version);
    if (version instanceof Name) {
      if (PDF_VERSION_REGEXP.test(version.name)) {
        return shadow(this, "version", version.name);
      }
      warn(`Invalid PDF catalog version: ${version.name}`);
    }
    return shadow(this, "version", null);
  }

  get lang(): string | null {
    const lang = this._catDict.getValue(DictKey.Lang);
    return shadow(
      this,
      "lang",
      lang && typeof lang === "string" ? stringToPDFString(lang) : null
    );
  }

  /**
   * @type {boolean} `true` for pure XFA documents,
   *   `false` for XFA Foreground documents.
   */
  get needsRendering() {
    const needsRendering = this._catDict.getValue(DictKey.NeedsRendering);
    return shadow(
      this,
      "needsRendering",
      typeof needsRendering === "boolean" ? needsRendering : false
    );
  }

  get collection() {
    let collection = null;
    try {
      const obj = this._catDict.getValue(DictKey.Collection);
      if (obj instanceof DictImpl && obj.size > 0) {
        collection = obj;
      }
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      info("Cannot fetch Collection entry; assuming no collection is present.");
    }
    return shadow(this, "collection", collection);
  }

  get acroForm(): Dict | null {
    let acroForm = null;
    try {
      const obj = this._catDict.getValue(DictKey.AcroForm);
      if (obj instanceof DictImpl && obj.size > 0) {
        acroForm = obj;
      }
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      info("Cannot fetch AcroForm entry; assuming no forms are present.");
    }
    return shadow(this, "acroForm", acroForm);
  }

  get acroFormRef() {
    const value = this._catDict.getRaw(DictKey.AcroForm);
    return shadow(this, "acroFormRef", value instanceof Ref ? value : null);
  }

  get metadata(): PDFMetadataInfo | null {
    const streamRef = this._catDict.getRaw(DictKey.Metadata);
    if (!(streamRef instanceof Ref)) {
      return shadow(this, "metadata", null);
    }

    let metadata = null;
    try {

      const stream = this.xref.fetch(streamRef, !this.xref.encrypt?.encryptMetadata);

      if (stream instanceof BaseStream && stream.dict instanceof DictImpl) {
        const type = stream.dict.getValue(DictKey.Type);
        const subtype = stream.dict.getValue(DictKey.Subtype);

        if (isName(type, "Metadata") && isName(subtype, "XML")) {
          // XXX: This should examine the charset the XML document defines,
          // however since there are currently no real means to decode arbitrary
          // charsets, let's just hope that the author of the PDF was reasonable
          // enough to stick with the XML default charset, which is UTF-8.
          const data = stringToUTF8String(stream.getString());
          if (data) {
            metadata = new MetadataParser(data).serializable;
          }
        }
      }
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      info(`Skipping invalid Metadata: "${ex}".`);
    }
    return shadow(this, "metadata", metadata);
  }

  get markInfo() {
    let markInfo = null;
    try {
      markInfo = this._readMarkInfo();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read mark info.");
    }
    return shadow(this, "markInfo", markInfo);
  }

  /**
   * @private
   */
  _readMarkInfo(): CatalogMarkInfo | null {
    const obj = this._catDict.getValue(DictKey.MarkInfo);
    if (!(obj instanceof DictImpl)) {
      return null;
    }

    const markInfo = new CatalogMarkInfo();

    const keys = <(keyof CatalogMarkInfo)[]>Reflect.ownKeys(markInfo);

    for (const key of keys) {
      const value = obj.getValue(<DictKey>key);
      if (typeof value === "boolean") {
        markInfo[key] = value;
      }
    }

    return markInfo;
  }

  get structTreeRoot() {
    let structTree = null;
    try {
      structTree = this._readStructTreeRoot();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable read to structTreeRoot info.");
    }
    return shadow(this, "structTreeRoot", structTree);
  }

  /**
   * @private
   */
  _readStructTreeRoot() {
    const rawObj = this._catDict.getRaw(DictKey.StructTreeRoot);
    const obj = this.xref.fetchIfRef(rawObj);
    if (!(obj instanceof DictImpl)) {
      return null;
    }

    const root = new StructTreeRoot(obj, rawObj);
    root.init();
    return root;
  }

  get toplevelPagesDict() {
    const pagesObj = this._catDict.getValue(DictKey.Pages);
    if (!(pagesObj instanceof DictImpl)) {
      throw new FormatError("Invalid top-level pages dictionary.");
    }
    return shadow(this, "toplevelPagesDict", pagesObj);
  }

  get documentOutline() {
    let obj = null;
    try {
      obj = this._readDocumentOutline();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read document outline.");
    }
    return shadow(this, "documentOutline", obj);
  }

  private _readDocumentOutline() {
    let obj: Dict | Ref | number | string = this._catDict.getValue(DictKey.Outlines);
    if (!(obj instanceof DictImpl)) {
      return null;
    }
    obj = <Ref>obj.getRaw(DictKey.First);
    if (!(obj instanceof Ref)) {
      return null;
    }

    const root = { items: <CatalogOutlineItem[]>[] };
    const queue: {
      obj: object,
      parent: { items: CatalogOutlineItem[] }
    }[] = [{ obj, parent: root }];
    // To avoid recursion, keep track of the already processed items.
    const processed = new RefSet();
    processed.put(obj);
    const xref = this.xref;
    const blackColor = new Uint8ClampedArray(3);

    while (queue.length > 0) {
      const i = queue.shift()!;
      const outlineDict = <Dict | null>xref.fetchIfRef(i.obj);
      if (outlineDict === null) {
        continue;
      }
      if (!outlineDict.has(DictKey.Title)) {
        warn("Invalid outline item encountered.");
      }

      const data: ParsedDestDictionary = { url: null, dest: null, action: null };
      Catalog.parseDestDictionary(
        outlineDict,
        data,
        this.baseUrl,
        this.attachments,
      );
      const title = outlineDict.getValue(DictKey.Title);
      const flags = <number>outlineDict.getValue(DictKey.F) || 0;
      const color = outlineDict.getArrayValue(DictKey.C);
      const count = <number>outlineDict.getValue(DictKey.Count);
      let rgbColor = blackColor;

      // We only need to parse the color when it's valid, and non-default.
      if (
        isNumberArray(color, 3) &&
        (color[0] !== 0 || color[1] !== 0 || color[2] !== 0)
      ) {
        rgbColor = ColorSpace.singletons.rgb.getRgb(color, 0);
      }

      const outlineItem: CatalogOutlineItem = {
        action: data.action,
        attachment: data.attachment ?? null,
        dest: data.dest,
        url: data.url,
        unsafeUrl: data.unsafeUrl ?? null,
        newWindow: data.newWindow ?? null,
        setOCGState: data.setOCGState ?? null,
        title: typeof title === "string" ? stringToPDFString(title) : "",
        color: rgbColor,
        count: Number.isInteger(count) ? count : null,
        bold: !!(flags & 2),
        italic: !!(flags & 1),
        items: [],
      };

      i.parent.items.push(outlineItem);
      obj = outlineDict.getRaw(DictKey.First);
      if (obj instanceof Ref && !processed.has(obj)) {
        queue.push({ obj, parent: outlineItem });
        processed.put(obj);
      }
      obj = outlineDict.getRaw(DictKey.Next);
      if (obj instanceof Ref && !processed.has(obj)) {
        queue.push({ obj, parent: i.parent });
        processed.put(obj);
      }
    }
    return root.items.length > 0 ? root.items : null;
  }

  get permissions() {
    let permissions = null;
    try {
      permissions = this._readPermissions();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read permissions.");
    }
    return shadow(this, "permissions", permissions);
  }

  /**
   * @private
   */
  _readPermissions() {
    const encrypt = this.xref.trailer!.getValue(DictKey.Encrypt);
    if (!(encrypt instanceof DictImpl)) {
      return null;
    }

    let flags = encrypt.getValue(DictKey.P);
    if (typeof flags !== "number") {
      return null;
    }

    // PDF integer objects are represented internally in signed 2's complement
    // form. Therefore, convert the signed decimal integer to a signed 2's
    // complement binary integer so we can use regular bitwise operations on it.
    flags += 2 ** 32;


    const permissions: number[] = [];
    for (const key in PermissionFlag) {
      const value = PermissionFlag[key];
      if (typeof value === 'number') {
        if (flags & value) {
          permissions.push(value);
        }
      }
    }
    return permissions;
  }

  get optionalContentConfig() {
    let config = null;
    try {
      const properties = this._catDict.getValue(DictKey.OCProperties);
      if (!properties) {
        return shadow(this, "optionalContentConfig", null);
      }
      const defaultConfig = <Dict>properties.getValue(DictKey.D);
      if (!defaultConfig) {
        return shadow(this, "optionalContentConfig", null);
      }
      const groupsData = properties.getValue(DictKey.OCGs);
      if (!Array.isArray(groupsData)) {
        return shadow(this, "optionalContentConfig", null);
      }
      const groupRefCache = new RefSetCache<Ref, OptionalContentDataGroup>();
      // Ensure all the optional content groups are valid.
      for (const groupRef of groupsData) {
        if (!(groupRef instanceof Ref) || groupRefCache.has(groupRef)) {
          continue;
        }
        groupRefCache.put(groupRef, this.#readOptionalContentGroup(groupRef));
      }
      config = this.#readOptionalContentConfig(defaultConfig, groupRefCache);
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`Unable to read optional content config: ${ex}`);
    }
    return shadow(this, "optionalContentConfig", config);
  }

  #readOptionalContentGroup(groupRef: Ref) {
    const group = <Dict>this.xref.fetch(groupRef);
    const obj: OptionalContentDataGroup = {
      id: groupRef.toString(),
      name: null,
      intent: null,
      usage: {
        print: null,
        view: null,
      },
      rbGroups: [],
    };

    const name = group.getValue(DictKey.Name);
    if (typeof name === "string") {
      obj.name = stringToPDFString(name);
    }

    let intent = group.getArrayValue(DictKey.Intent);
    if (!Array.isArray(intent)) {
      intent = [intent];
    }
    if (intent.every(i => i instanceof Name)) {
      obj.intent = intent.map(i => i.name);
    }

    const usage = group.getValue(DictKey.Usage);
    if (!(usage instanceof DictImpl)) {
      return obj;
    }
    const usageObj = obj.usage;

    const print = usage.getValue(DictKey.Print);
    if (print instanceof DictImpl) {
      const printState = print.getValue(DictKey.PrintState);
      if (printState instanceof Name) {
        switch (printState.name) {
          case "ON":
          case "OFF":
            usageObj.print = { printState: printState.name };
        }
      }
    }

    const view = usage.getValue(DictKey.View);
    if (view instanceof DictImpl) {
      const viewState = view.getValue(DictKey.ViewState);
      if (viewState instanceof Name) {
        switch (viewState.name) {
          case "ON":
          case "OFF":
            usageObj.view = { viewState: viewState.name };
        }
      }
    }

    return obj;
  }

  #readOptionalContentConfig(config: Dict, groupRefCache: RefSetCache<Ref, OptionalContentDataGroup>) {
    function parseOnOff(refs: Ref[]) {
      const onParsed = [];
      if (Array.isArray(refs)) {
        for (const value of refs) {
          if (!(value instanceof Ref)) {
            continue;
          }
          if (groupRefCache.has(value)) {
            onParsed.push(value.toString());
          }
        }
      }
      return onParsed;
    }

    function parseOrder(refs: Ref[], nestedLevels = 0) {
      if (!Array.isArray(refs)) {
        return null;
      }
      const order: (OptionalContentOrder | string)[] = [];

      for (const value of refs) {
        if (value instanceof Ref && groupRefCache.has(value)) {
          parsedOrderRefs.put(value); // Handle "hidden" groups, see below.

          order.push(value.toString());
          continue;
        }
        // Handle nested /Order arrays (see e.g. issue 9462 and bug 1240641).
        const nestedOrder = parseNestedOrder(value, nestedLevels);
        if (nestedOrder) {
          order.push(nestedOrder);
        }
      }

      if (nestedLevels > 0) {
        return order;
      }
      const hiddenGroups = [];
      for (const [groupRef] of groupRefCache.items()) {
        if (parsedOrderRefs.has(groupRef)) {
          continue;
        }
        hiddenGroups.push(groupRef.toString());
      }
      if (hiddenGroups.length) {
        order.push({ name: null, order: hiddenGroups });
      }

      return order;
    }

    function parseNestedOrder(ref: Ref, nestedLevels: number): OptionalContentOrder | null {
      if (++nestedLevels > MAX_NESTED_LEVELS) {
        warn("parseNestedOrder - reached MAX_NESTED_LEVELS.");
        return null;
      }
      const value = xref.fetchIfRef(ref);
      if (!Array.isArray(value)) {
        return null;
      }
      const nestedName = xref.fetchIfRef(value[0]);
      if (typeof nestedName !== "string") {
        return null;
      }
      const nestedOrder = parseOrder(value.slice(1), nestedLevels);
      if (!nestedOrder || !nestedOrder.length) {
        return null;
      }
      return { name: stringToPDFString(nestedName), order: nestedOrder };
    }

    function parseRBGroups(rbGroups: Ref[][]) {
      if (!Array.isArray(rbGroups)) {
        return;
      }

      for (const value of rbGroups) {
        const rbGroup = xref.fetchIfRef(value);
        if (!Array.isArray(rbGroup) || !rbGroup.length) {
          continue;
        }
        const parsedRbGroup = new Set<string>();

        for (const ref of rbGroup) {
          if (
            ref instanceof Ref &&
            groupRefCache.has(ref) &&
            !parsedRbGroup.has(ref.toString())
          ) {
            parsedRbGroup.add(ref.toString());
            // Keep a record of which RB groups the current OCG belongs to.
            groupRefCache.get(ref)!.rbGroups.push(parsedRbGroup);
          }
        }
      }
    }

    const xref = this.xref;
    const parsedOrderRefs = new RefSet();
    const MAX_NESTED_LEVELS = 10;

    parseRBGroups(config.getValue(DictKey.RBGroups));

    return <CatalogOptionalContentConfig>{
      name:
        typeof config.getValue(DictKey.Name) === "string"
          ? stringToPDFString(<string>config.getValue(DictKey.Name))
          : null,
      creator:
        typeof config.getValue(DictKey.Creator) === "string"
          ? stringToPDFString(config.getValue(DictKey.Creator))
          : null,
      baseState:
        config.getValue(DictKey.BaseState) instanceof Name
          ? config.getValue(DictKey.BaseState).name
          : null,
      on: parseOnOff(config.getValue(DictKey.ON)),
      off: parseOnOff(config.getValue(DictKey.OFF)),
      order: parseOrder(<Ref[]>config.getValue(DictKey.Order)),
      groups: [...groupRefCache],
    };
  }

  setActualNumPages(num: number | null = null) {
    this._actualNumPages = num;
  }

  get hasActualNumPages() {
    return this._actualNumPages !== null;
  }

  get _pagesCount(): number {
    const obj = this.toplevelPagesDict.getValue(DictKey.Count);
    if (!Number.isInteger(obj)) {
      throw new FormatError(
        "Page count in top-level pages dictionary is not an integer."
      );
    }
    return shadow(this, "_pagesCount", <number>obj);
  }

  get numPages() {
    return this.hasActualNumPages ? this._actualNumPages : this._pagesCount;
  }

  get destinations() {
    const obj = this._readDests();
    const dests = new Map<string, DestinationType>();
    if (obj instanceof NameTree) {
      for (const [key, value] of obj.getAll()) {
        const dest = fetchDest(value);
        if (dest) {
          dests.set(stringToPDFString(key), dest);
        }
      }
    } else if (obj instanceof DictImpl) {
      obj.forEach(function (key, value) {
        const dest = fetchDest(value);
        if (dest) {
          dests.set(key, dest);
        }
      });
    }
    return shadow(this, "destinations", dests);
  }

  getDestination(id: string) {
    const obj = this._readDests();
    if (obj instanceof NameTree) {
      const dest = fetchDest(obj.get(id));
      if (dest) {
        return dest;
      }
      // Fallback to checking the *entire* NameTree, in an attempt to handle
      // corrupt PDF documents with out-of-order NameTrees (fixes issue 10272).
      const allDest = this.destinations.get(id);
      if (allDest) {
        warn(`Found "${id}" at an incorrect position in the NameTree.`);
        return allDest;
      }
    } else if (obj instanceof DictImpl) {
      const dest = fetchDest(obj.getValue(<DictKey>id));
      if (dest) {
        return dest;
      }
    }
    return null;
  }

  /**
   * @private
   */
  _readDests() {
    const obj = this._catDict.getValue(DictKey.Names);
    if (obj?.has(DictKey.Dests)) {
      return new NameTree(<Ref>obj.getRaw(DictKey.Dests), this.xref);
    } else if (this._catDict.has(DictKey.Dests)) {
      // Simple destination dictionary.
      return this._catDict.getValue(DictKey.Dests);
    }
    return undefined;
  }

  get pageLabels() {
    let obj = null;
    try {
      obj = this._readPageLabels();
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn("Unable to read page labels.");
    }
    return shadow(this, "pageLabels", obj);
  }

  /**
   * @private
   */
  _readPageLabels() {
    const obj = this._catDict.getRaw(DictKey.PageLabels);
    if (!obj) {
      return null;
    }

    const pageLabels = new Array<number | string | Ref>(this.numPages!);
    let style = null,
      prefix = "";

    const numberTree = new NumberTree(<Ref>obj, this.xref);
    const nums = numberTree.getAll();
    let currentLabel: string | number = "",
      currentIndex = 1;

    for (let i = 0, ii = <number>this.numPages!; i < ii; i++) {
      const labelDict = nums.get(i);

      if (labelDict !== undefined) {
        if (!(labelDict instanceof DictImpl)) {
          throw new FormatError("PageLabel is not a dictionary.");
        }

        if (
          labelDict.has(DictKey.Type) &&
          !isName(labelDict.getValue(DictKey.Type), "PageLabel")
        ) {
          throw new FormatError("Invalid type in PageLabel dictionary.");
        }

        if (labelDict.has(DictKey.S)) {
          const s = labelDict.getValue(DictKey.S);
          if (!(s instanceof Name)) {
            throw new FormatError("Invalid style in PageLabel dictionary.");
          }
          style = s.name;
        } else {
          style = null;
        }

        if (labelDict.has(DictKey.P)) {
          const p = labelDict.getValue(DictKey.P);
          if (typeof p !== "string") {
            throw new FormatError("Invalid prefix in PageLabel dictionary.");
          }
          prefix = stringToPDFString(p);
        } else {
          prefix = "";
        }

        if (labelDict.has(DictKey.St)) {
          const st = labelDict.getValue(DictKey.St);
          if (!(Number.isInteger(st) && st >= 1)) {
            throw new FormatError("Invalid start in PageLabel dictionary.");
          }
          currentIndex = st;
        } else {
          currentIndex = 1;
        }
      }

      switch (style) {
        case "D":
          currentLabel = currentIndex;
          break;
        case "R":
        case "r":
          currentLabel = toRomanNumerals(currentIndex, style === "r");
          break;
        case "A":
        case "a":
          const LIMIT = 26; // Use only the characters A-Z, or a-z.
          const A_UPPER_CASE = 0x41,
            A_LOWER_CASE = 0x61;

          const baseCharCode = style === "a" ? A_LOWER_CASE : A_UPPER_CASE;
          const letterIndex = currentIndex - 1;
          const character = String.fromCharCode(
            baseCharCode + (letterIndex % LIMIT)
          );
          currentLabel = character.repeat(Math.floor(letterIndex / LIMIT) + 1);
          break;
        default:
          if (style) {
            throw new FormatError(
              `Invalid style "${style}" in PageLabel dictionary.`
            );
          }
          currentLabel = "";
      }

      pageLabels[i] = prefix + currentLabel;
      currentIndex++;
    }
    return <string[]>pageLabels;
  }

  get pageLayout() {
    const obj = this._catDict.getValue(DictKey.PageLayout);
    // Purposely use a non-standard default value, rather than 'SinglePage', to
    // allow differentiating between `undefined` and /SinglePage since that does
    // affect the Scroll mode (continuous/non-continuous) used in Adobe Reader.
    let pageLayout = "";

    if (obj instanceof Name) {
      switch (obj.name) {
        case "SinglePage":
        case "OneColumn":
        case "TwoColumnLeft":
        case "TwoColumnRight":
        case "TwoPageLeft":
        case "TwoPageRight":
          pageLayout = obj.name;
      }
    }
    return shadow(this, "pageLayout", pageLayout);
  }

  get pageMode() {
    const obj = this._catDict.getValue(DictKey.PageMode);
    let pageMode = "UseNone"; // Default value.

    if (obj instanceof Name) {
      switch (obj.name) {
        case "UseNone":
        case "UseOutlines":
        case "UseThumbs":
        case "FullScreen":
        case "UseOC":
        case "UseAttachments":
          pageMode = obj.name;
      }
    }
    return shadow(this, "pageMode", pageMode);
  }

  get viewerPreferences(): Map<ViewerPreferenceKeys, ViewerPreferenceValueTypes[ViewerPreferenceKeys]> | null {

    const obj = this._catDict.getValue(DictKey.ViewerPreferences);

    if (!(obj instanceof DictImpl)) {
      return shadow(this, "viewerPreferences", null);
    }

    let prefs: Map<ViewerPreferenceKeys, ViewerPreferenceValueTypes[ViewerPreferenceKeys]> | null = null;

    for (const key of obj.getKeys()) {
      const value = obj.getValue(key);
      let prefValue: string | boolean | number | number[] | undefined;

      switch (key) {
        case DictKey.HideToolbar:
        case DictKey.HideMenubar:
        case DictKey.HideWindowUI:
        case DictKey.FitWindow:
        case DictKey.CenterWindow:
        case DictKey.DisplayDocTitle:
        case DictKey.PickTrayByPDFSize:
          if (typeof value === "boolean") {
            prefValue = value;
          }
          break;
        case DictKey.NonFullScreenPageMode:
          if (value instanceof Name) {
            switch (value.name) {
              case "UseNone":
              case "UseOutlines":
              case "UseThumbs":
              case "UseOC":
                prefValue = value.name;
                break;
              default:
                prefValue = "UseNone";
            }
          }
          break;
        case DictKey.Direction:
          if (value instanceof Name) {
            switch (value.name) {
              case "L2R":
              case "R2L":
                prefValue = value.name;
                break;
              default:
                prefValue = "L2R";
            }
          }
          break;
        case DictKey.ViewArea:
        case DictKey.ViewClip:
        case DictKey.PrintArea:
        case DictKey.PrintClip:
          if (value instanceof Name) {
            switch (value.name) {
              case "MediaBox":
              case "CropBox":
              case "BleedBox":
              case "TrimBox":
              case "ArtBox":
                prefValue = value.name;
                break;
              default:
                prefValue = "CropBox";
            }
          }
          break;
        case DictKey.PrintScaling:
          if (value instanceof Name) {
            switch (value.name) {
              case "None":
              case "AppDefault":
                prefValue = value.name;
                break;
              default:
                prefValue = "AppDefault";
            }
          }
          break;
        case DictKey.Duplex:
          if (value instanceof Name) {
            switch (value.name) {
              case "Simplex":
              case "DuplexFlipShortEdge":
              case "DuplexFlipLongEdge":
                prefValue = value.name;
                break;
              default:
                prefValue = "None";
            }
          }
          break;
        case DictKey.PrintPageRange:
          // The number of elements must be even.
          if (Array.isArray(value) && value.length % 2 === 0) {
            const isValid = value.every(
              (page, i, arr) =>
                Number.isInteger(page) &&
                page > 0 &&
                (i === 0 || page >= arr[i - 1]) &&
                page <= this.numPages!
            );
            if (isValid) {
              prefValue = value;
            }
          }
          break;
        case DictKey.NumCopies:
          if (Number.isInteger(value) && <number>value > 0) {
            prefValue = <number>value;
          }
          break;
        default:
          warn(`Ignoring non-standard key in ViewerPreferences: ${key}.`);
          continue;
      }

      if (prefValue === undefined) {
        warn(`Bad value, for key "${key}", in ViewerPreferences: ${value}.`);
        continue;
      }
      if (!prefs) {
        prefs = new Map();
      }
      const str = <string>key;
      prefs.set(<ViewerPreferenceKeys>str, prefValue);
    }
    return shadow(this, "viewerPreferences", prefs);
  }

  get openAction() {
    const obj = this._catDict.getValue(DictKey.OpenAction);
    let openAction: CatalogOpenAction | null = null;

    if (obj instanceof DictImpl) {
      openAction = {
        dest: null, action: null
      }
      // Convert the OpenAction dictionary into a format that works with
      // `parseDestDictionary`, to avoid having to re-implement those checks.
      const destDict = new DictImpl(this.xref);
      destDict.set(DictKey.A, obj);

      const resultObj: ParsedDestDictionary = { url: null, dest: null, action: null };
      Catalog.parseDestDictionary(destDict, resultObj);

      if (Array.isArray(resultObj.dest)) {
        openAction.dest = resultObj.dest;
      } else if (resultObj.action) {
        openAction.action = resultObj.action;
      }
    } else if (Array.isArray(obj)) {
      openAction = {
        dest: obj, action: null
      }
    }
    return shadow(this, "openAction", openAction);
  }

  // 这应该是处理附件的？
  get attachments() {
    const obj = this._catDict.getValue(DictKey.Names);
    let attachments: Map<string, FileSpecSerializable> | null = null;

    if (obj instanceof DictImpl && obj.has(DictKey.EmbeddedFiles)) {
      const nameTree = new NameTree(obj.getRaw(DictKey.EmbeddedFiles), this.xref);
      for (const [key, value] of nameTree.getAll()) {
        const fs = new FileSpec(value, this.xref);
        if (!attachments) {
          attachments = new Map();
        }
        attachments.set(stringToPDFString(key), fs.serializable);
      }
    }
    return shadow(this, "attachments", attachments);
  }


  _collectJavaScript(): Map<string, string> | null {
    const obj = this._catDict.getValue(DictKey.Names);
    let javaScript: Map<string, string> | null = null;

    function appendIfJavaScriptDict(name: string, jsDict: Dict) {
      if (!(jsDict instanceof DictImpl)) {
        return;
      }
      if (!isName(jsDict.getValue(DictKey.S), "JavaScript")) {
        return;
      }

      let js = jsDict.getValue(DictKey.JS);
      if (js instanceof BaseStream) {
        js = js.getString();
      } else if (typeof js !== "string") {
        return;
      }
      js = stringToPDFString(js).replaceAll("\x00", "");
      // Skip empty entries, similar to the `_collectJS` function.
      if (js) {
        (javaScript ||= new Map()).set(name, js);
      }
    }

    if (obj instanceof DictImpl && obj.has(DictKey.JavaScript)) {
      const nameTree = new NameTree(obj.getRaw(DictKey.JavaScript), this.xref);
      for (const [key, value] of nameTree.getAll()) {
        appendIfJavaScriptDict(stringToPDFString(key), value);
      }
    }
    // Append OpenAction "JavaScript" actions, if any, to the JavaScript map.
    const openAction = <Dict>this._catDict.getValue(DictKey.OpenAction);
    if (openAction) {
      appendIfJavaScriptDict("OpenAction", openAction);
    }

    return javaScript;
  }

  get jsActions() {
    const javaScript = this._collectJavaScript();
    let actions = collectActions(
      this.xref,
      this._catDict,
      DocumentActionEventType
    );

    if (javaScript) {
      actions ||= new Map();

      for (const [key, val] of javaScript) {
        if (actions.has(key)) {
          actions.get(key)!.push(val);
        } else {
          actions.set(key, [val]);
        }
      }
    }
    return shadow(this, "jsActions", actions);
  }

  async fontFallback(id: string, handler: MessageHandler) {
    const translatedFonts = await Promise.all(this.fontCache);

    for (const translatedFont of translatedFonts) {
      if (translatedFont.loadedName === id) {
        translatedFont.fallback(handler);
        return;
      }
    }
  }

  async cleanup(manuallyTriggered = false) {

    clearGlobalCaches();

    this.globalImageCache.clear(manuallyTriggered);
    this.pageKidsCountCache.clear();
    this.pageIndexCache.clear();
    this.pageDictCache.clear();
    this.nonBlendModesSet.clear();
    this.fontKeyCache.clear();
    this.fontCache.clear();
    this.builtInCMapCache.clear();
    this.standardFontDataCache.clear();
    this.systemFontCache.clear();
  }

  async getPageDict(pageIndex: number) {
    const nodesToVisit: (Ref | Dict)[] = [this.toplevelPagesDict];
    const visitedNodes = new RefSet();

    const pagesRef = this._catDict.getRaw(DictKey.Pages);
    if (pagesRef instanceof Ref) {
      visitedNodes.put(pagesRef);
    }
    const xref = this.xref;
    const pageKidsCountCache = this.pageKidsCountCache;
    const pageIndexCache = this.pageIndexCache;
    const pageDictCache = this.pageDictCache;
    let currentPageIndex = 0;

    while (nodesToVisit.length) {
      const currentNode = nodesToVisit.pop();

      if (currentNode instanceof Ref) {
        const count = pageKidsCountCache.get(currentNode)!;
        // Skip nodes where the page can't be.
        if (count >= 0 && currentPageIndex + count <= pageIndex) {
          currentPageIndex += count;
          continue;
        }
        // Prevent circular references in the /Pages tree.
        if (visitedNodes.has(currentNode)) {
          throw new FormatError("Pages tree contains circular reference.");
        }
        visitedNodes.put(currentNode);

        const obj = await (pageDictCache.get(currentNode) || xref.fetchAsync(currentNode));

        if (obj instanceof DictImpl) {
          let type = obj.getRaw(DictKey.Type);
          if (type instanceof Ref) {
            type = <Name>await xref.fetchAsync(type);
          }
          if (isName(type, "Page") || !obj.has(DictKey.Kids)) {
            // Cache the Page reference, since it can *greatly* improve
            // performance by reducing redundant lookups in long documents
            // where all nodes are found at *one* level of the tree.
            if (!pageKidsCountCache.has(currentNode)) {
              pageKidsCountCache.put(currentNode, 1);
            }
            // Help improve performance of the `getPageIndex` method.
            if (!pageIndexCache.has(currentNode)) {
              pageIndexCache.put(currentNode, currentPageIndex);
            }

            if (currentPageIndex === pageIndex) {
              return [obj, currentNode];
            }
            currentPageIndex++;
            continue;
          }
        }
        // 不太确定是不是这两种类型，需要实际的跑一下这个代码
        nodesToVisit.push(<Ref | Dict>obj);
        continue;
      }

      // Must be a child page dictionary.
      if (!(currentNode instanceof DictImpl)) {
        throw new FormatError(
          "Page dictionary kid reference points to wrong type of object."
        );
      }
      const { objId } = currentNode;

      let count = currentNode.getRaw(DictKey.Count);
      if (count instanceof Ref) {
        count = <number>await xref.fetchAsync(count);
      }
      if (Number.isInteger(count) && <number>count >= 0) {
        // Cache the Kids count, since it can reduce redundant lookups in
        // documents where all nodes are found at *one* level of the tree.
        if (objId && !pageKidsCountCache.has(objId)) {
          pageKidsCountCache.put(objId, <number>count);
        }

        // Skip nodes where the page can't be.
        if (currentPageIndex + <number>count <= pageIndex) {
          currentPageIndex += <number>count;
          continue;
        }
      }

      let kids = currentNode.getRaw(DictKey.Kids);
      if (kids instanceof Ref) {
        kids = <(string | Ref | Dict)[]>await xref.fetchAsync(kids);
      }
      if (!Array.isArray(kids)) {
        // Prevent errors in corrupt PDF documents that violate the
        // specification by *inlining* Page dicts directly in the Kids
        // array, rather than using indirect objects (fixes issue9540.pdf).
        let type = currentNode.getRaw(DictKey.Type);
        if (type instanceof Ref) {
          type = <Name>await xref.fetchAsync(type);
        }
        if (isName(type, "Page") || !currentNode.has(DictKey.Kids)) {
          if (currentPageIndex === pageIndex) {
            return [currentNode, null];
          }
          currentPageIndex++;
          continue;
        }

        throw new FormatError("Page dictionary kids object is not an array.");
      }

      // Always check all `Kids` nodes, to avoid getting stuck in an empty
      // node further down in the tree (see issue5644.pdf, issue8088.pdf),
      // and to ensure that we actually find the correct `Page` dict.
      for (let last = kids.length - 1; last >= 0; last--) {
        const lastKid = kids[last];
        nodesToVisit.push(<Ref | Dict>lastKid);

        // Launch all requests in parallel so we don't wait for each one in turn
        // when looking for a page near the end, if all the pages are top level.
        if (
          currentNode === this.toplevelPagesDict &&
          lastKid instanceof Ref && !pageDictCache.has(lastKid)
        ) {
          pageDictCache.put(lastKid, <Promise<Dict>>xref.fetchAsync(lastKid));
        }
      }
    }

    throw new Error(`Page index ${pageIndex} not found.`);
  }

  /**
   * Eagerly fetches the entire /Pages-tree; should ONLY be used as a fallback.
   */
  async getAllPageDicts(recoveryMode = false) {
    const { ignoreErrors } = this.pdfManager.evaluatorOptions;

    const queue = [{ currentNode: this.toplevelPagesDict, posInKids: 0 }];
    const visitedNodes = new RefSet();

    const pagesRef = this._catDict.getRaw(DictKey.Pages);
    if (pagesRef instanceof Ref) {
      visitedNodes.put(pagesRef);
    }
    const map = new Map(), xref = this.xref;
    const pageIndexCache = this.pageIndexCache;
    let pageIndex = 0;

    function addPageDict(pageDict: Dict, pageRef: Ref | null) {
      // Help improve performance of the `getPageIndex` method.
      if (pageRef && !pageIndexCache.has(pageRef)) {
        pageIndexCache.put(pageRef, pageIndex);
      }

      map.set(pageIndex++, [pageDict, pageRef]);
    }
    function addPageError(error: unknown) {
      if (error instanceof XRefEntryException && !recoveryMode) {
        throw error;
      }
      if (recoveryMode && ignoreErrors && pageIndex === 0) {
        // Ensure that the viewer will always load (fixes issue15590.pdf).
        warn(`getAllPageDicts - Skipping invalid first page: "${error}".`);
        error = DictImpl.empty;
      }

      map.set(pageIndex++, [error, null]);
    }

    while (queue.length > 0) {
      const queueItem = queue.at(-1)!;
      const { currentNode, posInKids } = queueItem;

      let kids = currentNode.getRaw(DictKey.Kids);
      if (kids instanceof Ref) {
        try {
          kids = <(string | Ref | Dict)[]>await xref.fetchAsync(kids);
        } catch (ex) {
          addPageError(ex);
          break;
        }
      }
      if (!Array.isArray(kids)) {
        addPageError(
          new FormatError("Page dictionary kids object is not an array.")
        );
        break;
      }

      if (posInKids >= kids.length) {
        queue.pop();
        continue;
      }

      const kidObj = kids[posInKids];
      let obj;
      if (kidObj instanceof Ref) {
        // Prevent circular references in the /Pages tree.
        if (visitedNodes.has(kidObj)) {
          addPageError(
            new FormatError("Pages tree contains circular reference.")
          );
          break;
        }
        visitedNodes.put(kidObj);

        try {
          obj = await xref.fetchAsync(kidObj);
        } catch (ex) {
          addPageError(ex);
          break;
        }
      } else {
        // Prevent errors in corrupt PDF documents that violate the
        // specification by *inlining* Page dicts directly in the Kids
        // array, rather than using indirect objects (see issue9540.pdf).
        obj = kidObj;
      }
      if (!(obj instanceof DictImpl)) {
        addPageError(
          new FormatError(
            "Page dictionary kid reference points to wrong type of object."
          )
        );
        break;
      }

      let type = obj.getRaw(DictKey.Type);
      if (type instanceof Ref) {
        try {
          type = <Name>await xref.fetchAsync(type);
        } catch (ex) {
          addPageError(ex);
          break;
        }
      }
      if (isName(type, "Page") || !obj.has(DictKey.Kids)) {
        addPageDict(obj, kidObj instanceof Ref ? kidObj : null);
      } else {
        queue.push({ currentNode: obj, posInKids: 0 });
      }
      queueItem.posInKids++;
    }
    return map;
  }

  getPageIndex(pageRef: Ref): Promise<number> {
    const cachedPageIndex = this.pageIndexCache.get(pageRef);
    if (cachedPageIndex !== undefined) {
      return Promise.resolve(<number>cachedPageIndex);
    }

    // The page tree nodes have the count of all the leaves below them. To get
    // how many pages are before we just have to walk up the tree and keep
    // adding the count of siblings to the left of the node.
    const xref = this.xref;

    async function pagesBeforeRef(kidRef: Ref): Promise<[number, Ref] | null> {
      let total = 0;
      let parentRef: Ref;

      return (<Promise<Dict | Ref>>xref.fetchAsync(kidRef)).then(node => {
        if (
          isRefsEqual(kidRef, pageRef) && !isDict(node, "Page") &&
          !(node instanceof DictImpl && !node.has(DictKey.Type) && node.has(DictKey.Contents))
        ) {
          throw new FormatError(
            "The reference does not point to a /Page dictionary."
          );
        }
        if (!node) {
          return null;
        }
        if (!(node instanceof DictImpl)) {
          throw new FormatError("Node must be a dictionary.");
        }
        parentRef = <Ref>node.getRaw(DictKey.Parent);
        return <Promise<Dict | null>>node.getAsyncValue(DictKey.Parent);
      }).then(parent => {
        if (!parent) {
          return null;
        }
        if (!(parent instanceof DictImpl)) {
          throw new FormatError("Parent must be a dictionary.");
        }
        return <Promise<Ref[]>>parent.getAsyncValue(DictKey.Kids);
      }).then(kids => {
        if (!kids) {
          return null;
        }
        const kidPromises = [];
        let found = false;
        for (const kid of kids) {
          if (!(kid instanceof Ref)) {
            throw new FormatError("Kid must be a reference.");
          }
          if (isRefsEqual(kid, kidRef)) {
            found = true;
            break;
          }
          kidPromises.push((<Promise<Dict>>xref.fetchAsync(kid)).then(obj => {
            if (!(obj instanceof DictImpl)) {
              throw new FormatError("Kid node must be a dictionary.");
            }
            if (obj.has(DictKey.Count)) {
              total += <number>obj.getValue(DictKey.Count);
            } else {
              // Page leaf node.
              total++;
            }
          }));
        }
        if (!found) {
          throw new FormatError("Kid reference not found in parent's kids.");
        }
        return Promise.all(kidPromises).then(() => [total, parentRef]);
      });
    }

    let total = 0;
    const next: (ref: Ref) => Promise<number> = (ref: Ref) =>
      pagesBeforeRef(ref).then(args => {
        if (!args) {
          this.pageIndexCache.put(pageRef, total);
          return total;
        }
        const [count, parentRef] = args;
        total += count;
        return next(parentRef);
      });

    return next(pageRef);
  }

  get baseUrl() {
    const uri = this._catDict.getValue(DictKey.URI);
    if (uri instanceof DictImpl) {
      const base = uri.getValue(DictKey.Base);
      if (typeof base === "string") {
        const absoluteUrl = createValidAbsoluteUrl(base, null, {
          tryConvertEncoding: true,
        });
        if (absoluteUrl) {
          return shadow(this, "baseUrl", absoluteUrl.href);
        }
      }
    }
    return shadow(this, "baseUrl", this.pdfManager.docBaseUrl);
  }

  /**
   * @typedef {Object} ParseDestDictionaryParameters
   * @property {Dict} destDict - The dictionary containing the destination.
   * @property {Object} resultObj - The object where the parsed destination
   *   properties will be placed.
   * @property {string} [docBaseUrl] - The document base URL that is used when
   *   attempting to recover valid absolute URLs from relative ones.
   * @property {Object} [docAttachments] - The document attachments (may not
   *   exist in most PDF documents).
   */

  /**
   * Helper function used to parse the contents of destination dictionaries.
   * @param {ParseDestDictionaryParameters} params
   */
  static parseDestDictionary(
    destDict: Dict,
    resultObj: ParsedDestDictionary, // 可能是多种多样的
    docBaseUrl: string | null = null,
    docAttachments: Map<string, FileSpecSerializable> | null = null,
  ) {
    if (!(destDict instanceof DictImpl)) {
      warn("parseDestDictionary: `destDict` must be a dictionary.");
      return;
    }

    let action: Dict | Name | DestinationType | string | number[] = destDict.getValue(DictKey.A);
    let url, dest;
    if (!(action instanceof DictImpl)) {
      if (destDict.has(DictKey.Dest)) {
        // A /Dest entry should *only* contain a Name or an Array, but some bad
        // PDF generators ignore that and treat it as an /A entry.
        action = destDict.getValue(DictKey.Dest);
      } else {
        action = destDict.getValue(DictKey.AA);
        if (action instanceof DictImpl) {
          if (action.has(DictKey.D)) {
            // MouseDown
            action = action.getValue(DictKey.D);
          } else if (action.has(DictKey.U)) {
            // MouseUp
            action = action.getValue(DictKey.U);
          }
        }
      }
    }

    if (action instanceof DictImpl) {
      const actionType = action.getValue(DictKey.S);
      if (!(actionType instanceof Name)) {
        warn("parseDestDictionary: Invalid type in Action dictionary.");
        return;
      }
      const actionName = actionType.name;

      switch (actionName) {
        case "ResetForm":
          const flags = action.getValue(DictKey.Flags);
          const include = ((typeof flags === "number" ? flags : 0) & 1) === 0;
          const fields = [];
          const refs = [];
          for (const obj of action.getValue(DictKey.Fields) || []) {
            if (obj instanceof Ref) {
              refs.push(obj.toString());
            } else if (typeof obj === "string") {
              fields.push(stringToPDFString(obj));
            }
          }
          resultObj.resetForm = { fields, refs, include };
          break;
        case "URI":
          url = action.getValue(DictKey.URI);
          if (url instanceof Name) {
            // Some bad PDFs do not put parentheses around relative URLs.
            url = "/" + url.name;
          }
          break;

        case "GoTo":
          dest = action.getValue(DictKey.D);
          break;

        case "Launch":
        // We neither want, nor can, support arbitrary 'Launch' actions.
        // However, in practice they are mostly used for linking to other PDF
        // files, which we thus attempt to support (utilizing `docBaseUrl`).
        /* falls through */

        case "GoToR":
          const urlDict = action.getValue(DictKey.F);
          if (urlDict instanceof DictImpl) {
            const fs = new FileSpec(
              urlDict,
              /* xref = */ null,
              /* skipContent = */ true
            );
            const { rawFilename } = fs.serializable;
            url = rawFilename;
          } else if (typeof urlDict === "string") {
            url = urlDict;
          }

          // NOTE: the destination is relative to the *remote* document.
          const remoteDest = fetchRemoteDest(action);
          if (remoteDest && typeof url === "string") {
            url = /* baseUrl = */ url.split("#", 1)[0] + "#" + remoteDest;
          }
          // The 'NewWindow' property, equal to `LinkTarget.BLANK`.
          const newWindow = action.getValue(DictKey.NewWindow);
          if (typeof newWindow === "boolean") {
            resultObj.newWindow = newWindow;
          }
          break;

        case "GoToE":
          const target = action.getValue(DictKey.T);
          let attachment;

          if (docAttachments && target instanceof DictImpl) {
            const relationship = target.getValue(DictKey.R);
            const name = target.getValue(DictKey.N);

            if (isName(relationship, "C") && typeof name === "string") {
              attachment = docAttachments.get(stringToPDFString(name));
            }
          }

          if (attachment) {
            resultObj.attachment = attachment;

            // NOTE: the destination is relative to the *attachment*.
            const attachmentDest = fetchRemoteDest(action);
            if (attachmentDest) {
              resultObj.attachmentDest = attachmentDest;
            }
          } else {
            warn(`parseDestDictionary - unimplemented "GoToE" action.`);
          }
          break;

        case "Named":
          const namedAction = action.getValue(DictKey.N);
          if (namedAction instanceof Name) {
            resultObj.action = namedAction.name;
          }
          break;

        case "SetOCGState":
          const state = action.getValue(DictKey.State);
          const preserveRB = action.getValue(DictKey.PreserveRB);

          if (!Array.isArray(state) || state.length === 0) {
            break;
          }
          const stateArr = [];

          for (const elem of state) {
            if (elem instanceof Name) {
              switch (elem.name) {
                case "ON":
                case "OFF":
                case "Toggle":
                  stateArr.push(elem.name);
                  break;
              }
            } else if (elem instanceof Ref) {
              stateArr.push(elem.toString());
            }
          }

          if (stateArr.length !== state.length) {
            break; // Some of the original entries are not valid.
          }
          resultObj.setOCGState = {
            state: stateArr,
            preserveRB: typeof preserveRB === "boolean" ? preserveRB : true,
          };
          break;

        case "JavaScript":
          const jsAction = action.getValue(DictKey.JS);
          let js;

          if (jsAction instanceof BaseStream) {
            js = jsAction.getString();
          } else if (typeof jsAction === "string") {
            js = jsAction;
          }

          const jsURL = js && recoverJsURL(stringToPDFString(js));
          if (jsURL) {
            url = jsURL.url;
            resultObj.newWindow = jsURL.newWindow;
            break;
          }
        /* falls through */
        default:
          if (actionName === "JavaScript" || actionName === "SubmitForm") {
            // Don't bother the user with a warning for actions that require
            // scripting support, since those will be handled separately.
            break;
          }
          warn(`parseDestDictionary - unsupported action: "${actionName}".`);
          break;
      }
    } else if (destDict.has(DictKey.Dest)) {
      // Simple destination.
      dest = destDict.getValue(DictKey.Dest);
    }

    if (typeof url === "string") {
      const absoluteUrl = createValidAbsoluteUrl(url, docBaseUrl, {
        addDefaultProtocol: true,
        tryConvertEncoding: true,
      });
      if (absoluteUrl) {
        resultObj.url = absoluteUrl.href;
      }
      resultObj.unsafeUrl = url;
    }
    if (dest) {
      if (dest instanceof Name) {
        dest = dest.name;
      }
      if (typeof dest === "string") {
        resultObj.dest = stringToPDFString(dest);
      } else if (isValidExplicitDest(dest)) {
        resultObj.dest = <DestinationType>dest;
      }
    }
  }
}
