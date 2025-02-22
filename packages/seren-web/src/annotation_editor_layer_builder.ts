/* Copyright 2022 Mozilla Foundation
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
import { PDFPageProxy } from "../../display/api";
import { PageViewport } from "../../display/display_utils";
import { DrawLayer } from "../../display/draw_layer";
import { AnnotationEditorLayer } from '../../display/editor/annotation_editor_layer';
import { AnnotationEditorUIManager } from "../../display/editor/tools";
import { TextAccessibilityManager } from "../common/text_accessibility";
import { GenericL10n } from "./genericl10n";
import { L10n } from "../../seren-viewer/src/l10n/l10n";
import { StructTreeLayerBuilder } from "./struct_tree_layer_builder";
import { TextLayerBuilder } from "./text_layer_builder";

export class AnnotationEditorLayerBuilder {

  #annotationLayer: AnnotationLayer | null = null;

  #drawLayer: DrawLayer | null = null;

  #onAppend: ((annotationEditorLayerDiv: HTMLDivElement) => void) | null = null;

  #structTreeLayer: StructTreeLayerBuilder | null = null;

  #textLayer: TextLayerBuilder | null = null;

  #uiManager: AnnotationEditorUIManager;

  protected pdfPage: PDFPageProxy;

  protected accessibilityManager: TextAccessibilityManager | null;

  protected l10n: L10n;

  protected annotationEditorLayer: AnnotationEditorLayer | null;

  protected _cancelled: boolean;

  public div: HTMLDivElement | null;

  constructor(
    uiManager: AnnotationEditorUIManager,
    pdfPage: PDFPageProxy,
    l10n: L10n,
    structTreeLayer: StructTreeLayerBuilder,
    accessibilityManager: TextAccessibilityManager | null,
    annotationLayer: AnnotationLayer | null,
    textLayer: TextLayerBuilder | null,
    drawLayer: DrawLayer | null,
    onAppend: ((annotationEditorLayerDiv: HTMLDivElement) => void) | null,
  ) {
    this.pdfPage = pdfPage;
    this.accessibilityManager = accessibilityManager;
    this.l10n = l10n ||= new GenericL10n();
    this.annotationEditorLayer = null;
    this.div = null;
    this._cancelled = false;
    this.#uiManager = uiManager;
    this.#annotationLayer = annotationLayer || null;
    this.#textLayer = textLayer || null;
    this.#drawLayer = drawLayer || null;
    this.#onAppend = onAppend || null;
    this.#structTreeLayer = structTreeLayer || null;
  }

  /**
   * @param viewport
   * @param intent (default value is 'display')
   */
  async render(viewport: PageViewport, intent = "display") {
    if (intent !== "display") {
      return;
    }

    if (this._cancelled) {
      return;
    }

    const clonedViewport = viewport.clone(null, null, null, null, true);
    if (this.div) {
      this.annotationEditorLayer!.update(clonedViewport);
      this.show();
      return;
    }

    // Create an AnnotationEditor layer div
    const div = (this.div = document.createElement("div"));
    div.className = "annotationEditorLayer";
    div.hidden = true;
    div.dir = this.#uiManager.direction;
    this.#onAppend?.(div);

    this.annotationEditorLayer = new AnnotationEditorLayer(
      this.#uiManager,
      this.pdfPage.pageNumber - 1,
      div!,
      this.#structTreeLayer,
      this.accessibilityManager!,
      this.#annotationLayer!,
      this.#drawLayer!,
      this.#textLayer!,
      clonedViewport,
      this.l10n!,
    );

    const parameters = {
      viewport: clonedViewport,
      div,
      annotations: null,
      intent,
    };

    this.annotationEditorLayer.render(parameters);
    this.show();
  }

  cancel() {
    this._cancelled = true;

    if (!this.div) {
      return;
    }
    this.annotationEditorLayer!.destroy();
  }

  hide() {
    if (!this.div) {
      return;
    }
    this.div.hidden = true;
  }

  show() {
    if (!this.div || this.annotationEditorLayer!.isInvisible) {
      return;
    }
    this.div.hidden = false;
  }
}
