import {
  AltTextManager,
  BrowserUtil,
  DEFAULT_RANGE_CHUNK_SIZE,
  DocumentInitParameters,
  DOMCanvasFactory,
  DOMCMapReaderFactory,
  DOMFilterFactory,
  DOMStandardFontDataFactory,
  getDocument,
  isDataScheme,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "seren-viewer";
import { VerbosityLevel } from "seren-common";
import { WebDownloadManager } from "./download_manager";
import { PDFContentFindService } from "./find_service";
import { GenericL10n } from "./genericl10n";
import { GenericWebViewOutlineManager as DefaultWebViewOutlineManager } from "./outline_manager";
import { OverlayManager } from "./overlay_manager";
import { WebPageViewManager } from "./page_view_manager";
import { DefaultWebViewerPDFAttachmentManager } from "./pdf_attachment_manager";
import { GenericWebViewPDFLayerManager as DefaultWebViewPDFLayerManager } from "./pdf_layer_manager";
import { WebPDFLinkService } from "./pdf_link_service";
import { PDFScriptingManager } from "./pdf_scripting_manager";
import { PDFRenderingManager } from "./rendering_manager";
import { GenericWebThumbnailViewService, WebThumbnailViewService } from './thumbnail_view_service';
import { WebViewerCallbackManager } from "./viewer_callback_manager";
import { WebPDFViewerContext } from "./viewer_context";
import { WebViewerCursorManager } from "./viewer_cursor_manager";
import { WebPDFViewerOptions } from "./viewer_options";

export interface OpenDocumentArgs {
  url: string;
  originalUrl: string;
  data: string | Uint8Array<ArrayBuffer>;
  filename: string;
  httpHeaders: Record<string, string>;
}

enum PDFSource {
  /** PDF尚未加载 */
  UNLOAD = 0,
  /** 加载了本地的PDF */
  LOCAL = 1,
  /**  通过网络加载的PDF */
  NETWORK = 2
}

export class WebPDFViewer {

  protected viewerContext: WebPDFViewerContext;

  protected viewerOptions: WebPDFViewerOptions;

  protected callbackManager: WebViewerCallbackManager;

  protected viewerContainer: HTMLDivElement;

  protected pdfDocument: PDFDocumentProxy | null = null;

  protected pdfLoadingTask: PDFDocumentLoadingTask | null = null;

  protected pageViewManager: WebPageViewManager;

  protected pdfSource = PDFSource.UNLOAD;

  protected thumbnailService: WebThumbnailViewService | null;

  protected renderingManager = new PDFRenderingManager();

  protected linkService: WebPDFLinkService;

  protected findService: PDFContentFindService;

  protected outlineManager = new DefaultWebViewOutlineManager();

  protected pdfLayerManager = new DefaultWebViewPDFLayerManager();

  protected cursorManager: WebViewerCursorManager;

  protected pdfScriptingManager = new PDFScriptingManager();

  protected downloadManager = new WebDownloadManager();

  protected overlayManager = new OverlayManager();

  protected l10n = new GenericL10n();

  protected isInitialViewSet = false;

  protected url = "";

  protected baseUrl = "";

  protected _downloadUrl = "";

  protected _globalAbortController = new AbortController();

  protected _saveInProgress = false;

  protected _wheelUnusedTicks = 0;

  protected _wheelUnusedFactor = 1;

  protected _touchUnusedTicks = 0;

  protected _touchUnusedFactor = 1;

  protected _hasAnnotationEditors = false;

  protected _isCtrlKeyDown = false;

  protected _isScrolling = false;

  protected pdfAttachmentManager = new DefaultWebViewerPDFAttachmentManager();

  protected altTextManager: AltTextManager | null = null;

  protected _contentLength: number = -1;

  constructor(
    viewerContext: WebPDFViewerContext,
    viewerContainer: HTMLDivElement,
  ) {
    this.viewerContext = viewerContext;
    this.callbackManager = viewerContext.getCallbackManager();
    const options = this.viewerOptions = viewerContext.getViewerOptions();
    // 等待从localStorage中读取属性，这个原来有，但是现在暂时不用了，这个活儿不应该由我来干。
    this.viewerContainer = viewerContainer;
    this.pageViewManager = this.initPageViewManager();
    this.cursorManager = new WebViewerCursorManager(this.viewerContainer);

    const pdfLinkService = new WebPDFLinkService(
      options.externalLinkTarget,
      options.externalLinkRel,
      options.ignoreDestinationZoom,
    );

    this.linkService = pdfLinkService;
    this.findService = new PDFContentFindService(pdfLinkService);

    this.thumbnailService = options.enableThumbnailView ? new GenericWebThumbnailViewService() : null;
  }

  initPageViewManager() {
    const pageViewManager = new WebPageViewManager(
      this.viewerContainer,
      this.linkService,
      this.downloadManager,
      this.findService,
      this.altTextManager!,
      this.renderingManager,
      this.viewerOptions,
      this.l10n,
    )
    return pageViewManager;
  }

  async open(args: Partial<OpenDocumentArgs>) {
    // 如果已经打开了一个pdf文件，那么需要先关闭这个PDF文件
    if (this.pdfLoadingTask) {
      await this.close();
    }

    const params = this.initDocumentParameters(args);

    const loadingTask = getDocument(params);

    // 这里不太好，我觉得还是直接放入参数中，更好一些。
    loadingTask.onPassword = (_updateCallback, _reason) => {
      // 处理要输入密码的情况
      // 同样的，这边要API化，即可以让用户自己实现密码的管理，我们只要返回值
    }

    loadingTask.onProgress = (_loaded, _total) => {
      // 同样的，交给用户自己去展示，我们只是一味回调
    }
    return loadingTask.promise.then(
      pdfDocument => this.load(pdfDocument),
      _reason => {
        // 完善这里的错误处理
      }
    )
  }

  load(pdfDocument: PDFDocumentProxy) {
    this.pdfDocument = pdfDocument;
    pdfDocument.getDownloadInfo().then(({ length }) => {
      this._contentLength = length; // Ensure that the correct length is used.
    });

    if (BrowserUtil.isChrome()) {
      const baseUrl = location.href.split("#", 1)[0];
      // Ignore "data:"-URLs for performance reasons, even though it may cause
      // internal links to not work perfectly in all cases (see bug 1803050).
      this.linkService.setDocument(
        pdfDocument,
        isDataScheme(baseUrl) ? null : baseUrl
      );
    } else {
      this.linkService.setDocument(pdfDocument);
    }

    const pdfViewManager = this.pageViewManager;
    pdfViewManager.setDocument(pdfDocument);
  }


  // 关闭当前的pdf页面
  async close() {

  }

  protected initDocumentParameters(args: Partial<OpenDocumentArgs>): DocumentInitParameters {
    const params: DocumentInitParameters = {
      url: args.url ?? null,
      data: args.data ?? null,
      httpHeaders: args.httpHeaders ?? null,
      withCredentials: false,
      password: null,
      length: null,
      range: null,
      rangeChunkSize: DEFAULT_RANGE_CHUNK_SIZE,
      worker: null,
      verbosity: VerbosityLevel.ERRORS,
      docBaseUrl: null,
      cMapUrl: null,
      cMapPacked: true,
      CMapReaderFactory: DOMCMapReaderFactory,
      useSystemFonts: true,
      standardFontDataUrl: null,
      StandardFontDataFactory: DOMStandardFontDataFactory,
      useWorkerFetch: true,
      stopAtErrors: false,
      maxImageSize: -1,
      isEvalSupported: true,
      isOffscreenCanvasSupported: true,
      isChrome: BrowserUtil.isChrome(),
      canvasMaxAreaInBytes: -1,
      disableFontFace: false,
      fontExtraProperties: false,
      document: globalThis.document,
      disableRange: false,
      disableStream: false,
      disableAutoFetch: false,
      CanvasFactory: DOMCanvasFactory,
      FilterFactory: DOMFilterFactory,
      enableHWA: false,
      workerOptions: {
        workerPort: null,
        workerSrc: ""
      }
    }
    return params;
  }
}
