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

import { Stats } from "fs";
import { PlatformHelper } from "../platform/platform_helper";
import { AbortException, assert, MissingPDFException } from "../shared/util";
import { OnProgressParameters } from "./api";
import {
  createHeaders,
  extractFilenameFromHeader,
  validateRangeRequestCapabilities,
} from "./network_utils";
import { NodePackages } from "./node_utils";
/** 这里可能要做特殊处理，以同时支持web端和node服务器端 */
import * as http from "http"
import * as https from "https"
import * as fs from "fs"
import { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from "http";

if (PlatformHelper.isMozCental()) {
  throw new Error(
    'Module "./node_stream.js" shall not be used with MOZCENTRAL builds.'
  );
}

const urlRegex = /^[a-z][a-z0-9\-+.]+:/i;

function parseUrlOrPath(sourceUrl: string) {
  if (urlRegex.test(sourceUrl)) {
    return new URL(sourceUrl);
  }
  const url = NodePackages.get("url");
  return new URL(url.pathToFileURL(sourceUrl));
}

function createRequest(url: URL, headers: OutgoingHttpHeaders | undefined
  , callback: (res: IncomingMessage) => void): ClientRequest {

  if (url.protocol === "http:") {
    // const http = NodePackages.get("http");
    return http.request(url, { headers }, callback);
  }

  // const https = NodePackages.get("https");
  return https.request(url, { headers }, callback);
}

export class PDFNodeStream {

  public url: URL;

  public isHttp: boolean;

  protected isFsUrl: boolean;

  public headers: Headers;

  protected _fullRequestReader: NodeStreamFullReader | null;

  protected _rangeRequestReaders: NodeStreamRangeReader[];

  public source;

  constructor(source) {
    this.source = source;
    this.url = parseUrlOrPath(source.url);
    this.isHttp =
      this.url.protocol === "http:" || this.url.protocol === "https:";
    // Check if url refers to filesystem.
    this.isFsUrl = this.url.protocol === "file:";
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
      "PDFNodeStream.getFullReader can only be called once."
    );
    this._fullRequestReader = this.isFsUrl
      ? new PDFNodeStreamFsFullReader(this)
      : new PDFNodeStreamFullReader(this);
    return this._fullRequestReader;
  }

  getRangeReader(start: number, end: number) {
    if (end <= this._progressiveDataLength) {
      return null;
    }
    const rangeReader = this.isFsUrl
      ? new PDFNodeStreamFsRangeReader(this, start, end)
      : new PDFNodeStreamRangeReader(this, start, end);
    this._rangeRequestReaders.push(rangeReader);
    return rangeReader;
  }

  cancelAllRequests(reason: Error) {
    this._fullRequestReader?.cancel(reason);

    for (const reader of this._rangeRequestReaders.slice(0)) {
      reader.cancel(reason);
    }
  }
}

interface NodeStreamFullReader {

  _loaded: number;

  cancel(reason?: Error): void;

}

class BaseFullReader implements NodeStreamFullReader {

  protected _url: URL;

  protected _done = false;

  protected _storedError: Error | null;

  protected onProgress: ((evt: OnProgressParameters) => void) | null;

  protected _contentLength;

  public _loaded = 0;

  protected _filename: string | null;

  protected _disableRange: boolean;

  protected _rangeChunkSize: number;

  protected _isStreamingSupported: boolean;

  protected _isRangeSupported: boolean;

  protected _readableStream: fs.ReadStream | IncomingMessage | null;

  protected _readCapability = Promise.withResolvers();

  protected _headersCapability = Promise.withResolvers();

  protected _request: ClientRequest | null = null;

  constructor(stream: PDFNodeStream) {
    this._url = stream.url;
    this._storedError = null;
    this.onProgress = null;
    const source = stream.source;
    this._contentLength = source.length; // optional
    this._filename = null;

    this._disableRange = source.disableRange || false;
    this._rangeChunkSize = source.rangeChunkSize;
    if (!this._rangeChunkSize && !this._disableRange) {
      this._disableRange = true;
    }

    this._isStreamingSupported = !source.disableStream;
    this._isRangeSupported = !source.disableRange;

    this._readableStream = null;

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

  async read(): Promise<{ value?: ArrayBuffer, done: boolean }> {
    await this._readCapability.promise;
    if (this._done) {
      return { value: undefined, done: true };
    }
    if (this._storedError) {
      throw this._storedError;
    }

    const chunk = this._readableStream!.read();
    if (chunk === null) {
      this._readCapability = Promise.withResolvers();
      return this.read();
    }
    this._loaded += chunk.length;
    this.onProgress?.({
      loaded: this._loaded,
      total: this._contentLength,
    });

    // Ensure that `read()` method returns ArrayBuffer.
    const buffer = new Uint8Array(chunk).buffer;
    return { value: buffer, done: false };
  }

  cancel(reason?: Error) {
    // Call `this._error()` method when cancel is called
    // before _readableStream is set.
    if (!this._readableStream) {
      this._error(reason);
      return;
    }
    this._readableStream.destroy(reason);
  }

  _error(reason: Error | null = null) {
    this._storedError = reason;
    this._readCapability.resolve(undefined);
  }

  _setReadableStream(readableStream: fs.ReadStream | IncomingMessage) {
    this._readableStream = readableStream;
    readableStream.on("readable", () => {
      this._readCapability.resolve(undefined);
    });

    readableStream.on("end", () => {
      // Destroy readable to minimize resource usage.
      readableStream.destroy();
      this._done = true;
      this._readCapability.resolve(undefined);
    });

    readableStream.on("error", (reason: Error) => {
      this._error(reason);
    });

    // We need to stop reading when range is supported and streaming is
    // disabled.
    if (!this._isStreamingSupported && this._isRangeSupported) {
      this._error(new AbortException("streaming is disabled"));
    }

    // Destroy ReadableStream if already in errored state.
    if (this._storedError) {
      this._readableStream.destroy(this._storedError);
    }
  }
}

interface NodeStreamRangeReader {

  cancel(reason?: Error): void;

}

class BaseRangeReader implements NodeStreamRangeReader {

  protected onProgress: ((evt: OnProgressParameters) => void) | null;

  protected _url: URL;

  protected _done = false;

  protected _storedError?: Error | null;

  protected _readCapability = Promise.withResolvers();

  protected _loaded = 0;

  protected _isStreamingSupported: boolean;

  protected _readableStream: IncomingMessage | null;

  protected _request: ClientRequest | null = null;

  constructor(stream: PDFNodeStream) {
    this._url = stream.url;
    this._storedError = null;
    this.onProgress = null;
    this._readableStream = null;
    const source = stream.source;
    this._isStreamingSupported = !source.disableStream;
  }

  get isStreamingSupported() {
    return this._isStreamingSupported;
  }

  async read(): Promise<{ value?: ArrayBuffer, done: boolean }> {
    await this._readCapability.promise;
    if (this._done) {
      return { value: undefined, done: true };
    }
    if (this._storedError) {
      throw this._storedError;
    }

    const chunk = this._readableStream!.read();
    if (chunk === null) {
      this._readCapability = Promise.withResolvers();
      return this.read();
    }
    this._loaded += chunk.length;
    this.onProgress?.({ loaded: this._loaded });

    // Ensure that `read()` method returns ArrayBuffer.
    const buffer = new Uint8Array(chunk).buffer;
    return { value: buffer, done: false };
  }

  cancel(reason: Error) {
    // Call `this._error()` method when cancel is called
    // before _readableStream is set.
    if (!this._readableStream) {
      this._error(reason);
      return;
    }
    this._readableStream.destroy(reason);
  }

  _error(reason?: Error) {
    this._storedError = reason;
    this._readCapability.resolve(undefined);
  }

  _setReadableStream(readableStream: IncomingMessage) {
    this._readableStream = readableStream;
    readableStream.on("readable", () => {
      this._readCapability.resolve(undefined);
    });

    readableStream.on("end", () => {
      // Destroy readableStream to minimize resource usage.
      readableStream.destroy();
      this._done = true;
      this._readCapability.resolve(undefined);
    });

    readableStream.on("error", reason => {
      this._error(reason);
    });

    // Destroy readableStream if already in errored state.
    if (this._storedError) {
      this._readableStream.destroy(this._storedError);
    }
  }
}

class PDFNodeStreamFullReader extends BaseFullReader {

  constructor(stream: PDFNodeStream) {
    super(stream);

    // Node.js requires the `headers` to be a regular Object.
    const headers = Object.fromEntries(stream.headers);

    const handleResponse = (response: IncomingMessage) => {
      if (response.statusCode === 404) {
        const error = new MissingPDFException(`Missing PDF "${this._url}".`);
        this._storedError = error;
        this._headersCapability.reject(error);
        return;
      }
      this._headersCapability.resolve(undefined);
      this._setReadableStream(response);

      // 考虑一下库的问题
      const responseHeaders = new Headers(this._readableStream!.headers);

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
    };

    this._request = createRequest(this._url, headers, handleResponse);

    this._request.on("error", reason => {
      this._storedError = reason;
      this._headersCapability.reject(reason);
    });
    // Note: `request.end(data)` is used to write `data` to request body
    // and notify end of request. But one should always call `request.end()`
    // even if there is no data to write -- (to notify the end of request).
    this._request.end();
  }
}

class PDFNodeStreamRangeReader extends BaseRangeReader {

  constructor(stream: PDFNodeStream, start: number, end: number) {

    super(stream);

    // Node.js requires the `headers` to be a regular Object.
    const headers = Object.fromEntries(stream.headers);
    headers.Range = `bytes=${start}-${end - 1}`;

    const handleResponse = (response: IncomingMessage) => {
      if (response.statusCode === 404) {
        const error = new MissingPDFException(`Missing PDF "${this._url}".`);
        this._storedError = error;
        return;
      }
      this._setReadableStream(response);
    };

    this._request = createRequest(this._url, headers, handleResponse);

    this._request.on("error", reason => {
      this._storedError = reason;
    });
    this._request.end();
  }
}



class PDFNodeStreamFsFullReader extends BaseFullReader {

  constructor(stream: PDFNodeStream) {
    super(stream);
    fs.promises.lstat(this._url).then(
      (stat: Stats) => {
        // Setting right content length.
        this._contentLength = stat.size;

        this._setReadableStream(fs.createReadStream(this._url));
        this._headersCapability.resolve(undefined);
      },
      (error: any) => {
        if (error.code === "ENOENT") {
          error = new MissingPDFException(`Missing PDF "${this._url}".`);
        }
        this._storedError = error;
        this._headersCapability.reject(error);
      }
    );
  }
}

class PDFNodeStreamFsRangeReader extends BaseRangeReader {
  constructor(stream: PDFNodeStream, start: number, end: number) {
    super(stream);

    const fs = NodePackages.get("fs");
    this._setReadableStream(
      fs.createReadStream(this._url, { start, end: end - 1 })
    );
  }
}
