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

import { DocParamEvaluatorOptions } from "../display/api";
import { PlatformHelper } from "../platform/platform_helper";
import { MessageHandler } from "../shared/message_handler";
import {
  AbortException,
  createValidAbsoluteUrl,
  FeatureTest,
  unreachable,
  warn,
} from "../shared/util";
import { ChunkedStreamManager } from "./chunked_stream";
import { MissingDataException } from "./core_utils";
import { Page, PDFDocument } from "./document";
import { Stream } from "./stream";
import { WorkerTask } from "./worker";
import { PDFWorkerStream } from "./worker_stream";

function parseDocBaseUrl(url: string | null) {
  if (url) {
    const absoluteUrl = createValidAbsoluteUrl(url);
    if (absoluteUrl) {
      return absoluteUrl.href;
    }
    warn(`Invalid absolute docBaseUrl: "${url}".`);
  }
  return null;
}

export interface PDFManagerArgs {
  source: PDFWorkerStream | Uint8Array | null;
  disableAutoFetch: boolean;
  docBaseUrl: string | null;
  docId: string;
  enableXfa: boolean;
  evaluatorOptions: DocParamEvaluatorOptions;
  handler: MessageHandler;
  length: number;
  password: string | null;
  rangeChunkSize: number;
}

interface PDFManager {

  _docId: string;

  enableXfa: boolean;

  password: string | null;

  evaluatorOptions: DocParamEvaluatorOptions;

  getPage(pageIndex: number): Promise<Page>;

  updatePassword(password: string): void;

  ensure(obj: unknown, prop: string, ...args: any[]): Promise<unknown>;

  ensureDoc(prop: string, ...args: any[]): Promise<unknown>;

  ensureXRef(prop: string, ...args: any[]): Promise<unknown>;

  ensureCatalog(prop: string, ...args: any[]): Promise<unknown>;

  requestRange(_begin: number, _end: number): Promise<unknown>;

  requestLoadedStream(noFetch?: boolean): Promise<Stream>;

  sendProgressiveData(chunk: ArrayBufferLike): void;

  terminate(ex: AbortException): void;

  loadXfaFonts(handler: MessageHandler, task: WorkerTask): Promise<void>;

  loadXfaImages(): Promise<void>;

  serializeXfaData(annotationStorage: Map<string, object> | null): Promise<string | null>;

  cleanup(manuallyTriggered?: boolean): Promise<void>;
}

abstract class BasePDFManager implements PDFManager {

  readonly _docId: string;

  protected _docBaseUrl: string | null;

  protected _password: string | null;

  readonly enableXfa: boolean;

  evaluatorOptions: DocParamEvaluatorOptions;

  constructor(args: PDFManagerArgs) {
    if (
      (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
      this.constructor === BasePDFManager
    ) {
      unreachable("Cannot initialize BasePdfManager.");
    }
    this._docBaseUrl = parseDocBaseUrl(args.docBaseUrl);
    this._docId = args.docId;
    this._password = args.password;
    this.enableXfa = args.enableXfa;

    // Check `OffscreenCanvas` support once, rather than repeatedly throughout
    // the worker-thread code.
    args.evaluatorOptions.isOffscreenCanvasSupported &&=
      FeatureTest.isOffscreenCanvasSupported;
    this.evaluatorOptions = Object.freeze(args.evaluatorOptions);
  }

  get docId() {
    return this._docId;
  }

  get password() {
    return this._password;
  }

  updatePassword(password: string) {
    this._password = password;
  };

  get docBaseUrl() {
    return this._docBaseUrl;
  }

  get catalog() {
    return this.getPDFDocument().catalog;
  }

  ensureDoc(prop: string, ...args: any[]) {
    return this.ensure(this.getPDFDocument(), prop, args);
  }

  ensureXRef(prop: string, ...args: any[]) {
    return this.ensure(this.getPDFDocument().xref, prop, args);
  }

  ensureCatalog(prop: string, ...args: any[]) {
    return this.ensure(this.getPDFDocument().catalog, prop, args);
  }

  getPage(pageIndex: number) {
    return this.getPDFDocument().getPage(pageIndex);
  }

  fontFallback(id, handler) {
    return this.getPDFDocument().fontFallback(id, handler);
  }

  loadXfaFonts(handler, task) {
    return this.getPDFDocument().loadXfaFonts(handler, task);
  }

  loadXfaImages() {
    return this.getPDFDocument().loadXfaImages();
  }

  serializeXfaData(annotationStorage: Map<string, object> | null): Promise<string | null> {
    return this.getPDFDocument().serializeXfaData(annotationStorage);
  }

  cleanup(manuallyTriggered = false): Promise<void> {
    return this.getPDFDocument().cleanup(manuallyTriggered);
  }

  abstract ensure(obj: unknown, prop: string, ...args: any[]): Promise<unknown>;

  abstract requestRange(begin: number, end: number): Promise<void>;

  abstract requestLoadedStream(noFetch?: boolean): Promise<Stream>;

  abstract sendProgressiveData(chunk: ArrayBufferLike): void;

  abstract terminate(reason: AbortException): void;

  abstract getPDFDocument(): PDFDocument;

}

class LocalPDFManager extends BasePDFManager {

  public pdfDocument: PDFDocument;

  _loadedStreamPromise: Promise<Stream>;

  constructor(args: PDFManagerArgs) {
    super(args);

    const stream = new Stream(<Uint8Array>args.source);
    this.pdfDocument = new PDFDocument(this, stream);
    this._loadedStreamPromise = Promise.resolve(stream);
  }

  async ensure(obj, prop, args) {
    const value = obj[prop];
    if (typeof value === "function") {
      return value.apply(obj, args);
    }
    return value;
  }

  requestRange(_begin: number, _end: number) {
    return Promise.resolve();
  }

  requestLoadedStream(_noFetch = false) {
    return this._loadedStreamPromise;
  }

  sendProgressiveData(_chunk: ArrayBufferLike) {
    throw new Error("Method not implemented.");
  }

  terminate(_ex: AbortException) { }

  getPDFDocument(): PDFDocument {
    return this.pdfDocument;
  }
}

class NetworkPDFManager extends BasePDFManager {

  public pdfDocument: PDFDocument;

  public streamManager: ChunkedStreamManager;

  constructor(args: PDFManagerArgs) {
    super(args);

    this.streamManager = new ChunkedStreamManager(args.source, {
      msgHandler: args.handler,
      length: args.length,
      disableAutoFetch: args.disableAutoFetch,
      rangeChunkSize: args.rangeChunkSize,
    });
    this.pdfDocument = new PDFDocument(this, this.streamManager.getStream());
  }

  async ensure(obj: unknown, prop: string, ...args: any[]): Promise<unknown> {
    try {
      const value = obj[prop];
      if (typeof value === "function") {
        return value.apply(obj, args);
      }
      return value;
    } catch (ex) {
      if (!(ex instanceof MissingDataException)) {
        throw ex;
      }
      await this.requestRange(ex.begin, ex.end);
      return this.ensure(obj, prop, args);
    }
  }

  requestRange(begin: number, end: number) {
    return this.streamManager.requestRange(begin, end);
  }

  requestLoadedStream(noFetch = false): Promise<Stream> {
    return <Promise<Stream>>this.streamManager.requestAllChunks(noFetch);
  }

  sendProgressiveData(chunk: ArrayBufferLike) {
    this.streamManager.onReceiveData({ chunk });
  }

  terminate(reason: AbortException) {
    this.streamManager.abort(reason);
  }

  getPDFDocument(): PDFDocument {
    return this.pdfDocument;
  }
}

export { LocalPDFManager, NetworkPDFManager };
export type { PDFManager };

