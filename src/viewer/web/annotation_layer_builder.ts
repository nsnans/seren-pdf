/* Copyright 2014 Mozilla Foundation
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
import { AnnotationLayer } from "../../display/annotation_layer";
import { AnnotationStorage } from "../../display/annotation_storage";
import { PDFPageProxy } from "../../display/api";
import { PageViewport } from "../../display/display_utils";
import { AnnotationEditorUIManager } from "../../display/editor/tools";
import { DownloadManager } from "../common/component_types";
import { TextAccessibilityManager } from "../common/text_accessibility";
import { PresentationModeState } from "../common/ui_utils";
import { PDFLinkService } from "./pdf_link_service";
import { StructTreeLayerBuilder } from "./struct_tree_layer_builder";

export class AnnotationLayerBuilder {

  #onAppend: ((div: HTMLDivElement) => void) | null = null;

  #eventAbortController: AbortController | null = null;

  protected pdfPage: PDFPageProxy;

  protected linkService: PDFLinkService;

  protected downloadManager: DownloadManager;

  protected imageResourcesPath: string;

  protected renderForms: boolean;

  protected annotationStorage: AnnotationStorage;

  protected enableScripting: boolean;

  protected _annotationCanvasMap: Map<string, HTMLCanvasElement> | null;

  protected _accessibilityManager: TextAccessibilityManager;

  protected _cancelled: boolean;

  protected div: HTMLDivElement | null;

  protected _annotationEditorUIManager: AnnotationEditorUIManager;

  protected _hasJSActionsPromise: Promise<boolean>;

  protected _fieldObjectsPromise: Promise<void>;

  protected annotationLayer: AnnotationLayer | null;

  constructor(
    pdfPage: PDFPageProxy,
    linkService: PDFLinkService,
    downloadManager: DownloadManager,
    annotationStorage: AnnotationStorage,
    imageResourcesPath = "",
    renderForms = true,
    enableScripting = false,
    hasJSActionsPromise: Promise<boolean> | null = null,
    fieldObjectsPromise: Promise<void> | null = null,
    annotationCanvasMap: Map<string, HTMLCanvasElement> | null = null,
    accessibilityManager: TextAccessibilityManager,
    annotationEditorUIManager: AnnotationEditorUIManager,
    onAppend: ((div: HTMLDivElement) => void) | null = null,
  ) {
    this.pdfPage = pdfPage;
    this.linkService = linkService;
    this.downloadManager = downloadManager;
    this.imageResourcesPath = imageResourcesPath;
    this.renderForms = renderForms;
    this.annotationStorage = annotationStorage;
    this.enableScripting = enableScripting;
    this._hasJSActionsPromise = hasJSActionsPromise || Promise.resolve(false);
    this._fieldObjectsPromise = fieldObjectsPromise || Promise.resolve();
    this._annotationCanvasMap = annotationCanvasMap;
    this._accessibilityManager = accessibilityManager;
    this._annotationEditorUIManager = annotationEditorUIManager;
    this.#onAppend = onAppend;

    this.annotationLayer = null;
    this.div = null;
    this._cancelled = false;
  }

  /**
   * @returns A promise that is resolved when rendering of the annotations is complete.
   */
  async render(viewport: PageViewport, structTreeLayer: StructTreeLayerBuilder | null, intent = "display") {
    if (this.div) {
      if (this._cancelled || !this.annotationLayer) {
        return;
      }
      // If an annotationLayer already exists, refresh its children's
      // transformation matrices.
      this.annotationLayer!.update(viewport.clone(null, null, null, null, true));
      return;
    }

    const [annotations, hasJSActions, fieldObjects] = await Promise.all([
      this.pdfPage.getAnnotations(intent),
      this._hasJSActionsPromise,
      this._fieldObjectsPromise,
    ]);
    if (this._cancelled) {
      return;
    }

    // Create an annotation layer div and render the annotations
    // if there is at least one annotation.
    const div = (this.div = document.createElement("div"));
    div.className = "annotationLayer";
    this.#onAppend?.(div);

    if (annotations.length === 0) {
      this.hide();
      return;
    }

    this.annotationLayer = new AnnotationLayer(
      div,
      this._accessibilityManager,
      this._annotationCanvasMap!,
      this._annotationEditorUIManager,
      this.pdfPage,
      viewport.clone(null, null, null, null, true),
      structTreeLayer,
    );

    const x = {
      annotations,
      imageResourcesPath: this.imageResourcesPath,
      renderForms: this.renderForms,
      linkService: this.linkService,
      downloadManager: this.downloadManager,
      annotationStorage: this.annotationStorage,
      enableScripting: this.enableScripting,
      hasJSActions,
      fieldObjects,
    }

    await this.annotationLayer.render(
      annotations,
      this.imageResourcesPath,
      this.renderForms,
      this.linkService,
      this.downloadManager,
      this.annotationStorage,
      this.enableScripting,
      hasJSActions,
      fieldObjects,
    );

    // Ensure that interactive form elements in the annotationLayer are
    // disabled while PresentationMode is active (see issue 12232).
    if (this.linkService.isInPresentationMode) {
      this.#updatePresentationModeState(PresentationModeState.FULLSCREEN);
    }
    if (!this.#eventAbortController) {
      this.#eventAbortController = new AbortController();
    }
  }

  cancel() {
    this._cancelled = true;

    this.#eventAbortController?.abort();
    this.#eventAbortController = null;
  }

  hide() {
    if (!this.div) {
      return;
    }
    this.div.hidden = true;
  }

  hasEditableAnnotations() {
    return !!this.annotationLayer?.hasEditableAnnotations();
  }

  #updatePresentationModeState(state: PresentationModeState) {
    if (!this.div) {
      return;
    }
    let disableFormElements = false;

    switch (state) {
      case PresentationModeState.FULLSCREEN:
        disableFormElements = true;
        break;
      case PresentationModeState.NORMAL:
        break;
      default:
        return;
    }
    for (const section of this.div.childNodes) {
      if ((<HTMLElement>section).hasAttribute("data-internal-link")) {
        continue;
      }
      (<HTMLElement>section).inert = disableFormElements;
    }
  }
}
