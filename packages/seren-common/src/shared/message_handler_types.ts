import { AnnotationEditorSerial } from "../display/editor/state/editor_serializable";
import { WorkerMessageHandler } from "../pdf.worker";

export interface ReaderHeadersReadyResult {

  isStreamingSupported: boolean;

  isRangeSupported: boolean;

  contentLength: number
}

export interface WorkerBaseMessage {

  sourceName: string;

  targetName: string;

}

export interface ActionWorkerMessage<T> extends WorkerMessageHandler {
  action: string;
  data: T;
}

export interface CallbackWorkerMessage<T> extends WorkerBaseMessage {
  callback: number;
  callbackId: number;
  data?: T;
  reason?: Error;
}

export interface SaveDocumentMessage {

  numPages: number | null;

  // string => Annotation初始化的参数
  annotationStorage: Map<string, AnnotationEditorSerial> | null;

  filename: string | null;

}

export interface GetDocMessage {

  numPages: number,

  fingerprints: [string, string | null]

}

export interface StartRenderPageMessage {

  transparency: boolean,

  pageIndex: number,

  cacheKey: string

}

export interface FetchBuiltInCMapMessage {
  cMapData: Uint8Array<ArrayBuffer>;
  isCompressed: boolean;
}

export interface GetTextContentMessage {
  pageIndex: number;
  includeMarkedContent: boolean;
  disableNormalization: boolean;
}

export interface GetAnnotationsMessage {
  pageIndex: number,
  intent: number
}