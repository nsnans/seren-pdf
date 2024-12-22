import { Ref } from "../core/primitives";
import { RectType } from "../display/display_utils";
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
  annotationStorage: Map<string, Record<string, any>> | null;

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

export interface GetPageResult {
  rotate: number;
  ref: Ref | null;
  refStr: string | null;
  userUnit: number;
  view: RectType;
}