/* Copyright 2019 Mozilla Foundation
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

import { MessageHandler } from "../shared/message_handler";
import { ReaderHeadersReadyResult } from "../shared/message_handler_types";
import { assert } from "../shared/util";

/** @implements {IPDFStream} */
class PDFWorkerStream {

  protected _msgHandler: MessageHandler;

  protected _contentLength: null;

  protected _fullRequestReader: PDFWorkerStreamReader | null;

  protected _rangeRequestReaders: PDFWorkerStreamRangeReader[];

  constructor(msgHandler: MessageHandler) {
    this._msgHandler = msgHandler;
    this._contentLength = null;
    this._fullRequestReader = null;
    this._rangeRequestReaders = [];
  }

  getFullReader() {
    assert(
      !this._fullRequestReader,
      "PDFWorkerStream.getFullReader can only be called once."
    );
    this._fullRequestReader = new PDFWorkerStreamReader(this._msgHandler);
    return this._fullRequestReader;
  }

  getRangeReader(begin: number, end: number) {
    const reader = new PDFWorkerStreamRangeReader(begin, end, this._msgHandler);
    this._rangeRequestReaders.push(reader);
    return reader;
  }

  cancelAllRequests(reason: any) {
    this._fullRequestReader?.cancel(reason);

    for (const reader of this._rangeRequestReaders.slice(0)) {
      reader.cancel(reason);
    }
  }
}

/** @implements {IPDFStreamReader} */
class PDFWorkerStreamReader {

  protected _msgHandler: MessageHandler;

  protected onProgress: null;

  protected _contentLength: number | null;

  protected _isRangeSupported: boolean;

  protected _isStreamingSupported: boolean;

  protected _reader: ReadableStreamDefaultReader<Uint8Array>;

  protected _headersReady: Promise<void>;

  constructor(msgHandler: MessageHandler) {
    this._msgHandler = msgHandler;
    this.onProgress = null;

    this._contentLength = null;
    this._isRangeSupported = false;
    this._isStreamingSupported = false;

    const readableStream = this._msgHandler.sendWithStream("GetReader", null);
    this._reader = readableStream.getReader();

    const sendWithPromise = this._msgHandler.sendWithPromise("ReaderHeadersReady", null);
    const promise = <Promise<ReaderHeadersReadyResult>>sendWithPromise;
    this._headersReady = promise.then((data: ReaderHeadersReadyResult) => {
      this._isStreamingSupported = data.isStreamingSupported;
      this._isRangeSupported = data.isRangeSupported;
      this._contentLength = data.contentLength;
    });
  }

  get headersReady() {
    return this._headersReady;
  }

  get contentLength() {
    return this._contentLength;
  }

  get isStreamingSupported() {
    return this._isStreamingSupported;
  }

  get isRangeSupported() {
    return this._isRangeSupported;
  }

  async read() {
    const { value, done } = await this._reader.read();
    if (done) {
      return { value: undefined, done: true };
    }
    // `value` is wrapped into Uint8Array, we need to
    // unwrap it to ArrayBuffer for further processing.
    return { value: value.buffer, done: false };
  }

  cancel(reason: any) {
    this._reader.cancel(reason);
  }
}

/** @implements {IPDFStreamRangeReader} */
class PDFWorkerStreamRangeReader {

  protected _msgHandler: MessageHandler;

  protected _reader: ReadableStreamDefaultReader;

  protected onProgress: null;

  constructor(begin: number, end: number, msgHandler: MessageHandler) {
    this._msgHandler = msgHandler;
    this.onProgress = null;

    const readableStream = this._msgHandler.sendWithStream("GetRangeReader", {
      begin,
      end,
    });
    this._reader = readableStream.getReader();
  }

  get isStreamingSupported() {
    return false;
  }

  async read() {
    const { value, done } = await this._reader.read();
    if (done) {
      return { value: undefined, done: true };
    }
    return { value: value.buffer, done: false };
  }

  cancel(reason: any) {
    this._reader.cancel(reason);
  }
}

export { PDFWorkerStream };
