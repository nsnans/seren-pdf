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

// eslint-disable-next-line max-len
/** @typedef {import("./annotation_editor_layer.js").AnnotationEditorLayer} AnnotationEditorLayer */

import { AnnotationData } from "../../core/annotation";
import { PlatformHelper } from "../../platform/platform_helper";
import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  assert,
  LINE_FACTOR,
  shadow
} from "../../shared/util";
import { IL10n } from "../../viewer/common/component_types";
import { AnnotationElement } from "../annotation_layer";
import { AnnotationEditor, AnnotationEditorHelper } from "./editor";
import { AnnotationEditorSerial } from "./state/editor_serializable";
import { AnnotationEditorState } from "./state/editor_state";
import {
  AnnotationEditorUIManager,
  bindEvents,
  KeyboardManager,
} from "./tools";

const EOL_PATTERN = /\r\n?|\n/g;

/**
 * Basic text editor in order to create a FreeTex annotation.
 */
export class FreeTextEditor extends AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial> {

  static _freeTextDefaultContent = "";

  static _internalPadding = 0;

  static _defaultColor = null;

  static _defaultFontSize = 10;


  static get _keyboardManager() {
    const proto = FreeTextEditor.prototype;

    const arrowChecker = (self: FreeTextEditor) => self.isEmpty();

    const small = AnnotationEditorUIManager.TRANSLATE_SMALL;
    const big = AnnotationEditorUIManager.TRANSLATE_BIG;

    return shadow(
      this,
      "_keyboardManager",
      new KeyboardManager<FreeTextEditor>([
        [
          // Commit the text in case the user use ctrl+s to save the document.
          // The event must bubble in order to be caught by the viewer.
          // See bug 1831574.
          ["ctrl+s", "mac+meta+s", "ctrl+p", "mac+meta+p"],
          proto.commitOrRemove,
          { bubbles: true },
        ],
        [
          ["ctrl+Enter", "mac+meta+Enter", "Escape", "mac+Escape"],
          proto.commitOrRemove,
        ],
        [
          ["ArrowLeft", "mac+ArrowLeft"],
          proto._translateEmpty,
          { args: [-small, 0], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowLeft", "mac+shift+ArrowLeft"],
          proto._translateEmpty,
          { args: [-big, 0], checker: arrowChecker },
        ],
        [
          ["ArrowRight", "mac+ArrowRight"],
          proto._translateEmpty,
          { args: [small, 0], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowRight", "mac+shift+ArrowRight"],
          proto._translateEmpty,
          { args: [big, 0], checker: arrowChecker },
        ],
        [
          ["ArrowUp", "mac+ArrowUp"],
          proto._translateEmpty,
          { args: [0, -small], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowUp", "mac+shift+ArrowUp"],
          proto._translateEmpty,
          { args: [0, -big], checker: arrowChecker },
        ],
        [
          ["ArrowDown", "mac+ArrowDown"],
          proto._translateEmpty,
          { args: [0, small], checker: arrowChecker },
        ],
        [
          ["ctrl+ArrowDown", "mac+shift+ArrowDown"],
          proto._translateEmpty,
          { args: [0, big], checker: arrowChecker },
        ],
      ])
    );
  }

  static _type = "freetext";

  static _editorType = AnnotationEditorType.FREETEXT;

  #color: string;

  #content = "";

  #editorDivId = `${this.id}-editor`;

  #editModeAC: AbortController | null = null;

  #fontSize: number;

  protected editorDiv: HTMLDivElement | null = null;

  protected overlayDiv: HTMLDivElement | null = null;

  constructor(params) {
    super({ ...params, name: "freeTextEditor" });
    this.#color =
      params.color ||
      FreeTextEditor._defaultColor ||
      AnnotationEditorHelper._defaultLineColor;
    this.#fontSize = params.fontSize || FreeTextEditor._defaultFontSize;
  }

  /** @inheritdoc */
  static initialize(l10n: IL10n, uiManager: AnnotationEditorUIManager) {
    AnnotationEditorHelper.initialize(l10n, uiManager);
    const style = getComputedStyle(document.documentElement);

    if (PlatformHelper.isTesting()) {
      const lineHeight = parseFloat(
        style.getPropertyValue("--freetext-line-height")
      );
      assert(
        lineHeight === LINE_FACTOR,
        "Update the CSS variable to agree with the constant."
      );
    }

    this._internalPadding = parseFloat(
      style.getPropertyValue("--freetext-padding")
    );
  }

  /** @inheritdoc */
  static updateDefaultParams(type: number, value: any) {
    switch (type) {
      case AnnotationEditorParamsType.FREETEXT_SIZE:
        FreeTextEditor._defaultFontSize = value;
        break;
      case AnnotationEditorParamsType.FREETEXT_COLOR:
        FreeTextEditor._defaultColor = value;
        break;
    }
  }

  /** @inheritdoc */
  updateParams(type: number, value: any) {
    switch (type) {
      case AnnotationEditorParamsType.FREETEXT_SIZE:
        this.#updateFontSize(value);
        break;
      case AnnotationEditorParamsType.FREETEXT_COLOR:
        this.#updateColor(value);
        break;
    }
  }

  /** @inheritdoc */
  static get defaultPropertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.FREETEXT_SIZE,
        FreeTextEditor._defaultFontSize,
      ],
      [
        AnnotationEditorParamsType.FREETEXT_COLOR,
        FreeTextEditor._defaultColor || AnnotationEditorHelper._defaultLineColor,
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate(): [[number, number], [number, string]] {
    return [
      [AnnotationEditorParamsType.FREETEXT_SIZE, this.#fontSize],
      [AnnotationEditorParamsType.FREETEXT_COLOR, this.#color],
    ];
  }

  /**
   * Update the font size and make this action as undoable.
   * @param {number} fontSize
   */
  #updateFontSize(fontSize: number) {
    const setFontsize = (size: number) => {
      this.editorDiv!.style.fontSize = `calc(${size}px * var(--scale-factor))`;
      this.translate(0, -(size - this.#fontSize) * this.parentScale);
      this.#fontSize = size;
      this.#setEditorDimensions();
    };
    const savedFontsize = this.#fontSize;
    this.addCommands(
      setFontsize.bind(this, fontSize),
      setFontsize.bind(this, savedFontsize),
      this._uiManager.updateUI.bind(this._uiManager, this),
      true,
      AnnotationEditorParamsType.FREETEXT_SIZE,
      true,
      true,
    );
  }

  /**
   * Update the color and make this action undoable.
   * @param {string} color
   */
  #updateColor(color: string) {
    const setColor = (col: string) => {
      this.#color = this.editorDiv!.style.color = col;
    };
    const savedColor = this.#color;
    this.addCommands(
      setColor.bind(this, color),
      setColor.bind(this, savedColor),
      this._uiManager.updateUI.bind(this._uiManager, this),
      true,
      AnnotationEditorParamsType.FREETEXT_COLOR,
      true,
      true,
    );
  }

  /**
   * Helper to translate the editor with the keyboard when it's empty.
   * @param {number} x in page units.
   * @param {number} y in page units.
   */
  _translateEmpty(x: number, y: number) {
    this._uiManager.translateSelectedEditors(x, y, /* noCommit = */ true);
  }

  /** @inheritdoc */
  getInitialTranslation() {
    // The start of the base line is where the user clicked.
    const scale = this.parentScale;
    return [
      -FreeTextEditor._internalPadding * scale,
      -(FreeTextEditor._internalPadding + this.#fontSize) * scale,
    ];
  }

  /** @inheritdoc */
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilting it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
  }

  /** @inheritdoc */
  enableEditMode() {
    if (this.isInEditMode()) {
      return;
    }

    this.parent!.setEditingState(false);
    this.parent!.updateToolbar(AnnotationEditorType.FREETEXT);
    super.enableEditMode();
    this.overlayDiv!.classList.remove("enabled");
    this.editorDiv!.contentEditable = "true";
    this._isDraggable = false;
    this.div!.removeAttribute("aria-activedescendant");

    if (PlatformHelper.isTesting()) {
      assert(
        !this.#editModeAC,
        "No `this.#editModeAC` AbortController should exist."
      );
    }
    this.#editModeAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#editModeAC);

    this.editorDiv!.addEventListener(
      "keydown",
      this.editorDivKeydown.bind(this),
      { signal }
    );
    this.editorDiv!.addEventListener("focus", this.editorDivFocus.bind(this), {
      signal,
    });
    this.editorDiv!.addEventListener("blur", this.editorDivBlur.bind(this), {
      signal,
    });
    this.editorDiv!.addEventListener("input", this.editorDivInput.bind(this), {
      signal,
    });
  }

  /** @inheritdoc */
  disableEditMode() {
    if (!this.isInEditMode()) {
      return;
    }

    this.parent!.setEditingState(true);
    super.disableEditMode();
    this.overlayDiv!.classList.add("enabled");
    this.editorDiv!.contentEditable = "false";
    this.div!.setAttribute("aria-activedescendant", this.#editorDivId);
    this._isDraggable = true;

    this.#editModeAC?.abort();
    this.#editModeAC = null;

    // On Chrome, the focus is given to <body> when contentEditable is set to
    // false, hence we focus the div.
    this.div!.focus({
      preventScroll: true /* See issue #15744 */,
    });

    // In case the blur callback hasn't been called.
    this.isEditing = false;
    this.parent!.div!.classList.add("freetextEditing");
  }

  /** @inheritdoc */
  focusin(event: FocusEvent) {
    if (!this._focusEventsAllowed) {
      return;
    }
    super.focusin(event);
    if (event.target !== this.editorDiv) {
      this.editorDiv!.focus();
    }
  }

  /** @inheritdoc */
  onceAdded() {
    if (this.width) {
      // The editor was created in using ctrl+c.
      return;
    }
    this.enableEditMode();
    this.editorDiv!.focus();
    if (this._initialOptions?.isCentered) {
      this.center();
    }
    this._initialOptions = null;
  }

  /** @inheritdoc */
  isEmpty() {
    return !this.editorDiv || this.editorDiv.innerText.trim() === "";
  }

  /** @inheritdoc */
  remove() {
    this.isEditing = false;
    if (this.parent) {
      this.parent.setEditingState(true);
      this.parent.div!.classList.add("freetextEditing");
    }
    super.remove();
  }

  /**
   * Extract the text from this editor.
   * @returns {string}
   */
  #extractText() {
    // We don't use innerText because there are some bugs with line breaks.
    const buffer = [];
    this.editorDiv!.normalize();
    let prevChild = null;
    for (const child of this.editorDiv!.childNodes) {
      if (prevChild?.nodeType === Node.TEXT_NODE && child.nodeName === "BR") {
        // It can happen if the user uses shift+enter to add a new line.
        // If we don't skip it, we'll end up with an extra line (one for the
        // text and one for the br element).
        continue;
      }
      buffer.push(FreeTextEditor.#getNodeContent(child));
      prevChild = child;
    }
    return buffer.join("\n");
  }

  #setEditorDimensions() {
    const [parentWidth, parentHeight] = this.parentDimensions;

    let rect;
    if (this.isAttachedToDOM) {
      rect = this.div!.getBoundingClientRect();
    } else {
      // This editor isn't on screen but we need to get its dimensions, so
      // we just insert it in the DOM, get its bounding box and then remove it.
      const { currentLayer, div } = this;
      const savedDisplay = div!.style.display;
      const savedVisibility = div!.classList.contains("hidden");
      div!.classList.remove("hidden");
      div!.style.display = "hidden";
      currentLayer.div!.append(this.div!);
      rect = div!.getBoundingClientRect();
      div!.remove();
      div!.style.display = savedDisplay;
      div!.classList.toggle("hidden", savedVisibility);
    }

    // The dimensions are relative to the rotation of the page, hence we need to
    // take that into account (see issue #16636).
    if (this.rotation % 180 === this.parentRotation % 180) {
      this.width = rect.width / parentWidth;
      this.height = rect.height / parentHeight;
    } else {
      this.width = rect.height / parentWidth;
      this.height = rect.width / parentHeight;
    }
    this.fixAndSetPosition();
  }

  /**
   * Commit the content we have in this editor.
   * @returns {undefined}
   */
  commit() {
    if (!this.isInEditMode()) {
      return;
    }

    super.commit();
    this.disableEditMode();
    const savedText = this.#content;
    const newText = (this.#content = this.#extractText().trimEnd());
    if (savedText === newText) {
      return;
    }

    const setText = (text: string) => {
      this.#content = text;
      if (!text) {
        this.remove();
        return;
      }
      this.#setContent();
      this._uiManager.rebuild(this);
      this.#setEditorDimensions();
    };
    this.addCommands(
      () => {
        setText(newText);
      },
      () => {
        setText(savedText);
      },
      () => { },
      false,
    );
    this.#setEditorDimensions();
  }

  /** @inheritdoc */
  shouldGetKeyboardEvents() {
    return this.isInEditMode();
  }

  /** @inheritdoc */
  enterInEditMode() {
    this.enableEditMode();
    this.editorDiv!.focus();
  }

  /**
   * ondblclick callback.
   * @param {MouseEvent} event
   */
  dblclick(_event: MouseEvent) {
    this.enterInEditMode();
  }

  /**
   * onkeydown callback.
   * @param {KeyboardEvent} event
   */
  keydown(event: KeyboardEvent) {
    if (event.target === this.div && event.key === "Enter") {
      this.enterInEditMode();
      // Avoid to add an unwanted new line.
      event.preventDefault();
    }
  }

  editorDivKeydown(event: KeyboardEvent) {
    FreeTextEditor._keyboardManager.exec(this, event);
  }

  editorDivFocus(_event: FocusEvent) {
    this.isEditing = true;
  }

  editorDivBlur(_event: FocusEvent) {
    this.isEditing = false;
  }

  editorDivInput(_event: Event) {
    this.parent!.div!.classList.toggle("freetextEditing", this.isEmpty());
  }

  /** @inheritdoc */
  disableEditing() {
    this.editorDiv!.setAttribute("role", "comment");
    this.editorDiv!.removeAttribute("aria-multiline");
  }

  /** @inheritdoc */
  enableEditing() {
    this.editorDiv!.setAttribute("role", "textbox");
    this.editorDiv!.setAttribute("aria-multiline", "true");
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    let baseX, baseY;
    if (this.width) {
      baseX = this.x;
      baseY = this.y;
    }

    super.render();
    this.editorDiv = document.createElement("div");
    this.editorDiv.className = "internal";

    this.editorDiv.setAttribute("id", this.#editorDivId);
    this.editorDiv.setAttribute("data-l10n-id", "pdfjs-free-text2");
    this.editorDiv.setAttribute("data-l10n-attrs", "default-content");
    this.enableEditing();

    this.editorDiv.contentEditable = "true";

    const { style } = this.editorDiv;
    style.fontSize = `calc(${this.#fontSize}px * var(--scale-factor))`;
    style.color = this.#color;

    this.div!.append(this.editorDiv);

    this.overlayDiv = document.createElement("div");
    this.overlayDiv.classList.add("overlay", "enabled");
    this.div!.append(this.overlayDiv);

    bindEvents(this, this.div!, ["dblclick", "keydown"]);

    if (this.width) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      if (this.annotationElementId) {
        // This stuff is hard to test: if something is changed here, please
        // test with the following PDF file:
        //  - freetexts.pdf
        //  - rotated_freetexts.pdf
        // Only small variations between the original annotation and its editor
        // are allowed.

        // position is the position of the first glyph in the annotation
        // and it's relative to its container.
        const { position } = this._initialData!;
        let [tx, ty] = this.getInitialTranslation();
        [tx, ty] = this.pageTranslationToScreen(tx, ty);
        const [pageWidth, pageHeight] = this.pageDimensions;
        const [pageX, pageY] = this.pageTranslation;
        let posX, posY;
        switch (this.rotation) {
          case 0:
            posX = baseX! + (position[0] - pageX) / pageWidth;
            posY = baseY! + this.height - (position[1] - pageY) / pageHeight;
            break;
          case 90:
            posX = baseX! + (position[0] - pageX) / pageWidth;
            posY = baseY! - (position[1] - pageY) / pageHeight;
            [tx, ty] = [ty, -tx];
            break;
          case 180:
            posX = baseX! - this.width + (position[0] - pageX) / pageWidth;
            posY = baseY! - (position[1] - pageY) / pageHeight;
            [tx, ty] = [-tx, -ty];
            break;
          case 270:
            posX =
              baseX! +
              (position[0] - pageX - this.height * pageHeight) / pageWidth;
            posY =
              baseY! +
              (position[1] - pageY - this.width * pageWidth) / pageHeight;
            [tx, ty] = [-ty, tx];
            break;
        }
        this.setAt(posX! * parentWidth, posY! * parentHeight, tx, ty);
      } else {
        this.setAt(
          baseX! * parentWidth,
          baseY! * parentHeight,
          this.width * parentWidth,
          this.height * parentHeight
        );
      }

      this.#setContent();
      this._isDraggable = true;
      this.editorDiv.contentEditable = "false";
    } else {
      this._isDraggable = false;
      this.editorDiv.contentEditable = "true";
    }

    if (PlatformHelper.isTesting()) {
      this.div!.setAttribute("annotation-id", this.annotationElementId!);
    }

    return this.div;
  }

  static #getNodeContent(node) {
    return (
      node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.innerText
    ).replaceAll(EOL_PATTERN, "");
  }

  #setContent() {
    this.editorDiv!.replaceChildren();
    if (!this.#content) {
      return;
    }
    for (const line of this.#content.split("\n")) {
      const div = document.createElement("div");
      div.append(
        line ? document.createTextNode(line) : document.createElement("br")
      );
      this.editorDiv!.append(div);
    }
  }

  /** @inheritdoc */
  get contentDiv() {
    return this.editorDiv;
  }

  /** @inheritdoc */
  renderAnnotationElement(annotation: AnnotationElement<AnnotationData>) {
    const content = super.renderAnnotationElement(annotation)!;
    if (this.deleted) {
      return content;
    }
    const { style } = content;
    style.fontSize = `calc(${this.#fontSize}px * var(--scale-factor))`;
    style.color = this.#color;

    content.replaceChildren();
    for (const line of this.#content.split("\n")) {
      const div = document.createElement("div");
      div.append(
        line ? document.createTextNode(line) : document.createElement("br")
      );
      content.append(div);
    }

    const padding = FreeTextEditor._internalPadding * this.parentScale;
    annotation.updateEdited(this.getRect(padding, padding), this.#content);

    return content;
  }

  resetAnnotationElement(annotation: AnnotationElement<AnnotationData>) {
    super.resetAnnotationElement(annotation);
    annotation.resetEdited();
  }
}
