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

// eslint-disable-next-line max-len
/** @typedef {import("../src/display/display_utils").PageViewport} PageViewport */
// eslint-disable-next-line max-len
/** @typedef {import("../src/display/optional_content_config").OptionalContentConfig} OptionalContentConfig */
/** @typedef {import("./event_utils").EventBus} EventBus */
/** @typedef {import("./interfaces").IL10n} IL10n */
/** @typedef {import("./interfaces").IRenderableView} IRenderableView */
// eslint-disable-next-line max-len
/** @typedef {import("./pdf_rendering_queue").PDFRenderingQueue} PDFRenderingQueue */

import { PDFPageProxy, RenderTask } from "../../display/api";
import { OutputScale, PageViewport, PixelsPerInch, RenderingCancelledException, setLayerDimensions } from "../../display/display_utils";
import { DrawLayerBuilder } from "../../display/draw_layer_builder";
import { OptionalContentConfig } from "../../display/optional_content_config";
import { AbortException, AnnotationMode, shadow } from "../../shared/util";
import { TextAccessibilityManager } from "../common/text_accessibility";
import { approximateFraction, calcRound, DEFAULT_SCALE, floorToDivide, RenderingStates, TextLayerMode } from "../common/ui_utils";
import { AnnotationEditorLayerBuilder } from "./annotation_editor_layer_builder";
import { AnnotationLayerBuilder } from "./annotation_layer_builder";
import { GenericL10n } from "./genericl10n";
import { L10n } from "./l10n";
import { StructTreeLayerBuilder } from "./struct_tree_layer_builder";
import { TextHighlighter } from "./text_highlighter";
import { TextLayerBuilder } from "./text_layer_builder";
/**
 * @typedef {Object} PDFPageViewOptions
 * @property {HTMLDivElement} [container] - The viewer element.
 * @property {EventBus} eventBus - The application event bus.
 * @property {number} id - The page unique ID (normally its number).
 * @property {number} [scale] - The page scale display.
 * @property {PageViewport} defaultViewport - The page viewport.
 * @property {Promise<OptionalContentConfig>} [optionalContentConfigPromise] -
 *   A promise that is resolved with an {@link OptionalContentConfig} instance.
 *   The default value is `null`.
 * @property {PDFRenderingQueue} [renderingQueue] - The rendering queue object.
 * @property {number} [textLayerMode] - Controls if the text layer used for
 *   selection and searching is created. The constants from {TextLayerMode}
 *   should be used. The default value is `TextLayerMode.ENABLE`.
 * @property {number} [annotationMode] - Controls if the annotation layer is
 *   created, and if interactive form elements or `AnnotationStorage`-data are
 *   being rendered. The constants from {@link AnnotationMode} should be used;
 *   see also {@link RenderParameters} and {@link GetOperatorListParameters}.
 *   The default value is `AnnotationMode.ENABLE_FORMS`.
 * @property {string} [imageResourcesPath] - Path for image resources, mainly
 *   for annotation icons. Include trailing slash.
 * @property {number} [maxCanvasPixels] - The maximum supported canvas size in
 *   total pixels, i.e. width * height. Use `-1` for no limit, or `0` for
 *   CSS-only zooming. The default value is 4096 * 8192 (32 mega-pixels).
 * @property {Object} [pageColors] - Overwrites background and foreground colors
 *   with user defined ones in order to improve readability in high contrast
 *   mode.
 * @property {IL10n} [l10n] - Localization service.
 * @property {Object} [layerProperties] - The object that is used to lookup
 *   the necessary layer-properties.
 * @property {boolean} [enableHWA] - Enables hardware acceleration for
 *   rendering. The default value is `false`.
 */

const LAYERS_ORDER = new Map([
  ["canvasWrapper", 0],
  ["textLayer", 1],
  ["annotationLayer", 2],
  ["annotationEditorLayer", 3],
]);

/**
 * @implements {IRenderableView}
 */
export class WebPDFPageView {

  #annotationMode = AnnotationMode.ENABLE_FORMS;

  #enableHWA = false;

  #hasRestrictedScaling = false;

  #isEditing = false;

  #layerProperties = null;

  #loadingId: number | null = null;

  #previousRotation: number | null = null;

  #scaleRoundX = 1;

  #scaleRoundY = 1;

  #renderError = null;

  #renderingState = RenderingStates.INITIAL;

  #textLayerMode = TextLayerMode.ENABLE;

  #useThumbnailCanvas = {
    directDrawing: true,
    initialOptionalContent: true,
    regularAnnotations: true,
  };

  #viewportMap = new WeakMap();

  #layers: [
    HTMLDivElement | null,
    HTMLDivElement | null,
    HTMLDivElement | null,
    HTMLDivElement | null
  ] = [null, null, null, null];

  protected pageNum: number;

  protected div: HTMLDivElement;

  protected rotation: number;

  protected scale: number;

  protected maxCanvasPixels: number;

  public viewport: PageViewport;

  protected annotationLayer: AnnotationLayerBuilder | null;

  protected annotationEditorLayer: AnnotationEditorLayerBuilder | null;

  protected textLayer: TextLayerBuilder | null;

  protected zoomLayer: HTMLDivElement | null;

  protected drawLayer: DrawLayerBuilder | null;

  protected structTreeLayer: StructTreeLayerBuilder | null;

  protected pageLabel: string | null;

  protected imageResourcesPath: string;

  protected pdfPageRotate: number;

  protected l10n: L10n;

  protected renderTask: RenderTask | null;

  protected canvas: HTMLCanvasElement | null = null;

  protected pdfPage: PDFPageProxy | null;

  protected _accessibilityManager: TextAccessibilityManager | null = null;

  protected pageColors: { foreground: string; background: string; } | null;

  protected outputScale: OutputScale | null = null;

  protected _optionalContentConfigPromise: Promise<OptionalContentConfig> | null;

  /**
   * Page要和HTMLDivElement解开耦合，单个Page不需要挂到HTML的元素上去
   * PageView只需要提供页面的渲染就可以了，至于怎么渲染，由初始化的人来觉定
   */
  constructor(
    pageNum: number,
    scale: number,
    defaultViewport: PageViewport,
    optionalContentConfigPromise: Promise<OptionalContentConfig> | null,
    textLayerMode: TextLayerMode | null,
    annotationMode: AnnotationMode | null,
    imageResourcesPath: string | null,
    maxCanvasPixels: number,
    pageColors: {
      foreground: string;
      background: string;
    } | null,
    l10n: L10n | null,
    layerProperties: this._layerProperties,
    enableHWA: boolean,
  ) {

    this.pageNum = pageNum;
    this.#layerProperties = layerProperties;

    this.pdfPage = null;
    this.pageLabel = null;
    this.rotation = 0;
    this.scale = scale || DEFAULT_SCALE;
    this.viewport = defaultViewport;
    this.pdfPageRotate = defaultViewport.rotation;
    this._optionalContentConfigPromise = optionalContentConfigPromise;
    this.#textLayerMode = textLayerMode ?? TextLayerMode.ENABLE;
    this.#annotationMode = annotationMode ?? AnnotationMode.ENABLE_FORMS;
    this.imageResourcesPath = imageResourcesPath || "";
    this.maxCanvasPixels = maxCanvasPixels ?? AppOptions.get("maxCanvasPixels");
    this.pageColors = pageColors;
    this.#enableHWA = enableHWA || false;

    this.l10n = l10n ||= new GenericL10n();

    this.renderTask = null;
    this.resume = null;

    this._annotationCanvasMap = null;

    this.annotationLayer = null;
    this.annotationEditorLayer = null;
    this.textLayer = null;
    this.zoomLayer = null;
    this.structTreeLayer = null;
    this.drawLayer = null;

    const div = document.createElement("div");
    div.className = "page";
    div.setAttribute("data-page-number", `${this.pageNum}`);
    div.setAttribute("role", "region");
    div.setAttribute("data-l10n-id", "pdfjs-page-landmark");
    div.setAttribute("data-l10n-args", JSON.stringify({ page: this.pageNum }));
    this.div = div;

    this.#setDimensions();

    if (optionalContentConfigPromise) {
      // Ensure that the thumbnails always display the *initial* document
      // state, for documents with optional content.
      optionalContentConfigPromise.then(optionalContentConfig => {
        if (optionalContentConfigPromise !== this._optionalContentConfigPromise) {
          return;
        }
        this.#useThumbnailCanvas.initialOptionalContent = optionalContentConfig.hasInitialVisibility;
      });
    }

    // Ensure that Fluent is connected in e.g. the COMPONENTS build.
    this.l10n?.translate(this.div);
  }

  #addLayer(div: HTMLDivElement, name: string) {
    const pos = LAYERS_ORDER.get(name)!;
    const oldDiv = this.#layers[pos];
    this.#layers[pos] = div;
    if (oldDiv) {
      oldDiv.replaceWith(div);
      return;
    }
    for (let i = pos - 1; i >= 0; i--) {
      const layer = this.#layers[i];
      if (layer) {
        layer.after(div);
        return;
      }
    }
    this.div.prepend(div);
  }

  get renderingState() {
    return this.#renderingState;
  }

  set renderingState(state) {
    if (state === this.#renderingState) {
      return;
    }
    this.#renderingState = state;

    if (this.#loadingId) {
      clearTimeout(this.#loadingId);
      this.#loadingId = null;
    }

    switch (state) {
      case RenderingStates.PAUSED:
        this.div.classList.remove("loading");
        break;
      case RenderingStates.RUNNING:
        this.div.classList.add("loadingIcon");
        this.#loadingId = setTimeout(() => {
          // Adding the loading class is slightly postponed in order to not have
          // it with loadingIcon.
          // If we don't do that the visibility of the background is changed but
          // the transition isn't triggered.
          this.div.classList.add("loading");
          this.#loadingId = null;
        }, 0);
        break;
      case RenderingStates.INITIAL:
      case RenderingStates.FINISHED:
        this.div.classList.remove("loadingIcon", "loading");
        break;
    }
  }

  #setDimensions() {
    const { viewport } = this;
    if (this.pdfPage) {
      if (this.#previousRotation === viewport.rotation) {
        return;
      }
      this.#previousRotation = viewport.rotation;
    }

    setLayerDimensions(this.div, viewport, true, false);
  }

  setPdfPage(pdfPage: PDFPageProxy) {
    if (this.pageColors?.foreground === "CanvasText" || this.pageColors?.background === "Canvas") {
      this._container?.style.setProperty(
        "--hcm-highlight-filter",
        pdfPage.filterFactory.addHighlightHCMFilter(
          "highlight",
          "CanvasText",
          "Canvas",
          "HighlightText",
          "Highlight"
        )
      );
      this._container?.style.setProperty(
        "--hcm-highlight-selected-filter",
        pdfPage.filterFactory.addHighlightHCMFilter(
          "highlight_selected",
          "CanvasText",
          "Canvas",
          "HighlightText",
          "Highlight"
        )
      );
    }
    this.pdfPage = pdfPage;
    this.pdfPageRotate = pdfPage.rotate;

    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = pdfPage.getViewport(
      this.scale * PixelsPerInch.PDF_TO_CSS_UNITS, totalRotation
    );
    this.#setDimensions();
    this.reset();
  }

  destroy() {
    this.reset();
    this.pdfPage?.cleanup();
  }

  hasEditableAnnotations() {
    return !!this.annotationLayer?.hasEditableAnnotations();
  }

  get _textHighlighter() {
    return shadow(
      this,
      "_textHighlighter",
      new TextHighlighter({
        pageIndex: this.pageNum - 1,
        eventBus: this.eventBus,
        findController: this.#layerProperties.findController,
      })
    );
  }

  #dispatchLayerRendered(name: string, error) {
    this.eventBus.dispatch(name, {
      source: this,
      pageNumber: this.pageNum,
      error,
    });
  }

  async #renderAnnotationLayer() {
    let error = null;
    try {
      await this.annotationLayer!.render(
        this.viewport,
        { structTreeLayer: this.structTreeLayer },
        "display"
      );
    } catch (ex) {
      console.error(`#renderAnnotationLayer: "${ex}".`);
      error = ex;
    } finally {
      this.#dispatchLayerRendered("annotationlayerrendered", error);
    }
  }

  async #renderAnnotationEditorLayer() {
    let error = null;
    try {
      await this.annotationEditorLayer!.render(this.viewport, "display");
    } catch (ex) {
      console.error(`#renderAnnotationEditorLayer: "${ex}".`);
      error = ex;
    } finally {
      this.#dispatchLayerRendered("annotationeditorlayerrendered", error);
    }
  }

  async #renderDrawLayer() {
    try {
      await this.drawLayer!.render("display");
    } catch (ex) {
      console.error(`#renderDrawLayer: "${ex}".`);
    }
  }

  async #renderTextLayer() {
    if (!this.textLayer) {
      return;
    }

    let error = null;
    try {
      await this.textLayer.render(this.viewport);
    } catch (ex) {
      if (ex instanceof AbortException) {
        return;
      }
      console.error(`#renderTextLayer: "${ex}".`);
      error = ex;
    }
    this.#dispatchLayerRendered("textlayerrendered", error);

    this.#renderStructTreeLayer();
  }

  /**
   * The structure tree is currently only supported when the text layer is
   * enabled and a canvas is used for rendering.
   *
   * The structure tree must be generated after the text layer for the
   * aria-owns to work.
   */
  async #renderStructTreeLayer() {
    if (!this.textLayer) {
      return;
    }

    const treeDom = await this.structTreeLayer?.render();
    if (treeDom) {
      this.l10n.pause();
      this.structTreeLayer?.addElementsToTextLayer();
      if (this.canvas && treeDom.parentNode !== this.canvas) {
        // Pause translation when inserting the structTree in the DOM.
        this.canvas.append(treeDom);
      }
      this.l10n.resume();
    }
    this.structTreeLayer?.show();
  }

  /**
   * @private
   */
  _resetZoomLayer(removeFromDOM = false) {
    if (!this.zoomLayer) {
      return;
    }
    const zoomLayerCanvas = <HTMLCanvasElement>this.zoomLayer.firstChild!;
    this.#viewportMap.delete(zoomLayerCanvas);
    // Zeroing the width and height causes Firefox to release graphics
    // resources immediately, which can greatly reduce memory consumption.
    zoomLayerCanvas.width = 0;
    zoomLayerCanvas.height = 0;

    if (removeFromDOM) {
      // Note: `ChildNode.remove` doesn't throw if the parent node is undefined.
      this.zoomLayer.remove();
    }
    this.zoomLayer = null;
  }

  reset({
    keepZoomLayer = false,
    keepAnnotationLayer = false,
    keepAnnotationEditorLayer = false,
    keepTextLayer = false,
  } = {}) {
    this.cancelRendering({
      keepAnnotationLayer,
      keepAnnotationEditorLayer,
      keepTextLayer,
    });
    this.renderingState = RenderingStates.INITIAL;

    const div = this.div;

    const childNodes = div.childNodes,
      zoomLayerNode = (keepZoomLayer && this.zoomLayer) || null,
      annotationLayerNode =
        (keepAnnotationLayer && this.annotationLayer?.div) || null,
      annotationEditorLayerNode =
        (keepAnnotationEditorLayer && this.annotationEditorLayer?.div) || null,
      textLayerNode = (keepTextLayer && this.textLayer?.div) || null;
    for (let i = childNodes.length - 1; i >= 0; i--) {
      const node = childNodes[i];
      switch (node) {
        case zoomLayerNode:
        case annotationLayerNode:
        case annotationEditorLayerNode:
        case textLayerNode:
          continue;
      }
      node.remove();
      const layerIndex = this.#layers.indexOf(node);
      if (layerIndex >= 0) {
        this.#layers[layerIndex] = null;
      }
    }
    div.removeAttribute("data-loaded");

    if (annotationLayerNode) {
      // Hide the annotation layer until all elements are resized
      // so they are not displayed on the already resized page.
      this.annotationLayer!.hide();
    }
    if (annotationEditorLayerNode) {
      this.annotationEditorLayer!.hide();
    }
    if (textLayerNode) {
      this.textLayer!.hide();
    }
    this.structTreeLayer?.hide();

    if (!zoomLayerNode) {
      if (this.canvas) {
        this.#viewportMap.delete(this.canvas);
        // Zeroing the width and height causes Firefox to release graphics
        // resources immediately, which can greatly reduce memory consumption.
        this.canvas.width = 0;
        this.canvas.height = 0;
        this.canvas = null;
      }
      this._resetZoomLayer();
    }
  }

  toggleEditingMode(isEditing: boolean) {
    if (!this.hasEditableAnnotations()) {
      return;
    }
    this.#isEditing = isEditing;
    this.reset({
      keepZoomLayer: true,
      keepAnnotationLayer: true,
      keepAnnotationEditorLayer: true,
      keepTextLayer: true,
    });
  }

  /**
   * @typedef {Object} PDFPageViewUpdateParameters
   * @property {number} [scale] The new scale, if specified.
   * @property {number} [rotation] The new rotation, if specified.
   * @property {Promise<OptionalContentConfig>} [optionalContentConfigPromise]
   *   A promise that is resolved with an {@link OptionalContentConfig}
   *   instance. The default value is `null`.
   * @property {number} [drawingDelay]
   */

  /**
   * Update e.g. the scale and/or rotation of the page.
   * @param {PDFPageViewUpdateParameters} params
   */
  update({
    scale = 0,
    rotation = null,
    optionalContentConfigPromise = null,
    drawingDelay = -1,
  }) {
    this.scale = scale || this.scale;
    if (typeof rotation === "number") {
      this.rotation = rotation; // The rotation may be zero.
    }
    if (optionalContentConfigPromise instanceof Promise) {
      this._optionalContentConfigPromise = optionalContentConfigPromise;

      // Ensure that the thumbnails always display the *initial* document state,
      // for documents with optional content.
      optionalContentConfigPromise.then(optionalContentConfig => {
        if (
          optionalContentConfigPromise !== this._optionalContentConfigPromise
        ) {
          return;
        }
        this.#useThumbnailCanvas.initialOptionalContent =
          optionalContentConfig.hasInitialVisibility;
      });
    }
    this.#useThumbnailCanvas.directDrawing = true;

    const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
    this.viewport = this.viewport.clone(
      this.scale * PixelsPerInch.PDF_TO_CSS_UNITS, totalRotation,
    );
    this.#setDimensions();

    if (this.canvas) {
      let onlyCssZoom = false;
      if (this.#hasRestrictedScaling) {
        if (this.maxCanvasPixels === 0) {
          onlyCssZoom = true;
        } else if (this.maxCanvasPixels > 0) {
          const { width, height } = this.viewport;
          const { sx, sy } = this.outputScale!;
          onlyCssZoom =
            ((Math.floor(width) * sx) | 0) * ((Math.floor(height) * sy) | 0) >
            this.maxCanvasPixels;
        }
      }
      const postponeDrawing = drawingDelay >= 0 && drawingDelay < 1000;

      if (postponeDrawing || onlyCssZoom) {
        if (
          postponeDrawing &&
          !onlyCssZoom &&
          this.renderingState !== RenderingStates.FINISHED
        ) {
          this.cancelRendering({
            keepAnnotationLayer: true,
            keepAnnotationEditorLayer: true,
            keepTextLayer: true,
            cancelExtraDelay: drawingDelay,
          });
          // It isn't really finished, but once we have finished
          // to postpone, we'll call this.reset(...) which will set
          // the rendering state to INITIAL, hence the next call to
          // PDFViewer.update() will trigger a redraw (if it's mandatory).
          this.renderingState = RenderingStates.FINISHED;
          // Ensure that the thumbnails won't become partially (or fully) blank,
          // if the sidebar is opened before the actual rendering is done.
          this.#useThumbnailCanvas.directDrawing = false;
        }

        this.cssTransform({
          target: this.canvas,
          redrawAnnotationLayer: true,
          redrawAnnotationEditorLayer: true,
          redrawTextLayer: !postponeDrawing,
          hideTextLayer: postponeDrawing,
        });

        if (postponeDrawing) {
          // The "pagerendered"-event will be dispatched once the actual
          // rendering is done, hence don't dispatch it here as well.
          return;
        }
        this.eventBus.dispatch("pagerendered", {
          source: this,
          pageNumber: this.pageNum,
          cssTransform: true,
          timestamp: performance.now(),
          error: this.#renderError,
        });
        return;
      }
      if (!this.zoomLayer && !this.canvas.hidden) {
        this.zoomLayer = <HTMLDivElement>this.canvas.parentNode;
        this.zoomLayer.style.position = "absolute";
      }
    }
    if (this.zoomLayer) {
      this.cssTransform({ target: this.zoomLayer.firstChild });
    }
    this.reset({
      keepZoomLayer: true,
      keepAnnotationLayer: true,
      keepAnnotationEditorLayer: true,
      keepTextLayer: true,
    });
  }

  /**
   * PLEASE NOTE: Most likely you want to use the `this.reset()` method,
   *              rather than calling this one directly.
   */
  cancelRendering({
    keepAnnotationLayer = false,
    keepAnnotationEditorLayer = false,
    keepTextLayer = false,
    cancelExtraDelay = 0,
  } = {}) {
    if (this.renderTask) {
      this.renderTask.cancel(cancelExtraDelay);
      this.renderTask = null;
    }
    this.resume = null;

    if (this.textLayer && (!keepTextLayer || !this.textLayer.div)) {
      this.textLayer.cancel();
      this.textLayer = null;
    }
    if (
      this.annotationLayer &&
      (!keepAnnotationLayer || !this.annotationLayer.div)
    ) {
      this.annotationLayer.cancel();
      this.annotationLayer = null;
      this._annotationCanvasMap = null;
    }
    if (this.structTreeLayer && !this.textLayer) {
      this.structTreeLayer = null;
    }
    if (
      this.annotationEditorLayer &&
      (!keepAnnotationEditorLayer || !this.annotationEditorLayer.div)
    ) {
      if (this.drawLayer) {
        this.drawLayer.cancel();
        this.drawLayer = null;
      }
      this.annotationEditorLayer.cancel();
      this.annotationEditorLayer = null;
    }
  }

  cssTransform({
    target,
    redrawAnnotationLayer = false,
    redrawAnnotationEditorLayer = false,
    redrawTextLayer = false,
    hideTextLayer = false,
  }) {
    // Scale target (canvas), its wrapper and page container.
    if (!target.hasAttribute("zooming")) {
      target.setAttribute("zooming", true);
      const { style } = target;
      style.width = style.height = "";
    }

    const originalViewport = this.#viewportMap.get(target);
    if (this.viewport !== originalViewport) {
      // The canvas may have been originally rotated; rotate relative to that.
      const relativeRotation = this.viewport.rotation - originalViewport.rotation;
      const absRotation = Math.abs(relativeRotation);
      let scaleX = 1, scaleY = 1;
      if (absRotation === 90 || absRotation === 270) {
        const { width, height } = this.viewport;
        // Scale x and y because of the rotation.
        scaleX = height / width;
        scaleY = width / height;
      }
      target.style.transform = `rotate(${relativeRotation}deg) scale(${scaleX}, ${scaleY})`;
    }

    if (redrawAnnotationLayer && this.annotationLayer) {
      this.#renderAnnotationLayer();
    }
    if (redrawAnnotationEditorLayer && this.annotationEditorLayer) {
      if (this.drawLayer) {
        this.#renderDrawLayer();
      }
      this.#renderAnnotationEditorLayer();
    }

    if (this.textLayer) {
      if (hideTextLayer) {
        this.textLayer.hide();
        this.structTreeLayer?.hide();
      } else if (redrawTextLayer) {
        this.#renderTextLayer();
      }
    }
  }

  get width() {
    return this.viewport.width;
  }

  get height() {
    return this.viewport.height;
  }

  getPagePoint(x: number, y: number) {
    return this.viewport.convertToPdfPoint(x, y);
  }

  async #finishRenderTask(renderTask: RenderTask, error = null) {
    // The renderTask may have been replaced by a new one, so only remove
    // the reference to the renderTask if it matches the one that is
    // triggering this callback.
    if (renderTask === this.renderTask) {
      this.renderTask = null;
    }

    if (error instanceof RenderingCancelledException) {
      this.#renderError = null;
      return;
    }
    this.#renderError = error;

    this.renderingState = RenderingStates.FINISHED;
    this._resetZoomLayer(/* removeFromDOM = */ true);

    // Ensure that the thumbnails won't become partially (or fully) blank,
    // for documents that contain interactive form elements.
    this.#useThumbnailCanvas.regularAnnotations = !renderTask.separateAnnots;

    this.eventBus.dispatch("pagerendered", {
      source: this,
      pageNumber: this.pageNum,
      cssTransform: false,
      timestamp: performance.now(),
      error: this.#renderError,
    });

    if (error) {
      throw error;
    }
  }

  async draw() {
    if (this.renderingState !== RenderingStates.INITIAL) {
      console.error("Must be in new state before drawing");
      this.reset(); // Ensure that we reset all state to prevent issues.
    }
    const { div, l10n, pageColors, pdfPage, viewport } = this;

    if (!pdfPage) {
      this.renderingState = RenderingStates.FINISHED;
      throw new Error("pdfPage is not loaded");
    }

    this.renderingState = RenderingStates.RUNNING;

    // Wrap the canvas so that if it has a CSS transform for high DPI the
    // overflow will be hidden in Firefox.
    const canvasWrapper = document.createElement("div");
    canvasWrapper.classList.add("canvasWrapper");
    this.#addLayer(canvasWrapper, "canvasWrapper");

    if (!this.textLayer && this.#textLayerMode !== TextLayerMode.DISABLE) {
      this._accessibilityManager ||= new TextAccessibilityManager();

      this.textLayer = new TextLayerBuilder(
        pdfPage,
        this._textHighlighter,
        this._accessibilityManager,
        this.#textLayerMode === TextLayerMode.ENABLE_PERMISSIONS,
        (textLayerDiv: HTMLDivElement) => {
          // Pause translation when inserting the textLayer in the DOM.
          this.l10n.pause();
          this.#addLayer(textLayerDiv, "textLayer");
          this.l10n.resume();
        },
      );
    }

    if (
      !this.annotationLayer &&
      this.#annotationMode !== AnnotationMode.DISABLE
    ) {
      const {
        annotationStorage,
        annotationEditorUIManager,
        downloadManager,
        enableScripting,
        fieldObjectsPromise,
        hasJSActionsPromise,
        linkService,
      } = this.#layerProperties;

      this._annotationCanvasMap ||= new Map();
      this.annotationLayer = new AnnotationLayerBuilder({
        pdfPage,
        annotationStorage,
        imageResourcesPath: this.imageResourcesPath,
        renderForms: this.#annotationMode === AnnotationMode.ENABLE_FORMS,
        linkService,
        downloadManager,
        enableScripting,
        hasJSActionsPromise,
        fieldObjectsPromise,
        annotationCanvasMap: this._annotationCanvasMap,
        accessibilityManager: this._accessibilityManager,
        annotationEditorUIManager,
        onAppend: (annotationLayerDiv: HTMLDivElement) => {
          this.#addLayer(annotationLayerDiv, "annotationLayer");
        },
      });
    }

    const renderContinueCallback = cont => {
      showCanvas?.(false);
      if (this.renderingQueue && !this.renderingQueue.isHighestPriority(this)) {
        this.renderingState = RenderingStates.PAUSED;
        this.resume = () => {
          this.renderingState = RenderingStates.RUNNING;
          cont();
        };
        return;
      }
      cont();
    };

    const { width, height } = viewport;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "presentation");

    // Keep the canvas hidden until the first draw callback, or until drawing
    // is complete when `!this.renderingQueue`, to prevent black flickering.
    canvas.hidden = true;
    const hasHCM = !!(pageColors?.background && pageColors?.foreground);

    let showCanvas = (isLastShow: boolean) => {
      // In HCM, a final filter is applied on the canvas which means that
      // before it's applied we've normal colors. Consequently, to avoid to have
      // a final flash we just display it once all the drawing is done.
      if (!hasHCM || isLastShow) {
        canvas.hidden = false;
        showCanvas = null; // Only invoke the function once.
      }
    };
    canvasWrapper.append(canvas);
    this.canvas = canvas;

    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: !this.#enableHWA,
    });
    const outputScale = (this.outputScale = new OutputScale());

    if (
      (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) &&
      this.maxCanvasPixels === 0
    ) {
      const invScale = 1 / this.scale;
      // Use a scale that makes the canvas have the originally intended size
      // of the page.
      outputScale.sx *= invScale;
      outputScale.sy *= invScale;
      this.#hasRestrictedScaling = true;
    } else if (this.maxCanvasPixels > 0) {
      const pixelsInViewport = width * height;
      const maxScale = Math.sqrt(this.maxCanvasPixels / pixelsInViewport);
      if (outputScale.sx > maxScale || outputScale.sy > maxScale) {
        outputScale.sx = maxScale;
        outputScale.sy = maxScale;
        this.#hasRestrictedScaling = true;
      } else {
        this.#hasRestrictedScaling = false;
      }
    }
    const sfx = approximateFraction(outputScale.sx);
    const sfy = approximateFraction(outputScale.sy);

    const canvasWidth = (canvas.width = floorToDivide(
      calcRound(width * outputScale.sx),
      sfx[0]
    ));
    const canvasHeight = (canvas.height = floorToDivide(
      calcRound(height * outputScale.sy),
      sfy[0]
    ));
    const pageWidth = floorToDivide(calcRound(width), sfx[1]);
    const pageHeight = floorToDivide(calcRound(height), sfy[1]);
    outputScale.sx = canvasWidth / pageWidth;
    outputScale.sy = canvasHeight / pageHeight;

    if (this.#scaleRoundX !== sfx[1]) {
      div.style.setProperty("--scale-round-x", `${sfx[1]}px`);
      this.#scaleRoundX = sfx[1];
    }
    if (this.#scaleRoundY !== sfy[1]) {
      div.style.setProperty("--scale-round-y", `${sfy[1]}px`);
      this.#scaleRoundY = sfy[1];
    }

    // Add the viewport so it's known what it was originally drawn with.
    this.#viewportMap.set(canvas, viewport);

    // Rendering area
    const transform = outputScale.scaled
      ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
      : null;
    const renderContext = {
      canvasContext: ctx,
      transform,
      viewport,
      annotationMode: this.#annotationMode,
      optionalContentConfigPromise: this._optionalContentConfigPromise,
      annotationCanvasMap: this._annotationCanvasMap,
      pageColors,
      isEditing: this.#isEditing,
    };
    const renderTask = (this.renderTask = pdfPage.render(renderContext));
    renderTask.onContinue = renderContinueCallback;

    const resultPromise = renderTask.promise.then(
      async () => {
        showCanvas?.(true);
        await this.#finishRenderTask(renderTask);

        this.structTreeLayer ||= new StructTreeLayerBuilder(
          pdfPage,
          viewport.rawDims
        );

        this.#renderTextLayer();

        if (this.annotationLayer) {
          await this.#renderAnnotationLayer();
        }

        const { annotationEditorUIManager } = this.#layerProperties;

        if (!annotationEditorUIManager) {
          return;
        }
        this.drawLayer ||= new DrawLayerBuilder(this.pageNum);
        await this.#renderDrawLayer();
        this.drawLayer.setParent(canvasWrapper);

        this.annotationEditorLayer ||= new AnnotationEditorLayerBuilder({
          uiManager: annotationEditorUIManager,
          pdfPage,
          l10n,
          structTreeLayer: this.structTreeLayer,
          accessibilityManager: this._accessibilityManager,
          annotationLayer: this.annotationLayer?.annotationLayer,
          textLayer: this.textLayer,
          drawLayer: this.drawLayer.getDrawLayer(),
          onAppend: (annotationEditorLayerDiv: HTMLDivElement) => {
            this.#addLayer(annotationEditorLayerDiv, "annotationEditorLayer");
          },
        });
        this.#renderAnnotationEditorLayer();
      },
      error => {
        // When zooming with a `drawingDelay` set, avoid temporarily showing
        // a black canvas if rendering was cancelled before the `onContinue`-
        // callback had been invoked at least once.
        if (!(error instanceof RenderingCancelledException)) {
          showCanvas?.(true);
        }
        return this.#finishRenderTask(renderTask, error);
      }
    );



    div.setAttribute("data-loaded", "true");

    this.eventBus.dispatch("pagerender", {
      source: this,
      pageNumber: this.pageNum,
    });
    return resultPromise;
  }

  /**
   * @param {string|null} label
   */
  setPageLabel(label: string | null) {
    this.pageLabel = typeof label === "string" ? label : null;

    this.div.setAttribute(
      "data-l10n-args",
      JSON.stringify({ page: this.pageLabel ?? this.pageNum })
    );

    if (this.pageLabel !== null) {
      this.div.setAttribute("data-page-label", this.pageLabel);
    } else {
      this.div.removeAttribute("data-page-label");
    }
  }

  /**
   * For use by the `PDFThumbnailView.setImage`-method.
   * @ignore
   */
  get thumbnailCanvas() {
    const { directDrawing, initialOptionalContent, regularAnnotations } =
      this.#useThumbnailCanvas;
    return directDrawing && initialOptionalContent && regularAnnotations
      ? this.canvas
      : null;
  }
}
