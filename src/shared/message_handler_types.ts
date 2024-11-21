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