
/* Copyright 2018 Mozilla Foundation
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

import { Uint8TypedArray } from "../common/typed_array";
import { Dict } from "../document/dict";
import { assert } from "../utils/util";
import { JpxDecoderOptions } from "./image_types";
import { MessagePoster, wrapReason } from "./message_handler_types";

export interface PDFStreamSource {
  url: string;
  length: number;
  // 是一个JSON
  httpHeaders: Record<string, string>;
  withCredentials: boolean;
  rangeChunkSize: number;
  disableRange: boolean;
  disableStream: boolean;
}

/**
 * Interface that represents PDF data transport. If possible, it allows
 * progressively load entire or fragment of the PDF binary data.
 * */
export interface PDFStream {
  /**
   * Gets a reader for the entire PDF data.
   * @returns {PDFStreamReader}
   */
  getFullReader(): PDFStreamReader;

  /**
   * Gets a reader for the range of the PDF data.
   * @param {number} begin - the start offset of the data.
   * @param {number} end - the end offset of the data.
   * @returns {PDFStreamRangeReader}
   */
  getRangeReader(begin: number, end: number): PDFStreamRangeReader | null;

  /**
   * Cancels all opened reader and closes all their opened requests.
   * @param {Object} reason - the reason for cancelling
   */
  cancelAllRequests(reason: Error): void;
}

export interface ReadResult {
  value: ArrayBuffer | null;
  done: boolean;
}

export interface WorkerStreamReader extends PDFStreamReader {

  get headersReady(): Promise<void>;

  get contentLength(): number;

  get isStreamingSupported(): boolean;

  get isRangeSupported(): boolean;

  read(): Promise<ReadResult>;

  cancel(reason: any): void;

}
/**
 * Interface for a PDF binary data reader.
 *
 * @interface
 */

export interface PDFStreamReader {

  /**
   * Sets or gets the progress callback. The callback can be useful when the
   * isStreamingSupported property of the object is defined as false.
   * The callback is called with one parameter: an object with the loaded and
   * total properties.
   */
  onProgress: ((loaded: number, total?: number) => void) | null;

  /**
   * Gets a promise that is resolved when the headers and other metadata of
   * the PDF data stream are available.
   * @type {Promise}
   */
  get headersReady(): Promise<void>;

  /**
   * Gets the Content-Disposition filename. It is defined after the headersReady
   * promise is resolved.
   * @type {string|null} The filename, or `null` if the Content-Disposition
   *                     header is missing/invalid.
   */
  get filename(): string | null;

  /**
   * Gets PDF binary data length. It is defined after the headersReady promise
   * is resolved.
   * @type {number} The data length (or 0 if unknown).
   */
  get contentLength(): number;

  /**
   * Gets ability of the stream to handle range requests. It is defined after
   * the headersReady promise is resolved. Rejected when the reader is cancelled
   * or an error occurs.
   * @type {boolean}
   */
  get isRangeSupported(): boolean;

  /**
   * Gets ability of the stream to progressively load binary data. It is defined
   * after the headersReady promise is resolved.
   * @type {boolean}
   */
  get isStreamingSupported(): boolean;

  /**
   * Requests a chunk of the binary data. The method returns the promise, which
   * is resolved into object with properties "value" and "done". If the done
   * is set to true, then the stream has reached its end, otherwise the value
   * contains binary data. Cancelled requests will be resolved with the done is
   * set to true.
   * @returns {Promise}
   */
  read(): Promise<ReadResult>;

  /**
   * Cancels all pending read requests and closes the stream.
   * @param {Object} reason
   */
  cancel(reason?: Error): void;
}

/**
 * Interface for a PDF binary data fragment reader.
 *
 * @interface
 */
export interface PDFStreamRangeReader {
  /**
   * Sets or gets the progress callback. The callback can be useful when the
   * isStreamingSupported property of the object is defined as false.
   * The callback is called with one parameter: an object with the loaded
   * property.
   */
  onProgress: ((loaded: number, total?: number) => void) | null;

  /**
   * Gets ability of the stream to progressively load binary data.
   * @type {boolean}
   */
  get isStreamingSupported(): boolean;

  /**
   * Requests a chunk of the binary data. The method returns the promise, which
   * is resolved into object with properties "value" and "done". If the done
   * is set to true, then the stream has reached its end, otherwise the value
   * contains binary data. Cancelled requests will be resolved with the done is
   * set to true.
   * @returns {Promise}
   */
  read(): Promise<ReadResult>;

  /**
   * Cancels all pending read requests and closes the stream.
   * @param {Object} reason
   */
  cancel(reason: Error): void;
}

export interface StreamSink<Chunk> {

  ready: Promise<void> | null;

  desiredSize: number;

  sinkCapability: PromiseWithResolvers<void> | null;

  isCancelled: boolean;

  /**
   * 这是一个非常关键的函数，生产者通过这个函数向Stream队列里传递数据
   * 而ReadableStream.read()会从这里面来进行数据的调用
   */
  enqueue(chunk: Chunk, size: number, transfers?: Transferable[]): void;

  close(): void;

  error(reason: any): void;

  onCancel: ((reason: Error) => void) | null;

  onPull: (() => void) | null;

}

export interface ReaderHeadersReadyResult {

  isStreamingSupported: boolean;

  isRangeSupported: boolean;

  contentLength: number;
}

export interface DataStream {
  pos: number;
  dict: Dict | null;
  start: number;
  end: number;
  stream: DataStream | null;
  bytes: Uint8TypedArray;
  length: number;
  isEmpty: boolean;
  isDataLoaded: boolean;
  getByte(): number;
  getBytes(_length?: number, option?: JpxDecoderOptions | null): Uint8TypedArray;
  getImageData(length: number, decoderOptions: JpxDecoderOptions | null): Promise<Uint8TypedArray>
  asyncGetBytes(): Promise<Uint8TypedArray | null>
  isAsync: boolean;
  canAsyncDecodeImageFromBuffer: boolean;
  getTransferableImage(): Promise<VideoFrame | null>
  peekByte(): number;
  peekBytes(length?: number): Uint8TypedArray;
  getUint16(): number;
  getInt32(): number
  getByteRange(_begin: number, _end: number): Uint8TypedArray;
  getString(length?: number): string;
  skip(n?: number): void;
  reset(): void;
  moveStart(): void;
  makeSubStream(_start: number, _length: number, _dict: Dict | null): DataStream;
  getBaseStreams(): DataStream[] | null
}

export enum StreamKind {
  UNKNOWN = 0,
  CANCEL = 1,
  CANCEL_COMPLETE = 2,
  CLOSE = 3,
  ENQUEUE = 4,
  ERROR = 5,
  PULL = 6,
  PULL_COMPLETE = 7,
  START_COMPLETE = 8
}

export class GeneralStreamSink<Chunk> implements StreamSink<Chunk> {

  public sinkCapability: PromiseWithResolvers<void>;

  public ready: Promise<void> | null = null;

  public isCancelled: boolean = false;

  public desiredSize: number;

  readonly comObj: MessagePoster;

  readonly sourceName: string;

  readonly targetName: string;

  readonly streamId: number;

  public onPull: (() => void) | null = null;

  public onCancel: ((reason: Error) => void) | null = null;

  readonly onClose: (streamId: number) => void;

  constructor(comObj: MessagePoster, sourceName: string, targetName: string,
    streamId: number, desiredSize: number, onClose: (id: number) => void) {
    this.comObj = comObj;
    this.sinkCapability = Promise.withResolvers();
    this.sourceName = sourceName;
    this.targetName = targetName;
    this.streamId = streamId;
    this.desiredSize = desiredSize;
    this.onClose = onClose;
  }

  enqueue(chunk: Chunk, size = 1, transfers?: Transferable[]) {
    if (this.isCancelled) {
      return;
    }
    const lastDesiredSize = this.desiredSize;
    this.desiredSize -= size;
    // Enqueue decreases the desiredSize property of sink,
    // so when it changes from positive to negative,
    // set ready as unresolved promise.
    if (lastDesiredSize > 0 && this.desiredSize <= 0) {
      this.sinkCapability = Promise.withResolvers();
      this.ready = this.sinkCapability.promise;
    }
    const msg = {
      sourceName: this.sourceName,
      targetName: this.targetName,
      stream: StreamKind.ENQUEUE,
      streamId: this.streamId,
      chunk,
    };
    const post = this.comObj.postMessage.bind(this.comObj);
    // 兼容性写法，主要针对TypeScript报错
    !!transfers ? post(msg, transfers) : post(msg);
  }

  close() {
    if (this.isCancelled) {
      return;
    }
    this.isCancelled = true;
    const msg = {
      sourceName: this.sourceName,
      targetName: this.streamId,
      stream: StreamKind.CLOSE,
      streamId: this.streamId,
    };
    this.comObj.postMessage(msg);
    this.onClose(this.streamId);
  }

  error(reason: Error) {
    assert(reason instanceof Error, "error must have a valid reason");
    if (this.isCancelled) {
      return;
    }
    this.isCancelled = true;
    this.comObj.postMessage({
      sourceName: this.sourceName,
      targetName: this.targetName,
      stream: StreamKind.ERROR,
      streamId: this.streamId,
      reason: wrapReason(reason),
    });
  }
}

