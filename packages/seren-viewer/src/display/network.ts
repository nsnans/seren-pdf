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


import {
  assert,
  BaseException,
  PDFStream,
  PDFStreamRangeReader,
  PDFStreamReader,
  PDFStreamSource,
  PlatformHelper,
  ReadResult,
  stringToBytes
} from "seren-common";
import {
  createHeaders,
  createResponseStatusError,
  extractFilenameFromHeader,
  validateRangeRequestCapabilities,
} from "./network_utils";

if (PlatformHelper.isMozCental()) {
  throw new Error(
    'Module "./network.js" shall not be used with MOZCENTRAL builds.'
  );
}

const OK_RESPONSE = 200;
const PARTIAL_CONTENT_RESPONSE = 206;

function getArrayBuffer(xhr: XMLHttpRequest): ArrayBuffer {
  const data = xhr.response;
  if (typeof data !== "string") {
    return data;
  }
  return stringToBytes(data).buffer;
}

const EMPTY_FUNCTION = () => { };

interface PendingRequest {
  onHeadersReceived?: (() => void);
  onProgress: (evt: ProgressEvent) => void;
  onError: (status: number) => void;
  onDone: (begin: number, chunk: ArrayBuffer) => void;
  xhr: XMLHttpRequest,
  expectedStatus: number;

}

class NetworkManager {

  readonly url: string;

  readonly isHttp: boolean;

  protected headers: Headers;

  protected withCredentials: boolean;

  protected currXhrId: number;

  protected pendingRequests: Map<number, PendingRequest>;

  constructor(url: string, httpHeaders: Record<string, string>, withCredentials: boolean) {
    this.url = url;
    this.isHttp = /^https?:/i.test(url);
    this.headers = createHeaders(this.isHttp, httpHeaders);
    this.withCredentials = withCredentials || false;

    this.currXhrId = 0;
    this.pendingRequests = new Map();
  }

  requestRange(listeners: PDFReaderListeners, begin: number, end: number) {
    return this.request(listeners, begin, end);
  }

  requestFull(listeners: PDFReaderListeners) {
    return this.request(listeners);
  }

  request(args: PDFReaderListeners, begin: number | null = null, end: number | null = null) {
    const xhr = new XMLHttpRequest();
    const xhrId = this.currXhrId++;
    const pendingRequest: PendingRequest = {
      xhr,
      onProgress: EMPTY_FUNCTION,
      onError: EMPTY_FUNCTION,
      onDone: EMPTY_FUNCTION,
      expectedStatus: 0
    };
    this.pendingRequests.set(xhrId, pendingRequest);

    xhr.open("GET", this.url);
    xhr.withCredentials = this.withCredentials;
    for (const [key, val] of this.headers) {
      xhr.setRequestHeader(key, val);
    }
    if (this.isHttp && begin != null && end != null) {
      xhr.setRequestHeader("Range", `bytes=${begin}-${end - 1}`);
      pendingRequest.expectedStatus = PARTIAL_CONTENT_RESPONSE;
    } else {
      pendingRequest.expectedStatus = OK_RESPONSE;
    }
    xhr.responseType = "arraybuffer";

    if (args.onError) {
      xhr.onerror = function (_evt) {
        args.onError(xhr.status);
      };
    }
    xhr.onreadystatechange = this.onStateChange.bind(this, xhrId);
    xhr.onprogress = this.onProgress.bind(this, xhrId);

    pendingRequest.onHeadersReceived = args.onHeadersReceived;
    pendingRequest.onDone = args.onDone;
    pendingRequest.onError = args.onError;
    pendingRequest.onProgress = args.onProgress;

    xhr.send(null);

    return xhrId;
  }

  onProgress(xhrId: number, evt: ProgressEvent) {
    const pendingRequest = this.pendingRequests.get(xhrId) ?? null;
    if (!pendingRequest) {
      return; // Maybe abortRequest was called...
    }
    pendingRequest.onProgress?.(evt);
  }

  onStateChange(xhrId: number, _evt: Event) {
    const pendingRequest = this.pendingRequests.get(xhrId) ?? null;
    if (!pendingRequest) {
      return; // Maybe abortRequest was called...
    }

    const xhr = pendingRequest.xhr;
    if (xhr.readyState >= 2 && pendingRequest.onHeadersReceived) {
      pendingRequest.onHeadersReceived();
      delete pendingRequest.onHeadersReceived;
    }

    if (xhr.readyState !== 4) {
      return;
    }

    if (!(xhrId in this.pendingRequests)) {
      // The XHR request might have been aborted in onHeadersReceived()
      // callback, in which case we should abort request.
      return;
    }

    this.pendingRequests.delete(xhrId);

    // Success status == 0 can be on ftp, file and other protocols.
    if (xhr.status === 0 && this.isHttp) {
      pendingRequest.onError?.(xhr.status);
      return;
    }
    const xhrStatus = xhr.status || OK_RESPONSE;

    // From http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.35.2:
    // "A server MAY ignore the Range header". This means it's possible to
    // get a 200 rather than a 206 response from a range request.
    const ok_response_on_range_request =
      xhrStatus === OK_RESPONSE &&
      pendingRequest.expectedStatus === PARTIAL_CONTENT_RESPONSE;

    if (
      !ok_response_on_range_request &&
      xhrStatus !== pendingRequest.expectedStatus
    ) {
      pendingRequest.onError?.(xhr.status);
      return;
    }

    const chunk = getArrayBuffer(xhr);
    if (xhrStatus === PARTIAL_CONTENT_RESPONSE) {
      const rangeHeader = xhr.getResponseHeader("Content-Range")!;
      const matches = /bytes (\d+)-(\d+)\/(\d+)/.exec(rangeHeader)!;
      pendingRequest.onDone(parseInt(matches[1], 10), chunk);
    } else if (chunk) {
      pendingRequest.onDone(0, chunk);
    } else {
      pendingRequest.onError?.(xhr.status);
    }
  }

  getRequestXhr(xhrId: number): XMLHttpRequest {
    return this.pendingRequests.get(xhrId)!.xhr;
  }

  isPendingRequest(xhrId: number): boolean {
    return this.pendingRequests.has(xhrId);
  }

  abortRequest(xhrId: number) {
    const xhr = this.pendingRequests.get(xhrId)!.xhr;
    this.pendingRequests.delete(xhrId);
    xhr.abort();
  }
}

export class PDFNetworkStream implements PDFStream {

  protected _source: PDFStreamSource;

  protected _manager: NetworkManager;

  protected _rangeChunkSize: number;

  protected _rangeRequestReaders: PDFNetworkStreamRangeRequestReader[];

  protected _fullRequestReader: PDFNetworkStreamFullRequestReader | null;

  constructor(source: PDFStreamSource) {
    this._source = source;
    this._manager = new NetworkManager(source.url, source.httpHeaders, source.withCredentials);
    this._rangeChunkSize = source.rangeChunkSize;
    this._fullRequestReader = null;
    this._rangeRequestReaders = [];
  }

  _onRangeRequestReaderClosed(reader: PDFNetworkStreamRangeRequestReader) {
    const i = this._rangeRequestReaders.indexOf(reader);
    if (i >= 0) {
      this._rangeRequestReaders.splice(i, 1);
    }
  }

  getFullReader() {
    assert(
      !this._fullRequestReader,
      "PDFNetworkStream.getFullReader can only be called once."
    );
    this._fullRequestReader = new PDFNetworkStreamFullRequestReader(
      this._manager,
      this._source
    );
    return this._fullRequestReader;
  }

  getRangeReader(begin: number, end: number) {
    const reader = new PDFNetworkStreamRangeRequestReader(
      this._manager,
      begin,
      end
    );
    reader.onClosed = this._onRangeRequestReaderClosed.bind(this);
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

interface PDFReaderListeners {
  onHeadersReceived?: () => void;
  onDone: (begin: number, chunk: ArrayBuffer) => void;
  onError: (status: number) => void;
  onProgress: (evt: ProgressEvent) => void;
}

class PDFNetworkStreamFullRequestReader implements PDFStreamReader {

  protected _manager: NetworkManager;

  protected _url: string;

  protected _fullRequestId: number;

  protected _headersCapability = <PromiseWithResolvers<void>>Promise.withResolvers();

  protected _disableRange: boolean;

  protected _contentLength: number;

  protected _rangeChunkSize: number;

  protected _isStreamingSupported: boolean;

  protected _isRangeSupported: boolean;

  protected _done: boolean;

  protected _requests: PromiseWithResolvers<ReadResult>[];

  protected _filename: string | null;

  protected _cachedChunks: ArrayBuffer[];

  protected _storedError: BaseException | undefined;

  public onProgress: ((loaded: number, total?: number) => void) | null;

  constructor(manager: NetworkManager, source: PDFStreamSource) {
    this._manager = manager;

    const args: PDFReaderListeners = {
      onHeadersReceived: this._onHeadersReceived.bind(this),
      onDone: this._onDone.bind(this),
      onError: this._onError.bind(this),
      onProgress: this._onProgress.bind(this),
    };
    this._url = source.url;
    this._fullRequestId = manager.requestFull(args);
    this._disableRange = source.disableRange || false;
    this._contentLength = source.length; // Optional
    this._rangeChunkSize = source.rangeChunkSize;
    if (!this._rangeChunkSize && !this._disableRange) {
      this._disableRange = true;
    }

    this._isStreamingSupported = false;
    this._isRangeSupported = false;

    this._cachedChunks = [];
    this._requests = [];
    this._done = false;
    this._storedError = undefined;
    this._filename = null;

    this.onProgress = null;
  }

  _onHeadersReceived() {
    const fullRequestXhrId = this._fullRequestId;
    const fullRequestXhr = this._manager.getRequestXhr(fullRequestXhrId);

    const responseHeaders = new Headers(
      fullRequestXhr.getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)
        .map(x => {
          const [key, ...val] = x.split(": ");
          return [key, val.join(": ")];
        }) as [string, string][]
    );

    const { allowRangeRequests, suggestedLength } =
      validateRangeRequestCapabilities(
        responseHeaders,
        this._manager.isHttp,
        this._rangeChunkSize,
        this._disableRange,
      );

    if (allowRangeRequests) {
      this._isRangeSupported = true;
    }
    // Setting right content length.
    this._contentLength = suggestedLength || this._contentLength;

    this._filename = extractFilenameFromHeader(responseHeaders);

    if (this._isRangeSupported) {
      // NOTE: by cancelling the full request, and then issuing range
      // requests, there will be an issue for sites where you can only
      // request the pdf once. However, if this is the case, then the
      // server should not be returning that it can support range requests.
      this._manager.abortRequest(fullRequestXhrId);
    }

    this._headersCapability.resolve();
  }

  _onDone(_begin: number, chunk: ArrayBuffer) {

    if (this._requests.length > 0) {
      const requestCapability = this._requests.shift()!;
      requestCapability.resolve({ value: chunk, done: false });
    } else {
      this._cachedChunks.push(chunk);
    }

    this._done = true;
    if (this._cachedChunks.length > 0) {
      return;
    }
    for (const requestCapability of this._requests) {
      requestCapability.resolve({ value: null, done: true });
    }
    this._requests.length = 0;
  }

  _onError(status: number) {
    this._storedError = createResponseStatusError(status, this._url);
    this._headersCapability.reject(this._storedError);
    for (const requestCapability of this._requests) {
      requestCapability.reject(this._storedError);
    }
    this._requests.length = 0;
    this._cachedChunks.length = 0;
  }

  _onProgress(evt: ProgressEvent) {
    this.onProgress?.(evt.loaded, evt.lengthComputable ? evt.total : this._contentLength);
  }

  get filename() {
    return this._filename;
  }

  get isRangeSupported() {
    return this._isRangeSupported;
  }

  get isStreamingSupported() {
    return this._isStreamingSupported;
  }

  get contentLength() {
    return this._contentLength;
  }

  get headersReady() {
    return this._headersCapability.promise;
  }

  async read() {
    if (this._storedError) {
      throw this._storedError;
    }
    if (this._cachedChunks.length > 0) {
      const chunk = this._cachedChunks.shift()!;
      return { value: chunk, done: false };
    }
    if (this._done) {
      return { value: null, done: true };
    }
    const requestCapability = Promise.withResolvers<ReadResult>();
    this._requests.push(requestCapability);
    return requestCapability.promise;
  }

  cancel(_reason: any) {
    this._done = true;
    this._headersCapability.reject(_reason);
    for (const requestCapability of this._requests) {
      requestCapability.resolve({ value: null, done: true });
    }
    this._requests.length = 0;
    if (this._manager.isPendingRequest(this._fullRequestId)) {
      this._manager.abortRequest(this._fullRequestId);
    }
    // TODO ？？？？显示不存在这个变量？
    // this._fullRequestReader = null;
  }
}

/** @implements {PDFStreamRangeReader} */
class PDFNetworkStreamRangeRequestReader implements PDFStreamRangeReader {

  onProgress: ((loaded: number, total?: number) => void) | null;

  protected _manager: NetworkManager;

  protected _url: string;

  protected _requestId: number;

  protected _done: boolean;

  public onClosed: ((reader: PDFNetworkStreamRangeRequestReader) => void) | null;

  protected _requests: PromiseWithResolvers<ReadResult>[];

  protected _queuedChunk: ArrayBuffer | null;

  protected _storedError: BaseException | undefined;

  constructor(manager: NetworkManager, begin: number, end: number) {
    this._manager = manager;

    const args: PDFReaderListeners = {
      onDone: this._onDone.bind(this),
      onError: this._onError.bind(this),
      onProgress: this._onProgress.bind(this),
    };
    this._url = manager.url;
    this._requestId = manager.requestRange(args, begin, end);
    this._requests = [];
    this._queuedChunk = null;
    this._done = false;
    this._storedError = undefined;

    this.onProgress = null;
    this.onClosed = null;
  }

  _close() {
    this.onClosed?.(this);
  }

  _onDone(_begin: number, chunk: ArrayBuffer) {
    if (this._requests.length > 0) {
      const requestCapability = this._requests.shift()!;
      requestCapability.resolve({ value: chunk, done: false });
    } else {
      this._queuedChunk = chunk;
    }
    this._done = true;
    for (const requestCapability of this._requests) {
      requestCapability.resolve({ value: null, done: true });
    }
    this._requests.length = 0;
    this._close();
  }

  _onError(status: number) {
    this._storedError = createResponseStatusError(status, this._url);
    for (const requestCapability of this._requests) {
      requestCapability.reject(this._storedError);
    }
    this._requests.length = 0;
    this._queuedChunk = null;
  }

  _onProgress(evt: ProgressEvent) {
    if (!this.isStreamingSupported) {
      this.onProgress?.(evt.loaded);
    }
  }

  get isStreamingSupported() {
    return false;
  }

  async read() {
    if (this._storedError) {
      throw this._storedError;
    }
    if (this._queuedChunk !== null) {
      const chunk = this._queuedChunk;
      this._queuedChunk = null;
      return { value: chunk, done: false };
    }
    if (this._done) {
      return { value: null, done: true };
    }
    const requestCapability = Promise.withResolvers<ReadResult>();
    this._requests.push(requestCapability);
    return requestCapability.promise;
  }

  cancel(_reason: any) {
    this._done = true;
    for (const requestCapability of this._requests) {
      requestCapability.resolve({ value: null, done: true });
    }
    this._requests.length = 0;
    if (this._manager.isPendingRequest(this._requestId)) {
      this._manager.abortRequest(this._requestId);
    }
    this._close();
  }
}
