import { getDocument, PDFDocumentLoadingTask, PDFDocumentProxy } from "../../display/api";
import { AnnotationEditorParams } from "../../display/editor/annotation_editor_params";
import { DownloadManager, IL10n } from "../common/component_types";
import { ScrollMode, SidebarView, SpreadMode } from "../common/ui_utils";
import { ImageAltTextSettings } from "./new_alt_text_manager";
import { OverlayManager } from "./overlay_manager";
import { WebPageViewManager } from "./page_view_manager";
import { PDFDocumentProperties } from "./pdf_document_properties";
import { PDFLayerViewer } from "./pdf_layer_viewer";
import { PDFLinkService } from "./pdf_link_service";
import { PDFOutlineViewer } from "./pdf_outline_viewer";
import { PDFPresentationMode } from "./pdf_presentation_mode";
import { PDFRenderingQueue } from "./pdf_rendering_queue";
import { PDFScriptingManager } from "./pdf_scripting_manager";
import { PDFSidebar } from "./pdf_sidebar";
import { WebPDFThumbnailService } from "./thumbnail_service";
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

  protected thumbnailService: WebPDFThumbnailService | null;

  protected pdfRenderingQueue: PDFRenderingQueue;

  protected pdfPresentationMode: PDFPresentationMode;

  protected pdfDocumentProperties: PDFDocumentProperties;

  protected linkService: PDFLinkService;

  protected pdfSidebar: PDFSidebar;

  protected pdfOutlineViewer: PDFOutlineViewer;

  protected pdfLayerViewer: PDFLayerViewer;

  protected cursorManager: WebViewerCursorManager;

  protected pdfScriptingManager: PDFScriptingManager;

  protected downloadManager: DownloadManager;

  protected overlayManager: OverlayManager;

  protected l10n: IL10n;

  protected annotationEditorParams: AnnotationEditorParams;

  protected imageAltTextSettings: ImageAltTextSettings;

  protected isInitialViewSet: false;

  protected url: "";

  protected baseUrl: "";

  protected _downloadUrl: "";

  protected _eventBusAbortController: null;

  protected _windowAbortController: null;

  protected _globalAbortController = new AbortController();

  protected documentInfo: null;

  protected metadata: null;

  protected _contentDispositionFilename: null;

  protected _contentLength: number | null;

  protected _saveInProgress = false;

  protected _wheelUnusedTicks = 0;

  protected _wheelUnusedFactor = 1;

  protected _touchUnusedTicks = 0;

  protected _touchUnusedFactor = 1;

  protected _hasAnnotationEditors = false;

  protected _printAnnotationStoragePromise: null;

  protected _touchInfo: null;

  protected _isCtrlKeyDown = false;

  protected _caretBrowsing: null;

  protected _isScrolling = false;

  protected pdfAttachmentViewer: any;

  constructor(
    viewerContext: WebPDFViewerContext,
    viewerContainer: HTMLDivElement,
  ) {
    this.viewerContext = viewerContext;
    const callbackManager = this.callbackManager = viewerContext.getCallbackManager();
    const viewerOptions = this.viewerOptions = viewerContext.getViewerOptions();
    // 等待从localStorage中读取属性，这个原来有，但是现在暂时不用了，这个活儿不应该由我来干。
    this.viewerContainer = viewerContainer;
    this.pageViewManager = this.initPageViewManager();

    const pdfLinkService = new PDFLinkService(
      viewerOptions.externalLinkTarget,
      viewerOptions.externalLinkRel,
      viewerOptions.ignoreDestinationZoom,
    );

    this.linkService = pdfLinkService;

    this.thumbnailService = viewerOptions.enableThumbnailView ? new WebPDFThumbnailService() : null;
    this.pdfDocumentProperties = new PDFDocumentProperties();

  }

  initPageViewManager() {
    const viewerOptions = this.viewerOptions;
    return new WebPageViewManager(
      this.viewerContainer,
      viewerOptions.maxCanvasPixels,
    );
  }

  async open(args) {
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

      firstPagePromise.then(() => {
        this.eventBus.dispatch("documentloaded", { source: this });
      });

    });

    // Since the `setInitialView` call below depends on this being resolved,
    // fetch it early to avoid delaying initial rendering of the PDF document.
    const pageLayoutPromise = pdfDocument.getPageLayout().catch(() => {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const pageModePromise = pdfDocument.getPageMode().catch(() => {
      /* Avoid breaking initial rendering; ignoring errors. */
    });
    const openActionPromise = pdfDocument.getOpenAction().catch(() => {
      /* Avoid breaking initial rendering; ignoring errors. */
    });


    if (typeof PDFJSDev !== "undefined" && PDFJSDev.test("CHROME")) {
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
    this.pdfDocumentProperties?.setDocument(pdfDocument);

    const pdfViewer = this.pageViewManager;
    pdfViewer.setDocument(pdfDocument);
    const { firstPagePromise, onePageRendered, pagesPromise } = pdfViewer;

    this.pdfThumbnailViewer?.setDocument(pdfDocument);

    const storedPromise = (this.store = new ViewHistory(
      pdfDocument.fingerprints[0]
    )).getMultiple({
      page: null,
      zoom: DEFAULT_SCALE_VALUE,
      scrollLeft: "0",
      scrollTop: "0",
      rotation: null,
      sidebarView: SidebarView.UNKNOWN,
      scrollMode: ScrollMode.UNKNOWN,
      spreadMode: SpreadMode.UNKNOWN,
    })
      .catch(() => {
        /* Unable to read from storage; ignoring errors. */
      });

    firstPagePromise.then(_pdfPage => {
      this.loadingBar?.setWidth(this.appConfig.viewerContainer);
      this._initializeAnnotationStorageCallbacks(pdfDocument);

      Promise.all([
        animationStarted,
        storedPromise,
        pageLayoutPromise,
        pageModePromise,
        openActionPromise,
      ] as const).then(async ([_timeStamp, stored, pageLayout, pageMode, openAction]) => {
        const viewOnLoad = AppOptions.get("viewOnLoad");

        this._initializePdfHistory({
          fingerprint: pdfDocument.fingerprints[0],
          viewOnLoad,
          initialDest: openAction?.dest,
        });
        const initialBookmark = this.initialBookmark;

        // Initialize the default values, from user preferences.
        const zoom = AppOptions.get("defaultZoomValue");
        let hash = zoom ? `zoom=${zoom}` : null;

        let rotation = null;
        let sidebarView = AppOptions.get("sidebarViewOnLoad");
        let scrollMode = AppOptions.get("scrollModeOnLoad");
        let spreadMode = AppOptions.get("spreadModeOnLoad");

        if (stored?.page && viewOnLoad !== ViewOnLoad.INITIAL) {
          hash =
            `page=${stored.page}&zoom=${zoom || stored.zoom},` +
            `${stored.scrollLeft},${stored.scrollTop}`;

          rotation = parseInt(stored.rotation, 10);
          // Always let user preference take precedence over the view history.
          if (sidebarView === SidebarView.UNKNOWN) {
            sidebarView = stored.sidebarView | 0;
          }
          if (scrollMode === ScrollMode.UNKNOWN) {
            scrollMode = stored.scrollMode | 0;
          }
          if (spreadMode === SpreadMode.UNKNOWN) {
            spreadMode = stored.spreadMode | 0;
          }
        }
        // Always let the user preference/view history take precedence.
        if (pageMode && sidebarView === SidebarView.UNKNOWN) {
          sidebarView = apiPageModeToSidebarView(pageMode);
        }
        if (
          pageLayout &&
          scrollMode === ScrollMode.UNKNOWN &&
          spreadMode === SpreadMode.UNKNOWN
        ) {
          const modes = apiPageLayoutToViewerModes(pageLayout);
          // TODO: Try to improve page-switching when using the mouse-wheel
          // and/or arrow-keys before allowing the document to control this.
          // scrollMode = modes.scrollMode;
          spreadMode = modes.spreadMode;
        }

        this.setInitialView(hash, {
          rotation,
          sidebarView,
          scrollMode,
          spreadMode,
        });
        this.eventBus.dispatch("documentinit", { source: this });
        // Make all navigation keys work on document load,
        // unless the viewer is embedded in a web page.
        if (!this.isViewerEmbedded) {
          pdfViewer.focus();
        }

        // For documents with different page sizes, once all pages are
        // resolved, ensure that the correct location becomes visible on load.
        // (To reduce the risk, in very large and/or slow loading documents,
        //  that the location changes *after* the user has started interacting
        //  with the viewer, wait for either `pagesPromise` or a timeout.)
        await Promise.race([
          pagesPromise,
          new Promise(resolve => {
            setTimeout(resolve, FORCE_PAGES_LOADED_TIMEOUT);
          }),
        ]);
        if (!initialBookmark && !hash) {
          return;
        }
        if (pdfViewer.hasEqualPageSizes) {
          return;
        }
        this.initialBookmark = initialBookmark;

        // eslint-disable-next-line no-self-assign
        pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
        // Re-apply the initial document location.
        this.setInitialView(hash);
      })
        .catch(() => {
          // Ensure that the document is always completely initialized,
          // even if there are any errors thrown above.
          this.setInitialView();
        })
        .then(function () {
          // At this point, rendering of the initial page(s) should always have
          // started (and may even have completed).
          // To prevent any future issues, e.g. the document being completely
          // blank on load, always trigger rendering here.
          pdfViewer.update();
        });
    });

    pagesPromise.then(
      () => {
        this._unblockDocumentLoadEvent();

        this._initializeAutoPrint(pdfDocument, openActionPromise);
      },
      reason => {
        this._documentError("pdfjs-loading-error", { message: reason.message });
      }
    );

    onePageRendered.then(data => {
      this.externalServices.reportTelemetry({
        type: "pageInfo",
        timestamp: data.timestamp,
      });

      if (this.pdfOutlineViewer) {
        pdfDocument.getOutline().then(outline => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the outline resolved.
          }
          this.pdfOutlineViewer.render({ outline, pdfDocument });
        });
      }
      if (this.pdfAttachmentViewer) {
        pdfDocument.getAttachments().then(attachments => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the attachments resolved.
          }
          this.pdfAttachmentViewer.render({ attachments });
        });
      }
      if (this.pdfLayerViewer) {
        // Ensure that the layers accurately reflects the current state in the
        // viewer itself, rather than the default state provided by the API.
        pdfViewer.optionalContentConfigPromise.then(optionalContentConfig => {
          if (pdfDocument !== this.pdfDocument) {
            return; // The document was closed while the layers resolved.
          }
          this.pdfLayerViewer.render({ optionalContentConfig, pdfDocument });
        });
      }
    });

    this._initializePageLabels(pdfDocument);
    this._initializeMetadata(pdfDocument);
  }


  // 关闭当前的pdf页面
  async close() {

  }
}
