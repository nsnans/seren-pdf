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

import { PlatformHelper } from "../platform/platform_helper";
import { assert, shadow, unreachable } from "../shared/util";
import { XRef } from "./xref";

export const CIRCULAR_REF = Symbol("CIRCULAR_REF");
export const EOF = Symbol("EOF");

let CmdCache: Record<string, Cmd> = Object.create(null);
let NameCache: Record<string, Name> = Object.create(null);
let RefCache: Record<string, Ref> = Object.create(null);

export function clearPrimitiveCaches() {
  CmdCache = Object.create(null);
  NameCache = Object.create(null);
  RefCache = Object.create(null);
}

export class Name {

  public name: string;

  constructor(name: string) {
    if ((!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) && typeof name !== "string") {
      unreachable('Name: The "name" must be a string.');
    }
    this.name = name;
  }

  static get(name: string) {
    // eslint-disable-next-line no-restricted-syntax
    return (NameCache[name] ||= new Name(name));
  }
}

export class Cmd {
  public cmd: string;
  constructor(cmd: string) {
    if ((!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) && typeof cmd !== "string") {
      unreachable('Cmd: The "cmd" must be a string.');
    }
    this.cmd = cmd;
  }

  static get(cmd: string) {
    // eslint-disable-next-line no-restricted-syntax
    return (CmdCache[cmd] ||= new Cmd(cmd));
  }
}

const nonSerializable = function nonSerializableClosure() {
  return nonSerializable; // Creating closure on some variable.
};

// 为了防止Dict在get和set之后类型丢失，导致不知道无法获取到类型信息
// 因此将所有的dict类型都拿出来
export enum DictKey {
  Parent = "Parent",
  Subtype = "Subtype",
  Fm0 = "Fm0",
  GS0 = "GS0",
  Resources = "Resources",
  BBox = "BBox",
  R = "R",
  BC = "BC",
  BG = "BG",
  V = "V",
  MK = "MK",
  M = "M",
  Matrix = "Matrix",
  FormType = "FormType",
  Length = "Length",
  PdfJsZaDb = "PdfJsZaDb",
  Font = "Font",
  BaseFont = "BaseFont",
  Encoding = "Encoding",
  I = "I",
  N = "N",
  Helv = "Helv",
  CreationDate = "CreationDate",
  Rect = "Rect",
  InkList = "InkList",
  F = "F",
  Rotate = "Rotate",
  IT = "IT",
  BS = "BS",
  C = "C",
  CA = "CA",
  AP = "AP",
  R0 = "R0",
  ExtGState = "ExtGState",
  BM = "BM",
  ca = "ca",
  Type = "Type",
  BitsPerComponent = "BitsPerComponent",
  ColorSpace = "ColorSpace",
  Width = "Width",
  Height = "Height",
  XObject = "XObject",
  Im0 = "Im0",
  A = "A",
  FontName = "FontName",
  FontFamily = "FontFamily",
  FontBBox = "FontBBox",
  FontStretch = "FontStretch",
  FontWeight = "FontWeight",
  ItalicAngle = "ItalicAngle",
  CIDToGIDMap = "CIDToGIDMap",
  FirstChar = "FirstChar",
  LastChar = "LastChar",
  FontDescriptor = "FontDescriptor",
  DW = "DW",
  W = "W",
  Ordering = "Ordering",
  Registry = "Registry",
  Supplement = "Supplement",
  CIDSystemInfo = "CIDSystemInfo",
  DescendantFonts = "DescendantFonts",
  ToUnicode = "ToUnicode",
  Annots = "Annots",
  K = "K",
  Nums = "Nums",
  ParentTreeNextKey = "ParentTreeNextKey",
  ParentTree = "ParentTree",
  Pg = "Pg",
  Obj = "Obj",
  Filter = "Filter",
  DecodeParms = "DecodeParms",
  XFA = "XFA",
  NeedAppearances = "NeedAppearances",
  Index = "Index",
  ID = "ID",
  Prev = "Prev",
  Size = "Size",
  Root = "Root",
  Info = "Info",
  Encrypt = "Encrypt",

  // 以下只有get没有set，可能是动态引入的
  T = "T",
  Contents = "Contents",
  StructParent = "StructParent",
  Kids = "Kids",
  DA = "DA",
  S = "S",
  D = "D",
  AS = "AS",
  OC = "OC",
  TU = "TU",
  DR = "DR",
  Off = "Off",
  Name = "Name",
  StateModel = "StateModel",
  State = "State",
  Open = "Open",
  IC = "IC",
  FS = "FS",
  Version = "Version",
  Lang = "Lang",
  NeedsRendering = "NeedsRendering",
  Collection = "Collection",
  AcroForm = "AcroForm",
  MarkInfo = "MarkInfo",
  Pages = "Pages",
  Outlines = "Outlines",
  P = "P",
  OCProperties = "OCProperties",
  Print = "Print",
  PrintState = "PrintState",
  View = "View",
  ViewState = "ViewState",
  Count = "Count",
  St = "St",
  PageLayout = "PageLayout",
  PageMode = "PageMode",
  ViewerPreferences = "ViewerPreferences",
  OpenAction = "OpenAction",
  Names = "Names",
  EmbeddedFiles = "EmbeddedFiles",
  XFAImages = "XFAImages",
  JS = "JS",
  Base = "Base",
  Dest = "Dest",
  AA = "AA",
  U = "U",
  Flags = "Flags",
  Fields = "Fields",
  URI = "URI",
  NewWindow = "NewWindow",
  PreserveRB = "PreserveRB",
  CF = "CF",
  StmF = "StmF",
  O = "O",
  EncryptMetadata = "EncryptMetadata",
  OE = "OE",
  UE = "UE",
  Perms = "Perms",
  EFF = "EFF",
  StrF = "StrF",
  UserUnit = "UserUnit",
  FT = "FT",
  SigFlags = "SigFlags",
  CO = "CO",
  Group = "Group",
  H = "H",
  ImageMask = "ImageMask",
  IM = "IM",
  Interpolate = "Interpolate",
  G = "G",
  TR = "TR",
  Pattern = "Pattern",
  Shading = "Shading",
  MCID = "MCID",
  BaseEncoding = "BaseEncoding",
  Differences = "Differences",
  DOS = "DOS",
  Mac = "Mac",
  Unix = "Unix",
  UF = "UF",
  RF = "RF",
  EF = "EF",
  Desc = "Desc",
  JBIG2Globals = "JBIG2Globals",
  BPC = "BPC",
  DP = "DP",
  Linearized = "Linearized",
  ShadingType = "ShadingType",
  CS = "CS",
  Background = "Background",
  Function = "Function",
  BitsPerCoordinate = "BitsPerCoordinate",
  BitsPerFlag = "BitsPerFlag",
  Decode = "Decode",
  VerticesPerRow = "VerticesPerRow",
  Predictor = "Predictor",
  Colors = "Colors",
  Columns = "Columns",
  RoleMap = "RoleMap",
  XRefStm = "XRefStm",
  First = "First",
  QuadPoints = "QuadPoints",
  Border = "Border",
  L = "L",
  LE = "LE",
  Vertices = "Vertices",
  PMD = "PMD",
  Dests = "Dests",
  JavaScript = "JavaScript",
  SMask = "SMask",
  Mask = "Mask",
  FunctionType = "FunctionType",
  Metadata = "Metadata",
  StructTreeRoot = "StructTreeRoot",
  PageLabels = "PageLabels",
  Next = "Next",
}

// DictValueType 和 上面的DictKey需要连接起来
// 不然获取了DictKey之后，不知道DictValue的类型
// 需要反复查找，很浪费时间
export const DictValueTypeMapping = {
  Parent: '',
  Subtype: typeof Name,
  Fm0: "Fm0",
  GS0: "GS0",
  Resources: "Resources",
  BBox: "BBox",
  R: "R",
  BC: "BC",
  BG: "BG",
  V: "V",
  MK: "MK",
  M: "M",
  Matrix: "Matrix",
  FormType: "FormType",
  Length: "Length",
  PdfJsZaDb: "PdfJsZaDb",
  Font: "Font",
  BaseFont: "BaseFont",
  Encoding: "Encoding",
  I: "I",
  N: "N",
  Helv: "Helv",
  CreationDate: "CreationDate",
  Rect: "Rect",
  InkList: "InkList",
  F: "F",
  Rotate: "Rotate",
  IT: "IT",
  BS: "BS",
  C: "C",
  CA: "CA",
  AP: "AP",
  R0: "R0",
  ExtGState: "ExtGState",
  BM: "BM",
  ca: "ca",
  Type: "Type",
  BitsPerComponent: "BitsPerComponent",
  ColorSpace: "ColorSpace",
  Width: "Width",
  Height: "Height",
  XObject: "XObject",
  Im0: "Im0",
  A: "A",
  FontName: "FontName",
  FontFamily: "FontFamily",
  FontBBox: "FontBBox",
  FontStretch: "FontStretch",
  FontWeight: "FontWeight",
  ItalicAngle: "ItalicAngle",
  CIDToGIDMap: "CIDToGIDMap",
  FirstChar: "FirstChar",
  LastChar: "LastChar",
  FontDescriptor: "FontDescriptor",
  DW: "DW",
  W: "W",
  Ordering: "Ordering",
  Registry: "Registry",
  Supplement: "Supplement",
  CIDSystemInfo: "CIDSystemInfo",
  DescendantFonts: "DescendantFonts",
  ToUnicode: "ToUnicode",
  Annots: "Annots",
  K: "K",
  Nums: "Nums",
  ParentTreeNextKey: "ParentTreeNextKey",
  ParentTree: "ParentTree",
  Pg: "Pg",
  Obj: "Obj",
  Filter: "Filter",
  DecodeParms: "DecodeParms",
  XFA: "XFA",
  NeedAppearances: "NeedAppearances",
  Index: "Index",
  ID: "ID",
  Prev: "Prev",
  Size: "Size",
  Root: "Root",
  Info: "Info",
  Encrypt: "Encrypt",

  // 以下只有get没有set，可能是动态引入的
  T: "T",
  Contents: "Contents",
  StructParent: "StructParent",
  Kids: "Kids",
  DA: "DA",
  S: "S",
  D: "D",
  AS: "AS",
  OC: "OC",
  TU: "TU",
  DR: "DR",
  Off: "Off",
  Name: "Name",
  StateModel: "StateModel",
  State: "State",
  Open: "Open",
  IC: "IC",
  FS: "FS",
  Version: "Version",
  Lang: "Lang",
  NeedsRendering: "NeedsRendering",
  Collection: "Collection",
  AcroForm: "AcroForm",
  MarkInfo: "MarkInfo",
  Pages: "Pages",
  Outlines: "Outlines",
  P: "P",
  OCProperties: "OCProperties",
  Print: "Print",
  PrintState: "PrintState",
  View: "View",
  ViewState: "ViewState",
  Count: "Count",
  St: "St",
  PageLayout: "PageLayout",
  PageMode: "PageMode",
  ViewerPreferences: "ViewerPreferences",
  OpenAction: "OpenAction",
  Names: "Names",
  EmbeddedFiles: "EmbeddedFiles",
  XFAImages: "XFAImages",
  JS: "JS",
  Base: "Base",
  Dest: "Dest",
  AA: "AA",
  U: "U",
  Flags: "Flags",
  Fields: "Fields",
  URI: "URI",
  NewWindow: "NewWindow",
  PreserveRB: "PreserveRB",
  CF: "CF",
  StmF: "StmF",
  O: "O",
  EncryptMetadata: "EncryptMetadata",
  OE: "OE",
  UE: "UE",
  Perms: "Perms",
  EFF: "EFF",
  StrF: "StrF",
  UserUnit: "UserUnit",
  FT: "FT",
  SigFlags: "SigFlags",
  CO: "CO",
  Group: "Group",
  H: "H",
  ImageMask: "ImageMask",
  IM: "IM",
  Interpolate: "Interpolate",
  G: "G",
  TR: "TR",
  Pattern: "Pattern",
  Shading: "Shading",
  MCID: "MCID",
  BaseEncoding: "BaseEncoding",
  Differences: "Differences",
  DOS: "DOS",
  Mac: "Mac",
  Unix: "Unix",
  UF: "UF",
  RF: "RF",
  EF: "EF",
  Desc: "Desc",
  JBIG2Globals: "JBIG2Globals",
  BPC: "BPC",
  DP: "DP",
  Linearized: "Linearized",
  ShadingType: "ShadingType",
  CS: "CS",
  Background: "Background",
  Function: "Function",
  BitsPerCoordinate: "BitsPerCoordinate",
  BitsPerFlag: "BitsPerFlag",
  Decode: "Decode",
  VerticesPerRow: "VerticesPerRow",
  Predictor: "Predictor",
  Colors: "Colors",
  Columns: "Columns",
  RoleMap: "RoleMap",
  XRefStm: "XRefStm",
  First: "First",
  QuadPoints: "QuadPoints",
  Border: "Border",
  L: "L",
  LE: "LE",
  Vertices: "Vertices",
  PMD: "PMD",
  Dests: "Dests",
  JavaScript: "JavaScript",
  SMask: "SMask",
  Mask: "Mask",
  FunctionType: "FunctionType",
  Metadata: "Metadata",
  StructTreeRoot: "StructTreeRoot",
  PageLabels: "PageLabels",
  Next: "Next",
}


export class Dict {

  public suppressEncryption = false;

  protected _map: Record<DictKey, any> = Object.create(null);

  public xref: XRef | null;

  protected __nonSerializable__ = nonSerializable; // Disable cloning of the Dict.

  public objId: string | null;

  constructor(xref: XRef | null = null) {
    // Map should only be used internally, use functions below to access.
    this._map = Object.create(null);
    this.xref = xref;
    this.objId = null;
  }

  assignXref(newXref: XRef | null) {
    this.xref = newXref;
  }

  get size() {
    return Object.keys(this._map).length;
  }

  // Automatically dereferences Ref objects.
  get(key1: DictKey, key2?: DictKey, key3?: DictKey) {
    let value = this._map[key1];
    if (value === undefined && key2 !== undefined) {
      if (
        (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
        key2.length < key1.length
      ) {
        unreachable("Dict.get: Expected keys to be ordered by length.");
      }
      value = this._map[key2];
      if (value === undefined && key3 !== undefined) {
        if (
          (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
          key3.length < key2.length
        ) {
          unreachable("Dict.get: Expected keys to be ordered by length.");
        }
        value = this._map[key3];
      }
    }
    if (value instanceof Ref && this.xref) {
      return this.xref.fetch(value, this.suppressEncryption);
    }
    return value;
  }

  // Same as get(), but returns a promise and uses fetchIfRefAsync().
  async getAsync(key1: DictKey, key2?: DictKey, key3?: DictKey) {
    let value = this._map[key1];
    if (value === undefined && key2 !== undefined) {
      if (
        (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
        key2.length < key1.length
      ) {
        unreachable("Dict.getAsync: Expected keys to be ordered by length.");
      }
      value = this._map[key2];
      if (value === undefined && key3 !== undefined) {
        if (
          (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
          key3.length < key2.length
        ) {
          unreachable("Dict.getAsync: Expected keys to be ordered by length.");
        }
        value = this._map[key3];
      }
    }
    if (value instanceof Ref && this.xref) {
      return this.xref.fetchAsync(value, this.suppressEncryption);
    }
    return value;
  }

  // Same as get(), but dereferences all elements if the result is an Array.
  getArray(key1: DictKey, key2?: DictKey, key3?: DictKey) {
    let value = this._map[key1];
    if (value === undefined && key2 !== undefined) {
      if (
        (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
        key2.length < key1.length
      ) {
        unreachable("Dict.getArray: Expected keys to be ordered by length.");
      }
      value = this._map[key2];
      if (value === undefined && key3 !== undefined) {
        if (
          (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
          key3.length < key2.length
        ) {
          unreachable("Dict.getArray: Expected keys to be ordered by length.");
        }
        value = this._map[key3];
      }
    }
    if (value instanceof Ref && this.xref) {
      value = this.xref.fetch(value, this.suppressEncryption);
    }

    if (Array.isArray(value)) {
      value = value.slice(); // Ensure that we don't modify the Dict data.
      for (let i = 0, ii = value.length; i < ii; i++) {
        if (value[i] instanceof Ref && this.xref) {
          value[i] = this.xref.fetch(value[i], this.suppressEncryption);
        }
      }
    }
    return value;
  }

  // No dereferencing.
  getRaw(key: DictKey) {
    return this._map[key];
  }

  getKeys(): DictKey[] {
    return <DictKey[]>Object.keys(this._map);
  }

  // No dereferencing.
  getRawValues(): any[] {
    return Object.values(this._map);
  }

  set(key: DictKey, value: any) {
    if (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) {
      if (typeof key !== "string") {
        unreachable('Dict.set: The "key" must be a string.');
      } else if (value === undefined) {
        unreachable('Dict.set: The "value" cannot be undefined.');
      }
    }
    this._map[key] = value;
  }

  has(key: DictKey) {
    return this._map[key] !== undefined;
  }

  forEach(callback: (key: DictKey, value: any) => void) {
    for (const key in this._map) {
      const dictKey = <DictKey>key;
      callback(dictKey, this.get(dictKey));
    }
  }

  static get empty(): Dict {
    const emptyDict = new Dict(null);

    emptyDict.set = (_key, _value) => {
      unreachable("Should not call `set` on the empty dictionary.");
    };
    return shadow(this, "empty", emptyDict);
  }

  static merge({ xref, dictArray, mergeSubDicts = false }:
    { xref: XRef, dictArray: Dict[], mergeSubDicts: boolean }
  ) {
    const mergedDict = new Dict(xref),
      properties = new Map();

    for (const dict of dictArray) {
      if (!(dict instanceof Dict)) {
        continue;
      }
      for (const [key, value] of Object.entries(dict._map)) {
        let property = properties.get(key);
        if (property === undefined) {
          property = [];
          properties.set(key, property);
        } else if (!mergeSubDicts || !(value instanceof Dict)) {
          // Ignore additional entries, if either:
          //  - This is a "shallow" merge, where only the first element matters.
          //  - The value is *not* a `Dict`, since other types cannot be merged.
          continue;
        }
        property.push(value);
      }
    }
    for (const [name, values] of properties) {
      if (values.length === 1 || !(values[0] instanceof Dict)) {
        mergedDict._map[<DictKey>name] = values[0];
        continue;
      }
      const subDict = new Dict(xref);

      for (const dict of values) {
        for (const [key, value] of Object.entries(dict._map)) {
          if (subDict._map[<DictKey>key] === undefined) {
            subDict._map[<DictKey>key] = value;
          }
        }
      }
      if (subDict.size > 0) {
        mergedDict._map[<DictKey>name] = subDict;
      }
    }
    properties.clear();

    return mergedDict.size > 0 ? mergedDict : Dict.empty;
  }

  clone() {
    const dict = new Dict(this.xref);
    for (const key of this.getKeys()) {
      dict.set(key, this.getRaw(key));
    }
    return dict;
  }

  delete(key: string) {
    delete this._map[key];
  }
}

export class Ref {

  public num: number;

  public gen: number;

  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }

  toString() {
    // This function is hot, so we make the string as compact as possible.
    // |this.gen| is almost always zero, so we treat that case specially.
    if (this.gen === 0) {
      return `${this.num}R`;
    }
    return `${this.num}R${this.gen}`;
  }

  static fromString(str: string) {
    const ref = RefCache[str];
    if (ref) {
      return ref;
    }
    const m = /^(\d+)R(\d*)$/.exec(str);
    if (!m || m[1] === "0") {
      return null;
    }

    // eslint-disable-next-line no-restricted-syntax
    return (RefCache[str] = new Ref(
      parseInt(m[1]),
      !m[2] ? 0 : parseInt(m[2])
    ));
  }

  static get(num: number, gen: number): Ref {
    const key = gen === 0 ? `${num}R` : `${num}R${gen}`;
    // eslint-disable-next-line no-restricted-syntax
    return (RefCache[key] ||= new Ref(num, gen));
  }
}

// The reference is identified by number and generation.
// This structure stores only one instance of the reference.
export class RefSet {
  protected _set: Set<string>;
  constructor(parent: RefSet | null = null) {
    if ((!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
      parent && !(parent instanceof RefSet)
    ) {
      unreachable('RefSet: Invalid "parent" value.');
    }
    this._set = new Set(parent?._set);
  }

  // TODO 这里到底是不是object，还是可以窄化为一个更精确地类型
  // 需要研究一下
  has(ref: object | string) {
    return this._set.has(ref.toString());
  }

  put(ref: object | string) {
    this._set.add(ref.toString());
  }

  remove(ref: object | string) {
    this._set.delete(ref.toString());
  }

  [Symbol.iterator]() {
    return this._set.values();
  }

  clear() {
    this._set.clear();
  }
}

export class RefSetCache {

  protected _map = new Map();

  get size() {
    return this._map.size;
  }

  get(ref: object) {
    return this._map.get(ref.toString());
  }

  has(ref: object) {
    return this._map.has(ref.toString());
  }

  put(ref, obj) {
    this._map.set(ref.toString(), obj);
  }

  putAlias(ref, aliasRef) {
    this._map.set(ref.toString(), this.get(aliasRef));
  }

  [Symbol.iterator]() {
    return this._map.values();
  }

  clear() {
    this._map.clear();
  }

  *items() {
    for (const [ref, value] of this._map) {
      yield [Ref.fromString(ref), value];
    }
  }
}

export function isName(v: unknown, name: string) {
  return v instanceof Name && (name === undefined || v.name === name);
}

export function isCmd(v: unknown, cmd: string) {
  return v instanceof Cmd && (cmd === undefined || v.cmd === cmd);
}

export function isDict(v: unknown, type: string) {
  return (
    v instanceof Dict && (type === undefined || isName(v.get(DictKey.Type), type))
  );
}

export function isRefsEqual(v1: Ref, v2: Ref) {
  if (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) {
    assert(
      v1 instanceof Ref && v2 instanceof Ref,
      "isRefsEqual: Both parameters should be `Ref`s."
    );
  }
  return v1.num === v2.num && v1.gen === v2.gen;
}