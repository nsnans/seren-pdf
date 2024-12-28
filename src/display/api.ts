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

/**
 * @module pdfjsLib
 */

import { CatalogMarkInfo, CatalogOutlineItem } from "../core/catalog";
import { EvaluatorTextContent, ImageMask } from "../core/core_types";
import { PDFDocumentInfo } from "../core/document";
import { FontExportData, FontExportExtraData } from "../core/fonts";
import { OpertaorListChunk } from "../core/operator_list";
import { Ref } from "../core/primitives";
import { StructTreeSerialNode } from "../core/struct_tree";
import { WorkerMessageHandler } from "../core/worker";
import { CMapReaderFactory, DOMCMapReaderFactory } from "../display/cmap_reader_factory";
import { PDFFetchStream } from "../display/fetch_stream";
import { PDFNetworkStream } from "../display/network";
import { DOMStandardFontDataFactory, StandardFontDataFactory } from "../display/standard_fontdata_factory";
import { PDFStream, PDFStreamReader, PDFStreamSource } from "../interfaces";
import { PlatformHelper } from "../platform/platform_helper";
import { CommonObjType, MessageHandler, ObjType } from "../shared/message_handler";
import { MessagePoster } from "../shared/message_handler_base";
import { MessageHandlerAction } from "../shared/message_handler_utils";
import {
  AbortException,
  AnnotationMode,
  assert,
  FeatureTest,
  getVerbosityLevel,
  info,
  InvalidPDFException,
  MAX_IMAGE_SIZE_TO_CACHE,
  MissingPDFException,
  OPS,
  PasswordException,
  RenderingIntentFlag,
  setVerbosityLevel,
  shadow,
  stringToBytes,
  UnexpectedResponseException,
  UnknownErrorException,
  unreachable,
  warn
} from "../shared/util";
import { TypedArray } from "../types";
import {
  AnnotationStorage,
  AnnotationStorageSerializable,
  PrintAnnotationStorage,
  SerializableEmpty,
} from "./annotation_storage";
import { CanvasGraphics } from "./canvas";
import { CanvasFactory, DOMCanvasFactory } from "./canvas_factory";
import {
  isDataScheme,
  isValidFetchUrl,
  PageViewport,
  RectType,
  RenderingCancelledException,
  StatTimer,
  TransformType
} from "./display_utils";
import { DOMFilterFactory, FilterFactory } from "./filter_factory";
import { FontFaceObject, FontLoader } from "./font_loader";
import { Metadata } from "./metadata";
import { OptionalContentConfig } from "./optional_content_config";
import { TextLayer } from "./text_layer";
import { PDFDataTransportStream } from "./transport_stream";
import { GlobalWorkerOptions } from "./worker_options";

const DEFAULT_RANGE_CHUNK_SIZE = 65536; // 2^16 = 65536
const RENDERING_CANCELLED_TIMEOUT = 100; // ms
const DELAYED_CLEANUP_TIMEOUT = 5000; // ms

const DefaultCanvasFactory = DOMCanvasFactory;
const DefaultCMapReaderFactory = DOMCMapReaderFactory;
const DefaultFilterFactory = DOMFilterFactory;
const DefaultStandardFontDataFactory = DOMStandardFontDataFactory;

type RefProxy = {
  num: number;
  gen: number;
}

interface DocumentInitParameters {

  /* The URL of the PDF */
  url?: string | URL | null;

  /**
   * Binary PDF data.
   * Use TypedArrays (Uint8Array) to improve the memory usage. If PDF data is
   * BASE64-encoded, use `atob()` to convert it to a binary string first.
   */
  data?: TypedArray | ArrayBuffer | Array<number> | string | ArrayBufferView;

  /* Basic authentication headers */
  httpHeaders?: object;

  /** Indicates whether or not
   * cross-site Access-Control requests should be made using credentials such
   * as cookies or authorization headers. The default is `false`.
   * */
  withCredentials?: boolean;

  /* For decrypting password-protected PDFs. */
  password?: string;

  /* The PDF file length. It's used for progress reports and range requests operations. */
  length?: number;

  /* Allows for using a custom range transport implementation. */
  range?: PDFDataRangeTransport;

  /** 
   * Specify maximum number of bytes fetched per range request.
   * The default value is {@link DEFAULT_RANGE_CHUNK_SIZE}.
   * */
  rangeChunkSize?: number;

  /* The worker that will be used for loading and parsing the PDF data. */
  worker?: PDFWorker;

  /* Controls the logging level; the constants from {@link VerbosityLevel} should be used. */
  verbosity?: number;

  /**
   * The base URL of the document, used when attempting to recover valid absolute URLs for annotations,
   * and outline items, that (incorrectly) only specify relative URLs.
   * */
  docBaseUrl?: string;

  /* The URL where the predefined Adobe CMaps are located. Include the trailing slash.*/
  cMapUrl?: string;

  /* Specifies if the Adobe CMaps are binary packed or not. The default value is `true`. */
  cMapPacked?: boolean;

  /**
   * The factory that will be used when reading built-in CMap files. 
   * Providing a custom factory is useful for environments without Fetch API or `XMLHttpRequest` support, 
   * such as Node.js. The default value is {DOMCMapReaderFactory}.
   * */
  CMapReaderFactory: new (baseUrl: string | null, isCompressed: boolean) => CMapReaderFactory;

  /** 
   * When `true`, fonts that aren't embedded in the PDF document will fallback to a system font.
   * The default value is `true` in web environments and `false` in Node.js;
   * unless `disableFontFace === true` in which case this defaults to `false` 
   * regardless of the environment (to prevent completely broken fonts).
   * */
  useSystemFonts?: boolean;

  /* The URL where the standard font files are located. Include the trailing slash.*/
  standardFontDataUrl?: string;

  /**
   * The factory that will be used   when reading the standard font files. 
   * Providing a custom factory is useful for environments without Fetch API or `XMLHttpRequest` support, such as Node.js.
   * The default value is {DOMStandardFontDataFactory}
   * */
  StandardFontDataFactory: new (standardFontDataUrl: string | null) => StandardFontDataFactory;

  /**
   * Enable using the Fetch API in the worker-thread when reading CMap and standard font files. 
   * When `true`,the `CMapReaderFactory` and `StandardFontDataFactory` options are ignored.
   * The default value is `true` in web environments and `false` in Node.js.
   * */
  useWorkerFetch?: boolean;

  /**
   * Reject certain promises, e.g. `getOperatorList`, `getTextContent`, and `RenderTask`, 
   * when the associated PDF data cannot be successfully parsed, instead of attempting to recover whatever possible of the data. 
   * The default value is `false`.
   * */
  stopAtErrors?: boolean;

  /** 
   * The maximum allowed image size in total pixels, i.e. width * height. 
   * Images above this value will not be rendered. Use -1 for no limit, 
   * which is also the default value.
   *  */
  maxImageSize: number;

  /**
   * Determines if we can evaluate strings
   * as JavaScript. Primarily used to improve performance of PDF functions.
   * The default value is `true`.
   * */
  isEvalSupported?: boolean;

  /**
   * Determines if we can use `OffscreenCanvas` in the worker. Primarily used to 
   * improve performance of image conversion/rendering.
   * The default value is `true` in web environments and `false` in Node.js.
   * */
  isOffscreenCanvasSupported?: boolean;

  /**
   * Determines if we can use bmp ImageDecoder.
   * NOTE: Temporary option until [https://issues.chromium.org/issues/374807001] is fixed.
   * */
  isChrome?: boolean;

  /**
   * The integer value is used to know when an image must be resized (uses `OffscreenCanvas` in the worker).
   * If it's -1 then a possibly slow algorithm is used to guess the max value.
   * */
  canvasMaxAreaInBytes?: number;

  /** 
   * By default fonts are converted to OpenType fonts and loaded via the Font Loading API or `@font-face` rules.
   * If disabled, fonts will be rendered using a built-in font renderer that constructs the glyphs with primitive path commands. 
   * The default value is `false` in web environments and `true` in Node.js.
   * */
  disableFontFace?: boolean;

  /**
   * Include additional properties,which are unused during rendering of PDF documents,
   * when exporting the parsed font data from the worker-thread.
   * This may be useful for debugging purposes (and backwards compatibility), 
   * but note that it will lead to increased memory usage. 
   * The default value is `false`.
   * */
  fontExtraProperties?: boolean;

  /**
   * Specify an explicit document context to create elements with and to load resources, such as fonts, into.
   * Defaults to the current document.
   * */
  ownerDocument?: HTMLDocument;

  /**
   * Disable range request loading of PDF files. 
   * When enabled, and if the server supports partial content requests, then the PDF will be fetched in chunks. 
   * The default value is `false`. 
   * */
  disableRange?: boolean;

  /**
   * Disable streaming of PDF file data.
   * By default PDF.js attempts to load PDF files in chunks.
   * The default value is `false`*/
  disableStream?: boolean;

  /** Disable pre-fetching of PDF file data.
   * When range requests are enabled PDF.js will automatically keep fetching more data even if it isn't needed to display the current page.
   * The default value is `false`.
   * NOTE: It is also necessary to disable streaming, see above, in order for disabling of pre-fetching to work correctly.
   * */
  disableAutoFetch?: boolean;

  /* Enables special hooks for debugging PDF.js (see `web/debugger.js`). The default value is `false`. */
  pdfBug?: boolean;

  /* The factory that will be used when creating canvases. The default value is {DOMCanvasFactory}.*/
  CanvasFactory: new (document: Document, enableHWA: boolean) => CanvasFactory;

  canvasFactory?: Object;

  /** 
   * The factory that will be used to create SVG filters when rendering some images on the main canvas.
   * The default value is {DOMFilterFactory}.
   * */
  FilterFactory: new (docId: string, document: Document) => FilterFactory;

  filterFactory?: Object;

  /* Enables hardware acceleration for rendering. The default value is `false`.*/
  enableHWA?: boolean;

  /* Parameters only intended for development/testing purposes.*/
  styleElement?: HTMLStyleElement;
}

/**
 * This is the main entry point for loading a PDF and interacting with it.
 *
 * NOTE: If a URL is used to fetch the PDF data a standard Fetch API call (or
 * XHR as fallback) is used, which means it must follow same origin rules,
 * e.g. no cross-domain requests without CORS.
 *
 * @param {string | URL | TypedArray | ArrayBuffer | DocumentInitParameters}
 *   src - Can be a URL where a PDF file is located, a typed array (Uint8Array)
 *         already populated with data, or a parameter object.
 * @returns {PDFDocumentLoadingTask}
 */

export class DocumentEvaluatorOptions {

  readonly maxImageSize: number;

  readonly disableFontFace: boolean;

  readonly ignoreErrors: boolean;

  readonly isEvalSupported: boolean;

  public isOffscreenCanvasSupported: boolean;

  readonly isChrome: boolean;

  readonly canvasMaxAreaInBytes: number;

  readonly fontExtraProperties: boolean;

  readonly useSystemFonts: boolean;

  readonly cMapUrl: string | null;

  readonly standardFontDataUrl: string | null;

  constructor(
    maxImageSize: number,
    disableFontFace: boolean,
    ignoreErrors: boolean,
    isEvalSupported: boolean,
    isOffscreenCanvasSupported: boolean,
    isChrome: boolean,
    canvasMaxAreaInBytes: number,
    fontExtraProperties: boolean,
    useSystemFonts: boolean,
    cMapUrl: string | null,
    standardFontDataUrl: string | null,
  ) {
    this.maxImageSize = maxImageSize;
    this.disableFontFace = disableFontFace;
    this.ignoreErrors = ignoreErrors;
    this.isEvalSupported = isEvalSupported;
    this.isOffscreenCanvasSupported = isOffscreenCanvasSupported;
    this.isChrome = isChrome;
    this.canvasMaxAreaInBytes = canvasMaxAreaInBytes;
    this.fontExtraProperties = fontExtraProperties;
    this.useSystemFonts = useSystemFonts;
    this.cMapUrl = cMapUrl;
    this.standardFontDataUrl = standardFontDataUrl;
  }
}

export class DocumentParameter {

  readonly docId: string;

  readonly apiVersion: string | null;

  readonly data: Uint8Array<ArrayBuffer> | null;

  readonly password: string | null;

  readonly disableAutoFetch: boolean;

  readonly rangeChunkSize: number;

  readonly length: number;

  readonly docBaseUrl: string | null;

  readonly evaluatorOptions: DocumentEvaluatorOptions;

  constructor(
    docId: string,
    apiVersion: string | null,
    data: Uint8Array<ArrayBuffer> | null,
    password: string | null,
    disableAutoFetch: boolean,
    rangeChunkSize: number,
    length: number,
    docBaseUrl: string | null,
    evaluatorOptions: DocumentEvaluatorOptions
  ) {
    this.docId = docId;
    this.apiVersion = apiVersion;
    this.data = data;
    this.password = password;
    this.disableAutoFetch = disableAutoFetch;
    this.rangeChunkSize = rangeChunkSize;
    this.length = length;
    this.docBaseUrl = docBaseUrl;
    this.evaluatorOptions = evaluatorOptions;
  }
}

class DocParameterEvaluatorOptionsBuilder {

  private _maxImageSize: number | null = null;

  private _disableFontFace: boolean | null = null;

  private _ignoreErrors: boolean | null = null;

  private _isEvalSupported: boolean | null = null;

  private _isOffscreenCanvasSupported: boolean | null = null;

  private _isChrome: boolean | null = null;

  private _canvasMaxAreaInBytes: number | null = null;

  private _fontExtraProperties: boolean | null = null;

  private _useSystemFonts: boolean | null = null;

  private _cMapUrl: string | null = null;

  private _standardFontDataUrl: string | null = null;

  build() {
    if (this._maxImageSize === null) {
      throw new Error("cannot build evaluation options because maxImageSzie is null");
    }
    if (this._disableFontFace === null) {
      throw new Error("cannot build evaluation options because disableFontFace is null");
    }
    if (this._ignoreErrors === null) {
      throw new Error("cannot build evaluation options because ignoreErrors is null");
    }
    if (this._isEvalSupported === null) {
      throw new Error("cannot build evaluation options because isEvalSupported is null");
    }
    if (this._isOffscreenCanvasSupported === null) {
      throw new Error("cannot build evaluation options because isOffscreenCanvasSupported is null");
    }
    if (this._isChrome === null) {
      throw new Error("cannot build evaluation options because isChrome is null");
    }
    if (this._canvasMaxAreaInBytes === null) {
      throw new Error("cannot build evaluation options because canvasMaxAreaInBytes is null");
    }
    if (this._fontExtraProperties === null) {
      throw new Error("cannot build evaluation options because fontExtraProperties is null");
    }
    if (this._useSystemFonts === null) {
      throw new Error("cannot build evaluation options because useSystemFonts is null");
    }
    return new DocumentEvaluatorOptions(
      this._maxImageSize,
      this._disableFontFace,
      this._ignoreErrors,
      this._isEvalSupported,
      this._isOffscreenCanvasSupported,
      this._isChrome,
      this._canvasMaxAreaInBytes,
      this._fontExtraProperties,
      this._useSystemFonts,
      this._cMapUrl,
      this._standardFontDataUrl,
    )
  }

  set maxImageSize(maxImageSize: number) {
    this._maxImageSize = maxImageSize;
  }

  set disableFontFace(disableFontFace: boolean) {
    this._disableFontFace = disableFontFace;
  }

  set ignoreErrors(ignoreErrors: boolean) {
    this._ignoreErrors = ignoreErrors;
  }

  set isEvalSupported(isEvalSupported: boolean) {
    this._isEvalSupported = isEvalSupported;
  }

  set isOffscreenCanvasSupported(isOffscreenCanvasSupported: boolean) {
    this._isOffscreenCanvasSupported = isOffscreenCanvasSupported;
  }

  set isChrome(isChrome: boolean) {
    this._isChrome = isChrome;
  }

  set canvasMaxAreaInBytes(canvasMaxAreaInBytes: number) {
    this._canvasMaxAreaInBytes = canvasMaxAreaInBytes;
  }

  set fontExtraProperties(fontExtraProperties: boolean) {
    this._fontExtraProperties = fontExtraProperties;
  }

  set useSystemFonts(useSystemFonts: boolean) {
    this._useSystemFonts = useSystemFonts;
  }

  set cMapUrl(cMapUrl: string | null) {
    this._cMapUrl = cMapUrl;
  }

  set standardFontDataUrl(standardFontDataUrl: string | null) {
    this._standardFontDataUrl = standardFontDataUrl;
  }
}

class DocumentParameterBuilder {

  private _docId: string | null = null;

  private _apiVersion: string | null = null;

  private _data: Uint8Array<ArrayBuffer> | null = null;

  private _password: string | null = null;

  private _disableAutoFetch: boolean | null = null;

  private _rangeChunkSize: number | null = null;

  private _length: number | null = null;

  private _docBaseUrl: string | null = null;

  private _evaluatorOptions: DocumentEvaluatorOptions | null = null;

  build() {
    if (this._docId === null) {
      throw new Error("cannot build document parameter because docId is null");
    }
    if (this._disableAutoFetch === null) {
      throw new Error("cannot build document parameter because disableAutoFetch is null");
    }
    if (this._rangeChunkSize === null) {
      throw new Error("cannot build document parameter because rangeChunkSize is null");
    }
    if (this._length === null) {
      throw new Error("cannot build document parameter because length is null");
    }
    if (this._evaluatorOptions === null) {
      throw new Error("cannot build document parameter because evaluatorOptions is null");
    }
    return new DocumentParameter(
      this._docId,
      this._apiVersion,
      this._data,
      this._password,
      this._disableAutoFetch,
      this._rangeChunkSize,
      this._length,
      this._docBaseUrl,
      this._evaluatorOptions
    );
  }

  set docId(docId: string) {
    this._docId = docId;
  }

  set apiVersion(apiVersion: string | null) {
    this._apiVersion = apiVersion;
  }

  set data(data: Uint8Array<ArrayBuffer> | null) {
    this._data = data;
  }

  set password(password: string | null) {
    this._password = password;
  }

  set disableAutoFetch(enable: boolean) {
    this._disableAutoFetch = enable;
  }

  set rangeChunkSize(rangeChunkSize: number) {
    this._rangeChunkSize = rangeChunkSize;
  }

  set length(length: number) {
    this._length = length;
  }

  set docBaseUrl(docBaseUrl: string | null) {
    this._docBaseUrl = docBaseUrl;
  }

  set evaluatorOptions(options: DocumentEvaluatorOptions) {
    this._evaluatorOptions = options;
  }
}

// 只支持两种情况，一种是data数据，另一种是URL，如果
function getDocument(src: DocumentInitParameters) {

  const task = new PDFDocumentLoadingTask();

  const { docId } = task;

  const url = src.url ? getUrlProp(src.url) : null;
  const data = src.data ? getDataProp(src.data) : null;
  const httpHeaders = src.httpHeaders || null;
  const withCredentials = src.withCredentials === true;
  const password = src.password ?? null;
  const rangeTransport = src.range instanceof PDFDataRangeTransport ? src.range : null;

  const validChunkSize = Number.isInteger(src.rangeChunkSize) && <number>src.rangeChunkSize > 0;
  const rangeChunkSize = validChunkSize ? src.rangeChunkSize : DEFAULT_RANGE_CHUNK_SIZE;

  let worker = src.worker instanceof PDFWorker ? src.worker : null;

  const verbosity = src.verbosity || null;

  // Ignore "data:"-URLs, since they can't be used to recover valid absolute
  // URLs anyway. We want to avoid sending them to the worker-thread, since
  // they contain the *entire* PDF document and can thus be arbitrarily long.
  const validDocBaseUrl = typeof src.docBaseUrl === "string" && !isDataScheme(src.docBaseUrl)
  const docBaseUrl = validDocBaseUrl ? src.docBaseUrl : null;
  const cMapUrl = typeof src.cMapUrl === "string" ? src.cMapUrl : null;
  const cMapPacked = src.cMapPacked !== false;
  const CMapReaderFactory = src.CMapReaderFactory || DefaultCMapReaderFactory;
  const validFontDataUrl = typeof src.standardFontDataUrl === "string"
  const standardFontDataUrl = validFontDataUrl ? src.standardFontDataUrl || null : null;

  const StandardFontDataFactory = src.StandardFontDataFactory || DefaultStandardFontDataFactory;
  const ignoreErrors = src.stopAtErrors !== true;

  const validMaxImageSize = Number.isInteger(src.maxImageSize) && src.maxImageSize > -1;
  const maxImageSize = validMaxImageSize ? src.maxImageSize : -1;

  const isEvalSupported = src.isEvalSupported !== false;
  const isOffscreenCanvasSupported = !!src.isOffscreenCanvasSupported;

  const isSetChrome = typeof src.isChrome === "boolean"
  const validChrome = PlatformHelper.isMozCental() && !FeatureTest.platform.isFirefox
    && typeof window !== "undefined" && !!(window)?.chrome;
  const isChrome = isSetChrome ? src.isChrome : validChrome;

  const canvasMaxAreaInBytes = Number.isInteger(src.canvasMaxAreaInBytes) ? src.canvasMaxAreaInBytes : -1;
  const disableFontFace = !!src.disableFontFace;
  const fontExtraProperties = src.fontExtraProperties === true;
  const ownerDocument = src.ownerDocument || globalThis.document;
  const disableRange = src.disableRange === true;
  const disableStream = src.disableStream === true;
  const disableAutoFetch = src.disableAutoFetch === true;
  const pdfBug = src.pdfBug === true;
  const CanvasFactory = src.CanvasFactory || DefaultCanvasFactory;
  const FilterFactory = src.FilterFactory || DefaultFilterFactory;
  const enableHWA = src.enableHWA === true;

  // Parameters whose default values depend on other parameters.
  const length = rangeTransport ? rangeTransport.length : (src.length ?? NaN);
  const isSetUseSystemFonts = typeof src.useSystemFonts === "boolean";
  const useSystemFonts = isSetUseSystemFonts ? src.useSystemFonts : !disableFontFace;

  const isSetWorkerFetch = typeof src.useWorkerFetch === "boolean";
  const calcWorkerFetch = (PlatformHelper.isMozCental()) ||
    (CMapReaderFactory === DOMCMapReaderFactory &&
      StandardFontDataFactory === DOMStandardFontDataFactory &&
      !!cMapUrl &&
      !!standardFontDataUrl &&
      isValidFetchUrl(cMapUrl, document.baseURI) &&
      isValidFetchUrl(standardFontDataUrl, document.baseURI));

  const useWorkerFetch = isSetWorkerFetch ? !!src.useWorkerFetch : calcWorkerFetch;

  // Set the main-thread verbosity level.
  setVerbosityLevel(verbosity);

  // 因为工厂的类型可能是多种多样的，
  // Ensure that the various factories can be initialized, when necessary,
  // since the user may provide *custom* ones.
  const transportFactory = new TransportFactory(
    new CanvasFactory(ownerDocument, enableHWA),
    new FilterFactory(docId, ownerDocument),
    useWorkerFetch ?
      null : new CMapReaderFactory(cMapUrl, cMapPacked),
    PlatformHelper.isMozCental() || useWorkerFetch ?
      null : new StandardFontDataFactory(standardFontDataUrl),
  );

  if (!worker) {
    const port = GlobalWorkerOptions.workerPort;
    // Worker was not provided -- creating and owning our own. If message port
    // is specified in global worker options, using it.
    worker = !!port ? PDFWorker.fromPort(null, port, verbosity || undefined) : new PDFWorker(null, port, verbosity || undefined);
    task._worker = worker;
  }

  const optionBuilder = new DocParameterEvaluatorOptionsBuilder();
  optionBuilder.maxImageSize = maxImageSize;
  optionBuilder.disableFontFace = disableFontFace;
  optionBuilder.ignoreErrors = ignoreErrors;
  optionBuilder.isEvalSupported = isEvalSupported;
  optionBuilder.isOffscreenCanvasSupported = isOffscreenCanvasSupported;
  optionBuilder.isChrome = isChrome!;
  optionBuilder.canvasMaxAreaInBytes = canvasMaxAreaInBytes!;
  optionBuilder.fontExtraProperties = fontExtraProperties;
  optionBuilder.useSystemFonts = useSystemFonts!;
  optionBuilder.cMapUrl = useWorkerFetch ? cMapUrl : null;
  optionBuilder.standardFontDataUrl = useWorkerFetch ? standardFontDataUrl : null;
  const evaluatorOptions = optionBuilder.build();

  const parameterBuilder = new DocumentParameterBuilder();
  parameterBuilder.docId = docId;
  parameterBuilder.apiVersion = PlatformHelper.isTesting() ? PlatformHelper.bundleVersion() : null;
  parameterBuilder.data = data;
  parameterBuilder.password = password;
  parameterBuilder.rangeChunkSize = rangeChunkSize!;
  parameterBuilder.length = length;
  parameterBuilder.docBaseUrl = docBaseUrl!;
  parameterBuilder.evaluatorOptions = evaluatorOptions;

  const docParams = parameterBuilder.build();

  const transportParams = new WorkerTransportParameters(
    disableFontFace,
    fontExtraProperties,
    ownerDocument,
    pdfBug,
    disableAutoFetch
  );

  worker.promise.then(async () => {
    if (task.destroyed) {
      throw new Error("Loading aborted");
    }
    if (worker.destroyed) {
      throw new Error("Worker was destroyed");
    }

    const workerIdPromise = worker.messageHandler.GetDocRequest(
      docParams, data ? [data.buffer] : null
    );

    let networkStream: PDFStream;
    if (rangeTransport) {
      networkStream = new PDFDataTransportStream(rangeTransport, disableRange, disableStream);
    } else if (!data) {
      if (PlatformHelper.isMozCental()) {
        throw new Error("Not implemented: NetworkStream");
      }
      if (!url) {
        throw new Error("getDocument - no `url` parameter provided.");
      }

      const pss: PDFStreamSource = {
        url,
        length,
        httpHeaders,
        withCredentials,
        rangeChunkSize: rangeChunkSize!,
        disableRange,
        disableStream,
      }

      const needFetch = isValidFetchUrl(url);
      networkStream = needFetch ? new PDFFetchStream(pss) : new PDFNetworkStream(pss);
    }

    return workerIdPromise.then(workerId => {
      if (task.destroyed) {
        throw new Error("Loading aborted");
      }
      if (worker!.destroyed) {
        throw new Error("Worker was destroyed");
      }

      const messageHandler = new MessageHandler(docId, workerId, worker.port!);
      const transport = new WorkerTransport(
        messageHandler,
        task,
        networkStream,
        transportParams,
        transportFactory
      );

      task._transport = transport;
      messageHandler.Ready();
    });
  }).catch(task._capability.reject);

  return task;
}

function getUrlProp(val: URL | string): string | null {
  if (PlatformHelper.isMozCental()) {
    return null; // The 'url' is unused with `PDFDataRangeTransport`.
  }
  if (val instanceof URL) {
    return val.href;
  }
  try {
    // The full path is required in the 'url' field.
    return new URL(val, window.location.href).href;
  } catch {
    warn('can not create url')
  }
  throw new Error(
    "Invalid PDF url data: " +
    "either string or URL-object is expected in the url property."
  );
}

function getDataProp(val: TypedArray | ArrayBuffer | Array<number> | string | ArrayBufferView): Uint8Array<ArrayBuffer> {
  // ignore the support of Buffer,because of the unsupport of Node
  if (val instanceof Uint8Array && val.byteLength === val.buffer.byteLength) {
    // Use the data as-is when it's already a Uint8Array that completely
    // "utilizes" its underlying ArrayBuffer, to prevent any possible
    // issues when transferring it to the worker-thread.
    return <Uint8Array<ArrayBuffer>>val;
  }
  if (typeof val === "string") {
    return stringToBytes(val);
  }
  if (val instanceof ArrayBuffer || ArrayBuffer.isView(val) || (typeof val === "object" && !isNaN(val?.length))
  ) {
    return new Uint8Array(val as ArrayBuffer);
  }
  throw new Error(
    "Invalid PDF binary data: either TypedArray, " +
    "string, or array-like object is expected in the data property."
  );
}

function isRefProxy(ref: RefProxy) {
  return (
    typeof ref === "object" &&
    Number.isInteger(ref?.num) &&
    ref.num >= 0 &&
    Number.isInteger(ref?.gen) &&
    ref.gen >= 0
  );
}

export interface OnProgressParameters {
  loaded: number;
  total?: number;
}

/**
 * The loading task controls the operations required to load a PDF document
 * (such as network requests) and provides a way to listen for completion,
 * after which individual pages can be rendered.
 */
export class PDFDocumentLoadingTask {

  static #docId = 0;

  public docId: string;

  public _worker: PDFWorker | null = null;

  public _capability = Promise.withResolvers<PDFDocumentProxy>();

  public destroyed = false;

  public _transport: WorkerTransport | null;

  public onProgress: ((loaded: number, total?: number) => void) | null = null;

  public onPassword: ((updateCallback: (password: string | Error) => void, reason: number) => void) | null;

  constructor() {
    this._transport = null;
    this._worker = null;

    /**
     * Unique identifier for the document loading task.
     * @type {string}
     */
    this.docId = `d${PDFDocumentLoadingTask.#docId++}`;

    /**
     * Whether the loading task is destroyed or not.
     * @type {boolean}
     */
    this.destroyed = false;

    /**
     * Callback to request a password if a wrong or no password was provided.
     * The callback receives two parameters: a function that should be called
     * with the new password, and a reason (see {@link PasswordResponses}).
     * @type {function}
     */
    this.onPassword = null;

    /**
     * Callback to be able to monitor the loading progress of the PDF file
     * (necessary to implement e.g. a loading bar).
     * The callback receives an {@link OnProgressParameters} argument.
     * @type {function} (loaded: number, total?: number) => void;
     */
    this.onProgress = null;
  }

  /**
   * Promise for document loading task completion.
   * @type {Promise<PDFDocumentProxy>}
   */
  get promise() {
    return this._capability.promise;
  }

  /**
   * Abort all network requests and destroy the worker.
   * @returns {Promise<void>} A promise that is resolved when destruction is
   *   completed.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    try {
      if (this._worker?.port) {
        this._worker._pendingDestroy = true;
      }
      await this._transport?.destroy();
    } catch (ex) {
      if (this._worker?.port) {
        delete this._worker._pendingDestroy;
      }
      throw ex;
    }

    this._transport = null;
    if (this._worker) {
      this._worker.destroy();
      this._worker = null;
    }
  }
}

/**
 * Abstract class to support range requests file loading.
 *
 * NOTE: The TypedArrays passed to the constructor and relevant methods below
 * will generally be transferred to the worker-thread. This will help reduce
 * main-thread memory usage, however it will take ownership of the TypedArrays.
 */
abstract class PDFDataRangeTransport {

  public length: number;

  public initialData: Uint8Array | null;

  public progressiveDone: boolean;

  public contentDispositionFilename: string | null;

  protected _readyCapability = Promise.withResolvers();

  protected _progressListeners = [] as ((loaded: number, total?: number) => void)[]

  protected _rangeListeners = [] as ((begin: number, chunk: Uint8Array | null) => void)[]

  protected _progressiveReadListeners = [] as ((chunk: Uint8Array | null) => void)[]

  protected _progressiveDoneListeners = [] as (() => void)[];

  constructor(
    length: number,
    initialData: Uint8Array | null,
    progressiveDone = false,
    contentDispositionFilename: string | null = null
  ) {
    this.length = length;
    this.initialData = initialData;
    this.progressiveDone = progressiveDone;
    this.contentDispositionFilename = contentDispositionFilename;
  }

  addRangeListener(listener: (begin: number, chunk: Uint8Array | null) => void) {
    this._rangeListeners.push(listener);
  }

  addProgressListener(listener: (loaded: number, total?: number) => void) {
    this._progressListeners.push(listener);
  }

  addProgressiveReadListener(listener: (chunk: Uint8Array | null) => void) {
    this._progressiveReadListeners.push(listener);
  }

  /**
   * @param {function} listener
   */
  addProgressiveDoneListener(listener: () => void) {
    this._progressiveDoneListeners.push(listener);
  }

  /**
   * @param {number} begin
   * @param {Uint8Array|null} chunk
   */
  onDataRange(begin: number, chunk: Uint8Array | null) {
    for (const listener of this._rangeListeners) {
      listener(begin, chunk);
    }
  }

  /**
   * @param {number} loaded
   * @param {number|undefined} total
   */
  onDataProgress(loaded: number, total: number | undefined) {
    this._readyCapability.promise.then(() => {
      for (const listener of this._progressListeners) {
        listener(loaded, total);
      }
    });
  }

  /**
   * @param {Uint8Array|null} chunk
   */
  onDataProgressiveRead(chunk: Uint8Array | null) {
    this._readyCapability.promise.then(() => {
      for (const listener of this._progressiveReadListeners) {
        listener(chunk);
      }
    });
  }

  onDataProgressiveDone() {
    this._readyCapability.promise.then(() => {
      for (const listener of this._progressiveDoneListeners) {
        listener();
      }
    });
  }

  transportReady() {
    this._readyCapability.resolve(null);
  }

  abstract requestDataRange(_begin: number, _end: number): void;

  abort() { }
}

interface PdfInfo {
  numPages: number,
  fingerprints: [string, string | null]
}

/**
 * Proxy to a `PDFDocument` in the worker thread.
 */
class PDFDocumentProxy {

  protected _transport: WorkerTransport;

  protected _pdfInfo: PdfInfo;

  constructor(pdfInfo: PdfInfo, transport: WorkerTransport) {
    this._pdfInfo = pdfInfo;
    this._transport = transport;
  }

  /**
   * Storage for annotation data in forms.
   */
  get annotationStorage() {
    return this._transport.annotationStorage;
  }

  /**
   * The canvas factory instance.
   */
  get canvasFactory() {
    return this._transport.canvasFactory;
  }

  /**
   * The filter factory instance.
   */
  get filterFactory() {
    return this._transport.filterFactory;
  }

  /**
   * Total number of pages in the PDF file.
   */
  get numPages(): number {
    return this._pdfInfo.numPages;
  }

  /**
   * @type A (not guaranteed to be) unique ID to identify the PDF document.
   *   NOTE: The first element will always be defined for all PDF documents,
   *   whereas the second element is only defined for *modified* PDF documents.
   */
  get fingerprints() {
    return this._pdfInfo.fingerprints;
  }

  /**
   * @param pageNumber - The page number to get. The first page is 1.
   * @returns A promise that is resolved with a {@link PDFPageProxy} object.
   */
  getPage(pageNumber: number): Promise<PDFPageProxy> {
    return this._transport.getPage(pageNumber);
  }

  /**
   * @param ref - The page reference.
   * @returns A promise that is resolved with the page index,
   *   starting from zero, that is associated with the reference.
   */
  getPageIndex(ref: RefProxy) {
    return this._transport.getPageIndex(ref);
  }

  /**
   * @returns A promise that is resolved
   *   with a mapping from named destinations to references.
   *
   * This can be slow for large documents. Use `getDestination` instead.
   */
  getDestinations() {
    return this._transport.getDestinations();
  }

  /**
   * @param id - The named destination to get.
   * @returns A promise that is resolved with all
   *   information of the given named destination, or `null` when the named
   *   destination is not present in the PDF file.
   */
  getDestination(id: string) {
    return this._transport.getDestination(id);
  }

  /**
   * @returns  A promise that is resolved with
   *   an {Array} containing the page labels that correspond to the page
   *   indexes, or `null` when no page labels are present in the PDF file.
   */
  getPageLabels() {
    return this._transport.getPageLabels();
  }

  /**
   * @returns A promise that is resolved with a {string}
   *   containing the page layout name.
   */
  getPageLayout() {
    return this._transport.getPageLayout();
  }

  /**
   * @returns A promise that is resolved with a {string}
   *   containing the page mode name.
   */
  getPageMode() {
    return this._transport.getPageMode();
  }

  /**
   * @returns  A promise that is resolved with an
   *   {Object} containing the viewer preferences, or `null` when no viewer
   *   preferences are present in the PDF file.
   */
  getViewerPreferences() {
    return this._transport.getViewerPreferences();
  }

  /**
   * @returns A promise that is resolved with an {Array}
   *   containing the destination, or `null` when no open action is present
   *   in the PDF.
   */
  getOpenAction() {
    return this._transport.getOpenAction();
  }

  /**
   * @returns A promise that is resolved with a lookup table
   *   for mapping named attachments to their content.
   */
  getAttachments() {
    return this._transport.getAttachments();
  }

  /**
   * @returns A promise that is resolved with
   *   an {Object} with the JavaScript actions:
   *     - from the name tree.
   *     - from A or AA entries in the catalog dictionary.
   *   , or `null` if no JavaScript exists.
   */
  getJSActions() {
    return this._transport.getDocJSActions();
  }

  /**
   * @returns A promise that is resolved with an
   *   {Array} that is a tree outline (if it has one) of the PDF file.
   */
  getOutline(): Promise<CatalogOutlineItem[] | null> {
    return this._transport.getOutline();
  }

  /**
   * @typedef {Object} GetOptionalContentConfigParameters
   * @property {string} [intent] - Determines the optional content groups that
   *   are visible by default; valid values are:
   *    - 'display' (viewable groups).
   *    - 'print' (printable groups).
   *    - 'any' (all groups).
   *   The default value is 'display'.
   */

  /**
   * @param {GetOptionalContentConfigParameters} [params] - Optional content
   *   config parameters.
   * @returns {Promise<OptionalContentConfig>} A promise that is resolved with
   *   an {@link OptionalContentConfig} that contains all the optional content
   *   groups (assuming that the document has any).
   */
  getOptionalContentConfig({ intent = "display" } = {}) {
    const { renderingIntent } = this._transport.getRenderingIntent(intent);

    return this._transport.getOptionalContentConfig(renderingIntent);
  }

  /**
   * @returns {Promise<Array<number> | null>} A promise that is resolved with
   *   an {Array} that contains the permission flags for the PDF document, or
   *   `null` when no permissions are present in the PDF file.
   */
  getPermissions() {
    return this._transport.getPermissions();
  }

  /**
   * @returns A promise that is resolved with an {Object} that has `info` and `metadata` properties.
   *   `info` is an {Object} filled with anything available in the information
   *   dictionary and similarly `metadata` is a {Metadata} object with
   *   information from the metadata section of the PDF.
   */
  getMetadata(): Promise<WorkerTransportMetadata> {
    return this._transport.getMetadata();
  }

  /**
   * @returns A promise that is resolved with
   *   a {CatalogMarkInfo} object that contains the MarkInfo flags for the PDF
   *   document, or `null` when no MarkInfo values are present in the PDF file.
   */
  getMarkInfo(): Promise<CatalogMarkInfo | null> {
    return this._transport.getMarkInfo();
  }

  /**
   * @returns {Promise<Uint8Array>} A promise that is resolved with a
   *   {Uint8Array} containing the raw data of the PDF document.
   */
  getData(): Promise<Uint8Array<ArrayBuffer>> {
    return this._transport.getData();
  }

  /**
   * @returns  A promise that is resolved with a
   *   {Uint8Array} containing the full data of the saved document.
   */
  saveDocument() {
    return this._transport.saveDocument();
  }

  /**
   * @returns A promise that is resolved when the
   *   document's data is loaded. It is resolved with an {Object} that contains
   *   the `length` property that indicates size of the PDF data in bytes.
   */
  getDownloadInfo(): Promise<{ length: number }> {
    return this._transport.downloadInfoCapability.promise;
  }

  /**
   * Cleans up resources allocated by the document on both the main and worker
   * threads.
   *
   * NOTE: Do not, under any circumstances, call this method when rendering is
   * currently ongoing since that may lead to rendering errors.
   *
   * @param {boolean} [keepLoadedFonts] - Let fonts remain attached to the DOM.
   *   NOTE: This will increase persistent memory usage, hence don't use this
   *   option unless absolutely necessary. The default value is `false`.
   * @returns {Promise} A promise that is resolved when clean-up has finished.
   */
  cleanup(keepLoadedFonts: boolean = false): Promise<void> {
    return this._transport.startCleanup(keepLoadedFonts);
  }

  /**
   * Destroys the current document instance and terminates the worker.
   */
  destroy() {
    return this.loadingTask.destroy();
  }

  /**
   * @param {RefProxy} ref - The page reference.
   * @returns {number | null} The page number, if it's cached.
   */
  cachedPageNumber(ref: RefProxy): number | null {
    return this._transport.cachedPageNumber(ref);
  }

  /**
   * 只用到了disableAutoFetch，因此不需要整的那么复杂
   */
  get disabelAutoFetch(): boolean {
    return this._transport.disableAutoFetch;
  }

  /**
   * @type {PDFDocumentLoadingTask} The loadingTask for the current document.
   */
  get loadingTask(): PDFDocumentLoadingTask {
    return this._transport.loadingTask;
  }

  /**
   * @returns {Promise<Object<string, Array<Object>> | null>} A promise that is
   *   resolved with an {Object} containing /AcroForm field data for the JS
   *   sandbox, or `null` when no field data is present in the PDF file.
   */
  getFieldObjects() {
    return this._transport.getFieldObjects();
  }

  /**
   * @returns {Promise<boolean>} A promise that is resolved with `true`
   *   if some /AcroForm fields have JavaScript actions.
   */
  hasJSActions(): Promise<boolean> {
    return <Promise<boolean>>this._transport.hasJSActions();
  }

  /**
   * @returns {Promise<Array<string> | null>} A promise that is resolved with an
   *   {Array<string>} containing IDs of annotations that have a calculation
   *   action, or `null` when no such annotations are present in the PDF file.
   */
  getCalculationOrderIds(): Promise<Array<string> | null> {
    return <Promise<Array<string> | null>>this._transport.getCalculationOrderIds();
  }
}


/**
 * Page text content part.
 */
export interface TextItem {

  /** Text content.*/
  str: string;

  /** Text direction: 'ttb', 'ltr' or 'rtl'.*/
  dir: string;

  /** Transformation matrix.*/
  transform: TransformType | null;

  /** Width in device space.*/
  width: number;

  /** Height in device space.*/
  height: number;

  /** Font name used by PDF.js for converted font. */
  fontName: string;

  /** Indicating if the text content is followed by aline-break.*/
  hasEOL: boolean;
}

/**
 * Page text marked content part.
 */
export interface TextMarkedContent {

  /** Either 'beginMarkedContent', 'beginMarkedContentProps', or 'endMarkedContent'. */
  type: string;

  /** The marked content identifier. Only used for type 'beginMarkedContentProps'. */
  id: string | null;

  tag: string | null;
}


/**
 * Text style.
 */
export interface TextStyle {

  /** Font ascent.*/
  ascent: number;

  /** Font descent.*/
  descent: number;

  /** Whether or not the text is in vertical mode.*/
  vertical: boolean;

  /** The possible font family.*/
  fontFamily: string;

  fontSubstitution: string | null,

  fontSubstitutionLoadedName: string | null,
}


/**
 * Page text content.
 */
export interface TextContent {
  /**
   * Array of {@link TextItem} and {@link TextMarkedContent} objects. 
   * TextMarkedContent items are included when includeMarkedContent is true.
   */
  items: Array<TextItem | TextMarkedContent>;

  /** {@link TextStyle} objects, indexed by font name. */
  styles: Map<string, TextStyle>;

  /** The document /Lang attribute. */
  lang: string | null;
}

/**
 * Page render parameters.
 * */
interface RenderParameters {

  /* A 2D context of a DOM Canvas object.*/
  canvasContext: CanvasRenderingContext2D;

  /* Rendering viewport obtained by calling the `PDFPageProxy.getViewport` method.*/
  viewport: PageViewport;

  /* Rendering intent, can be 'display', 'print', or 'any'. The default value is 'display'.*/
  intent: string;

  /**
   * Controls which annotations are rendered onto the canvas, for annotations with appearance-data;
   * the values from {@link AnnotationMode} should be used. The following values are supported:
   * - `AnnotationMode.DISABLE`, which disables all annotations.
   * - `AnnotationMode.ENABLE`, which includes all possible annotations (thus
   *    it also depends on the `intent`-option, see above).
   * - `AnnotationMode.ENABLE_FORMS`, which excludes annotations that contain
   *    interactive form elements (those will be rendered in the display layer).
   * - `AnnotationMode.ENABLE_STORAGE`, which includes all possible annotations
   *    (as above) but where interactive form elements are updated with data
   *    from the {@link AnnotationStorage}-instance; useful e.g. for printing.
   * The default value is `AnnotationMode.ENABLE`.
   */
  annotationMode: number;

  /* Additional transform, applied just before viewport transform. */
  transform: TransformType | null;

  /**
   * Background to use for the canvas.
   * Any valid `canvas.fillStyle` can be used: a `DOMString` parsed as CSS <color> value,
   * a `CanvasGradient` object (a linear or radial gradient) or a `CanvasPattern` object (a repetitive image).
   * The default value is 'rgb(255,255,255)'.
   *
   * NOTE: This option may be partially, or completely, ignored when the `pageColors`-option is used.
   */
  background: CanvasGradient | CanvasPattern | string | null;

  /** 
   * Overwrites background and foreground colors with user defined ones in order to 
   * improve readability in high contrast mode. */
  pageColors: { background: string, foreground: string } | null;

  /**
   * A promise that should resolve with an {@link OptionalContentConfig} 
   * created from `PDFDocumentProxy.getOptionalContentConfig`. If `null`,
   * the configuration will be fetched automatically with the default visibility states set. 
   * */
  optionalContentConfigPromise: Promise<OptionalContentConfig> | null;

  /* Map some annotation ids with canvases used to render them. */
  annotationCanvasMap: Map<string, HTMLCanvasElement> | null;

  printAnnotationStorage: PrintAnnotationStorage | null;

  /* Render the page in editing mode.*/
  isEditing: boolean;
}


/**
 * Page getOperatorList parameters.
 */
interface GetOperatorListParameters {

  /* Rendering intent, can be 'display', 'print', or 'any'. The default value is 'display'.*/
  intent: string;

  /**
   * Controls which annotations are included in the operatorList, for annotations with appearance-data; 
   * the values from {@link AnnotationMode} should be used. The following values are supported:
   *   - `AnnotationMode.DISABLE`, which disables all annotations.
   *   - `AnnotationMode.ENABLE`, which includes all possible annotations (thus
   *     it also depends on the `intent`-option, see above).
   *   - `AnnotationMode.ENABLE_FORMS`, which excludes annotations that contain
   *     interactive form elements (those will be rendered in the display layer).
   *   - `AnnotationMode.ENABLE_STORAGE`, which includes all possible annotations
   *     (as above) but where interactive form elements are updated with data
   *     from the {@link AnnotationStorage}-instance; useful e.g. for printing.
   * The default value is `AnnotationMode.ENABLE`. 
   * */
  annotationMode: number;

  printAnnotationStorage: PrintAnnotationStorage | null;

  /* Render the page in editing mode. */
  isEditing: boolean
}

/**
 * Structure tree content.
 */
interface StructTreeContent {

  /* either "content" for page and stream structure elements or "object" for object references. */
  type: string;

  /* unique id that will map to the text layer. */
  id: string;
}

/**
 * Structure tree node. The root node will have a role "Root".
 */
export interface StructTreeNode {

  /* Array of {@link StructTreeNode} and {@link StructTreeContent} objects. */
  children: (StructTreeNode | StructTreeContent)[];

  /* element's role, already mapped if a role map exists in the PDF. */
  role: string;
}

/**
 * PDF page operator list.
 */
interface PDFOperatorList {

  /* Array containing the operator functions */
  fnArray: Array<number>;

  /* Array containing the arguments of the functions. */
  argsArray: Array<any>;
}

export interface PageInfo {
  rotate: number;
  ref: Ref | null;
  refStr: string | null;
  userUnit: number;
  view: RectType;
}

export interface IntentStateOperatorList {
  fnArray: OPS[];
  argsArray: (any[] | null)[];
  lastChunk: boolean;
  separateAnnots: {
    form: boolean;
    canvas: boolean;
  } | null;
}

interface IntentState {
  streamReader: ReadableStreamDefaultReader<OpertaorListChunk> | null;
  renderTasks: Set<{ operatorListChanged: () => void; }> | null;
  opListReadCapability: PromiseWithResolvers<IntentStateOperatorList> | null;
  streamReaderCancelTimeout: number | null;
  displayReadyCapability: PromiseWithResolvers<boolean> | null;
  operatorList: IntentStateOperatorList | null;
}

/**
 * Proxy to a `PDFPage` in the worker thread.
 */
export class PDFPageProxy {

  protected _delayedCleanupTimeout: number | null = null;

  protected _pendingCleanup = false;

  protected _pageIndex: number;

  protected _pdfBug: boolean;

  protected _stats: StatTimer | null;

  public _maybeCleanupAfterRender: boolean = false;

  public _intentStates = new Map<string, IntentState>();

  protected destroyed = false;

  protected _transport: WorkerTransport;

  protected commonObjs: PDFObjects;

  protected _pageInfo: PageInfo;

  public objs: PDFObjects = new PDFObjects();

  constructor(pageIndex: number, pageInfo: PageInfo, transport: WorkerTransport, pdfBug = false) {
    this._pageIndex = pageIndex;
    this._pageInfo = pageInfo;
    this._transport = transport;
    this._stats = pdfBug ? new StatTimer() : null;
    this._pdfBug = pdfBug;
    this.commonObjs = transport.commonObjs;
    this.objs = new PDFObjects();
  }

  /**
   * Page number of the page. First page is 1.
   */
  get pageNumber() {
    return this._pageIndex + 1;
  }

  /**
   * The number of degrees the page is rotated clockwise.
   */
  get rotate() {
    return this._pageInfo.rotate;
  }

  /**
   * The reference that points to this page.
   */
  get ref() {
    return this._pageInfo.ref;
  }

  /**
   * The default size of units in 1/72nds of an inch.
   */
  get userUnit() {
    return this._pageInfo.userUnit;
  }

  /**
   * An array of the visible portion of the PDF page in user space units [x1, y1, x2, y2].
   */
  get view() {
    return this._pageInfo.view;
  }

  /**
   * @param params - Viewport parameters.
   * @returns {PageViewport} Contains 'width' and 'height' properties
   *   along with transforms required for rendering.
   */
  getViewport(
    scale: number,
    rotation = this.rotate,
    offsetX = 0,
    offsetY = 0,
    dontFlip = false,
  ): PageViewport {
    return new PageViewport(
      this.view,
      scale,
      rotation,
      offsetX,
      offsetY,
      dontFlip,
    );
  }

  /**
   * @param Annotation parameters.
   * @returns A promise that is resolved with an
   *   {Array} of the annotation objects.
   */
  getAnnotations(intent = "display") {
    const { renderingIntent } = this._transport.getRenderingIntent(intent);
    return this._transport.getAnnotations(this._pageIndex, renderingIntent);
  }

  /**
   * @returns A promise that is resolved with an
   *   {Object} with JS actions.
   */
  getJSActions() {
    return this._transport.getPageJSActions(this._pageIndex);
  }

  /**
   * @type {Object} The filter factory instance.
   */
  get filterFactory() {
    return this._transport.filterFactory;
  }

  /**
   * Begins the process of rendering a page to the desired context.
   *
   * @param params - Page render parameters.
   * @returns An object that contains a promise that is resolved when the page finishes rendering.
   */
  render({
    canvasContext,
    viewport,
    intent = "display",
    annotationMode = AnnotationMode.ENABLE,
    transform = null,
    background = null,
    optionalContentConfigPromise = null,
    annotationCanvasMap = null,
    pageColors = null,
    printAnnotationStorage = null,
    isEditing = false,
  }: RenderParameters) {
    this._stats?.time("Overall");

    const intentArgs = this._transport.getRenderingIntent(
      intent,
      annotationMode,
      printAnnotationStorage,
      isEditing
    );
    const { renderingIntent, cacheKey } = intentArgs;
    // If there was a pending destroy, cancel it so no cleanup happens during
    // this call to render...
    this._pendingCleanup = false;
    // ... and ensure that a delayed cleanup is always aborted.
    this._abortDelayedCleanup();

    optionalContentConfigPromise ||=
      this._transport.getOptionalContentConfig(renderingIntent);

    let intentState = this._intentStates.get(cacheKey) ?? null;
    if (!intentState) {
      intentState = {
        streamReaderCancelTimeout: null,
        displayReadyCapability: null,
        operatorList: null,
        renderTasks: null,
        opListReadCapability: null,
        streamReader: null,
      };
      this._intentStates.set(cacheKey, intentState!);
    }

    // Ensure that a pending `streamReader` cancel timeout is always aborted.
    if (intentState.streamReaderCancelTimeout) {
      clearTimeout(intentState.streamReaderCancelTimeout);
      intentState.streamReaderCancelTimeout = null;
    }

    const intentPrint = !!(renderingIntent & RenderingIntentFlag.PRINT);

    // If there's no displayReadyCapability yet, then the operatorList
    // was never requested before. Make the request and create the promise.
    if (!intentState.displayReadyCapability) {
      intentState.displayReadyCapability = Promise.withResolvers();
      intentState.operatorList = {
        fnArray: [],
        argsArray: [],
        lastChunk: false,
        separateAnnots: null,
      };

      this._stats?.time("Page Request");
      const args = intentArgs;
      this._pumpOperatorList(
        args.renderingIntent, args.cacheKey, args.annotationStorageSerializable, args.modifiedIds
      );
    }

    const complete = (error?: Error) => {
      intentState!.renderTasks!.delete(internalRenderTask);

      // Attempt to reduce memory usage during *printing*, by always running
      // cleanup immediately once rendering has finished.
      if (this._maybeCleanupAfterRender || intentPrint) {
        this._pendingCleanup = true;
      }
      this.#tryCleanup(!intentPrint);

      if (error) {
        internalRenderTask.capability.reject(error);

        const reason = error instanceof Error ? error : new Error(error);
        this._abortOperatorList(intentState, reason);
      } else {
        internalRenderTask.capability.resolve(undefined);
      }

      if (this._stats) {
        this._stats.timeEnd("Rendering");
        this._stats.timeEnd("Overall");

        if ((globalThis as any).Stats?.enabled) {
          (globalThis as any).Stats.add(this.pageNumber, this._stats);
        }
      }
    };

    const internalRenderTask = new InternalRenderTask(
      complete,
      // Only include the required properties, and *not* the entire object.
      { canvasContext, viewport, transform, background },
      this.objs,
      this.commonObjs,
      annotationCanvasMap,
      intentState!.operatorList!,
      this._pageIndex,
      this._transport.canvasFactory,
      this._transport.filterFactory,
      !intentPrint,
      this._pdfBug,
      pageColors,
    );

    (intentState!.renderTasks ||= new Set()).add(internalRenderTask);
    const renderTask = internalRenderTask.task;

    Promise.all([
      intentState!.displayReadyCapability.promise,
      optionalContentConfigPromise,
    ]).then(([transparency, optionalContentConfig]) => {
      if (this.destroyed) {
        complete(undefined);
        return;
      }
      this._stats?.time("Rendering");

      if (!(optionalContentConfig!.renderingIntent & renderingIntent)) {
        throw new Error(
          "Must use the same `intent`-argument when calling the `PDFPageProxy.render` " +
          "and `PDFDocumentProxy.getOptionalContentConfig` methods."
        );
      }
      internalRenderTask.initializeGraphics(
        transparency,
        optionalContentConfig,
      );
      internalRenderTask.operatorListChanged();
    }).catch(complete);

    return renderTask;
  }

  /**
   * @param intent Rendering intent, can be 'display', 'print', or 'any'. The default value is 'display'.
   * @param annotationMode Controls which annotations are included in the operatorList, for annotations with appearance-data; 
   * the values from {@link AnnotationMode} should be used. The following values are supported:
   *   - `AnnotationMode.DISABLE`, which disables all annotations.
   *   - `AnnotationMode.ENABLE`, which includes all possible annotations (thus
   *     it also depends on the `intent`-option, see above).
   *   - `AnnotationMode.ENABLE_FORMS`, which excludes annotations that contain
   *     interactive form elements (those will be rendered in the display layer).
   *   - `AnnotationMode.ENABLE_STORAGE`, which includes all possible annotations
   *     (as above) but where interactive form elements are updated with data
   *     from the {@link AnnotationStorage}-instance; useful e.g. for printing.
   * The default value is `AnnotationMode.ENABLE`. 
   * @param isEditing Render the page in editing mode.
   * @returns A promise resolved with an {@link PDFOperatorList} object that represents the page's operator list.
   */
  getOperatorList(
    intent = "display",
    annotationMode = AnnotationMode.ENABLE,
    printAnnotationStorage: PrintAnnotationStorage | null = null,
    isEditing = false,
  ): Promise<PDFOperatorList> {
    if (PlatformHelper.isGeneric()) {
      throw new Error("Not implemented: getOperatorList");
    }
    function operatorListChanged() {
      assert(intentState != null, 'intent state cannot be null')
      if (intentState.operatorList!.lastChunk) {
        intentState.opListReadCapability!.resolve(intentState.operatorList!);
        intentState.renderTasks!.delete(opListTask!);
      }
    }

    const intentArgs = this._transport.getRenderingIntent(
      intent, annotationMode, printAnnotationStorage, isEditing, true
    );
    let intentState = this._intentStates.get(intentArgs.cacheKey);
    if (!intentState) {
      intentState = {
        streamReaderCancelTimeout: null,
        displayReadyCapability: null,
        operatorList: null,
        renderTasks: null,
        opListReadCapability: null,
        streamReader: null,
      };
      this._intentStates.set(intentArgs.cacheKey, intentState);
    }

    assert(intentState != null, 'intent state cannot be null')

    let opListTask: { operatorListChanged: () => void; } | null = null;

    if (!intentState.opListReadCapability) {
      opListTask = {
        operatorListChanged: operatorListChanged
      }
      intentState.opListReadCapability = Promise.withResolvers();
      (intentState.renderTasks ||= new Set()).add(opListTask);
      intentState.operatorList = {
        fnArray: [],
        argsArray: [],
        lastChunk: false,
        separateAnnots: null,
      };

      this._stats?.time("Page Request");
      const args = intentArgs;
      this._pumpOperatorList(
        args.renderingIntent, args.cacheKey, args.annotationStorageSerializable, args.modifiedIds
      );
    }
    return intentState.opListReadCapability.promise;
  }

  /**
   * NOTE: All occurrences of whitespace will be replaced by
   * standard spaces (0x20).
   *
   * @param includeMarkedContent When true include marked content items in the items array of TextContent. The default is `false`.
   * @param disableNormalization When true the text is *not* normalized in the worker-thread. The default is `false`. 
   * @returns Stream for reading text content chunks.
   */
  streamTextContent(
    includeMarkedContent = false,
    disableNormalization = false,
  ): ReadableStream<EvaluatorTextContent> {
    const TEXT_CONTENT_CHUNK_SIZE = 100;

    return this._transport.messageHandler!.GetTextContent(
      this._pageIndex,
      includeMarkedContent === true,
      disableNormalization === true,
      {
        highWaterMark: TEXT_CONTENT_CHUNK_SIZE,
        size(textContent: TextContent) {
          return textContent.items.length;
        },
      }
    );
  }

  /**
   * NOTE: All occurrences of whitespace will be replaced by
   * standard spaces (0x20).
   *
   * @param includeMarkedContent When true include marked content items in the items array of TextContent. The default is `false`.
   * @param disableNormalization When true the text is *not* normalized in the worker-thread. The default is `false`. 
   * @returns A promise that is resolved with a {@link TextContent} object that represents the page's text content.
   */
  getTextContent(
    includeMarkedContent = false,
    disableNormalization = false
  ): Promise<TextContent> {

    const readableStream = this.streamTextContent(includeMarkedContent, disableNormalization);

    return new Promise(function (resolve, reject) {
      function pump() {
        reader.read().then(function ({ value, done }) {
          if (done) {
            resolve(textContent);
            return;
          }
          textContent.lang ??= value.lang;
          value.styles.forEach((v, k) => {
            textContent.styles.set(k, v);
          })
          textContent.items.push(...value.items);
          pump();
        }, reject);
      }

      const reader = readableStream.getReader();
      const textContent: TextContent = {
        items: [],
        styles: new Map(),
        lang: null,
      };
      pump();
    });
  }

  /**
   * @returns {Promise<StructTreeNode>} A promise that is resolved with a
   *   {@link StructTreeNode} object that represents the page's structure tree,
   *   or `null` when no structure tree is present for the current page.
   */
  getStructTree(): Promise<StructTreeSerialNode | null> {
    return this._transport.getStructTree(this._pageIndex);
  }

  /**
   * Destroys the page object.
   * @private
   */
  _destroy() {
    this.destroyed = true;

    const waitOn = [];
    for (const intentState of this._intentStates.values()) {
      const error = new Error("Page was destroyed.")
      this._abortOperatorList(intentState, error, true);

      if (intentState.opListReadCapability) {
        // Avoid errors below, since the renderTasks are just stubs.
        continue;
      }
      for (const internalRenderTask of intentState.renderTasks!) {
        if (internalRenderTask instanceof InternalRenderTask) {
          waitOn.push(internalRenderTask.completed);
          internalRenderTask.cancel();
        } else {
          throw new Error("interalRenderTask属性值不应当包含opListTask");
        }
      }
    }
    this.objs.clear();
    this._pendingCleanup = false;
    this._abortDelayedCleanup();

    return Promise.all(waitOn);
  }

  /**
   * Cleans up resources allocated by the page.
   *
   * @param {boolean} [resetStats] - Reset page stats, if enabled.
   *   The default value is `false`.
   * @returns {boolean} Indicates if clean-up was successfully run.
   */
  cleanup(resetStats: boolean = false): boolean {
    this._pendingCleanup = true;
    const success = this.#tryCleanup(false);

    if (resetStats && success) {
      this._stats &&= new StatTimer();
    }
    return success;
  }

  /**
   * Attempts to clean up if rendering is in a state where that's possible.
   * @param {boolean} [delayed] - Delay the cleanup, to e.g. improve zooming
   *   performance in documents with large images.
   *   The default value is `false`.
   * @returns {boolean} Indicates if clean-up was successfully run.
   */
  #tryCleanup(delayed: boolean = false): boolean {
    this._abortDelayedCleanup();

    if (!this._pendingCleanup || this.destroyed) {
      return false;
    }
    if (delayed) {
      this._delayedCleanupTimeout = setTimeout(() => {
        this._delayedCleanupTimeout = null;
        this.#tryCleanup(false);
      }, DELAYED_CLEANUP_TIMEOUT);

      return false;
    }
    for (const { renderTasks, operatorList } of this._intentStates.values()) {
      if (renderTasks!.size > 0 || !operatorList!.lastChunk) {
        return false;
      }
    }
    this._intentStates.clear();
    this.objs.clear();
    this._pendingCleanup = false;
    return true;
  }

  protected _abortDelayedCleanup() {
    if (this._delayedCleanupTimeout) {
      clearTimeout(this._delayedCleanupTimeout);
      this._delayedCleanupTimeout = null;
    }
  }

  _startRenderPage(transparency: boolean, cacheKey: string) {
    const intentState = this._intentStates.get(cacheKey);
    if (!intentState) {
      return; // Rendering was cancelled.
    }
    this._stats?.timeEnd("Page Request");

    // TODO Refactor RenderPageRequest to separate rendering
    // and operator list logic
    intentState.displayReadyCapability?.resolve(transparency);
  }

  /**
   * @private
   */
  _renderPageChunk(operatorListChunk: OpertaorListChunk, intentState: IntentState) {
    // Add the new chunk to the current operator list.
    for (let i = 0, ii = operatorListChunk.length; i < ii; i++) {
      intentState.operatorList!.fnArray.push(operatorListChunk.fnArray[i]);
      intentState.operatorList!.argsArray.push(operatorListChunk.argsArray[i]);
    }
    intentState.operatorList!.lastChunk = operatorListChunk.lastChunk;
    intentState.operatorList!.separateAnnots = operatorListChunk.separateAnnots;

    // Notify all the rendering tasks there are more operators to be consumed.
    for (const internalRenderTask of intentState.renderTasks!) {
      internalRenderTask.operatorListChanged();
    }

    if (operatorListChunk.lastChunk) {
      this.#tryCleanup(true);
    }
  }

  /**
   * @private
   */
  private _pumpOperatorList(
    renderingIntent: number,
    cacheKey: string,
    annotationStorageSerializable: AnnotationStorageSerializable,
    modifiedIds: Set<string>,
  ) {
    if (PlatformHelper.isTesting()) {
      assert(
        Number.isInteger(renderingIntent) && renderingIntent > 0,
        '_pumpOperatorList: Expected valid "renderingIntent" argument.'
      );
    }
    const { map, transfer } = annotationStorageSerializable;

    // 起初怀疑这里有问题，但是随着调查annotationStorageSerializable的值是SerializableEmpty后
    // 就感觉这里应该没有问题了
    const readableStream = this._transport.messageHandler!.GetOperatorList(
      this._pageIndex, renderingIntent, cacheKey, map, modifiedIds, transfer
    );

    const reader = readableStream.getReader();

    const intentState = this._intentStates.get(cacheKey)!;
    intentState.streamReader = reader;

    const pump = () => {
      reader.read().then(({ value, done }) => {
        if (done) {
          intentState.streamReader = null;
          return;
        }
        if (this._transport.destroyed) {
          return; // Ignore any pending requests if the worker was terminated.
        }
        this._renderPageChunk(value, intentState);
        pump();
      }, reason => {
        intentState.streamReader = null;

        if (this._transport.destroyed) {
          return; // Ignore any pending requests if the worker was terminated.
        }
        if (intentState.operatorList) {
          // Mark operator list as complete.
          intentState.operatorList.lastChunk = true;

          for (const internalRenderTask of intentState.renderTasks!) {
            internalRenderTask.operatorListChanged();
          }
          this.#tryCleanup(true);
        }

        if (intentState.displayReadyCapability) {
          intentState.displayReadyCapability.reject(reason);
        } else if (intentState.opListReadCapability) {
          intentState.opListReadCapability.reject(reason);
        } else {
          throw reason;
        }
      });
    };
    pump();
  }

  /**
   * @private
   */
  _abortOperatorList(intentState: IntentState, reason: Error, force = false) {
    if (PlatformHelper.isTesting()) {
      assert(
        reason instanceof Error,
        '_abortOperatorList: Expected valid "reason" argument.'
      );
    }

    if (!intentState.streamReader) {
      return;
    }
    // Ensure that a pending `streamReader` cancel timeout is always aborted.
    if (intentState.streamReaderCancelTimeout) {
      clearTimeout(intentState.streamReaderCancelTimeout);
      intentState.streamReaderCancelTimeout = null;
    }

    if (!force) {
      // Ensure that an Error occurring in *only* one `InternalRenderTask`, e.g.
      // multiple render() calls on the same canvas, won't break all rendering.
      if (intentState.renderTasks!.size > 0) {
        return;
      }
      // Don't immediately abort parsing on the worker-thread when rendering is
      // cancelled, since that will unnecessarily delay re-rendering when (for
      // partially parsed pages) e.g. zooming/rotation occurs in the viewer.
      if (reason instanceof RenderingCancelledException) {
        let delay = RENDERING_CANCELLED_TIMEOUT;
        if (reason.extraDelay > 0 && reason.extraDelay < /* ms = */ 1000) {
          // Above, we prevent the total delay from becoming arbitrarily large.
          delay += reason.extraDelay;
        }

        intentState.streamReaderCancelTimeout = setTimeout(() => {
          intentState.streamReaderCancelTimeout = null;
          this._abortOperatorList(intentState, reason, true);
        }, delay);
        return;
      }
    }
    intentState.streamReader
      .cancel(new AbortException(reason.message))
      .catch(() => {
        // Avoid "Uncaught promise" messages in the console.
      });
    intentState.streamReader = null;

    if (this._transport.destroyed) {
      return; // Ignore any pending requests if the worker was terminated.
    }
    // Remove the current `intentState`, since a cancelled `getOperatorList`
    // call on the worker-thread cannot be re-started...
    for (const [curCacheKey, curIntentState] of this._intentStates) {
      if (curIntentState === intentState) {
        this._intentStates.delete(curCacheKey);
        break;
      }
    }
    // ... and force clean-up to ensure that any old state is always removed.
    this.cleanup();
  }

  /**
   * @type {StatTimer | null} Returns page stats, if enabled; returns `null`
   *   otherwise.
   */
  get stats() {
    return this._stats;
  }
}

// 一个本地实现的MessagePoster
class LoopbackPort implements MessagePoster {

  protected _listeners = new Map();

  protected _deferred = Promise.resolve();

  postMessage(obj: any, options?: StructuredSerializeOptions | Transferable[]) {
    let transfer = null;
    if (options instanceof Array) {
      transfer = { transfer: options }
    } else if (options?.transfer) {
      transfer = { transfer: options!.transfer! }
    }
    const event = {
      data: structuredClone(obj, transfer ?? undefined),
    };

    this._deferred.then(() => {
      for (const [listener] of this._listeners) {
        listener.call(this, event);
      }
    });
  }

  addEventListener<K extends keyof WorkerEventMap>(
    name: K,
    listener: (this: Worker, ev: WorkerEventMap[K]) => any,
    options: boolean | AddEventListenerOptions | null = null
  ) {
    let rmAbort = null;
    if (typeof options === 'object' && options?.signal instanceof AbortSignal) {
      const { signal } = options;
      if (signal.aborted) {
        warn("LoopbackPort - cannot use an `aborted` signal.");
        return;
      }
      const onAbort = () => this.removeEventListener(name, listener);
      rmAbort = () => signal.removeEventListener("abort", onAbort);

      signal.addEventListener("abort", onAbort);
    }
    this._listeners.set(listener, rmAbort);
  }

  removeEventListener<K extends keyof WorkerEventMap>(
    _name: K, listener: (this: Worker, ev: WorkerEventMap[K]) => any
  ) {
    const rmAbort = this._listeners.get(listener);
    rmAbort?.();

    this._listeners.delete(listener);
  }

  terminate() {
    for (const [, rmAbort] of this._listeners) {
      rmAbort?.();
    }
    this._listeners.clear();
  }
}

/**
 * PDF.js web worker abstraction that controls the instantiation of PDF
 * documents. Message handlers are used to pass information from the main
 * thread to the worker thread and vice versa. If the creation of a web
 * worker is not possible, a "fake" worker will be used instead.
 */
class PDFWorker {

  private static FAKE_WORKER_ID = 0;

  private static IS_WORKER_DISABLED = false;

  private static WORKER_PORTS: WeakMap<MessagePoster, PDFWorker> | null;

  static _isSameOrigin(baseUrl: string, otherUrl: string) {
    let base;
    try {
      base = new URL(baseUrl);
      if (!base.origin || base.origin === "null") {
        return false; // non-HTTP url
      }
    } catch {
      return false;
    }
    const other = new URL(otherUrl, base);
    return base.origin === other.origin;
  };

  static _createCDNWrapper(url: string) {
    // We will rely on blob URL's property to specify origin.
    // We want this function to fail in case if createObjectURL or Blob do
    // not exist or fail for some reason -- our Worker creation will fail anyway.
    const wrapper = `await import("${url}");`;
    return URL.createObjectURL(
      new Blob([wrapper], { type: "text/javascript" })
    );
  }

  public destroyed = false;

  public _pendingDestroy?: boolean;

  protected name: string | null;

  protected verbosity: number;

  protected _readyCapability = Promise.withResolvers();

  protected _port: MessagePoster | null = null;

  protected _webWorker: Worker | null = null;

  protected _messageHandler: MessageHandler | null = null;

  constructor(
    name: string | null = null,
    port: Worker | null = null,
    verbosity = getVerbosityLevel()
  ) {

    this.name = name;
    this.verbosity = verbosity;

    if (PlatformHelper.isMozCental() && port) {
      if (PDFWorker.WORKER_PORTS?.has(port)) {
        throw new Error("Cannot use more than one PDFWorker per port.");
      }
      (PDFWorker.WORKER_PORTS ||= new WeakMap()).set(port, this);
      this._initializeFromPort(port);
      return;
    }
    this._initialize();
  }

  /**
   * Promise for worker initialization completion.
   * @type {Promise<void>}
   */
  get promise() {
    return this._readyCapability.promise;
  }

  #resolve() {
    this._readyCapability.resolve(undefined);
    // Send global setting, e.g. verbosity level.
    this._messageHandler!.configure(this.verbosity);
  }

  /**
   * The current `workerPort`, when it exists.
   * @type {Worker}
   */
  get port() {
    return this._port;
  }

  /**
   * The current MessageHandler-instance.
   * @type {MessageHandler}
   */
  get messageHandler() {
    return this._messageHandler!;
  }

  _initializeFromPort(port: Worker) {
    if (PlatformHelper.isMozCental()) {
      throw new Error("Not implemented: _initializeFromPort");
    }
    this._port = port;
    this._messageHandler = new MessageHandler("main", "worker", port);
    this._messageHandler.onready(() => {
      // Ignoring "ready" event -- MessageHandler should already be initialized
      // and ready to accept messages.
    });
    this.#resolve();
  }

  _initialize() {
    // If worker support isn't disabled explicit and the browser has worker
    // support, create a new web worker and test if it/the browser fulfills
    // all requirements to run parts of pdf.js in a web worker.
    // Right now, the requirement is, that an Uint8Array is still an
    // Uint8Array as it arrives on the worker.
    if (
      PDFWorker.IS_WORKER_DISABLED ||
      PDFWorker.#mainThreadWorkerMessageHandler
    ) {
      this._setupFakeWorker();
      return;
    }
    let { workerSrc } = PDFWorker;

    try {
      // Wraps workerSrc path into blob URL, if the former does not belong
      // to the same origin.
      if (PlatformHelper.isGeneric() && !PDFWorker._isSameOrigin(window.location.href, workerSrc)) {
        workerSrc = PDFWorker._createCDNWrapper(
          new URL(workerSrc, new URL(window.location.href)).href
        );
      }

      const worker = new Worker(workerSrc, { type: "module" });
      const messageHandler = new MessageHandler("main", "worker", worker);
      const terminateEarly = () => {
        ac.abort();
        messageHandler.destroy();
        worker.terminate();
        if (this.destroyed) {
          this._readyCapability.reject(new Error("Worker was destroyed"));
        } else {
          // Fall back to fake worker if the termination is caused by an
          // error (e.g. NetworkError / SecurityError).
          this._setupFakeWorker();
        }
      };

      const ac = new AbortController();
      worker.addEventListener(
        "error",
        () => {
          if (!this._webWorker) {
            // Worker failed to initialize due to an error. Clean up and fall
            // back to the fake worker.
            terminateEarly();
          }
        },
        { signal: ac.signal }
      );

      messageHandler.onTest(data => {
        ac.abort();
        if (this.destroyed || !data) {
          terminateEarly();
          return;
        }
        this._messageHandler = messageHandler;
        this._port = worker;
        this._webWorker = worker;

        this.#resolve();
      });

      messageHandler.onready(() => {
        ac.abort();
        if (this.destroyed) {
          terminateEarly();
          return;
        }
        try {
          sendTest();
        } catch {
          // We need fallback to a faked worker.
          this._setupFakeWorker();
        }
      });

      const sendTest = () => {
        const testObj = new Uint8Array();
        // Ensure that we can use `postMessage` transfers.
        messageHandler.test(testObj, [testObj.buffer]);
      };

      // It might take time for the worker to initialize. We will try to send
      // the "test" message immediately, and once the "ready" message arrives.
      // The worker shall process only the first received "test" message.
      sendTest();
      return;
    } catch {
      info("The worker has been disabled.");
    }
    // Either workers are not supported or have thrown an exception.
    // Thus, we fallback to a faked worker.
    this._setupFakeWorker();
  }

  _setupFakeWorker() {
    if (!PDFWorker.IS_WORKER_DISABLED) {
      warn("Setting up fake worker.");
      PDFWorker.IS_WORKER_DISABLED = true;
    }

    PDFWorker._setupFakeWorkerGlobal
      .then(WorkerMessageHandler => {
        if (this.destroyed) {
          this._readyCapability.reject(new Error("Worker was destroyed"));
          return;
        }
        const port = new LoopbackPort();
        this._port = port;

        // All fake workers use the same port, making id unique.
        const id = `fake${PDFWorker.FAKE_WORKER_ID++}`;

        // If the main thread is our worker, setup the handling for the
        // messages -- the main thread sends to it self.
        const workerHandler = new MessageHandler(id + "_worker", id, port);
        WorkerMessageHandler.setup(workerHandler, port);

        this._messageHandler = new MessageHandler(id, id + "_worker", port);
        this.#resolve();
      })
      .catch((reason: Error) => {
        this._readyCapability.reject(
          new Error(`Setting up fake worker failed: "${reason.message}".`)
        );
      });
  }

  /**
   * Destroys the worker instance.
   */
  destroy() {
    this.destroyed = true;
    if (this._webWorker) {
      // We need to terminate only web worker created resource.
      this._webWorker.terminate();
      this._webWorker = null;
    }
    PDFWorker.WORKER_PORTS?.delete(this._port!);
    this._port = null;
    if (this._messageHandler) {
      this._messageHandler.destroy();
      this._messageHandler = null;
    }
  }

  /**
   * @param {PDFWorkerParameters} params - The worker initialization parameters.
   */
  static fromPort(
    name: string | null = null,
    port: Worker | null = null,
    verbosity = getVerbosityLevel()
  ) {
    if (PlatformHelper.isMozCental()) {
      throw new Error("Not implemented: fromPort");
    }
    if (!port) {
      throw new Error("PDFWorker.fromPort - invalid method signature.");
    }
    const cachedPort = this.WORKER_PORTS?.get(port);
    if (cachedPort) {
      if (cachedPort._pendingDestroy) {
        throw new Error(
          "PDFWorker.fromPort - the worker is being destroyed.\n" +
          "Please remember to await `PDFDocumentLoadingTask.destroy()`-calls."
        );
      }
      return cachedPort;
    }
    return new PDFWorker(name, port, verbosity);
  }

  /**
   * The current `workerSrc`, when it exists.
   * @type {string}
   */
  static get workerSrc() {
    if (GlobalWorkerOptions.workerSrc) {
      return GlobalWorkerOptions.workerSrc;
    }
    throw new Error('No "GlobalWorkerOptions.workerSrc" specified.');
  }

  static get #mainThreadWorkerMessageHandler() {
    try {
      return (globalThis as any).pdfjsWorker?.WorkerMessageHandler || null;
    } catch {
      return null;
    }
  }

  // Loads worker code into the main-thread.
  static get _setupFakeWorkerGlobal() {
    const loader = async () => {
      if (this.#mainThreadWorkerMessageHandler) {
        // The worker was already loaded using e.g. a `<script>` tag.
        return this.#mainThreadWorkerMessageHandler;
      }
      // 根据测试和正式环境，决定使用不同的WorkerMessageHandler
      // 此处去掉了判断，直接去正式环境的
      return WorkerMessageHandler;
    };

    return shadow(this, "_setupFakeWorkerGlobal", loader());
  }
}

class TransportFactory {

  canvasFactory: CanvasFactory;

  filterFactory: FilterFactory;

  cMapReaderFactory: CMapReaderFactory | null;

  standardFontDataFactory: StandardFontDataFactory | null;

  constructor(canvasFactory: CanvasFactory, filterFactory: FilterFactory,
    cMapReaderFactory: CMapReaderFactory | null,
    standardFontDataFactory: StandardFontDataFactory | null) {
    this.canvasFactory = canvasFactory;
    this.filterFactory = filterFactory;
    this.cMapReaderFactory = cMapReaderFactory;
    this.standardFontDataFactory = standardFontDataFactory;
  }
}

class WorkerTransportParameters {

  readonly disableFontFace: boolean;

  readonly fontExtraProperties: boolean;

  readonly ownerDocument: HTMLDocument;

  readonly pdfBug: boolean;

  readonly disableAutoFetch: boolean;

  constructor(
    disableFontFace: boolean,
    fontExtraProperties: boolean,
    ownerDocument: HTMLDocument,
    pdfBug: boolean,
    disableAutoFetch: boolean
  ) {
    this.disableFontFace = disableFontFace;
    this.fontExtraProperties = fontExtraProperties;
    this.ownerDocument = ownerDocument;
    this.pdfBug = pdfBug;
    this.disableAutoFetch = disableAutoFetch;
  }
}

export interface WorkerTransportMetadata {
  info: PDFDocumentInfo;
  metadata: Metadata | null;
  contentDispositionFilename: string | null;
  contentLength: number | null;
}

/**
 * For internal use only.
 * @ignore
 */
class WorkerTransport {

  protected _methodPromises = new Map<string, Promise<unknown>>();

  protected _pageCache = new Map<number, PDFPageProxy>();

  protected _pagePromises = new Map<number, Promise<PDFPageProxy>>();

  protected _pageRefCache = new Map<string, number>();

  protected fontLoader: FontLoader;

  protected _networkStream: PDFStream;

  protected cMapReaderFactory: CMapReaderFactory | null;

  protected standardFontDataFactory: StandardFontDataFactory | null;

  protected _params: WorkerTransportParameters;

  protected destroyCapability: PromiseWithResolvers<unknown> | null = null;

  protected _passwordCapability: PromiseWithResolvers<{ password: string | Error }> | null = null;

  protected _fullReader: PDFStreamReader | null = null;

  protected _lastProgress: OnProgressParameters | null = null;

  protected _numPages: number | null = null;

  public messageHandler: MessageHandler | null;

  public commonObjs = new PDFObjects();

  public downloadInfoCapability = Promise.withResolvers<{ length: number }>();

  public loadingTask: PDFDocumentLoadingTask;

  public canvasFactory: CanvasFactory;

  public filterFactory: FilterFactory;

  public destroyed: boolean;

  public disableAutoFetch: boolean;

  constructor(
    messageHandler: MessageHandler,
    loadingTask: PDFDocumentLoadingTask,
    networkStream: PDFStream,
    params: WorkerTransportParameters,
    factory: TransportFactory
  ) {
    this.messageHandler = messageHandler;
    this.loadingTask = loadingTask;
    this.fontLoader = new FontLoader(params.ownerDocument);
    this.disableAutoFetch = params.disableAutoFetch;
    this._params = params;

    this.canvasFactory = factory.canvasFactory;
    this.filterFactory = factory.filterFactory;
    this.cMapReaderFactory = factory.cMapReaderFactory;
    this.standardFontDataFactory = factory.standardFontDataFactory;

    this.destroyed = false;
    this.destroyCapability = null;

    this._networkStream = networkStream;
    this._fullReader = null;
    this._lastProgress = null;

    this.setupMessageHandler();
  }

  protected _cacheSimpleMethod<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const cachedPromise = <Promise<T>>this._methodPromises.get(name);
    if (cachedPromise) {
      return cachedPromise;
    }
    const promise = fn();

    this._methodPromises.set(name, promise);
    return promise;
  }

  get annotationStorage(): AnnotationStorage {
    return shadow(this, "annotationStorage", new AnnotationStorage());
  }

  getRenderingIntent(
    intent: string,
    annotationMode = AnnotationMode.ENABLE,
    printAnnotationStorage: PrintAnnotationStorage | null = null,
    isEditing = false,
    isOpList = false
  ) {
    let renderingIntent = RenderingIntentFlag.DISPLAY; // Default value.
    let annotationStorageSerializable: AnnotationStorageSerializable = SerializableEmpty;

    switch (intent) {
      case "any":
        renderingIntent = RenderingIntentFlag.ANY;
        break;
      case "display":
        break;
      case "print":
        renderingIntent = RenderingIntentFlag.PRINT;
        break;
      default:
        warn(`getRenderingIntent - invalid intent: ${intent}`);
    }

    const annotationStorage = renderingIntent & RenderingIntentFlag.PRINT && printAnnotationStorage instanceof PrintAnnotationStorage
      ? printAnnotationStorage : this.annotationStorage;

    switch (annotationMode) {
      case AnnotationMode.DISABLE:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_DISABLE;
        break;
      case AnnotationMode.ENABLE:
        break;
      case AnnotationMode.ENABLE_FORMS:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_FORMS;
        break;
      case AnnotationMode.ENABLE_STORAGE:
        renderingIntent += RenderingIntentFlag.ANNOTATIONS_STORAGE;

        annotationStorageSerializable = annotationStorage.serializable;
        break;
      default:
        warn(`getRenderingIntent - invalid annotationMode: ${annotationMode}`);
    }

    if (isEditing) {
      renderingIntent += RenderingIntentFlag.IS_EDITING;
    }
    if (isOpList) {
      renderingIntent += RenderingIntentFlag.OPLIST;
    }

    const { ids: modifiedIds, hash: modifiedIdsHash } = annotationStorage.modifiedIds;

    const cacheKeyBuf = [renderingIntent, annotationStorageSerializable.hash, modifiedIdsHash];

    return {
      renderingIntent, cacheKey: cacheKeyBuf.join("_"), annotationStorageSerializable, modifiedIds
    };
  }

  destroy() {
    if (this.destroyCapability) {
      return this.destroyCapability.promise;
    }

    this.destroyed = true;
    this.destroyCapability = Promise.withResolvers();

    this._passwordCapability?.reject(
      new Error("Worker was destroyed during onPassword callback")
    );

    const waitOn = [];
    // We need to wait for all renderings to be completed, e.g.
    // timeout/rAF can take a long time.
    for (const page of this._pageCache.values()) {
      waitOn.push(page._destroy());
    }
    this._pageCache.clear();
    this._pagePromises.clear();
    this._pageRefCache.clear();
    // Allow `AnnotationStorage`-related clean-up when destroying the document.
    if (this.hasOwnProperty("annotationStorage")) {
      this.annotationStorage.resetModified();
    }
    // We also need to wait for the worker to finish its long running tasks.
    const terminated = this.messageHandler!.Terminate();
    waitOn.push(terminated);

    Promise.all(waitOn).then(() => {
      this.commonObjs.clear();
      this.fontLoader.clear();
      this._methodPromises.clear();
      this.filterFactory.destroy(false);
      TextLayer.cleanup();

      this._networkStream?.cancelAllRequests(
        new AbortException("Worker was terminated.")
      );

      if (this.messageHandler) {
        this.messageHandler.destroy();
        this.messageHandler = null;
      }
      this.destroyCapability!.resolve(undefined);
    }, this.destroyCapability.reject);
    return this.destroyCapability.promise;
  }

  setupMessageHandler() {

    const { loadingTask } = this;

    const messageHandler = this.messageHandler!;

    messageHandler.onGetReader((_data, sink) => {
      assert(!!this._networkStream, "GetReader - no `IPDFStream` instance available.");
      this._fullReader = this._networkStream.getFullReader();
      this._fullReader.onProgress = (loaded, total) => this._lastProgress = { loaded, total };

      sink.onPull = () => {
        this._fullReader!.read().then(({ value, done }) => {
          if (done) {
            sink.close();
            return;
          }
          assert(value instanceof ArrayBuffer, "GetReader - expected an ArrayBuffer.");
          // Enqueue data chunk into sink, and transfer it
          // to other side as `Transferable` object.
          sink.enqueue(new Uint8Array<ArrayBuffer>(value!), 1, [value]);
        }).catch(reason => {
          sink.error(reason);
        });
      };

      sink.onCancel = (reason: Error) => {
        this._fullReader!.cancel(reason);
        sink.ready!.catch(readyReason => {
          if (this.destroyed) {
            return; // Ignore any pending requests if the worker was terminated.
          }
          throw readyReason;
        });
      };
    });

    messageHandler.onReaderHeadersReady(async () => {
      await this._fullReader!.headersReady;
      const { isStreamingSupported, isRangeSupported, contentLength } = this._fullReader!;
      // If stream or range are disabled, it's our only way to report
      // loading progress.
      if (!isStreamingSupported || !isRangeSupported) {
        if (this._lastProgress) {
          const progress = this._lastProgress;
          loadingTask.onProgress?.(progress.loaded, progress.total);
        }
        this._fullReader!.onProgress = (loaded, total) => {
          loadingTask.onProgress?.(loaded, total);
        };
      }
      return { isStreamingSupported, isRangeSupported, contentLength };
    });

    messageHandler.onGetRangeReader((data, sink) => {
      assert(!!this._networkStream, "GetRangeReader - no `IPDFStream` instance available.");
      const begin = data.begin, end = data.end;
      const rangeReader = this._networkStream.getRangeReader(begin, end);

      // When streaming is enabled, it's possible that the data requested here
      // has already been fetched via the `_fullRequestReader` implementation.
      // However, given that the PDF data is loaded asynchronously on the
      // main-thread and then sent via `postMessage` to the worker-thread,
      // it may not have been available during parsing (hence the attempt to
      // use range requests here).
      //
      // To avoid wasting time and resources here, we'll thus *not* dispatch
      // range requests if the data was already loaded but has not been sent to
      // the worker-thread yet (which will happen via the `_fullRequestReader`).
      if (!rangeReader) {
        sink.close();
        return;
      }

      sink.onPull = () => {
        rangeReader.read().then(({ value, done }) => {
          if (done) {
            sink.close();
            return;
          }
          assert(value instanceof ArrayBuffer, "GetRangeReader - expected an ArrayBuffer.");
          sink.enqueue(new Uint8Array<ArrayBuffer>(value!), 1, [value]);
        }).catch(reason => {
          sink.error(reason);
        });
      };

      sink.onCancel = (reason: Error) => {
        rangeReader.cancel(reason);

        sink.ready!.catch((readyReason: Error) => {
          if (this.destroyed) {
            return; // Ignore any pending requests if the worker was terminated.
          }
          throw readyReason;
        });
      };
    });

    messageHandler.onGetDoc((pdfInfo) => {
      this._numPages = pdfInfo.numPages;
      loadingTask._capability.resolve(new PDFDocumentProxy(pdfInfo, this));
    });

    // 这里不一定是BaseException
    messageHandler.onDocException(ex => {
      let reason;
      switch (ex.name) {
        case "PasswordException":
          reason = new PasswordException(ex.message, (ex as any).code);
          break;
        case "InvalidPDFException":
          reason = new InvalidPDFException(ex.message);
          break;
        case "MissingPDFException":
          reason = new MissingPDFException(ex.message);
          break;
        case "UnexpectedResponseException":
          reason = new UnexpectedResponseException(ex.message, (ex as any).status);
          break;
        case "UnknownErrorException":
          reason = new UnknownErrorException(ex.message, (ex as any).details);
          break;
        default:
          unreachable("DocException - expected a valid Error.");
      }
      loadingTask._capability.reject(reason);
    });

    messageHandler.onPasswordRequest(exception => {
      this._passwordCapability = Promise.withResolvers();

      if (loadingTask.onPassword) {
        const updatePassword = (password: string | Error) => {
          if (password instanceof Error) {
            this._passwordCapability!.reject(password);
          } else {
            this._passwordCapability!.resolve({ password });
          }
        };
        try {
          loadingTask.onPassword(updatePassword, exception.code);
        } catch (ex) {
          this._passwordCapability.reject(ex);
        }
      } else {
        this._passwordCapability.reject(
          new PasswordException(exception.message, exception.code)
        );
      }
      return this._passwordCapability.promise;
    });

    messageHandler.onDataLoaded(data => {
      // For consistency: Ensure that progress is always reported when the
      // entire PDF file has been loaded, regardless of how it was fetched.
      loadingTask.onProgress?.(data.length, data.length);
      this.downloadInfoCapability.resolve(data);
    });

    messageHandler.onStartRenderPage(data => {
      if (this.destroyed) {
        return; // Ignore any pending requests if the worker was terminated.
      }
      const page = this._pageCache.get(data.pageIndex)!;
      page._startRenderPage(data.transparency, data.cacheKey);
    });

    messageHandler.onCommonobj(([id, type, exportedData]) => {
      if (this.destroyed) {
        return null; // Ignore any pending requests if the worker was terminated.
      }

      if (this.commonObjs.has(id)) {
        return null;
      }

      switch (type) {
        case CommonObjType.Font:
          const { disableFontFace, fontExtraProperties } = this._params;
          if ("error" in exportedData!) {
            const exportedError = exportedData.error;
            warn(`Error during font loading: ${exportedError}`);
            this.commonObjs.resolve(id, exportedError);
            break;
          }

          // FontInspector 既然只在调试环境下有，那就删除了吧
          const fontExportData = <FontExportData | FontExportExtraData>exportedData;
          const font = new FontFaceObject(fontExportData, disableFontFace);

          this.fontLoader
            .bind(font)
            .catch(() => messageHandler.FontFallback(id))
            .finally(() => {
              if (!fontExtraProperties && font.translated.data) {
                // Immediately release the `font.data` property once the font
                // has been attached to the DOM, since it's no longer needed,
                // rather than waiting for a `PDFDocumentProxy.cleanup` call.
                // Since `font.data` could be very large, e.g. in some cases
                // multiple megabytes, this will help reduce memory usage.
                font.translated.data = null;
              }
              this.commonObjs.resolve(id, font);
            });
          break;
        case CommonObjType.CopyLocalImage:
          const { imageRef } = <{ imageRef: string }>exportedData!;
          assert(!!imageRef, "The imageRef must be defined.");

          for (const pageProxy of this._pageCache.values()) {
            for (const [, data] of pageProxy.objs) {
              if (data?.ref !== imageRef) {
                continue;
              }
              if (!data.dataLen) {
                return null;
              }
              this.commonObjs.resolve(id, structuredClone(data));
              return data.dataLen;
            }
          }
          break;
        case CommonObjType.FontPath:
        case CommonObjType.Image:
        case CommonObjType.Pattern:
          this.commonObjs.resolve(id, exportedData);
          break;
        default:
          throw new Error(`Got unknown common object type ${type}`);
      }

      return null;
    });

    messageHandler.onObj(([id, pageIndex, type, imageData]) => {
      if (this.destroyed) {
        // Ignore any pending requests if the worker was terminated.
        return;
      }

      const pageProxy = this._pageCache.get(pageIndex)!;
      if (pageProxy.objs.has(id)) {
        return;
      }
      // Don't store data *after* cleanup has successfully run, see bug 1854145.
      if (pageProxy._intentStates.size === 0) {
        if (type === ObjType.Image) {
          const tmp = <ImageMask | null>imageData;
          tmp?.bitmap?.close(); // Release any `ImageBitmap` data.
        }
        return;
      }

      switch (type) {
        case ObjType.Image:
          const tmp = <ImageMask | null>imageData;
          pageProxy.objs.resolve(id, tmp);

          // Heuristic that will allow us not to store large data.
          if (tmp?.dataLen! > MAX_IMAGE_SIZE_TO_CACHE) {
            pageProxy._maybeCleanupAfterRender = true;
          }
          break;
        case ObjType.Pattern:
          pageProxy.objs.resolve(id, imageData);
          break;
        default:
          throw new Error(`Got unknown object type ${type}`);
      }
    });

    messageHandler.onDocProgress(data => {
      if (this.destroyed) {
        return; // Ignore any pending requests if the worker was terminated.
      }
      loadingTask.onProgress?.(data.loaded, data.total);
    });

    messageHandler.onFetchBuiltInCMap(data => {
      if (PlatformHelper.isMozCental()) {
        throw new Error("Not implemented: FetchBuiltInCMap");
      }
      if (this.destroyed) {
        throw new Error("Worker was destroyed.");
      }
      if (!this.cMapReaderFactory) {
        throw new Error(
          "CMapReaderFactory not initialized, see the `useWorkerFetch` parameter."
        );
      }
      return this.cMapReaderFactory.fetch(data.name);
    });

    messageHandler.onFetchStandardFontData(async data => {
      if (PlatformHelper.isMozCental()) {
        throw new Error("Not implemented: FetchStandardFontData");
      }
      if (this.destroyed) {
        throw new Error("Worker was destroyed.");
      }
      if (!this.standardFontDataFactory) {
        const error = "StandardFontDataFactory not initialized, see the `useWorkerFetch` parameter."
        throw new Error(error);
      }
      return this.standardFontDataFactory.fetch(data.filename);
    });
  }

  getData() {
    return this.messageHandler!.GetData();
  }

  async saveDocument() {

    if (this.annotationStorage.size <= 0) {
      let warning = "saveDocument called while `annotationStorage` is empty, ";
      warning += "please use the getData-method instead.";
      warn(warning);
    }

    const { map, transfer } = this.annotationStorage.serializable;
    const numPages = this._numPages;
    const filename = this._fullReader?.filename ?? null;

    return this.messageHandler!.saveDocument(numPages, map, filename, transfer).finally(() => {
      this.annotationStorage.resetModified();
    });
  }

  getPage(pageNumber: number) {
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber <= 0 ||
      pageNumber > this._numPages!
    ) {
      return Promise.reject(new Error("Invalid page request."));
    }

    const pageIndex = pageNumber - 1;
    const cachedPromise = this._pagePromises.get(pageIndex);
    if (cachedPromise) {
      return cachedPromise;
    }
    const promise = this.messageHandler!.GetPage(pageIndex).then(pageInfo => {
      if (this.destroyed) {
        throw new Error("Transport destroyed");
      }
      if (pageInfo.refStr) {
        this._pageRefCache.set(pageInfo.refStr, pageNumber);
      }
      const pdfBug = this._params.pdfBug;
      const page = new PDFPageProxy(pageIndex, pageInfo, this, pdfBug);
      this._pageCache.set(pageIndex, page);
      return page;
    });
    this._pagePromises.set(pageIndex, promise);
    return promise;
  }

  getPageIndex(ref: RefProxy) {
    if (!isRefProxy(ref)) {
      return Promise.reject(new Error("Invalid pageIndex request."));
    }
    return this.messageHandler!.GetPageIndex(ref.num, ref.gen);
  }

  getAnnotations(pageIndex: number, intent: number) {
    return this.messageHandler!.GetAnnotations(pageIndex, intent);
  }

  getFieldObjects() {
    const action = MessageHandlerAction.GetFieldObjects;
    const handler = this.messageHandler!;
    return this._cacheSimpleMethod(action, () => handler.GetFieldObjects());
  }

  hasJSActions() {
    const action = MessageHandlerAction.HasJSActions;
    const handler = this.messageHandler!;
    return this._cacheSimpleMethod(action, () => handler.HasJSActions());
  }

  getCalculationOrderIds() {
    return this.messageHandler!.GetCalculationOrderIds();
  }

  getDestinations() {
    return this.messageHandler!.GetDestinations();
  }

  getDestination(id: string) {
    if (typeof id !== "string") {
      return Promise.reject(new Error("Invalid destination request."));
    }
    return this.messageHandler!.GetDestination(id);
  }

  getPageLabels() {
    return this.messageHandler!.GetPageLabels();
  }

  getPageLayout() {
    return this.messageHandler!.GetPageLayout();
  }

  getPageMode() {
    return this.messageHandler!.GetPageMode();
  }

  getViewerPreferences() {
    return this.messageHandler!.GetViewerPreferences();
  }

  getOpenAction() {
    return this.messageHandler!.GetOpenAction();
  }

  getAttachments() {
    return this.messageHandler!.GetAttachments();
  }

  getDocJSActions() {
    const handler = this.messageHandler!;
    const action = MessageHandlerAction.GetDocJSActions;
    return this._cacheSimpleMethod(action, () => handler.GetDocJSActions());
  }

  getPageJSActions(pageIndex: number) {
    return this.messageHandler!.GetPageJSActions(pageIndex);
  }

  getStructTree(pageIndex: number): Promise<StructTreeSerialNode | null> {
    return this.messageHandler!.GetStructTree(pageIndex)
  }

  getOutline() {
    return this.messageHandler!.GetOutline();
  }

  async getOptionalContentConfig(renderingIntent: number): Promise<OptionalContentConfig> {
    const action = MessageHandlerAction.GetOptionalContentConfig;
    const handler = this.messageHandler!;
    return this._cacheSimpleMethod(action, () => handler.GetOptionalContentConfig()).then(
      data => new OptionalContentConfig(data, renderingIntent)
    );
  }

  getPermissions() {
    return this.messageHandler!.GetPermissions();
  }

  getMetadata(): Promise<WorkerTransportMetadata> {
    const name = MessageHandlerAction.GetMetadata;
    const cachedPromise = this._methodPromises.get(name);
    if (cachedPromise) {
      return <Promise<WorkerTransportMetadata>>cachedPromise;
    }
    const promise = this.messageHandler!.GetMetadata().then(results => ({
      info: results[0],
      metadata: results[1] ? new Metadata(results[1].parsedData, results[1].rawData) : null,
      contentDispositionFilename: this._fullReader?.filename ?? null,
      contentLength: this._fullReader?.contentLength ?? null,
    }));
    this._methodPromises.set(name, promise);
    return promise;
  }

  getMarkInfo() {
    return this.messageHandler!.GetMarkInfo();
  }

  async startCleanup(keepLoadedFonts = false) {
    if (this.destroyed) {
      return; // No need to manually clean-up when destruction has started.
    }
    await this.messageHandler!.Cleanup();

    for (const page of this._pageCache.values()) {
      const cleanupSuccessful = page.cleanup();

      if (!cleanupSuccessful) {
        throw new Error(
          `startCleanup: Page ${page.pageNumber} is currently rendering.`
        );
      }
    }
    this.commonObjs.clear();
    if (!keepLoadedFonts) {
      this.fontLoader.clear();
    }
    this._methodPromises.clear();
    this.filterFactory.destroy(/* keepHCM = */ true);
    TextLayer.cleanup();
  }

  cachedPageNumber(ref: RefProxy) {
    if (!isRefProxy(ref)) {
      return null;
    }
    const refStr = ref.gen === 0 ? `${ref.num}R` : `${ref.num}R${ref.gen}`;
    return this._pageRefCache.get(refStr) ?? null;
  }
}

const INITIAL_DATA = Symbol("INITIAL_DATA");

interface PDFObjectData {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
  data: any;
}

/**
 * A PDF document and page is built of many objects. E.g. there are objects for
 * fonts, images, rendering code, etc. These objects may get processed inside of
 * a worker. This class implements some basic methods to manage these objects.
 */
export class PDFObjects {
  #objs = Object.create(null);

  /**
   * Ensures there is an object defined for `objId`.
   *
   * @param {string} objId
   * @returns {Object}
   */
  #ensureObj(objId: string): PDFObjectData {
    return (this.#objs[objId] ||= {
      ...Promise.withResolvers(),
      data: INITIAL_DATA,
    });
  }

  /**
   * If called *without* callback, this returns the data of `objId` but the
   * object needs to be resolved. If it isn't, this method throws.
   *
   * If called *with* a callback, the callback is called with the data of the
   * object once the object is resolved. That means, if you call this method
   * and the object is already resolved, the callback gets called right away.
   *
   * @param {string} objId
   * @param {function} [callback]
   * @returns {any}
   */
  get(objId: string, callback: ((data: any) => void) | null = null) {
    // If there is a callback, then the get can be async and the object is
    // not required to be resolved right now.
    if (callback) {
      const obj = this.#ensureObj(objId);
      obj.promise.then(() => callback(obj.data));
      return null;
    }
    // If there isn't a callback, the user expects to get the resolved data
    // directly.
    const obj = this.#objs[objId];
    // If there isn't an object yet or the object isn't resolved, then the
    // data isn't ready yet!
    if (!obj || obj.data === INITIAL_DATA) {
      throw new Error(`Requesting object that isn't resolved yet ${objId}.`);
    }
    return obj.data;
  }

  /**
   * @param {string} objId
   * @returns {boolean}
   */
  has(objId: string): boolean {
    const obj = this.#objs[objId];
    return !!obj && obj.data !== INITIAL_DATA;
  }

  /**
   * Resolves the object `objId` with optional `data`.
   *
   * @param {string} objId
   * @param {any} [data]
   */
  resolve(objId: string, data: any = null) {
    const obj = this.#ensureObj(objId);
    obj.data = data;
    obj.resolve();
  }

  clear() {
    for (const objId in this.#objs) {
      const { data } = this.#objs[objId];
      data?.bitmap?.close(); // Release any `ImageBitmap` data.
    }
    this.#objs = Object.create(null);
  }

  *[Symbol.iterator]() {
    for (const objId in this.#objs) {
      const { data } = this.#objs[objId];

      if (data === INITIAL_DATA) {
        continue;
      }
      yield [objId, data];
    }
  }
}

/**
 * Allows controlling of the rendering tasks.
 */
class RenderTask {

  protected _internalRenderTask: InternalRenderTask;

  onContinue: ((fn: () => void) => void) | null;

  constructor(internalRenderTask: InternalRenderTask) {
    this._internalRenderTask = internalRenderTask;

    /**
     * Callback for incremental rendering -- a function that will be called
     * each time the rendering is paused.  To continue rendering call the
     * function that is the first argument to the callback.
     * @type {function}
     */
    this.onContinue = null;
  }

  /**
   * Promise for rendering task completion.
   * @type {Promise<void>}
   */
  get promise() {
    return this._internalRenderTask.capability.promise;
  }

  /**
   * Cancels the rendering task. If the task is currently rendering it will
   * not be cancelled until graphics pauses with a timeout. The promise that
   * this object extends will be rejected when cancelled.
   *
   * @param {number} [extraDelay]
   */
  cancel(extraDelay: number = 0) {
    this._internalRenderTask.cancel(/* error = */ null, extraDelay);
  }

  /**
   * Whether form fields are rendered separately from the main operatorList.
   * @type {boolean}
   */
  get separateAnnots() {
    const { separateAnnots } = this._internalRenderTask.operatorList;
    if (!separateAnnots) {
      return false;
    }
    const { annotationCanvasMap } = this._internalRenderTask;
    return (
      separateAnnots.form ||
      (separateAnnots.canvas && annotationCanvasMap && annotationCanvasMap.size > 0)
    );
  }
}

interface InternalRenderTaskParameter {

  canvasContext: CanvasRenderingContext2D;

  viewport: PageViewport;

  transform: TransformType | null;

  background: CanvasGradient | CanvasPattern | string | null;

}

/**
 * For internal use only.
 * @ignore
 */
class InternalRenderTask {

  #rAF: number | null = null;

  static #canvasInUse = new WeakSet();

  protected callback: (err?: Error) => void;

  protected params: InternalRenderTaskParameter;

  protected objs: PDFObjects;

  protected commonObjs: PDFObjects;

  public annotationCanvasMap: Map<string, HTMLCanvasElement> | null;

  protected operatorListIdx: number | null = null;

  public operatorList: IntentStateOperatorList;

  protected _pageIndex: number;

  protected canvasFactory: CanvasFactory;

  protected filterFactory: FilterFactory;

  protected _pdfBug: boolean;

  protected pageColors: { background: string; foreground: string; } | null;

  protected running = false;

  protected graphicsReadyCallback: (() => void) | null;

  protected graphicsReady = false;

  protected _useRequestAnimationFrame: boolean;

  protected cancelled = false;

  public capability = Promise.withResolvers();

  public task: RenderTask;

  protected _cancelBound: (error?: null, extraDelay?: number) => void;

  protected _continueBound: () => void;

  protected _scheduleNextBound: () => void;

  protected _nextBound: () => Promise<void>;

  protected _canvas: HTMLCanvasElement;

  protected gfx: CanvasGraphics | null = null;

  constructor(
    callback: (err?: Error) => void,
    params: InternalRenderTaskParameter,
    objs: PDFObjects,
    commonObjs: PDFObjects,
    annotationCanvasMap: Map<string, HTMLCanvasElement> | null,
    operatorList: IntentStateOperatorList,
    pageIndex: number,
    canvasFactory: CanvasFactory,
    filterFactory: FilterFactory,
    useRequestAnimationFrame = false,
    pdfBug = false,
    pageColors: { background: string; foreground: string; } | null = null,
  ) {
    this.callback = callback;
    this.params = params;
    this.objs = objs;
    this.commonObjs = commonObjs;
    this.annotationCanvasMap = annotationCanvasMap;
    this.operatorListIdx = null;
    this.operatorList = operatorList;
    this._pageIndex = pageIndex;
    this.canvasFactory = canvasFactory;
    this.filterFactory = filterFactory;
    this._pdfBug = pdfBug;
    this.pageColors = pageColors;

    this.graphicsReadyCallback = null;

    this._useRequestAnimationFrame = useRequestAnimationFrame === true && typeof window !== "undefined";

    this.task = new RenderTask(this);

    // caching this-bound methods
    this._cancelBound = this.cancel.bind(this);

    this._continueBound = this._continue.bind(this);

    this._scheduleNextBound = this._scheduleNext.bind(this);

    this._nextBound = this._next.bind(this);

    this._canvas = params.canvasContext.canvas;
  }

  get completed() {
    return this.capability.promise.catch(function () {
      // Ignoring errors, since we only want to know when rendering is
      // no longer pending.
    });
  }

  initializeGraphics(transparency: boolean, optionalContentConfig: OptionalContentConfig) {
    if (this.cancelled) {
      return;
    }
    if (this._canvas) {
      if (InternalRenderTask.#canvasInUse.has(this._canvas)) {
        throw new Error(
          "Cannot use the same canvas during multiple render() operations. " +
          "Use different canvas or ensure previous operations were " +
          "cancelled or completed."
        );
      }
      InternalRenderTask.#canvasInUse.add(this._canvas);
    }

    const { canvasContext, viewport, transform, background } = this.params;

    this.gfx = new CanvasGraphics(
      canvasContext,
      this.commonObjs,
      this.objs,
      this.canvasFactory,
      this.filterFactory,
      optionalContentConfig,
      null,
      this.annotationCanvasMap,
      this.pageColors
    );
    this.gfx.beginDrawing(transform, viewport, transparency, background);
    this.operatorListIdx = 0;
    this.graphicsReady = true;
    this.graphicsReadyCallback?.();
  }

  cancel(error = null, extraDelay = 0) {
    this.running = false;
    this.cancelled = true;
    this.gfx?.endDrawing();
    if (this.#rAF) {
      window.cancelAnimationFrame(this.#rAF);
      this.#rAF = null;
    }
    InternalRenderTask.#canvasInUse.delete(this._canvas);

    this.callback(
      error ||
      new RenderingCancelledException(
        `Rendering cancelled, page ${this._pageIndex + 1}`,
        extraDelay
      )
    );
  }

  operatorListChanged() {
    if (!this.graphicsReady) {
      this.graphicsReadyCallback ||= this._continueBound;
      return;
    }
    if (this.running) {
      return;
    }
    this._continue();
  }

  _continue() {
    this.running = true;
    if (this.cancelled) {
      return;
    }
    if (this.task.onContinue) {
      this.task.onContinue(this._scheduleNextBound);
    } else {
      this._scheduleNext();
    }
  }

  _scheduleNext() {
    if (this._useRequestAnimationFrame) {
      this.#rAF = window.requestAnimationFrame(() => {
        this.#rAF = null;
        this._nextBound().catch(this._cancelBound);
      });
    } else {
      Promise.resolve().then(this._nextBound).catch(this._cancelBound);
    }
  }

  async _next() {
    if (this.cancelled) {
      return;
    }
    this.operatorListIdx = this.gfx!.executeOperatorList(
      this.operatorList,
      this.operatorListIdx!,
      this._continueBound
    );
    if (this.operatorListIdx === this.operatorList.argsArray.length) {
      this.running = false;
      if (this.operatorList.lastChunk) {
        this.gfx!.endDrawing();
        InternalRenderTask.#canvasInUse.delete(this._canvas);
        this.callback();
      }
    }
  }
}

export {
  DefaultCanvasFactory,
  DefaultCMapReaderFactory,
  DefaultFilterFactory,
  DefaultStandardFontDataFactory,
  getDocument,
  LoopbackPort,
  PDFDataRangeTransport,
  PDFDocumentProxy,
  PDFWorker,
  RenderTask
};

