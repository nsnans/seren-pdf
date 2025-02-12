import { PDFDocumentLoadingTask, PDFDocumentProxy } from "../../display/api";
import { AnnotationEditorParams } from "../../display/editor/annotation_editor_params";
import { DownloadManager, IL10n } from "../common/component_types";
import { EventBus } from "./event_utils";
import { ImageAltTextSettings } from "./new_alt_text_manager";
import { OverlayManager } from "./overlay_manager";
import { PDFCursorTools } from "./pdf_cursor_tools";
import { PDFDocumentProperties } from "./pdf_document_properties";
import { PDFHistory } from "./pdf_history";
import { PDFLayerViewer } from "./pdf_layer_viewer";
import { PDFLinkService } from "./pdf_link_service";
import { PDFOutlineViewer } from "./pdf_outline_viewer";
import { PDFPresentationMode } from "./pdf_presentation_mode";
import { PDFRenderingQueue } from "./pdf_rendering_queue";
import { PDFScriptingManager } from "./pdf_scripting_manager";
import { PDFSidebar } from "./pdf_sidebar";
import { PDFThumbnailViewer } from "./pdf_thumbnail_viewer";
import { PDFViewer } from "./pdf_viewer";
import { ViewHistory } from "./view_history";
import { WebPDFViewerCallbackManager } from "./viewer_callback_manager";
import { WebPDFViewerContext } from "./viewer_context";
import { WebPDFViewerOptions } from "./viewer_options";

export class WebPDFViewerBuilder {

}

export class WebPDFViewer {

  protected viewerContext: WebPDFViewerContext;

  protected viewerOptions: WebPDFViewerOptions;

  protected callbackManager: WebPDFViewerCallbackManager;

  protected viewerContainer: HTMLDivElement;

  protected pdfDocument: PDFDocumentProxy;

  protected pdfLoadingTask: PDFDocumentLoadingTask;

  protected pdfViewer: PDFViewer;

  protected pdfThumbnailViewer: PDFThumbnailViewer;

  protected pdfRenderingQueue: PDFRenderingQueue;

  protected pdfPresentationMode: PDFPresentationMode;

  protected pdfDocumentProperties: PDFDocumentProperties;

  protected pdfLinkService: PDFLinkService;

  protected pdfHistory: PDFHistory;

  protected pdfSidebar: PDFSidebar;

  protected pdfOutlineViewer: PDFOutlineViewer;

  protected pdfLayerViewer: PDFLayerViewer;

  protected pdfCursorTools: PDFCursorTools;

  protected pdfScriptingManager: PDFScriptingManager;

  protected store: ViewHistory;

  protected downloadManager: DownloadManager;

  protected overlayManager: OverlayManager;

  protected eventBus: EventBus;

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

  protected _contentLength: null;

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

  constructor(
    viewerContext: WebPDFViewerContext,
    viewerContainer: HTMLDivElement,
  ) {
    this.viewerContext = viewerContext;
    this.callbackManager = viewerContext.getCallbackManager();
    const viewerOptions = this.viewerOptions = viewerContext.getViewerOptions();
    // 等待从localStorage中读取属性，这个原来有，但是现在暂时不用了，这个活儿不应该由我来干。
    this.viewerContainer = viewerContainer;
    addCallback
  }
}
