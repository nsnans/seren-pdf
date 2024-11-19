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

import { PlatformHelper } from "../platform/platform_helper";
import {
  createValidAbsoluteUrl,
  FeatureTest,
  unreachable,
  warn,
} from "../shared/util";
import { ChunkedStreamManager } from "./chunked_stream";
import { MissingDataException } from "./core_utils";
import { PDFDocument } from "./document";
import { Stream } from "./stream";

function parseDocBaseUrl(url: string) {
  if (url) {
    const absoluteUrl = createValidAbsoluteUrl(url);
    if (absoluteUrl) {
      return absoluteUrl.href;
    }
    warn(`Invalid absolute docBaseUrl: "${url}".`);
  }
  return null;
}

interface PDFManager {

  _docId: string;

  enableXfa: boolean;

  password: string | null;

  evaluatorOptions;

  ensureDoc(prop: string, args?: any);

  ensureXRef(prop: string, args?: any);

  ensureCatalog(prop, args?: any);

  requestRange(_begin: number, _end: number): Promise<unknown>;
}

abstract class BasePDFManager implements PDFManager {

  _docId: string;

  protected _docBaseUrl: string | null;

  protected _password: string | null;

  protected enableXfa: boolean;


  constructor(args) {
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

  get docBaseUrl() {
    return this._docBaseUrl;
  }

  get catalog() {
    return this.getPDFDocument().catalog;
  }

  ensureDoc(prop: string, ...args: any[]) {
    return this.ensure(this.getPDFDocument(), prop, args);
  }

  ensureXRef(prop, args) {
    return this.ensure(this.getPDFDocument().xref, prop, args);
  }

  ensureCatalog(prop, args) {
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

  serializeXfaData(annotationStorage) {
    return this.getPDFDocument().serializeXfaData(annotationStorage);
  }

  cleanup(manuallyTriggered = false) {
    return this.getPDFDocument().cleanup(manuallyTriggered);
  }

  abstract ensure(obj, prop, args);

  abstract requestRange(begin: number, end: number): Promise<void>;

  abstract requestLoadedStream(noFetch = false);

  abstract sendProgressiveData(chunk);

  updatePassword(password: string) {
    this._password = password;
  }

  abstract terminate(reason: string): void;

  abstract getPDFDocument(): PDFDocument;
  
}

class LocalPDFManager extends BasePDFManager {


  public pdfDocument: PDFDocument;

  constructor(args) {
    super(args);

    const stream = new Stream(args.source);
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

  requestLoadedStream(noFetch = false) {
    return this._loadedStreamPromise;
  }

  sendProgressiveData(_chunk: any) {
    throw new Error("Method not implemented.");
  }

  terminate() { }

  getPDFDocument(): PDFDocument {
    return this.pdfDocument;
  }
}

class NetworkPDFManager extends BasePDFManager {

  public pdfDocument: PDFDocument;

  public streamManager: ChunkedStreamManager;

  constructor(args) {
    super(args);

    this.streamManager = new ChunkedStreamManager(args.source, {
      msgHandler: args.handler,
      length: args.length,
      disableAutoFetch: args.disableAutoFetch,
      rangeChunkSize: args.rangeChunkSize,
    });
    this.pdfDocument = new PDFDocument(this, this.streamManager.getStream());
  }

  async ensure(obj, prop, args) {
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

  requestLoadedStream(noFetch = false) {
    return this.streamManager.requestAllChunks(noFetch);
  }

  sendProgressiveData(chunk) {
    this.streamManager.onReceiveData({ chunk });
  }

  terminate(reason) {
    this.streamManager.abort(reason);
  }

  getPDFDocument(): PDFDocument {
    return this.pdfDocument;
  }
}

export { LocalPDFManager, NetworkPDFManager };
export type { PDFManager };

