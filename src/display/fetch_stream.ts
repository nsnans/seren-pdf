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

import { PDFStream, PDFStreamRangeReader, PDFStreamReader, PDFStreamSource } from "../interfaces";
import { PlatformHelper } from "../platform/platform_helper";
import { AbortException, assert, warn } from "../shared/util";
import {
  createHeaders,
  createResponseStatusError,
  extractFilenameFromHeader,
  validateRangeRequestCapabilities,
  validateResponseStatus,
} from "./network_utils";

if (PlatformHelper.isMozCental()) {
  throw new Error(
    'Module "./fetch_stream.js" shall not be used with MOZCENTRAL builds.'
  );
}

function createFetchOptions(headers: Headers, withCredentials: boolean, abortController: AbortController) {
  return {
    method: "GET",
    headers,
    signal: abortController.signal,
    mode: "cors",
    credentials: withCredentials ? "include" : "same-origin",
    redirect: "follow",
  };
}

// 看了几处调用，val的类型似乎都是Uint8Array，但是考虑到可能会出现不是预期的值
// 因此在这里还是不变更这边的代码
function getArrayBuffer(val: Uint8Array<ArrayBuffer>): ArrayBuffer {
  if (val instanceof Uint8Array) {
    return val.buffer;
  }
  if ((val as any) instanceof ArrayBuffer) {
    return val;
  }
  warn(`getArrayBuffer - unexpected data format: ${val}`);
  return new Uint8Array(val).buffer;
}

export class PDFFetchStream implements PDFStream {

  public source: PDFStreamSource;

  public isHttp: boolean;

  public headers: Headers;

  protected _fullRequestReader: PDFFetchStreamReader | null = null;

  protected _rangeRequestReaders: PDFFetchStreamRangeReader[];

  constructor(source: PDFStreamSource) {
    this.source = source;
    this.isHttp = /^https?:/i.test(source.url);
    this.headers = createHeaders(this.isHttp, source.httpHeaders);

    this._fullRequestReader = null;
    this._rangeRequestReaders = [];
  }

  get _progressiveDataLength() {
    return this._fullRequestReader?._loaded ?? 0;
  }

  getFullReader() {
    assert(
      !this._fullRequestReader,
      "PDFFetchStream.getFullReader can only be called once."
    );
    this._fullRequestReader = new PDFFetchStreamReader(this);
    return this._fullRequestReader;
  }


  getRangeReader(begin: number, end: number) {
    if (end <= this._progressiveDataLength) {
      return null;
    }
    const reader = new PDFFetchStreamRangeReader(this, begin, end);
    this._rangeRequestReaders.push(reader);
    return reader;
  }

  cancelAllRequests(reason: Error) {
    this._fullRequestReader?.cancel(reason);

    for (const reader of this._rangeRequestReaders.slice(0)) {
      reader.cancel(reason);
    }
  }
}

class PDFFetchStreamReader implements PDFStreamReader {

  protected _stream: PDFFetchStream;

  protected _reader: ReadableStreamDefaultReader<Uint8Array> | null;

  public _loaded = 0;

  protected _filename: string | null = null;

  protected _withCredentials: boolean;

  protected _contentLength: number;

  protected _headersCapability = Promise.withResolvers();

  protected _disableRange: boolean;

  protected _rangeChunkSize: number;

  protected _abortController = new AbortController();

  protected _isStreamingSupported: boolean;

  protected _isRangeSupported: boolean;

  public onProgress: ((loaded: number, total?: number) => void) | null;

  constructor(stream: PDFFetchStream) {
    this._stream = stream;
    this._reader = null;
    this._filename = null;
    const source = stream.source;
    this._withCredentials = source.withCredentials || false;
    this._contentLength = source.length;

    this._disableRange = source.disableRange || false;
    this._rangeChunkSize = source.rangeChunkSize;
    if (!this._rangeChunkSize && !this._disableRange) {
      this._disableRange = true;
    }

    this._isStreamingSupported = !source.disableStream;
    this._isRangeSupported = !source.disableRange;
    // Always create a copy of the headers.
    const headers = new Headers(stream.headers);

    const url = source.url;
    fetch(
      url,
      createFetchOptions(headers, this._withCredentials, this._abortController) as RequestInit
    ).then(response => {
      if (!validateResponseStatus(response.status)) {
        throw createResponseStatusError(response.status, url);
      }
      this._reader = response.body!.getReader();
      this._headersCapability.resolve(undefined);

      const responseHeaders = response.headers;

      const { allowRangeRequests, suggestedLength } =
        validateRangeRequestCapabilities({
          responseHeaders,
          isHttp: stream.isHttp,
          rangeChunkSize: this._rangeChunkSize,
          disableRange: this._disableRange,
        });

      this._isRangeSupported = allowRangeRequests;
      // Setting right content length.
      this._contentLength = suggestedLength || this._contentLength;

      this._filename = extractFilenameFromHeader(responseHeaders);

      // We need to stop reading when range is supported and streaming is
      // disabled.
      if (!this._isStreamingSupported && this._isRangeSupported) {
        this.cancel(new AbortException("Streaming is disabled."));
      }
    })
      .catch(this._headersCapability.reject);

    this.onProgress = null;
  }


  get headersReady() {
    return this._headersCapability.promise;
  }

  get filename() {
    return this._filename;
  }

  get contentLength() {
    return this._contentLength;
  }

  get isRangeSupported() {
    return this._isRangeSupported;
  }

  get isStreamingSupported() {
    return this._isStreamingSupported;
  }

  async read() {
    await this._headersCapability.promise;
    const { value, done } = await this._reader!.read();
    if (done) {
      return { value: <ArrayBuffer>value!.buffer, done };
    }
    this._loaded += value.byteLength;
    this.onProgress?.(this._loaded, this._contentLength);

    return { value: getArrayBuffer(<Uint8Array<ArrayBuffer>>value), done: false };
  }

  cancel(reason: Error) {
    this._reader?.cancel(reason);
    this._abortController.abort();
  }
}

class PDFFetchStreamRangeReader implements PDFStreamRangeReader {

  protected _stream: PDFFetchStream;

  protected _reader: ReadableStreamDefaultReader<Uint8Array> | null;

  protected _loaded = 0;

  protected _readCapability = Promise.withResolvers();

  protected _withCredentials = false;

  protected _abortController = new AbortController();

  protected _isStreamingSupported: boolean;

  onProgress: ((loaded: number, total?: number) => void) | null;

  constructor(stream: PDFFetchStream, begin: number, end: number) {
    this._stream = stream;
    this._reader = null;
    this._loaded = 0;
    const source = stream.source;
    this._withCredentials = source.withCredentials || false;
    this._readCapability = Promise.withResolvers();
    this._isStreamingSupported = !source.disableStream;

    // Always create a copy of the headers.
    const headers = new Headers(stream.headers);
    headers.append("Range", `bytes=${begin}-${end - 1}`);

    const url = source.url;
    fetch(
      url,
      createFetchOptions(headers, this._withCredentials, this._abortController) as RequestInit
    )
      .then(response => {
        if (!validateResponseStatus(response.status)) {
          throw createResponseStatusError(response.status, url);
        }
        this._readCapability.resolve(undefined);
        this._reader = response.body!.getReader();
      })
      .catch(this._readCapability.reject);

    this.onProgress = null;
  }

  get isStreamingSupported() {
    return this._isStreamingSupported;
  }

  async read() {
    await this._readCapability.promise;
    const { value, done } = await this._reader!.read();
    if (done) {
      return { value: <ArrayBuffer>value!.buffer, done };
    }
    this._loaded += value.byteLength;
    this.onProgress?.(this._loaded);

    return { value: getArrayBuffer(<Uint8Array<ArrayBuffer>>value), done: false };
  }

  cancel(reason: Error) {
    this._reader?.cancel(reason);
    this._abortController.abort();
  }
}
