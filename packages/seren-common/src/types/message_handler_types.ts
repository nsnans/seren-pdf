import { MeshShadingPatternIR } from "./shading_types"
import { ImageMask } from "../image/image_types"
import { RadialAxialShadingIR } from "./shading_types"
import { FontExportData } from "./font_types"
import { RectType } from "../common/types"
import { Ref } from "../document/primitives"
import { AnnotationEditorSerial } from "./annotation_types"
import { FontExportExtraData } from "packages/seren-core/src/document/font/fonts"

export enum ObjType {
  Image = "Image",
  Pattern = "Pattern",
}

export enum CommonObjType {
  Font = "Font",
  Image = "Image",
  Pattern = "Pattern",
  FontPath = "FontPath",
  CopyLocalImage = "CopyLocalImage",
}

export interface ObjDataType {
  [ObjType.Pattern]: string[] | MeshShadingPatternIR | RadialAxialShadingIR,
  [ObjType.Image]: ImageMask | null,
}

export interface CommonObjDataType {
  [CommonObjType.Font]: FontExportData | FontExportExtraData | { error: string }
  [CommonObjType.Image]: ImageMask | null
  [CommonObjType.Pattern]: string[] | MeshShadingPatternIR | RadialAxialShadingIR
  [CommonObjType.FontPath]: number[]
  [CommonObjType.CopyLocalImage]: { imageRef: string }
}

export interface GetDocMessage {
  numPages: number;
  fingerprints: [string, string | null];
}

export interface StartRenderPageMessage {
  transparency: boolean;
  pageIndex: number;
  cacheKey: string;
}

export interface FetchBuiltInCMapMessage {
  cMapData: Uint8Array<ArrayBuffer>;
  isCompressed: boolean;
}

export interface FileSpecSerializable {
  filename: string;
  content: Uint8Array<ArrayBuffer> | null;
  description: string;
  rawFilename?: string;
}

export interface GetTextContentMessage {
  pageIndex: number;
  includeMarkedContent: boolean;
  disableNormalization: boolean;
}

export interface SaveDocumentMessage {
  numPages: number | null;
  // string => Annotation初始化的参数
  annotationStorage: Map<string, AnnotationEditorSerial> | null;
  filename: string | null;
}

export interface WorkerBaseMessage {
  sourceName: string;
  targetName: string;
}

export interface ActionWorkerMessage<T> extends WorkerBaseMessage {
  action: string;
  data: T;
}

export interface CallbackWorkerMessage<T> extends WorkerBaseMessage {
  callback: number;
  callbackId: number;
  data?: T;
  reason?: Error;
}

export interface OnProgressParameters {
  loaded: number;
  total?: number;
}

export interface PageInfo {
  rotate: number;
  ref: Ref | null;
  refStr: string | null;
  userUnit: number;
  view: RectType;
}

