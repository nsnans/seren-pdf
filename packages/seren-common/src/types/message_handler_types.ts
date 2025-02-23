import { RectType } from "../common/common_types"
import { Ref } from "../document/primitives"
import { AbortException, MissingPDFException, PasswordException, UnexpectedResponseException, UnknownErrorException, unreachable } from "../utils/util"
import { AnnotationEditorSerial } from "./annotation_types"
import { FontExportData, FontExportExtraData } from "./font_types"
import { ImageMask } from "./image_types"
import { MeshShadingPatternIR, RadialAxialShadingIR } from "./shading_types"

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
export interface MessagePoster {

  postMessage(message: any, transfer: Transferable[]): void;

  postMessage(message: any, options?: StructuredSerializeOptions): void;

  addEventListener<K extends keyof WorkerEventMap>(type: K, listener: (this: Worker, ev: WorkerEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;

}


export function wrapReason(reason: any) {
  const valid = !(reason instanceof Error || (typeof reason === "object" && reason !== null));
  if (valid) {
    unreachable('wrapReason: Expected "reason" to be a (possibly cloned) Error.');
  }
  switch (reason.name) {
    case "AbortException":
      return new AbortException(reason.message);
    case "MissingPDFException":
      return new MissingPDFException(reason.message);
    case "PasswordException":
      return new PasswordException(reason.message, reason.code);
    case "UnexpectedResponseException":
      return new UnexpectedResponseException(reason.message, reason.status);
    case "UnknownErrorException":
      return new UnknownErrorException(reason.message, reason.details);
    default:
      return new UnknownErrorException(reason.message, reason.toString());
  }
}

