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

/** @typedef {import("../src/display/api").PDFPageProxy} PDFPageProxy */
// eslint-disable-next-line max-len
/** @typedef {import("../src/display/display_utils").PageViewport} PageViewport */
/** @typedef {import("./text_highlighter").TextHighlighter} TextHighlighter */
// eslint-disable-next-line max-len
/** @typedef {import("./text_accessibility.js").TextAccessibilityManager} TextAccessibilityManager */

import { removeNullCharacters } from "../common/ui_utils";
import { normalizeUnicode } from "../../shared/util";
import { TextLayer } from "../../display/text_layer";
import { PDFPageProxy } from "../../display/api";
import { TextAccessibilityManager } from "../common/text_accessibility";
import { PageViewport } from "../../display/display_utils";
import { BrowserUtil } from "./browser_util";

/**
 * The text layer builder provides text selection functionality for the PDF.
 * It does this by creating overlay divs over the PDF's text. These divs
 * contain text that matches the PDF text they are overlaying.
 */
export class TextLayerBuilder {

  #enablePermissions = false;

  #onAppend: ((div: HTMLDivElement) => void) | null = null;

  #renderingDone = false;

  #textLayer: TextLayer | null = null;

  static #textLayers = new Map<HTMLDivElement, HTMLDivElement>();

  static #selectionChangeAbortController: AbortController | null = null;

  public div: HTMLDivElement;

  protected pdfPage: PDFPageProxy;

  protected accessibilityManager: TextAccessibilityManager | null;

  // protected highlighter: TextHighlighter | null;

  constructor(
    pdfPage: PDFPageProxy,
    // highlighter: TextHighlighter | null = null,
    accessibilityManager: TextAccessibilityManager | null = null,
    enablePermissions = false,
    onAppend: ((div: HTMLDivElement) => void) | null = null,
  ) {
    this.pdfPage = pdfPage;
    // this.highlighter = highlighter;
    this.accessibilityManager = accessibilityManager;
    this.#enablePermissions = enablePermissions === true;
    this.#onAppend = onAppend;

    this.div = document.createElement("div");
    this.div.tabIndex = 0;
    this.div.className = "textLayer";
  }

  /**
   * Renders the text layer.
   * @param {PageViewport} viewport
   * @param {Object} [textContentParams]
   */
  async render(viewport: PageViewport) {
    if (this.#renderingDone && this.#textLayer) {
      this.#textLayer.update(viewport, this.hide.bind(this));
      this.show();
      return;
    }

    this.cancel();
    this.#textLayer = new TextLayer(this.pdfPage.streamTextContent(true, true), this.div, viewport);

    // const { textDivs, textContentItemsStr } = this.#textLayer;
    const { textDivs } = this.#textLayer;
    // this.highlighter?.setTextMapping(textDivs, textContentItemsStr);
    this.accessibilityManager?.setTextMapping(textDivs);

    await this.#textLayer.render();
    this.#renderingDone = true;

    const endOfContent = document.createElement("div");
    endOfContent.className = "endOfContent";
    this.div.append(endOfContent);

    this.#bindMouse(endOfContent);
    // Ensure that the textLayer is appended to the DOM *before* handling
    // e.g. a pending search operation.
    this.#onAppend?.(this.div);
    // this.highlighter?.enable();
    this.accessibilityManager?.enable();
  }

  hide() {
    if (!this.div.hidden && this.#renderingDone) {
      // We turn off the highlighter in order to avoid to scroll into view an
      // element of the text layer which could be hidden.
      // this.highlighter?.disable();
      this.div.hidden = true;
    }
  }

  show() {
    if (this.div.hidden && this.#renderingDone) {
      this.div.hidden = false;
      // this.highlighter?.enable();
    }
  }

  /**
   * Cancel rendering of the text layer.
   */
  cancel() {
    this.#textLayer?.cancel();
    this.#textLayer = null;

    // this.highlighter?.disable();
    this.accessibilityManager?.disable();
    TextLayerBuilder.#removeGlobalSelectionListener(this.div);
  }

  /**
   * Improves text selection by adding an additional div where the mouse was
   * clicked. This reduces flickering of the content if the mouse is slowly
   * dragged up or down.
   */
  #bindMouse(end: HTMLDivElement) {
    const { div } = this;

    div.addEventListener("mousedown", () => {
      div.classList.add("selecting");
    });

    div.addEventListener("copy", event => {
      if (!this.#enablePermissions) {
        const selection = document.getSelection()!;
        event.clipboardData!.setData(
          "text/plain",
          removeNullCharacters(normalizeUnicode(selection.toString()))
        );
      }
      event.preventDefault();
      event.stopPropagation();
    });

    TextLayerBuilder.#textLayers.set(div, end);
    TextLayerBuilder.#enableGlobalSelectionListener();
  }

  static #removeGlobalSelectionListener(textLayerDiv: HTMLDivElement) {
    this.#textLayers.delete(textLayerDiv);

    if (this.#textLayers.size === 0) {
      this.#selectionChangeAbortController?.abort();
      this.#selectionChangeAbortController = null;
    }
  }

  static #enableGlobalSelectionListener() {
    if (this.#selectionChangeAbortController) {
      // document-level event listeners already installed
      return;
    }
    this.#selectionChangeAbortController = new AbortController();
    const { signal } = this.#selectionChangeAbortController;

    const reset = (end: HTMLDivElement, textLayer: HTMLDivElement) => {
      textLayer.append(end);
      end.style.width = "";
      end.style.height = "";
      textLayer.classList.remove("selecting");
    };

    let isPointerDown = false;
    const eventOptions = { signal };
    document.addEventListener("pointerdown", () => isPointerDown = true, eventOptions);
    document.addEventListener("pointerup", () => {
      isPointerDown = false;
      this.#textLayers.forEach(reset);
    }, eventOptions);
    window.addEventListener("blur", () => {
      isPointerDown = false;
      this.#textLayers.forEach(reset);
    }, eventOptions);
    document.addEventListener("keyup", () => {
      if (!isPointerDown) {
        this.#textLayers.forEach(reset);
      }
    }, eventOptions);

    let isFirefox: boolean, prevRange: Range | null = null;

    document.addEventListener("selectionchange", () => {
      const selection = document.getSelection()!;
      if (selection.rangeCount === 0) {
        this.#textLayers.forEach(reset);
        return;
      }

      // Even though the spec says that .rangeCount should be 0 or 1, Firefox
      // creates multiple ranges when selecting across multiple pages.
      // Make sure to collect all the .textLayer elements where the selection
      // is happening.
      const activeTextLayers = new Set();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const textLayerDiv of this.#textLayers.keys()) {
          if (
            !activeTextLayers.has(textLayerDiv) &&
            range.intersectsNode(textLayerDiv)
          ) {
            activeTextLayers.add(textLayerDiv);
          }
        }
      }

      for (const [textLayerDiv, endDiv] of this.#textLayers) {
        if (activeTextLayers.has(textLayerDiv)) {
          textLayerDiv.classList.add("selecting");
        } else {
          reset(endDiv, textLayerDiv);
        }
      }

      if (BrowserUtil.isFirefox()) {
        return;
      }
      if (!BrowserUtil.isChrome()) {
        isFirefox ??=
          getComputedStyle(
            <Element>this.#textLayers.values().next().value
          ).getPropertyValue("-moz-user-select") === "none";

        if (isFirefox) {
          return;
        }
      }
      // In non-Firefox browsers, when hovering over an empty space (thus,
      // on .endOfContent), the selection will expand to cover all the
      // text between the current selection and .endOfContent. By moving
      // .endOfContent to right after (or before, depending on which side
      // of the selection the user is moving), we limit the selection jump
      // to at most cover the enteirety of the <span> where the selection
      // is being modified.
      const range = selection.getRangeAt(0);
      const modifyStart =
        prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode;
      }

      const parentTextLayer = <HTMLDivElement>anchor!.parentElement?.closest(".textLayer")!;
      const endDiv = this.#textLayers.get(parentTextLayer);
      if (endDiv) {
        endDiv.style.width = parentTextLayer.style.width;
        endDiv.style.height = parentTextLayer.style.height;
        anchor!.parentElement!.insertBefore(
          endDiv, modifyStart ? anchor : anchor!.nextSibling
        );
      }

      prevRange = range.cloneRange();
    },
      eventOptions
    );
  }
}
