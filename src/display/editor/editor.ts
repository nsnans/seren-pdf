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

import { FeatureTest, shadow, unreachable } from "../../shared/util";
import { IL10n } from "../../viewer/common/component_types";
import { noContextMenu, RectType } from "../display_utils";
import { AltText } from "./alt_text";
import { AnnotationEditorLayer } from "./annotation_editor_layer";
import { AnnotationEditorState } from "./state/editor_state";
import { EditorToolbar } from "./toolbar";
import {
  AnnotationEditorUIManager,
  bindEvents,
  ColorManager,
  KeyboardManager,
} from "./tools";

/**
 * @typedef {Object} AnnotationEditorParameters
 * @property {AnnotationEditorUIManager} uiManager - the global manager
 * @property {AnnotationEditorLayer} parent - the layer containing this editor
 * @property {string} id - editor id
 * @property {number} x - x-coordinate
 * @property {number} y - y-coordinate
 */
interface AnnotationEditorParameters {
  uiManager: AnnotationEditorUIManager;
  parent: AnnotationEditorLayer;
  id: string;
  x: number;
  y: number;
  name: string;
  isCentered: boolean;
}


export class AnnotationEditorHelper {

  static _l10n: IL10n | null = null;

  static _l10nResizer: {
    topLeft: string,
    topMiddle: string,
    topRight: string,
    middleRight: string,
    bottomRight: string,
    bottomMiddle: string,
    bottomLeft: string,
    middleLeft: string,
  } | null = null;

  static _borderLineWidth = -1;

  static _colorManager = new ColorManager();

  static _zIndex = 1;

  static get _defaultLineColor() {
    return shadow(
      this,
      "_defaultLineColor",
      this._colorManager.getHexCode("CanvasText")
    );
  }

  // Time to wait (in ms) before sending the telemetry data.
  // We wait a bit to avoid sending too many requests when changing something
  // like the thickness of a line.
  static _telemetryTimeout = 1000;

  static get _resizerKeyboardManager() {
    const resize = AnnotationEditor.prototype._resizeWithKeyboard;
    const small = AnnotationEditorUIManager.TRANSLATE_SMALL;
    const big = AnnotationEditorUIManager.TRANSLATE_BIG;

    return shadow(
      this,
      "_resizerKeyboardManager",
      new KeyboardManager([
        [["ArrowLeft", "mac+ArrowLeft"], resize, { args: [-small, 0] }],
        [
          ["ctrl+ArrowLeft", "mac+shift+ArrowLeft"],
          resize,
          { args: [-big, 0] },
        ],
        [["ArrowRight", "mac+ArrowRight"], resize, { args: [small, 0] }],
        [
          ["ctrl+ArrowRight", "mac+shift+ArrowRight"],
          resize,
          { args: [big, 0] },
        ],
        [["ArrowUp", "mac+ArrowUp"], resize, { args: [0, -small] }],
        [["ctrl+ArrowUp", "mac+shift+ArrowUp"], resize, { args: [0, -big] }],
        [["ArrowDown", "mac+ArrowDown"], resize, { args: [0, small] }],
        [["ctrl+ArrowDown", "mac+shift+ArrowDown"], resize, { args: [0, big] }],
        [
          ["Escape", "mac+Escape"],
          AnnotationEditor.prototype._stopResizingWithKeyboard,
        ],
      ])
    );
  }

}


class AnnotationEditor<T extends AnnotationEditorState> {

  protected state: T;

  #accessibilityData = null;

  #allResizerDivs: HTMLDivElement[] | null = null;

  #altText: AltText | null = null;

  #disabled = false;

  #keepAspectRatio = false;

  #resizersDiv: HTMLDivElement | null = null;

  #savedDimensions: { savedX: number; savedY: number; savedWidth: number; savedHeight: number; } | null = null;

  #focusAC: AbortController | null = null;

  #focusedResizerName = "";

  #hasBeenClicked = false;

  #initialPosition: [number, number] | null = null;

  #isEditing = false;

  #isInEditMode = false;

  #isResizerEnabledForKeyboard = false;

  #moveInDOMTimeout: number | null = null;

  #prevDragX = 0;

  #prevDragY = 0;

  // TODO 这里需要再分析分析
  #telemetryTimeouts: Map<unknown, number> | null = null;

  #isDraggable = false;

  #zIndex = AnnotationEditorHelper._zIndex++;

  _editToolbar: EditorToolbar | null = null;

  _initialOptions = Object.create(null);

  _initialData = null;

  protected _isVisible = true;

  protected _focusEventsAllowed = true;

  protected parent: AnnotationEditorLayer | null;

  protected id: string;

  protected x: number;

  protected y: number;

  protected _willKeepAspectRatio: boolean;

  public _uiManager: AnnotationEditorUIManager;

  protected deleted: boolean;

  protected isAttachedToDOM: boolean;

  protected width: number;

  protected height: number;

  protected pageIndex: number;

  protected name: string;

  protected div: HTMLDivElement | null;

  public annotationElementId: string | null;

  protected _structTreeParentId: string | null;

  protected rotation: number;

  protected pageRotation: number;

  protected pageDimensions: [number, number];

  protected pageTranslation: [number, number];

  /**
   * @param {AnnotationEditorParameters} parameters
   */
  constructor(parameters: AnnotationEditorParameters) {
    this.parent = parameters.parent;
    this.id = parameters.id;
    this.width = this.height = 0;
    this.pageIndex = parameters.parent.pageIndex;
    this.name = parameters.name;
    this.div = null;
    this._uiManager = parameters.uiManager;
    this.annotationElementId = null;
    this._willKeepAspectRatio = false;
    this._initialOptions.isCentered = parameters.isCentered;
    this._structTreeParentId = null;

    const {
      rotation,
      rawDims: { pageWidth, pageHeight, pageX, pageY },
    } = this.parent.viewport;

    this.rotation = rotation;
    this.pageRotation =
      (360 + rotation - this._uiManager.viewParameters.rotation) % 360;
    this.pageDimensions = [pageWidth, pageHeight];
    this.pageTranslation = [pageX, pageY];

    const [width, height] = this.parentDimensions;
    this.x = parameters.x / width;
    this.y = parameters.y / height;

    this.isAttachedToDOM = false;
    this.deleted = false;
  }

  get editorType() {
    return Object.getPrototypeOf(this).constructor._type;
  }

  static deleteAnnotationElement(editor: AnnotationEditor) {
    const fakeEditor = new FakeEditor({
      id: editor.parent!.getNextId(),
      parent: editor.parent,
      uiManager: editor._uiManager,
    });
    fakeEditor.annotationElementId = editor.annotationElementId;
    fakeEditor.deleted = true;
    fakeEditor._uiManager.addToAnnotationStorage(fakeEditor);
  }

  /**
   * Initialize the l10n stuff for this type of editor.
   * @param {Object} l10n
   */
  static initialize(l10n: IL10n, _uiManager: AnnotationEditorUIManager) {
    AnnotationEditorHelper._l10n ??= l10n;

    AnnotationEditorHelper._l10nResizer ||= Object.freeze({
      topLeft: "pdfjs-editor-resizer-top-left",
      topMiddle: "pdfjs-editor-resizer-top-middle",
      topRight: "pdfjs-editor-resizer-top-right",
      middleRight: "pdfjs-editor-resizer-middle-right",
      bottomRight: "pdfjs-editor-resizer-bottom-right",
      bottomMiddle: "pdfjs-editor-resizer-bottom-middle",
      bottomLeft: "pdfjs-editor-resizer-bottom-left",
      middleLeft: "pdfjs-editor-resizer-middle-left",
    });

    if (AnnotationEditorHelper._borderLineWidth !== -1) {
      return;
    }
    const style = getComputedStyle(document.documentElement);
    AnnotationEditorHelper._borderLineWidth =
      parseFloat(style.getPropertyValue("--outline-width")) || 0;
  }

  /**
   * Update the default parameters for this type of editor.
   * @param {number} _type
   * @param {*} _value
   */
  static updateDefaultParams(_type: number, _value: any) { }

  /**
   * Get the default properties to set in the UI for this type of editor.
   * @returns {Array}
   */
  static get defaultPropertiesToUpdate() {
    return [];
  }

  /**
   * Check if this kind of editor is able to handle the given mime type for
   * pasting.
   * @param {string} mime
   * @returns {boolean}
   */
  static isHandlingMimeForPasting(_mime: string) {
    return false;
  }

  /**
   * Extract the data from the clipboard item and delegate the creation of the
   * editor to the parent.
   * @param {DataTransferItem} item
   * @param {AnnotationEditorLayer} parent
   */
  static paste(_item, _parent: AnnotationEditorLayer) {
    unreachable("Not implemented");
  }

  /**
   * Get the properties to update in the UI for this editor.
   * @returns {Array}
   */
  get propertiesToUpdate(): any[][] {
    return [];
  }

  get _isDraggable() {
    return this.#isDraggable;
  }

  set _isDraggable(value) {
    this.#isDraggable = value;
    this.div?.classList.toggle("draggable", value);
  }

  /**
   * @returns {boolean} true if the editor handles the Enter key itself.
   */
  get isEnterHandled() {
    return true;
  }

  center() {
    const [pageWidth, pageHeight] = this.pageDimensions;
    switch (this.parentRotation) {
      case 90:
        this.x -= (this.height * pageHeight) / (pageWidth * 2);
        this.y += (this.width * pageWidth) / (pageHeight * 2);
        break;
      case 180:
        this.x += this.width / 2;
        this.y += this.height / 2;
        break;
      case 270:
        this.x += (this.height * pageHeight) / (pageWidth * 2);
        this.y -= (this.width * pageWidth) / (pageHeight * 2);
        break;
      default:
        this.x -= this.width / 2;
        this.y -= this.height / 2;
        break;
    }
    this.fixAndSetPosition();
  }

  /**
   * Add some commands into the CommandManager (undo/redo stuff).
   * @param {Object} params
   */
  addCommands(params) {
    this._uiManager.addCommands(params);
  }

  get currentLayer() {
    return this._uiManager.currentLayer;
  }

  /**
   * This editor will be behind the others.
   */
  setInBackground() {
    this.div!.style.zIndex = "0";
  }

  /**
   * This editor will be in the foreground.
   */
  setInForeground() {
    this.div!.style.zIndex = `${this.#zIndex}`;
  }

  setParent(parent: AnnotationEditorLayer) {
    if (parent !== null) {
      this.pageIndex = parent.pageIndex;
      this.pageDimensions = parent.pageDimensions;
    } else {
      // The editor is being removed from the DOM, so we need to stop resizing.
      this.#stopResizing();
    }
    this.parent = parent;
  }

  /**
   * onfocus callback.
   */
  focusin(_event: FocusEvent) {
    if (!this._focusEventsAllowed) {
      return;
    }
    if (!this.#hasBeenClicked) {
      this.parent.setSelected(this);
    } else {
      this.#hasBeenClicked = false;
    }
  }

  /**
   * onblur callback.
   * @param {FocusEvent} event
   */
  focusout(event: FocusEvent) {
    if (!this._focusEventsAllowed) {
      return;
    }

    if (!this.isAttachedToDOM) {
      return;
    }

    // In case of focusout, the relatedTarget is the element which
    // is grabbing the focus.
    // So if the related target is an element under the div for this
    // editor, then the editor isn't unactive.
    const target = event.relatedTarget;
    if (target?.closest(`#${this.id}`)) {
      return;
    }

    event.preventDefault();

    if (!this.parent?.isMultipleSelection) {
      this.commitOrRemove();
    }
  }

  commitOrRemove() {
    if (this.isEmpty()) {
      this.remove();
    } else {
      this.commit();
    }
  }

  /**
   * Commit the data contained in this editor.
   */
  commit() {
    this.addToAnnotationStorage();
  }

  addToAnnotationStorage() {
    this._uiManager.addToAnnotationStorage(this);
  }

  /**
   * Set the editor position within its parent.
   * @param {number} x
   * @param {number} y
   * @param {number} tx - x-translation in screen coordinates.
   * @param {number} ty - y-translation in screen coordinates.
   */
  setAt(x: number, y: number, tx: number, ty: number) {
    const [width, height] = this.parentDimensions;
    [tx, ty] = this.screenToPageTranslation(tx, ty);

    this.x = (x + tx) / width;
    this.y = (y + ty) / height;

    this.fixAndSetPosition();
  }

  #translate([width, height]: [number, number], x: number, y: number) {
    [x, y] = this.screenToPageTranslation(x, y);

    this.x += x / width;
    this.y += y / height;

    this.fixAndSetPosition();
  }

  /**
   * Translate the editor position within its parent.
   * @param {number} x - x-translation in screen coordinates.
   * @param {number} y - y-translation in screen coordinates.
   */
  translate(x: number, y: number) {
    // We don't change the initial position because the move here hasn't been
    // done by the user.
    this.#translate(this.parentDimensions, x, y);
  }

  /**
   * Translate the editor position within its page and adjust the scroll
   * in order to have the editor in the view.
   * @param {number} x - x-translation in page coordinates.
   * @param {number} y - y-translation in page coordinates.
   */
  translateInPage(x: number, y: number) {
    this.#initialPosition ||= [this.x, this.y];
    this.#translate(this.pageDimensions, x, y);
    this.div!.scrollIntoView({ block: "nearest" });
  }

  drag(tx: number, ty: number) {
    this.#initialPosition ||= [this.x, this.y];
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.x += tx / parentWidth;
    this.y += ty / parentHeight;
    if (this.parent && (this.x < 0 || this.x > 1 || this.y < 0 || this.y > 1)) {
      // It's possible to not have a parent: for example, when the user is
      // dragging all the selected editors but this one on a page which has been
      // destroyed.
      // It's why we need to check for it. In such a situation, it isn't really
      // a problem to not find a new parent: it's something which is related to
      // what the user is seeing, hence it depends on how pages are layed out.

      // The element will be outside of its parent so change the parent.
      const { x, y } = this.div!.getBoundingClientRect();
      if (this.parent.findNewParent(this, x, y)) {
        this.x -= Math.floor(this.x);
        this.y -= Math.floor(this.y);
      }
    }

    // The editor can be moved wherever the user wants, so we don't need to fix
    // the position: it'll be done when the user will release the mouse button.

    let { x, y } = this;
    const [bx, by] = this.getBaseTranslation();
    x += bx;
    y += by;

    this.div!.style.left = `${(100 * x).toFixed(2)}%`;
    this.div!.style.top = `${(100 * y).toFixed(2)}%`;
    this.div!.scrollIntoView({ block: "nearest" });
  }

  get _hasBeenMoved() {
    return (
      !!this.#initialPosition &&
      (this.#initialPosition[0] !== this.x ||
        this.#initialPosition[1] !== this.y)
    );
  }

  /**
   * Get the translation to take into account the editor border.
   * The CSS engine positions the element by taking the border into account so
   * we must apply the opposite translation to have the editor in the right
   * position.
   * @returns {Array<number>}
   */
  getBaseTranslation(): [number, number] {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const { _borderLineWidth } = AnnotationEditorHelper;
    const x = _borderLineWidth / parentWidth;
    const y = _borderLineWidth / parentHeight;
    switch (this.rotation) {
      case 90:
        return [-x, y];
      case 180:
        return [x, y];
      case 270:
        return [x, -y];
      default:
        return [-x, -y];
    }
  }

  /**
   * @returns {boolean} true if position must be fixed (i.e. make the x and y
   * living in the page).
   */
  get _mustFixPosition(): boolean {
    return true;
  }

  /**
   * Fix the position of the editor in order to keep it inside its parent page.
   * @param {number} [rotation] - the rotation of the page.
   */
  fixAndSetPosition(rotation: number = this.rotation) {
    const [pageWidth, pageHeight] = this.pageDimensions;
    let { x, y, width, height } = this;
    width *= pageWidth;
    height *= pageHeight;
    x *= pageWidth;
    y *= pageHeight;

    if (this._mustFixPosition) {
      switch (rotation) {
        case 0:
          x = Math.max(0, Math.min(pageWidth - width, x));
          y = Math.max(0, Math.min(pageHeight - height, y));
          break;
        case 90:
          x = Math.max(0, Math.min(pageWidth - height, x));
          y = Math.min(pageHeight, Math.max(width, y));
          break;
        case 180:
          x = Math.min(pageWidth, Math.max(width, x));
          y = Math.min(pageHeight, Math.max(height, y));
          break;
        case 270:
          x = Math.min(pageWidth, Math.max(height, x));
          y = Math.max(0, Math.min(pageHeight - width, y));
          break;
      }
    }

    this.x = x /= pageWidth;
    this.y = y /= pageHeight;

    const [bx, by] = this.getBaseTranslation();
    x += bx;
    y += by;

    const { style } = this.div!;
    style.left = `${(100 * x).toFixed(2)}%`;
    style.top = `${(100 * y).toFixed(2)}%`;

    this.moveInDOM();
  }

  static #rotatePoint(x: number, y: number, angle: number) {
    switch (angle) {
      case 90:
        return [y, -x];
      case 180:
        return [-x, -y];
      case 270:
        return [-y, x];
      default:
        return [x, y];
    }
  }

  /**
   * Convert a screen translation into a page one.
   * @param {number} x
   * @param {number} y
   */
  screenToPageTranslation(x: number, y: number) {
    return AnnotationEditor.#rotatePoint(x, y, this.parentRotation);
  }

  /**
   * Convert a page translation into a screen one.
   * @param {number} x
   * @param {number} y
   */
  pageTranslationToScreen(x: number, y: number) {
    return AnnotationEditor.#rotatePoint(x, y, 360 - this.parentRotation);
  }

  #getRotationMatrix(rotation: number) {
    switch (rotation) {
      case 90: {
        const [pageWidth, pageHeight] = this.pageDimensions;
        return [0, -pageWidth / pageHeight, pageHeight / pageWidth, 0];
      }
      case 180:
        return [-1, 0, 0, -1];
      case 270: {
        const [pageWidth, pageHeight] = this.pageDimensions;
        return [0, pageWidth / pageHeight, -pageHeight / pageWidth, 0];
      }
      default:
        return [1, 0, 0, 1];
    }
  }

  get parentScale() {
    return this._uiManager.viewParameters.realScale;
  }

  get parentRotation() {
    return (this._uiManager.viewParameters.rotation + this.pageRotation) % 360;
  }

  get parentDimensions(): [number, number] {
    const {
      parentScale,
      pageDimensions: [pageWidth, pageHeight],
    } = this;
    return [pageWidth * parentScale, pageHeight * parentScale];
  }

  /**
   * Set the dimensions of this editor.
   * @param {number} width
   * @param {number} height
   */
  setDims(width: number, height: number) {
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.div!.style.width = `${((100 * width) / parentWidth).toFixed(2)}%`;
    if (!this.#keepAspectRatio) {
      this.div!.style.height = `${((100 * height) / parentHeight).toFixed(2)}%`;
    }
  }

  fixDims() {
    const { style } = this.div!;
    const { height, width } = style;
    const widthPercent = width.endsWith("%");
    const heightPercent = !this.#keepAspectRatio && height.endsWith("%");
    if (widthPercent && heightPercent) {
      return;
    }

    const [parentWidth, parentHeight] = this.parentDimensions;
    if (!widthPercent) {
      style.width = `${((100 * parseFloat(width)) / parentWidth).toFixed(2)}%`;
    }
    if (!this.#keepAspectRatio && !heightPercent) {
      style.height = `${((100 * parseFloat(height)) / parentHeight).toFixed(
        2
      )}%`;
    }
  }

  /**
   * Get the translation used to position this editor when it's created.
   * @returns {Array<number>}
   */
  getInitialTranslation() {
    return [0, 0];
  }

  #createResizers() {
    if (this.#resizersDiv) {
      return;
    }
    this.#resizersDiv = document.createElement("div");
    this.#resizersDiv.classList.add("resizers");
    // When the resizers are used with the keyboard, they're focusable, hence
    // we want to have them in this order (top left, top middle, top right, ...)
    // in the DOM to have the focus order correct.
    const classes = this._willKeepAspectRatio
      ? ["topLeft", "topRight", "bottomRight", "bottomLeft"]
      : [
        "topLeft",
        "topMiddle",
        "topRight",
        "middleRight",
        "bottomRight",
        "bottomMiddle",
        "bottomLeft",
        "middleLeft",
      ];
    const signal = this._uiManager._signal;
    for (const name of classes) {
      const div = document.createElement("div");
      this.#resizersDiv.append(div);
      div.classList.add("resizer", name);
      div.setAttribute("data-resizer-name", name);
      div.addEventListener(
        "pointerdown",
        this.#resizerPointerdown.bind(this, name),
        { signal }
      );
      div.addEventListener("contextmenu", noContextMenu, { signal });
      div.tabIndex = -1;
    }
    this.div!.prepend(this.#resizersDiv);
  }

  #resizerPointerdown(name: string, event: PointerEvent) {
    event.preventDefault();
    const { isMac } = FeatureTest.platform;
    if (event.button !== 0 || (event.ctrlKey && isMac)) {
      return;
    }

    this.#altText?.toggle(false);

    const savedDraggable = this._isDraggable;
    this._isDraggable = false;

    const ac = new AbortController();
    const signal = this._uiManager.combinedSignal(ac);

    this.parent.togglePointerEvents(false);
    window.addEventListener(
      "pointermove",
      this.#resizerPointermove.bind(this, name),
      { passive: true, capture: true, signal }
    );
    window.addEventListener("contextmenu", noContextMenu, { signal });
    const savedX = this.x;
    const savedY = this.y;
    const savedWidth = this.width;
    const savedHeight = this.height;
    const savedParentCursor = this.parent.div.style.cursor;
    const savedCursor = this.div!.style.cursor;
    this.div!.style.cursor = this.parent.div.style.cursor =
      window.getComputedStyle(event.target).cursor;

    const pointerUpCallback = () => {
      ac.abort();
      this.parent.togglePointerEvents(true);
      this.#altText?.toggle(true);
      this._isDraggable = savedDraggable;
      this.parent.div.style.cursor = savedParentCursor;
      this.div!.style.cursor = savedCursor;

      this.#addResizeToUndoStack(savedX, savedY, savedWidth, savedHeight);
    };
    window.addEventListener("pointerup", pointerUpCallback, { signal });
    // If the user switches to another window (with alt+tab), then we end the
    // resize session.
    window.addEventListener("blur", pointerUpCallback, { signal });
  }

  #addResizeToUndoStack(savedX: number, savedY: number, savedWidth: number, savedHeight: number) {
    const newX = this.x;
    const newY = this.y;
    const newWidth = this.width;
    const newHeight = this.height;
    if (
      newX === savedX &&
      newY === savedY &&
      newWidth === savedWidth &&
      newHeight === savedHeight
    ) {
      return;
    }

    this.addCommands({
      cmd: () => {
        this.width = newWidth;
        this.height = newHeight;
        this.x = newX;
        this.y = newY;
        const [parentWidth, parentHeight] = this.parentDimensions;
        this.setDims(parentWidth * newWidth, parentHeight * newHeight);
        this.fixAndSetPosition();
      },
      undo: () => {
        this.width = savedWidth;
        this.height = savedHeight;
        this.x = savedX;
        this.y = savedY;
        const [parentWidth, parentHeight] = this.parentDimensions;
        this.setDims(parentWidth * savedWidth, parentHeight * savedHeight);
        this.fixAndSetPosition();
      },
      mustExec: true,
    });
  }

  #resizerPointermove(name: string, event: PointerEvent) {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const savedX = this.x;
    const savedY = this.y;
    const savedWidth = this.width;
    const savedHeight = this.height;
    const minWidth = AnnotationEditor.MIN_SIZE / parentWidth;
    const minHeight = AnnotationEditor.MIN_SIZE / parentHeight;

    // 10000 because we multiply by 100 and use toFixed(2) in fixAndSetPosition.
    // Without rounding, the positions of the corners other than the top left
    // one can be slightly wrong.
    const round = (x: number) => Math.round(x * 10000) / 10000;
    const rotationMatrix = this.#getRotationMatrix(this.rotation);
    const transf = (x: number, y: number) => [
      rotationMatrix[0] * x + rotationMatrix[2] * y,
      rotationMatrix[1] * x + rotationMatrix[3] * y,
    ];
    const invRotationMatrix = this.#getRotationMatrix(360 - this.rotation);
    const invTransf = (x: number, y: number) => [
      invRotationMatrix[0] * x + invRotationMatrix[2] * y,
      invRotationMatrix[1] * x + invRotationMatrix[3] * y,
    ];
    let getPoint;
    let getOpposite;
    let isDiagonal = false;
    let isHorizontal = false;

    switch (name) {
      case "topLeft":
        isDiagonal = true;
        getPoint = (_w: number, _h: number) => [0, 0];
        getOpposite = (w: number, h: number) => [w, h];
        break;
      case "topMiddle":
        getPoint = (w: number, _h: number) => [w / 2, 0];
        getOpposite = (w: number, h: number) => [w / 2, h];
        break;
      case "topRight":
        isDiagonal = true;
        getPoint = (w: number, _h: number) => [w, 0];
        getOpposite = (_w: number, h: number) => [0, h];
        break;
      case "middleRight":
        isHorizontal = true;
        getPoint = (w: number, h: number) => [w, h / 2];
        getOpposite = (_w: number, h: number) => [0, h / 2];
        break;
      case "bottomRight":
        isDiagonal = true;
        getPoint = (w: number, h: number) => [w, h];
        getOpposite = (_w: number, _h: number) => [0, 0];
        break;
      case "bottomMiddle":
        getPoint = (w: number, h: number) => [w / 2, h];
        getOpposite = (w: number, _h: number) => [w / 2, 0];
        break;
      case "bottomLeft":
        isDiagonal = true;
        getPoint = (_w: number, h: number) => [0, h];
        getOpposite = (w: number, _h: number) => [w, 0];
        break;
      case "middleLeft":
        isHorizontal = true;
        getPoint = (_w: number, h: number) => [0, h / 2];
        getOpposite = (w: number, h: number) => [w, h / 2];
        break;
    }

    const point = getPoint!(savedWidth, savedHeight);
    const oppositePoint = getOpposite!(savedWidth, savedHeight);
    let transfOppositePoint = transf(...oppositePoint as [number, number]);
    const oppositeX = round(savedX + transfOppositePoint[0]);
    const oppositeY = round(savedY + transfOppositePoint[1]);
    let ratioX = 1;
    let ratioY = 1;

    let [deltaX, deltaY] = this.screenToPageTranslation(
      event.movementX,
      event.movementY
    );
    [deltaX, deltaY] = invTransf(deltaX / parentWidth, deltaY / parentHeight);

    if (isDiagonal) {
      const oldDiag = Math.hypot(savedWidth, savedHeight);
      ratioX = ratioY = Math.max(
        Math.min(
          Math.hypot(
            oppositePoint[0] - point[0] - deltaX,
            oppositePoint[1] - point[1] - deltaY
          ) / oldDiag,
          // Avoid the editor to be larger than the page.
          1 / savedWidth,
          1 / savedHeight
        ),
        // Avoid the editor to be smaller than the minimum size.
        minWidth / savedWidth,
        minHeight / savedHeight
      );
    } else if (isHorizontal) {
      ratioX =
        Math.max(
          minWidth,
          Math.min(1, Math.abs(oppositePoint[0] - point[0] - deltaX))
        ) / savedWidth;
    } else {
      ratioY =
        Math.max(
          minHeight,
          Math.min(1, Math.abs(oppositePoint[1] - point[1] - deltaY))
        ) / savedHeight;
    }

    const newWidth = round(savedWidth * ratioX);
    const newHeight = round(savedHeight * ratioY);
    transfOppositePoint = transf(...getOpposite!(newWidth, newHeight) as [number, number]);
    const newX = oppositeX - transfOppositePoint[0];
    const newY = oppositeY - transfOppositePoint[1];

    this.width = newWidth;
    this.height = newHeight;
    this.x = newX;
    this.y = newY;

    this.setDims(parentWidth * newWidth, parentHeight * newHeight);
    this.fixAndSetPosition();
  }

  /**
   * Called when the alt text dialog is closed.
   */
  altTextFinish() {
    this.#altText?.finish();
  }

  /**
   * Add a toolbar for this editor.
   * @returns {Promise<EditorToolbar|null>}
   */
  async addEditToolbar() {
    if (this._editToolbar || this.#isInEditMode) {
      return this._editToolbar;
    }
    this._editToolbar = new EditorToolbar(this);
    this.div!.append(this._editToolbar.render());
    if (this.#altText) {
      await this._editToolbar.addAltText(this.#altText);
    }

    return this._editToolbar;
  }

  removeEditToolbar() {
    if (!this._editToolbar) {
      return;
    }
    this._editToolbar.remove();
    this._editToolbar = null;

    // We destroy the alt text but we don't null it because we want to be able
    // to restore it in case the user undoes the deletion.
    this.#altText?.destroy();
  }

  addContainer(container) {
    const editToolbarDiv = this._editToolbar?.div;
    if (editToolbarDiv) {
      editToolbarDiv!.before(container);
    } else {
      this.div!.append(container);
    }
  }

  getClientDimensions() {
    return this.div!.getBoundingClientRect();
  }

  async addAltTextButton() {
    if (this.#altText) {
      return;
    }
    AltText.initialize(AnnotationEditorHelper._l10n);
    this.#altText = new AltText(this);
    if (this.#accessibilityData) {
      this.#altText.data = this.#accessibilityData;
      this.#accessibilityData = null;
    }
    await this.addEditToolbar();
  }

  get altTextData() {
    return this.#altText?.data;
  }

  /**
   * Set the alt text data.
   */
  set altTextData(data) {
    if (!this.#altText) {
      return;
    }
    this.#altText!.data = data;
  }

  get guessedAltText() {
    return this.#altText?.guessedText;
  }

  async setGuessedAltText(text) {
    await this.#altText?.setGuessedText(text);
  }

  serializeAltText(isForCopying: boolean) {
    return this.#altText?.serialize(isForCopying);
  }

  hasAltText() {
    return !!this.#altText && !this.#altText.isEmpty();
  }

  hasAltTextData() {
    return this.#altText?.hasData() ?? false;
  }

  /**
   * Render this editor in a div.
   * @returns {HTMLDivElement | null}
   */
  render(): HTMLDivElement | null {
    this.div = document.createElement("div");
    this.div.setAttribute("data-editor-rotation", `${(360 - this.rotation) % 360}`);
    this.div.className = this.name;
    this.div.setAttribute("id", this.id);
    this.div.tabIndex = this.#disabled ? -1 : 0;
    if (!this._isVisible) {
      this.div.classList.add("hidden");
    }

    this.setInForeground();
    this.#addFocusListeners();

    const [parentWidth, parentHeight] = this.parentDimensions;
    if (this.parentRotation % 180 !== 0) {
      this.div.style.maxWidth = `${((100 * parentHeight) / parentWidth).toFixed(
        2
      )}%`;
      this.div.style.maxHeight = `${(
        (100 * parentWidth) /
        parentHeight
      ).toFixed(2)}%`;
    }

    const [tx, ty] = this.getInitialTranslation();
    this.translate(tx, ty);

    bindEvents(this, this.div, ["pointerdown"]);

    return this.div;
  }

  /**
   * Onpointerdown callback.
   * @param {PointerEvent} event
   */
  pointerdown(event: PointerEvent) {
    const { isMac } = FeatureTest.platform;
    if (event.button !== 0 || (event.ctrlKey && isMac)) {
      // Avoid to focus this editor because of a non-left click.
      event.preventDefault();
      return;
    }

    this.#hasBeenClicked = true;

    if (this._isDraggable) {
      this.#setUpDragSession(event);
      return;
    }

    this.#selectOnPointerEvent(event);
  }

  get isSelected() {
    return this._uiManager.isSelected(this);
  }

  #selectOnPointerEvent(event: PointerEvent) {
    const { isMac } = FeatureTest.platform;
    if (
      (event.ctrlKey && !isMac) ||
      event.shiftKey ||
      (event.metaKey && isMac)
    ) {
      this.parent.toggleSelected(this);
    } else {
      this.parent.setSelected(this);
    }
  }

  #setUpDragSession(event) {
    const { isSelected } = this;
    this._uiManager.setUpDragSession();

    const ac = new AbortController();
    const signal = this._uiManager.combinedSignal(ac);

    if (isSelected) {
      this.div!.classList.add("moving");
      this.#prevDragX = event.clientX;
      this.#prevDragY = event.clientY;
      const pointerMoveCallback = (e: PointerEvent) => {
        const { clientX: x, clientY: y } = e;
        const [tx, ty] = this.screenToPageTranslation(
          x - this.#prevDragX,
          y - this.#prevDragY
        );
        this.#prevDragX = x;
        this.#prevDragY = y;
        this._uiManager.dragSelectedEditors(tx, ty);
      };
      window.addEventListener("pointermove", pointerMoveCallback, {
        passive: true,
        capture: true,
        signal,
      });
    }

    const pointerUpCallback = () => {
      ac.abort();
      if (isSelected) {
        this.div!.classList.remove("moving");
      }

      this.#hasBeenClicked = false;
      if (!this._uiManager.endDragSession()) {
        this.#selectOnPointerEvent(event);
      }
    };
    window.addEventListener("pointerup", pointerUpCallback, { signal });
    // If the user is using alt+tab during the dragging session, the pointerup
    // event could be not fired, but a blur event is fired so we can use it in
    // order to interrupt the dragging session.
    window.addEventListener("blur", pointerUpCallback, { signal });
  }

  moveInDOM() {
    // Moving the editor in the DOM can be expensive, so we wait a bit before.
    // It's important to not block the UI (for example when changing the font
    // size in a FreeText).
    if (this.#moveInDOMTimeout) {
      clearTimeout(this.#moveInDOMTimeout);
    }
    this.#moveInDOMTimeout = setTimeout(() => {
      this.#moveInDOMTimeout = null;
      this.parent?.moveEditorInDOM(this);
    }, 0);
  }

  _setParentAndPosition(parent: AnnotationEditorLayer, x: number, y: number) {
    parent.changeParent(this);
    this.x = x;
    this.y = y;
    this.fixAndSetPosition();
  }

  /**
   * Convert the current rect into a page one.
   * @param {number} tx - x-translation in screen coordinates.
   * @param {number} ty - y-translation in screen coordinates.
   * @param {number} [rotation] - the rotation of the page.
   */
  getRect(tx: number, ty: number, rotation: number = this.rotation): RectType {
    const scale = this.parentScale;
    const [pageWidth, pageHeight] = this.pageDimensions;
    const [pageX, pageY] = this.pageTranslation;
    const shiftX = tx / scale;
    const shiftY = ty / scale;
    const x = this.x * pageWidth;
    const y = this.y * pageHeight;
    const width = this.width * pageWidth;
    const height = this.height * pageHeight;

    switch (rotation) {
      case 0:
        return [
          x + shiftX + pageX,
          pageHeight - y - shiftY - height + pageY,
          x + shiftX + width + pageX,
          pageHeight - y - shiftY + pageY,
        ];
      case 90:
        return [
          x + shiftY + pageX,
          pageHeight - y + shiftX + pageY,
          x + shiftY + height + pageX,
          pageHeight - y + shiftX + width + pageY,
        ];
      case 180:
        return [
          x - shiftX - width + pageX,
          pageHeight - y + shiftY + pageY,
          x - shiftX + pageX,
          pageHeight - y + shiftY + height + pageY,
        ];
      case 270:
        return [
          x - shiftY - height + pageX,
          pageHeight - y - shiftX - width + pageY,
          x - shiftY + pageX,
          pageHeight - y - shiftX + pageY,
        ];
      default:
        throw new Error("Invalid rotation");
    }
  }

  getRectInCurrentCoords(rect: RectType, pageHeight: number) {
    const [x1, y1, x2, y2] = rect;

    const width = x2 - x1;
    const height = y2 - y1;

    switch (this.rotation) {
      case 0:
        return [x1, pageHeight - y2, width, height];
      case 90:
        return [x1, pageHeight - y1, height, width];
      case 180:
        return [x2, pageHeight - y1, width, height];
      case 270:
        return [x2, pageHeight - y2, height, width];
      default:
        throw new Error("Invalid rotation");
    }
  }

  /**
   * Executed once this editor has been rendered.
   */
  onceAdded() { }

  /**
   * Check if the editor contains something.
   * @returns {boolean}
   */
  isEmpty(): boolean {
    return false;
  }

  /**
   * Enable edit mode.
   */
  enableEditMode() {
    this.#isInEditMode = true;
  }

  /**
   * Disable edit mode.
   */
  disableEditMode() {
    this.#isInEditMode = false;
  }

  /**
   * Check if the editor is edited.
   * @returns {boolean}
   */
  isInEditMode() {
    return this.#isInEditMode;
  }

  /**
   * If it returns true, then this editor handles the keyboard
   * events itself.
   * @returns {boolean}
   */
  shouldGetKeyboardEvents() {
    return this.#isResizerEnabledForKeyboard;
  }

  /**
   * Check if this editor needs to be rebuilt or not.
   * @returns {boolean}
   */
  needsToBeRebuilt() {
    return this.div && !this.isAttachedToDOM;
  }

  #addFocusListeners() {
    if (this.#focusAC || !this.div) {
      return;
    }
    this.#focusAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#focusAC);

    this.div.addEventListener("focusin", this.focusin.bind(this), { signal });
    this.div.addEventListener("focusout", this.focusout.bind(this), { signal });
  }

  /**
   * Rebuild the editor in case it has been removed on undo.
   *
   * To implement in subclasses.
   */
  rebuild() {
    this.#addFocusListeners();
  }

  /**
   * Rotate the editor.
   * @param {number} angle
   */
  rotate(_angle: number) { }

  /**
   * Serialize the editor when it has been deleted.
   * @returns {Object}
   */
  serializeDeleted() {
    return {
      id: this.annotationElementId,
      deleted: true,
      pageIndex: this.pageIndex,
      popupRef: this._initialData?.popupRef || "",
    };
  }

  /**
   * Serialize the editor.
   * The result of the serialization will be used to construct a
   * new annotation to add to the pdf document.
   *
   * To implement in subclasses.
   * @param {boolean} [isForCopying]
   * @param {Object | null} [context]
   * @returns {Object | null}
   */
  serialize(_isForCopying = false, _context = null) {
    unreachable("An editor must be serializable");
  }

  /**
   * Deserialize the editor.
   * The result of the deserialization is a new editor.
   *
   * @param {Object} data
   * @param {AnnotationEditorLayer} parent
   * @param {AnnotationEditorUIManager} uiManager
   * @returns {Promise<AnnotationEditor | null>}
   */
  static async deserialize(data, parent: AnnotationEditorLayer, uiManager: AnnotationEditorUIManager) {
    const editor = new this.prototype.constructor({
      parent,
      id: parent.getNextId(),
      uiManager,
    });
    editor.rotation = data.rotation;
    editor.#accessibilityData = data.accessibilityData;

    const [pageWidth, pageHeight] = editor.pageDimensions;
    const [x, y, width, height] = editor.getRectInCurrentCoords(
      data.rect,
      pageHeight
    );

    editor.x = x / pageWidth;
    editor.y = y / pageHeight;
    editor.width = width / pageWidth;
    editor.height = height / pageHeight;

    return editor;
  }

  /**
   * Check if an existing annotation associated with this editor has been
   * modified.
   * @returns {boolean}
   */
  get hasBeenModified(): boolean {
    return (
      !!this.annotationElementId && (this.deleted || this.serialize() !== null)
    );
  }

  /**
   * Remove this editor.
   * It's used on ctrl+backspace action.
   */
  remove() {
    this.#focusAC?.abort();
    this.#focusAC = null;

    if (!this.isEmpty()) {
      // The editor is removed but it can be back at some point thanks to
      // undo/redo so we must commit it before.
      this.commit();
    }
    if (this.parent) {
      this.parent.remove(this);
    } else {
      this._uiManager.removeEditor(this);
    }

    if (this.#moveInDOMTimeout) {
      clearTimeout(this.#moveInDOMTimeout);
      this.#moveInDOMTimeout = null;
    }
    this.#stopResizing();
    this.removeEditToolbar();
    if (this.#telemetryTimeouts) {
      for (const timeout of this.#telemetryTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.#telemetryTimeouts = null;
    }
    this.parent = null;
  }

  /**
   * @returns {boolean} true if this editor can be resized.
   */
  get isResizable() {
    return false;
  }

  /**
   * Add the resizers to this editor.
   */
  makeResizable() {
    if (this.isResizable) {
      this.#createResizers();
      this.#resizersDiv!.classList.remove("hidden");
      bindEvents(this, this.div!, ["keydown"]);
    }
  }

  get toolbarPosition(): [number, number] {
    unreachable('未实现的方法')
    return [0, 0];
  }

  /**
   * onkeydown callback.
   * @param {KeyboardEvent} event
   */
  keydown(event: KeyboardEvent) {
    if (
      !this.isResizable ||
      event.target !== this.div ||
      event.key !== "Enter"
    ) {
      return;
    }
    this._uiManager.setSelected(this);
    this.#savedDimensions = {
      savedX: this.x,
      savedY: this.y,
      savedWidth: this.width,
      savedHeight: this.height,
    };
    const children = this.#resizersDiv!.children;
    if (!this.#allResizerDivs) {
      this.#allResizerDivs = <HTMLDivElement[]>Array.from(children);
      const boundResizerKeydown = this.#resizerKeydown.bind(this);
      const boundResizerBlur = this.#resizerBlur.bind(this);
      const signal = this._uiManager._signal;
      for (const div of this.#allResizerDivs) {
        const name = div.getAttribute("data-resizer-name")!;
        div.setAttribute("role", "spinbutton");
        div.addEventListener("keydown", boundResizerKeydown, { signal });
        div.addEventListener("blur", boundResizerBlur, { signal });
        div.addEventListener("focus", this.#resizerFocus.bind(this, name), {
          signal,
        });
        div.setAttribute("data-l10n-id", AnnotationEditorHelper._l10nResizer![name]);
      }
    }

    // We want to have the resizers in the visual order, so we move the first
    // (top-left) to the right place.
    const first = this.#allResizerDivs[0];
    let firstPosition = 0;
    for (const div of children) {
      if (div === first) {
        break;
      }
      firstPosition++;
    }
    const nextFirstPosition =
      (((360 - this.rotation + this.parentRotation) % 360) / 90) *
      (this.#allResizerDivs.length / 4);

    if (nextFirstPosition !== firstPosition) {
      // We need to reorder the resizers in the DOM in order to have the focus
      // on the top-left one.
      if (nextFirstPosition < firstPosition) {
        for (let i = 0; i < firstPosition - nextFirstPosition; i++) {
          this.#resizersDiv!.append(this.#resizersDiv!.firstChild!);
        }
      } else if (nextFirstPosition > firstPosition) {
        for (let i = 0; i < nextFirstPosition - firstPosition; i++) {
          this.#resizersDiv!.firstChild!.before(this.#resizersDiv!.lastChild!);
        }
      }

      let i = 0;
      for (const child of children) {
        const div = this.#allResizerDivs[i++];
        const name = div.getAttribute("data-resizer-name")!;
        child.setAttribute("data-l10n-id", AnnotationEditorHelper._l10nResizer[name]);
      }
    }

    this.#setResizerTabIndex(0);
    this.#isResizerEnabledForKeyboard = true;
    this.#resizersDiv!.firstChild!.focus({ focusVisible: true });
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  #resizerKeydown(event: KeyboardEvent) {
    AnnotationEditor._resizerKeyboardManager.exec(this, event);
  }

  #resizerBlur(event: FocusEvent) {
    if (
      this.#isResizerEnabledForKeyboard &&
      event.relatedTarget?.parentNode !== this.#resizersDiv
    ) {
      this.#stopResizing();
    }
  }

  #resizerFocus(name: string) {
    this.#focusedResizerName = this.#isResizerEnabledForKeyboard ? name : "";
  }

  #setResizerTabIndex(value: number) {
    if (!this.#allResizerDivs) {
      return;
    }
    for (const div of this.#allResizerDivs) {
      div.tabIndex = value;
    }
  }

  _resizeWithKeyboard(x: number, y: number) {
    if (!this.#isResizerEnabledForKeyboard) {
      return;
    }
    this.#resizerPointermove(this.#focusedResizerName, {
      movementX: x,
      movementY: y,
    });
  }

  #stopResizing() {
    this.#isResizerEnabledForKeyboard = false;
    this.#setResizerTabIndex(-1);
    if (this.#savedDimensions) {
      const { savedX, savedY, savedWidth, savedHeight } = this.#savedDimensions;
      this.#addResizeToUndoStack(savedX, savedY, savedWidth, savedHeight);
      this.#savedDimensions = null;
    }
  }

  _stopResizingWithKeyboard() {
    this.#stopResizing();
    this.div!.focus();
  }

  /**
   * Select this editor.
   */
  select() {
    this.makeResizable();
    this.div?.classList.add("selectedEditor");
    if (!this._editToolbar) {
      this.addEditToolbar().then(() => {
        if (this.div?.classList.contains("selectedEditor")) {
          // The editor can have been unselected while we were waiting for the
          // edit toolbar to be created, hence we want to be sure that this
          // editor is still selected.
          this._editToolbar?.show();
        }
      });
      return;
    }
    this._editToolbar?.show();
    this.#altText?.toggleAltTextBadge(false);
  }

  /**
   * Unselect this editor.
   */
  unselect() {
    this.#resizersDiv?.classList.add("hidden");
    this.div?.classList.remove("selectedEditor");
    if (this.div?.contains(document.activeElement)) {
      // Don't use this.div.blur() because we don't know where the focus will
      // go.
      this._uiManager.currentLayer.div.focus({
        preventScroll: true,
      });
    }
    this._editToolbar?.hide();
    this.#altText?.toggleAltTextBadge(true);
  }

  /**
   * Update some parameters which have been changed through the UI.
   * @param {number} type
   * @param {*} value
   */
  updateParams(_type: number, _value: any) { }

  /**
   * When the user disables the editing mode some editors can change some of
   * their properties.
   */
  disableEditing() { }

  /**
   * When the user enables the editing mode some editors can change some of
   * their properties.
   */
  enableEditing() { }

  /**
   * The editor is about to be edited.
   */
  enterInEditMode() { }

  /**
   * @returns {HTMLElement | null} the element requiring an alt text.
   */
  getImageForAltText(): HTMLElement | null {
    return null;
  }

  /**
   * Get the div which really contains the displayed content.
   * @returns {HTMLDivElement | undefined}
   */
  get contentDiv() {
    return this.div;
  }

  /**
   * If true then the editor is currently edited.
   * @type {boolean}
   */
  get isEditing() {
    return this.#isEditing;
  }

  /**
   * When set to true, it means that this editor is currently edited.
   * @param {boolean} value
   */
  set isEditing(value) {
    this.#isEditing = value;
    if (!this.parent) {
      return;
    }
    if (value) {
      this.parent.setSelected(this);
      this.parent.setActiveEditor(this);
    } else {
      this.parent.setActiveEditor(null);
    }
  }

  /**
   * Set the aspect ratio to use when resizing.
   * @param {number} width
   * @param {number} height
   */
  setAspectRatio(width: number, height: number) {
    this.#keepAspectRatio = true;
    const aspectRatio = width / height;
    const { style } = this.div!;
    style.aspectRatio = `${aspectRatio}`;
    style.height = "auto";
  }

  static get MIN_SIZE() {
    return 16;
  }

  static canCreateNewEmptyEditor() {
    return true;
  }

  /**
   * Get the data to report to the telemetry when the editor is added.
   * @returns {Object}
   */
  get telemetryInitialData() {
    return { action: "added" };
  }

  /**
   * The telemetry data to use when saving/printing.
   * @returns {Object|null}
   */
  get telemetryFinalData(): { type: string; hasAltText: boolean; } | null {
    return null;
  }

  _reportTelemetry(data, mustWait = false) {
    if (mustWait) {
      this.#telemetryTimeouts ||= new Map();
      const { action } = data;
      let timeout = this.#telemetryTimeouts.get(action);
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        this._reportTelemetry(data);
        this.#telemetryTimeouts!.delete(action);
        if (this.#telemetryTimeouts!.size === 0) {
          this.#telemetryTimeouts = null;
        }
      }, AnnotationEditorHelper._telemetryTimeout);
      this.#telemetryTimeouts.set(action, timeout);
      return;
    }
    data.type ||= this.editorType;
    this._uiManager._eventBus.dispatch("reporttelemetry", {
      source: this,
      details: {
        type: "editing",
        data,
      },
    });
  }

  /**
   * Show or hide this editor.
   * @param {boolean|undefined} visible
   */
  show(visible = this._isVisible) {
    this.div!.classList.toggle("hidden", !visible);
    this._isVisible = visible;
  }

  enable() {
    if (this.div) {
      this.div.tabIndex = 0;
    }
    this.#disabled = false;
  }

  disable() {
    if (this.div) {
      this.div.tabIndex = -1;
    }
    this.#disabled = true;
  }

  /**
   * Render an annotation in the annotation layer.
   * @param {Object} annotation
   * @returns {HTMLElement|null}
   */
  renderAnnotationElement(annotation) {
    let content = annotation.container.querySelector(".annotationContent");
    if (!content) {
      content = document.createElement("div");
      content.classList.add("annotationContent", this.editorType);
      annotation.container.prepend(content);
    } else if (content.nodeName === "CANVAS") {
      const canvas = content;
      content = document.createElement("div");
      content.classList.add("annotationContent", this.editorType);
      canvas.before(content);
    }

    return content;
  }

  resetAnnotationElement(annotation) {
    const { firstChild } = annotation.container;
    if (
      firstChild?.nodeName === "DIV" &&
      firstChild.classList.contains("annotationContent")
    ) {
      firstChild.remove();
    }
  }
}

// This class is used to fake an editor which has been deleted.
class FakeEditor extends AnnotationEditor {
  constructor(params) {
    super(params);
    this.annotationElementId = params.annotationElementId;
    this.deleted = true;
  }

  serialize() {
    return this.serializeDeleted();
  }
}

export { AnnotationEditor };
