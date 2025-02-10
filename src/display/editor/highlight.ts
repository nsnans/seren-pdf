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

import { AnnotationData } from "../../core/annotation";
import { AnnotationEditorParamsType, AnnotationEditorType, shadow } from "../../shared/util";
import { BoxType } from "../../types";
import { IL10n } from "../../viewer/common/component_types";
import { AnnotationElement } from "../annotation_layer";
import { PointType } from "../display_utils";
import { AnnotationEditorLayer } from "./annotation_editor_layer";
import { ColorPicker } from "./color_picker";
import { FreeDrawOutline } from "./drawers/freedraw";
import { FreeHighlightOutliner, HighlightOutline, HighlightOutliner } from "./drawers/highlight";
import { AnnotationEditor, AnnotationEditorHelper, AnnotationEditorParameters } from "./editor";
import { AnnotationEditorUIManager, bindEvents, KeyboardManager } from "./tools";

export interface HighlightEditorParameter extends AnnotationEditorParameters {
  color: string | null;
  thickness: number | null;
  opacity: number | null;
  text: string | null;
  highlightId: number;
  boxes: null;
  anchorNode: null;
  anchorOffset: number;
  focusNode: null;
  focusOffset: number;
  clipPathId: string | null;
  highlightOutlines: FreeDrawOutline | null;
}

/**
 * Basic draw editor in order to generate an Highlight annotation.
 */
export class HighlightEditor extends AnnotationEditor {

  static _defaultColor: string | null = null;

  static _defaultOpacity = 1;

  static _defaultThickness = 12;

  static _type = "highlight";

  static _editorType = AnnotationEditorType.HIGHLIGHT;

  static _freeHighlightId = -1;

  static _freeHighlight: FreeHighlightOutliner | null = null;

  static _freeHighlightClipId = "";

  static get _keyboardManager() {
    const proto = HighlightEditor.prototype;
    return shadow(this, "_keyboardManager", new KeyboardManager<HighlightEditor>([
      [["ArrowLeft", "mac+ArrowLeft"], proto._moveCaret, { args: [0] }],
      [["ArrowRight", "mac+ArrowRight"], proto._moveCaret, { args: [1] }],
      [["ArrowUp", "mac+ArrowUp"], proto._moveCaret, { args: [2] }],
      [["ArrowDown", "mac+ArrowDown"], proto._moveCaret, { args: [3] }],
    ]));
  }

  #anchorNode = null;

  #anchorOffset = 0;

  #boxes: BoxType[] | null;

  #clipPathId: string | null = null;

  #colorPicker: ColorPicker | null = null;

  #focusOutlines: FreeDrawOutline | HighlightOutline | null = null;

  #focusNode = null;

  #focusOffset = 0;

  #highlightDiv: HTMLDivElement | null = null;

  #highlightOutlines: FreeDrawOutline | HighlightOutline | null = null;

  #id: number | null = null;

  #isFreeHighlight = false;

  #lastPoint: PointType | null = null;

  #opacity: number;

  #outlineId: number | null = null;

  #text = "";

  #thickness;

  protected color: string;

  constructor(params: HighlightEditorParameter) {
    super({ ...params, name: "highlightEditor" });
    this.color = params.color || HighlightEditor._defaultColor!;
    this.#thickness = params.thickness || HighlightEditor._defaultThickness;
    this.#opacity = params.opacity || HighlightEditor._defaultOpacity;
    this.#boxes = params.boxes || null;
    this.#text = params.text || "";
    this._isDraggable = false;

    if (params.highlightId > -1) {
      this.#isFreeHighlight = true;
      this.#createFreeOutlines(params.highlightOutlines!, params.highlightId, params.clipPathId ?? "");
      this.#addToDrawLayer();
    } else if (this.#boxes) {
      this.#anchorNode = params.anchorNode;
      this.#anchorOffset = params.anchorOffset;
      this.#focusNode = params.focusNode;
      this.#focusOffset = params.focusOffset;
      this.#createOutlines();
      this.#addToDrawLayer();
      this.rotate(this.rotation);
    }
  }

  #createOutlines() {
    const outliner = new HighlightOutliner(this.#boxes!, 0.001);
    this.#highlightOutlines = outliner.getOutlines();
    ({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    } = this.#highlightOutlines!.box!);

    const outlinerForOutline = new HighlightOutliner(
      this.#boxes!, 0.0025, 0.001, this._uiManager.direction === "ltr"
    );
    this.#focusOutlines = outlinerForOutline.getOutlines();

    // The last point is in the pages coordinate system.
    const { lastPoint } = this.#focusOutlines!.box!;
    this.#lastPoint = [
      (lastPoint[0] - this.x) / this.width,
      (lastPoint[1] - this.y) / this.height,
    ];
  }

  #createFreeOutlines(
    highlightOutlines: FreeDrawOutline,
    highlightId: number = 0,
    clipPathId: string = "",
  ) {
    this.#highlightOutlines = highlightOutlines;
    const extraThickness = 1.5;
    this.#focusOutlines = highlightOutlines.getNewOutline(
      /* Slightly bigger than the highlight in order to have a little
         space between the highlight and the outline. */
      this.#thickness / 2 + extraThickness, 0.0025
    );

    if (highlightId >= 0) {
      this.#id = highlightId;
      this.#clipPathId = clipPathId;
      // We need to redraw the highlight because we change the coordinates to be
      // in the box coordinate system.
      this.parent!.drawLayer.finalizeLine(highlightId, highlightOutlines);
      this.#outlineId = this.parent!.drawLayer.drawOutline(this.#focusOutlines!);
    } else if (this.parent) {
      const angle = this.parent.viewport.rotation;
      this.parent.drawLayer.updateLine(this.#id!, highlightOutlines);
      this.parent.drawLayer.updateBox(
        this.#id!,
        HighlightEditor.#rotateBbox(
          this.#highlightOutlines!.box!,
          (angle - this.rotation + 360) % 360
        )
      );

      this.parent.drawLayer.updateLine(this.#outlineId!, this.#focusOutlines);
      this.parent.drawLayer.updateBox(
        this.#outlineId!,
        HighlightEditor.#rotateBbox(this.#focusOutlines!.box!, angle)
      );
    }
    const { x, y, width, height } = highlightOutlines.box!;
    switch (this.rotation) {
      case 0:
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        break;
      case 90: {
        const [pageWidth, pageHeight] = this.parentDimensions;
        this.x = y;
        this.y = 1 - x;
        this.width = (width * pageHeight) / pageWidth;
        this.height = (height * pageWidth) / pageHeight;
        break;
      }
      case 180:
        this.x = 1 - x;
        this.y = 1 - y;
        this.width = width;
        this.height = height;
        break;
      case 270: {
        const [pageWidth, pageHeight] = this.parentDimensions;
        this.x = 1 - y;
        this.y = x;
        this.width = (width * pageHeight) / pageWidth;
        this.height = (height * pageWidth) / pageHeight;
        break;
      }
    }

    const { lastPoint } = this.#focusOutlines!.box!;
    this.#lastPoint = [(lastPoint[0] - x) / width, (lastPoint[1] - y) / height];
  }

  /** @inheritdoc */
  static initialize(l10n: IL10n, uiManager: AnnotationEditorUIManager) {
    AnnotationEditorHelper.initialize(l10n, uiManager);
    HighlightEditor._defaultColor ||=
      uiManager.highlightColors?.values().next().value || "#fff066";
  }

  /** @inheritdoc */
  static updateDefaultParams(type: number, value: any) {
    switch (type) {
      case AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR:
        HighlightEditor._defaultColor = value;
        break;
      case AnnotationEditorParamsType.HIGHLIGHT_THICKNESS:
        HighlightEditor._defaultThickness = value;
        break;
    }
  }

  /** @inheritdoc */
  translateInPage(_x: number, _y: number) { }

  /** @inheritdoc */
  get toolbarPosition(): [number, number] {
    return this.#lastPoint!;
  }

  /** @inheritdoc */
  updateParams(type: number, value: any) {
    switch (type) {
      case AnnotationEditorParamsType.HIGHLIGHT_COLOR:
        this.#updateColor(value);
        break;
      case AnnotationEditorParamsType.HIGHLIGHT_THICKNESS:
        this.#updateThickness(value);
        break;
    }
  }

  static get defaultPropertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR,
        HighlightEditor._defaultColor,
      ],
      [
        AnnotationEditorParamsType.HIGHLIGHT_THICKNESS,
        HighlightEditor._defaultThickness,
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        this.color || HighlightEditor._defaultColor,
      ],
      [
        AnnotationEditorParamsType.HIGHLIGHT_THICKNESS,
        this.#thickness || HighlightEditor._defaultThickness,
      ],
      [AnnotationEditorParamsType.HIGHLIGHT_FREE, this.#isFreeHighlight],
    ];
  }

  /**
   * Update the color and make this action undoable.
   * @param {string} color
   */
  #updateColor(color: string) {
    const setColorAndOpacity = (col: string, opa: number) => {
      this.color = col;
      this.parent?.drawLayer.changeColor(this.#id!, col);
      this.#colorPicker?.updateColor(col);
      this.#opacity = opa;
      this.parent?.drawLayer.changeOpacity(this.#id!, opa);
    };
    const savedColor = this.color;
    const savedOpacity = this.#opacity;
    this.addCommands(
      setColorAndOpacity.bind(this, color, HighlightEditor._defaultOpacity),
      setColorAndOpacity.bind(this, savedColor, savedOpacity),
      this._uiManager.updateUI.bind(this._uiManager, this),
      true,
      AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      true,
      true,
    );
  }

  /**
   * Update the thickness and make this action undoable.
   * @param {number} thickness
   */
  #updateThickness(thickness: number) {
    const savedThickness = this.#thickness;
    const setThickness = (th: number) => {
      this.#thickness = th;
      this.#changeThickness(th);
    };
    this.addCommands(
      setThickness.bind(this, thickness),
      setThickness.bind(this, savedThickness),
      this._uiManager.updateUI.bind(this._uiManager, this),
      true,
      AnnotationEditorParamsType.INK_THICKNESS,
      true,
      true,
    );
  }

  /** @inheritdoc */
  async addEditToolbar() {
    const toolbar = await super.addEditToolbar();
    if (!toolbar) {
      return null;
    }
    if (this._uiManager.highlightColors) {
      this.#colorPicker = new ColorPicker(this);
      toolbar.addColorPicker(this.#colorPicker);
    }
    return toolbar;
  }

  /** @inheritdoc */
  disableEditing() {
    super.disableEditing();
    this.div!.classList.toggle("disabled", true);
  }

  /** @inheritdoc */
  enableEditing() {
    super.enableEditing();
    this.div!.classList.toggle("disabled", false);
  }

  /** @inheritdoc */
  fixAndSetPosition() {
    return super.fixAndSetPosition(this.#getRotation());
  }

  /** @inheritdoc */
  getBaseTranslation(): [number, number] {
    // The editor itself doesn't have any CSS border (we're drawing one
    // ourselves in using SVG).
    return [0, 0];
  }

  /** @inheritdoc */
  getRect(tx: number, ty: number) {
    return super.getRect(tx, ty, this.#getRotation());
  }

  /** @inheritdoc */
  onceAdded() {
    if (!this.annotationElementId) {
      this.parent!.addUndoableEditor(this);
    }
    this.div!.focus();
  }

  /** @inheritdoc */
  remove() {
    this.#cleanDrawLayer();
    super.remove();
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

    this.#addToDrawLayer();

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilding it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
  }

  setParent(parent: AnnotationEditorLayer) {
    let mustBeSelected = false;
    if (this.parent && !parent) {
      this.#cleanDrawLayer();
    } else if (parent) {
      this.#addToDrawLayer(parent);
      // If mustBeSelected is true it means that this editor was selected
      // when its parent has been destroyed, hence we must select it again.
      mustBeSelected =
        !this.parent && !!this.div?.classList.contains("selectedEditor");
    }
    super.setParent(parent);
    this.show(this._isVisible);
    if (mustBeSelected) {
      // We select it after the parent has been set.
      this.select();
    }
  }

  #changeThickness(thickness: number) {
    if (!this.#isFreeHighlight) {
      return;
    }
    this.#createFreeOutlines((<FreeDrawOutline>this.#highlightOutlines).getNewOutline(thickness / 2, null));
    this.fixAndSetPosition();
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);
  }

  #cleanDrawLayer() {
    if (this.#id === null || !this.parent) {
      return;
    }
    this.parent.drawLayer.remove(this.#id);
    this.#id = null;
    this.parent.drawLayer.remove(this.#outlineId!);
    this.#outlineId = null;
  }

  #addToDrawLayer(parent = this.parent) {
    if (this.#id !== null) {
      return;
    }
    ({ id: this.#id, clipPathId: this.#clipPathId } = parent!.drawLayer.draw(
      this.#highlightOutlines!,
      this.color,
      this.#opacity
    ));
    this.#outlineId = parent!.drawLayer.drawOutline(<HighlightOutline>this.#focusOutlines!);
    if (this.#highlightDiv) {
      this.#highlightDiv.style.clipPath = this.#clipPathId;
    }
  }

  static #rotateBbox({ x, y, width, height }: { x: number, y: number, width: number, height: number }, angle: number) {
    switch (angle) {
      case 90:
        return {
          x: 1 - y - height,
          y: x,
          width: height,
          height: width,
        };
      case 180:
        return {
          x: 1 - x - width,
          y: 1 - y - height,
          width,
          height,
        };
      case 270:
        return {
          x: y,
          y: 1 - x - width,
          width: height,
          height: width,
        };
    }
    return {
      x,
      y,
      width,
      height,
    };
  }

  /** @inheritdoc */
  rotate(angle: number) {
    // We need to rotate the svgs because of the coordinates system.
    const { drawLayer } = this.parent!;
    let box;
    if (this.#isFreeHighlight) {
      angle = (angle - this.rotation + 360) % 360;
      box = HighlightEditor.#rotateBbox(this.#highlightOutlines!.box!, angle);
    } else {
      // An highlight annotation is always drawn horizontally.
      box = HighlightEditor.#rotateBbox(this, angle);
    }
    drawLayer.rotate(this.#id!, angle);
    drawLayer.rotate(this.#outlineId!, angle);
    drawLayer.updateBox(this.#id!, box);
    drawLayer.updateBox(
      this.#outlineId!, HighlightEditor.#rotateBbox(this.#focusOutlines!.box!, angle)
    );
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    const div = super.render()!;
    if (this.#text) {
      div.setAttribute("aria-label", this.#text);
      div.setAttribute("role", "mark");
    }
    if (this.#isFreeHighlight) {
      div.classList.add("free");
    } else {
      this.div!.addEventListener("keydown", this.#keydown.bind(this), {
        signal: this._uiManager._signal!,
      });
    }
    const highlightDiv = (this.#highlightDiv = document.createElement("div"));
    div.append(highlightDiv);
    highlightDiv.setAttribute("aria-hidden", "true");
    highlightDiv.className = "internal";
    highlightDiv.style.clipPath = this.#clipPathId!;
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);

    bindEvents(this, this.#highlightDiv, ["pointerover", "pointerleave"]);
    this.enableEditing();

    return div;
  }

  pointerover() {
    if (!this.isSelected) {
      this.parent!.drawLayer.addClass(this.#outlineId!, "hovered");
    }
  }

  pointerleave() {
    if (!this.isSelected) {
      this.parent!.drawLayer.removeClass(this.#outlineId!, "hovered");
    }
  }

  #keydown(event: KeyboardEvent) {
    HighlightEditor._keyboardManager.exec(this, event);
  }

  _moveCaret(direction: number) {
    this.parent!.unselect(this);
    switch (direction) {
      case 0 /* left */:
      case 2 /* up */:
        this.#setCaret(/* start = */ true);
        break;
      case 1 /* right */:
      case 3 /* down */:
        this.#setCaret(/* start = */ false);
        break;
    }
  }

  #setCaret(start: boolean) {
    if (!this.#anchorNode) {
      return;
    }
    const selection = window.getSelection()!;
    if (start) {
      selection.setPosition(this.#anchorNode, this.#anchorOffset);
    } else {
      selection.setPosition(this.#focusNode, this.#focusOffset);
    }
  }

  /** @inheritdoc */
  select() {
    super.select();
    if (!this.#outlineId) {
      return;
    }
    this.parent?.drawLayer.removeClass(this.#outlineId, "hovered");
    this.parent?.drawLayer.addClass(this.#outlineId, "selected");
  }

  /** @inheritdoc */
  unselect() {
    super.unselect();
    if (!this.#outlineId) {
      return;
    }
    this.parent?.drawLayer.removeClass(this.#outlineId, "selected");
    if (!this.#isFreeHighlight) {
      this.#setCaret(/* start = */ false);
    }
  }

  /** @inheritdoc */
  get _mustFixPosition() {
    return !this.#isFreeHighlight;
  }

  /** @inheritdoc */
  show(visible = this._isVisible) {
    super.show(visible);
    if (this.parent) {
      this.parent.drawLayer.show(this.#id!, visible);
      this.parent.drawLayer.show(this.#outlineId!, visible);
    }
  }

  #getRotation() {
    // Highlight annotations are always drawn horizontally but if
    // a free highlight annotation can be rotated.
    return this.#isFreeHighlight ? this.rotation : 0;
  }

  /** @inheritdoc */
  renderAnnotationElement(annotation: AnnotationElement<AnnotationData>) {
    annotation.updateEdited(this.getRect(0, 0));

    return null;
  }

  static canCreateNewEmptyEditor() {
    return false;
  }
}
