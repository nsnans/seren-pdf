import { AnnotationParameters } from "../core/annotation";
import { AnnotationElementParameters } from "../display/annotation_layer";
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

  isPureXfa: boolean;

  numPages: number | null;

  // string => Annotation初始化的参数
  annotationStorage: Map<string, Record<string, any>> | null;

  filename: string | null;

}
