import { AnnotationEditorSerial } from "seren-core";
import { MessageHandler } from "./message_handler";

export interface ReaderHeadersReadyResult {

  isStreamingSupported: boolean;

  isRangeSupported: boolean;

  contentLength: number
}

export interface WorkerBaseMessage {

  sourceName: string;

  targetName: string;

}

export interface ActionWorkerMessage<T> extends MessageHandler {
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