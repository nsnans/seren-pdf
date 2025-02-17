import { getDocument, PDFDocumentLoadingTask, PDFDocumentProxy } from "../../display/api";
import { isDataScheme } from "../../display/display_utils";
import { PlatformHelper } from "../../platform/platform_helper";
import { AltTextManager } from "./alt_text_manager";
import { DownloadManager } from "./download_manager";
import { PDFContentFindService } from "./find_service";
import { GenericL10n } from "./genericl10n";
import { GenericWebViewOutlineManager as DefaultWebViewOutlineManager } from "./outline_manager";
import { OverlayManager } from "./overlay_manager";
import { WebPageViewManager } from "./page_view_manager";
import { DefaultWebViewerPDFAttachmentManager } from "./pdf_attachment_manager";
import { GenericWebViewPDFLayerManager as DefaultWebViewPDFLayerManager } from "./pdf_layer_manager";
import { PDFLinkService } from "./pdf_link_service";
import { PDFScriptingManager } from "./pdf_scripting_manager";
import { GenericWebThumbnailViewService, WebThumbnailViewService } from './thumbnail_view_service';
import { PDFRenderingManager } from "./view_rendering_manager";
import { WebPDFViewerCallbackManager } from "./viewer_callback_manager";
import { WebPDFViewerContext } from "./viewer_context";
import { WebViewerCursorManager } from "./viewer_cursor_manager";
import { WebPDFViewerOptions } from "./viewer_options";

export class WebPDFViewerBuilder {

}

enum PDFSource {
  /** PDF尚未加载 */
  UNLOAD = 0,
  /** 加载了本地的PDF */
  LOCAL = 1,
  /**  通过网络加载的PDF */
  NETWORK = 2,
}

export class WebPDFViewer {

  protected viewerContext: WebPDFViewerContext;

  protected viewerOptions: WebPDFViewerOptions;

  protected callbackManager: WebPDFViewerCallbackManager;

  protected viewerContainer: HTMLDivElement;

  protected pdfDocument: PDFDocumentProxy | null = null;

  protected pdfLoadingTask: PDFDocumentLoadingTask | null = null;

  protected pageViewManager: WebPageViewManager;

  protected pdfSource = PDFSource.UNLOAD;

  protected thumbnailService: WebThumbnailViewService | null;

  protected renderingManager = new PDFRenderingManager();

  protected linkService: PDFLinkService;

  protected findService: PDFContentFindService;

  protected outlineManager = new DefaultWebViewOutlineManager();

  protected pdfLayerManager = new DefaultWebViewPDFLayerManager();

  protected cursorManager: WebViewerCursorManager;

  protected pdfScriptingManager: PDFScriptingManager;

  protected downloadManager = new DownloadManager();

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

    const pdfLinkService = new PDFLinkService(
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

  async open() {
    if (this.pdfLoadingTask) {
      await this.close();
    }

    const loadingTask = getDocument({});

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

    if (PlatformHelper.isChrome()) {
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
}
