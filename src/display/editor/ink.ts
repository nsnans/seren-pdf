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

import { PlatformHelper } from "../../platform/platform_helper";
import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  assert,
  Util,
} from "../../shared/util";
import { IL10n } from "../../viewer/common/component_types";
import { noContextMenu, PointType } from "../display_utils";
import { AnnotationEditorLayer } from "./annotation_editor_layer";
import { AnnotationEditor, AnnotationEditorHelper, AnnotationEditorParameters } from "./editor";
import { AnnotationEditorUIManager, opacityToHex } from "./tools";

type BezierType = [PointType, PointType, PointType, PointType][];

export interface InkEditorParameter extends AnnotationEditorParameters {
  opacity: number | null;
  thickness: number | null;
  color: string | null;
  name: "inkEditor";
}

/**
 * Basic draw editor in order to generate an Ink annotation.
 */
export class InkEditor extends AnnotationEditor {

  #baseHeight = 0;

  #baseWidth = 0;

  #canvasContextMenuTimeoutId: number | null = null;

  #currentPath2D = new Path2D();

  #disableEditing = false;

  #drawingAC: AbortController | null = null;

  #hasSomethingToDraw = false;

  #isCanvasInitialized = false;

  #observer: ResizeObserver | null = null;

  #pointerdownAC: AbortController | null = null;

  #realWidth = 0;

  #realHeight = 0;

  #requestFrameCallback: (() => void) | null = null;

  static _defaultColor = null;

  static _defaultOpacity = 1;

  static _defaultThickness = 1;

  static _type = "ink";

  static _editorType = AnnotationEditorType.INK;

  protected color: string | null;
  
  protected thickness: number | null;
  
  protected opacity: number | null;
  
  protected canvas: HTMLCanvasElement | null = null;
  
  protected paths: BezierType[];
  
  protected bezierPath2D: Path2D[];
  
  protected allRawPaths: PointType[][];
  
  protected currentPath: PointType[];
  
  protected scaleFactor: number;
  
  protected translationX: number;
  
  protected translationY: number;
  
  protected ctx: CanvasRenderingContext2D | null = null;

  constructor(params: InkEditorParameter) {
    super({ ...params, name: "inkEditor" });
    this.color = params.color || null;
    this.thickness = params.thickness || null;
    this.opacity = params.opacity || null;
    this.paths = [];
    this.bezierPath2D = [];
    this.allRawPaths = [];
    this.currentPath = [];
    this.scaleFactor = 1;
    this.translationX = this.translationY = 0;
    this.x = 0;
    this.y = 0;
    this._willKeepAspectRatio = true;
  }

  /** @inheritdoc */
  static initialize(l10n: IL10n, uiManager: AnnotationEditorUIManager) {
    AnnotationEditorHelper.initialize(l10n, uiManager);
  }

  /** @inheritdoc */
  static updateDefaultParams(type: number, value: any) {
    switch (type) {
      case AnnotationEditorParamsType.INK_THICKNESS:
        InkEditor._defaultThickness = value;
        break;
      case AnnotationEditorParamsType.INK_COLOR:
        InkEditor._defaultColor = value;
        break;
      case AnnotationEditorParamsType.INK_OPACITY:
        InkEditor._defaultOpacity = value / 100;
        break;
    }
  }

  /** @inheritdoc */
  updateParams(type: number, value: any) {
    switch (type) {
      case AnnotationEditorParamsType.INK_THICKNESS:
        this.#updateThickness(value);
        break;
      case AnnotationEditorParamsType.INK_COLOR:
        this.#updateColor(value);
        break;
      case AnnotationEditorParamsType.INK_OPACITY:
        this.#updateOpacity(value);
        break;
    }
  }

  /** @inheritdoc */
  static get defaultPropertiesToUpdate() {
    return [
      [AnnotationEditorParamsType.INK_THICKNESS, InkEditor._defaultThickness],
      [
        AnnotationEditorParamsType.INK_COLOR,
        InkEditor._defaultColor || AnnotationEditorHelper._defaultLineColor,
      ],
      [
        AnnotationEditorParamsType.INK_OPACITY,
        Math.round(InkEditor._defaultOpacity * 100),
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.INK_THICKNESS,
        this.thickness || InkEditor._defaultThickness,
      ],
      [
        AnnotationEditorParamsType.INK_COLOR,
        this.color ||
        InkEditor._defaultColor ||
        AnnotationEditorHelper._defaultLineColor,
      ],
      [
        AnnotationEditorParamsType.INK_OPACITY,
        Math.round(100 * (this.opacity ?? InkEditor._defaultOpacity)),
      ],
    ];
  }

  /**
   * Update the thickness and make this action undoable.
   * @param {number} thickness
   */
  #updateThickness(thickness: number) {
    const setThickness = (th: number) => {
      this.thickness = th;
      this.#fitToContent();
    };
    const savedThickness = this.thickness!;
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

  /**
   * Update the color and make this action undoable.
   * @param {string} color
   */
  #updateColor(color: string) {
    const setColor = (col: string) => {
      this.color = col;
      this.#redraw();
    };
    const savedColor = this.color;
    this.addCommands(
      setColor.bind(this, color),
      setColor.bind(this, savedColor!),
      this._uiManager.updateUI.bind(this._uiManager, this),
      true,
      AnnotationEditorParamsType.INK_COLOR,
      true,
      true,
    );
  }

  /**
   * Update the opacity and make this action undoable.
   * @param {number} opacity
   */
  #updateOpacity(opacity: number) {
    const setOpacity = (op: number) => {
      this.opacity = op;
      this.#redraw();
    };
    opacity /= 100;
    const savedOpacity = this.opacity;
    this.addCommands(
      setOpacity.bind(this, opacity),
      setOpacity.bind(this, savedOpacity!),
      this._uiManager.updateUI.bind(this._uiManager, this),
      true,
      AnnotationEditorParamsType.INK_OPACITY,
      true,
      true,
    );
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

    if (!this.canvas) {
      this.#createCanvas();
      this.#createObserver();
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilding it,
      // hence we must add it to its parent.
      this.parent.add(this);
      this.#setCanvasDims();
    }
    this.#fitToContent();
  }

  /** @inheritdoc */
  remove() {
    if (this.canvas === null) {
      return;
    }

    if (!this.isEmpty()) {
      this.commit();
    }

    // Destroy the canvas.
    this.canvas.width = this.canvas.height = 0;
    this.canvas.remove();
    this.canvas = null;

    if (this.#canvasContextMenuTimeoutId) {
      clearTimeout(this.#canvasContextMenuTimeoutId);
      this.#canvasContextMenuTimeoutId = null;
    }

    this.#observer?.disconnect();
    this.#observer = null;

    super.remove();
  }

  setParent(parent: AnnotationEditorLayer) {
    if (!this.parent && parent) {
      // We've a parent hence the rescale will be handled thanks to the
      // ResizeObserver.
      this._uiManager.removeShouldRescale(this);
    } else if (this.parent && parent === null) {
      // The editor is removed from the DOM, hence we handle the rescale thanks
      // to the onScaleChanging callback.
      // This way, it'll be saved/printed correctly.
      this._uiManager.addShouldRescale(this);
    }
    super.setParent(parent);
  }

  onScaleChanging() {
    const [parentWidth, parentHeight] = this.parentDimensions;
    const width = this.width * parentWidth;
    const height = this.height * parentHeight;
    this.setDimensions(width, height);
  }

  /** @inheritdoc */
  enableEditMode() {
    if (this.#disableEditing || this.canvas === null) {
      return;
    }

    super.enableEditMode();
    this._isDraggable = false;
    this.#addPointerdownListener();
  }

  /** @inheritdoc */
  disableEditMode() {
    if (!this.isInEditMode() || this.canvas === null) {
      return;
    }

    super.disableEditMode();
    this._isDraggable = !this.isEmpty();
    this.div!.classList.remove("editing");
    this.#removePointerdownListener();
  }

  /** @inheritdoc */
  onceAdded() {
    this._isDraggable = !this.isEmpty();
  }

  /** @inheritdoc */
  isEmpty() {
    return (
      this.paths.length === 0 ||
      (this.paths.length === 1 && this.paths[0].length === 0)
    );
  }

  #getInitialBBox() {
    const {
      parentRotation,
      parentDimensions: [width, height],
    } = this;
    switch (parentRotation) {
      case 90:
        return [0, height, height, width];
      case 180:
        return [width, height, width, height];
      case 270:
        return [width, 0, height, width];
      default:
        return [0, 0, width, height];
    }
  }

  /**
   * Set line styles.
   */
  #setStroke() {
    const { ctx, color, opacity, thickness, parentScale, scaleFactor } = this;
    ctx!.lineWidth = (thickness! * parentScale) / scaleFactor;
    ctx!.lineCap = "round";
    ctx!.lineJoin = "round";
    ctx!.miterLimit = 10;
    ctx!.strokeStyle = `${color}${opacityToHex(opacity!)}`;
  }

  /**
   * Start to draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #startDrawing(x: number, y: number) {
    this.canvas!.addEventListener("contextmenu", noContextMenu, {
      signal: this._uiManager._signal!,
    });
    this.#removePointerdownListener();

    if (PlatformHelper.isTesting()) {
      assert(
        !this.#drawingAC,
        "No `this.#drawingAC` AbortController should exist."
      );
    }
    this.#drawingAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#drawingAC);

    this.canvas!.addEventListener(
      "pointerleave",
      this.canvasPointerleave.bind(this),
      { signal }
    );
    this.canvas!.addEventListener(
      "pointermove",
      this.canvasPointermove.bind(this),
      { signal }
    );
    this.canvas!.addEventListener("pointerup", this.canvasPointerup.bind(this), {
      signal,
    });

    this.isEditing = true;
    if (!this.#isCanvasInitialized) {
      this.#isCanvasInitialized = true;
      this.#setCanvasDims();
      this.thickness ||= InkEditor._defaultThickness;
      this.color ||=
        InkEditor._defaultColor || AnnotationEditorHelper._defaultLineColor;
      this.opacity ??= InkEditor._defaultOpacity;
    }
    this.currentPath.push([x, y]);
    this.#hasSomethingToDraw = false;
    this.#setStroke();

    this.#requestFrameCallback = () => {
      this.#drawPoints();
      if (this.#requestFrameCallback) {
        window.requestAnimationFrame(this.#requestFrameCallback);
      }
    };
    window.requestAnimationFrame(this.#requestFrameCallback);
  }

  /**
   * Draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #draw(x: number, y: number) {
    const [lastX, lastY] = this.currentPath.at(-1)!;
    if (this.currentPath.length > 1 && x === lastX && y === lastY) {
      return;
    }
    const currentPath = this.currentPath;
    let path2D = this.#currentPath2D;
    currentPath.push([x, y]);
    this.#hasSomethingToDraw = true;

    if (currentPath.length <= 2) {
      path2D.moveTo(...currentPath[0]);
      path2D.lineTo(x, y);
      return;
    }

    if (currentPath.length === 3) {
      this.#currentPath2D = path2D = new Path2D();
      path2D.moveTo(...currentPath[0]);
    }

    this.#makeBezierCurve(
      path2D,
      ...currentPath.at(-3)!,
      ...currentPath.at(-2)!,
      x,
      y
    );
  }

  #endPath() {
    if (this.currentPath.length === 0) {
      return;
    }
    const lastPoint = this.currentPath.at(-1);
    this.#currentPath2D.lineTo(...lastPoint!);
  }

  /**
   * Stop to draw on the canvas.
   * @param {number} x
   * @param {number} y
   */
  #stopDrawing(x: number, y: number) {
    this.#requestFrameCallback = null;

    x = Math.min(Math.max(x, 0), this.canvas!.width);
    y = Math.min(Math.max(y, 0), this.canvas!.height);

    this.#draw(x, y);
    this.#endPath();

    // Interpolate the path entered by the user with some
    // Bezier's curves in order to have a smoother path and
    // to reduce the data size used to draw it in the PDF.
    let bezier: BezierType;
    if (this.currentPath.length !== 1) {
      bezier = this.#generateBezierPoints();
    } else {
      // We have only one point finally.
      const xy: PointType = [x, y];
      bezier = [[xy, <PointType>xy.slice(), <PointType>xy.slice(), xy]];
    }
    const path2D = this.#currentPath2D;
    const currentPath = this.currentPath;
    this.currentPath = [];
    this.#currentPath2D = new Path2D();

    const cmd = () => {
      this.allRawPaths.push(currentPath);
      this.paths.push(bezier);
      this.bezierPath2D.push(path2D);
      this._uiManager.rebuild(this);
    };

    const undo = () => {
      this.allRawPaths.pop();
      this.paths.pop();
      this.bezierPath2D.pop();
      if (this.paths.length === 0) {
        this.remove();
      } else {
        if (!this.canvas) {
          this.#createCanvas();
          this.#createObserver();
        }
        this.#fitToContent();
      }
    };

    this.addCommands(cmd, undo, () => { }, true);
  }

  #drawPoints() {
    if (!this.#hasSomethingToDraw) {
      return;
    }
    this.#hasSomethingToDraw = false;

    const thickness = Math.ceil(this.thickness! * this.parentScale);
    const lastPoints = this.currentPath.slice(-3);
    const x = lastPoints.map(xy => xy[0]);
    const y = lastPoints.map(xy => xy[1]);
    const xMin = Math.min(...x) - thickness;
    const xMax = Math.max(...x) + thickness;
    const yMin = Math.min(...y) - thickness;
    const yMax = Math.max(...y) + thickness;

    const ctx = this.ctx!;
    ctx.save();

    if (PlatformHelper.isMozCental()) {
      // In Chrome, the clip() method doesn't work as expected.
      ctx.clearRect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.beginPath();
      ctx.rect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.clip();
    } else {
      ctx.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
    }

    for (const path of this.bezierPath2D) {
      ctx.stroke(path);
    }
    ctx.stroke(this.#currentPath2D);

    ctx.restore();
  }

  #makeBezierCurve(path2D: Path2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
    const prevX = (x0 + x1) / 2;
    const prevY = (y0 + y1) / 2;
    const x3 = (x1 + x2) / 2;
    const y3 = (y1 + y2) / 2;

    path2D.bezierCurveTo(
      prevX + (2 * (x1 - prevX)) / 3,
      prevY + (2 * (y1 - prevY)) / 3,
      x3 + (2 * (x1 - x3)) / 3,
      y3 + (2 * (y1 - y3)) / 3,
      x3,
      y3
    );
  }

  #generateBezierPoints(): BezierType {
    const path = this.currentPath;
    if (path.length <= 2) {
      return [[path[0], path[0], path.at(-1)!, path.at(-1)!]];
    }

    const bezierPoints: BezierType = [];
    let i;
    let [x0, y0] = path[0];
    for (i = 1; i < path.length - 2; i++) {
      const [x1, y1] = path[i];
      const [x2, y2] = path[i + 1];
      const x3 = (x1 + x2) / 2;
      const y3 = (y1 + y2) / 2;

      // The quadratic is: [[x0, y0], [x1, y1], [x3, y3]].
      // Convert the quadratic to a cubic
      // (see https://fontforge.org/docs/techref/bezier.html#converting-truetype-to-postscript)
      const control1: [number, number] = [x0 + (2 * (x1 - x0)) / 3, y0 + (2 * (y1 - y0)) / 3];
      const control2: [number, number] = [x3 + (2 * (x1 - x3)) / 3, y3 + (2 * (y1 - y3)) / 3];

      bezierPoints.push([[x0, y0], control1, control2, [x3, y3]]);

      [x0, y0] = [x3, y3];
    }

    const [x1, y1] = path[i];
    const [x2, y2] = path[i + 1];

    // The quadratic is: [[x0, y0], [x1, y1], [x2, y2]].
    const control1: [number, number] = [x0 + (2 * (x1 - x0)) / 3, y0 + (2 * (y1 - y0)) / 3];
    const control2: [number, number] = [x2 + (2 * (x1 - x2)) / 3, y2 + (2 * (y1 - y2)) / 3];

    bezierPoints.push([[x0, y0], control1, control2, [x2, y2]]);
    return bezierPoints;
  }

  /**
   * Redraw all the paths.
   */
  #redraw() {
    if (this.isEmpty()) {
      this.#updateTransform();
      return;
    }
    this.#setStroke();

    const { canvas } = this;
    const ctx = this.ctx!
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas!.width, canvas!.height);
    this.#updateTransform();

    for (const path of this.bezierPath2D) {
      ctx.stroke(path);
    }
  }

  /**
   * Commit the curves we have in this editor.
   */
  commit() {
    if (this.#disableEditing) {
      return;
    }

    super.commit();

    this.isEditing = false;
    this.disableEditMode();

    // This editor must be on top of the main ink editor.
    this.setInForeground();

    this.#disableEditing = true;
    this.div!.classList.add("disabled");

    this.#fitToContent(/* firstTime = */ true);
    this.select();

    this.parent!.addInkEditorIfNeeded(/* isCommitting = */ true);

    // When committing, the position of this editor is changed, hence we must
    // move it to the right position in the DOM.
    this.moveInDOM();
    this.div!.focus({
      preventScroll: true /* See issue #15744 */,
    });
  }

  /** @inheritdoc */
  focusin(event: FocusEvent) {
    if (!this._focusEventsAllowed) {
      return;
    }
    super.focusin(event);
    this.enableEditMode();
  }

  #addPointerdownListener() {
    if (this.#pointerdownAC) {
      return;
    }
    this.#pointerdownAC = new AbortController();
    const signal = this._uiManager.combinedSignal(this.#pointerdownAC);

    this.canvas!.addEventListener(
      "pointerdown",
      this.canvasPointerdown.bind(this),
      { signal }
    );
  }

  #removePointerdownListener() {
    this.#pointerdownAC?.abort();
    this.#pointerdownAC = null;
  }

  /**
   * onpointerdown callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointerdown(event: PointerEvent) {
    if (event.button !== 0 || !this.isInEditMode() || this.#disableEditing) {
      return;
    }

    // We want to draw on top of any other editors.
    // Since it's the last child, there's no need to give it a higher z-index.
    this.setInForeground();

    event.preventDefault();

    if (!this.div!.contains(document.activeElement)) {
      this.div!.focus({
        preventScroll: true /* See issue #17327 */,
      });
    }

    this.#startDrawing(event.offsetX, event.offsetY);
  }

  /**
   * onpointermove callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointermove(event: PointerEvent) {
    event.preventDefault();
    this.#draw(event.offsetX, event.offsetY);
  }

  /**
   * onpointerup callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointerup(event: PointerEvent) {
    event.preventDefault();
    this.#endDrawing(event);
  }

  /**
   * onpointerleave callback for the canvas we're drawing on.
   * @param {PointerEvent} event
   */
  canvasPointerleave(event: PointerEvent) {
    this.#endDrawing(event);
  }

  /**
   * End the drawing.
   * @param {PointerEvent} event
   */
  #endDrawing(event: PointerEvent) {
    this.#drawingAC?.abort();
    this.#drawingAC = null;

    this.#addPointerdownListener();
    // Slight delay to avoid the context menu to appear (it can happen on a long
    // tap with a pen).
    if (this.#canvasContextMenuTimeoutId) {
      clearTimeout(this.#canvasContextMenuTimeoutId);
    }
    this.#canvasContextMenuTimeoutId = setTimeout(() => {
      this.#canvasContextMenuTimeoutId = null;
      this.canvas!.removeEventListener("contextmenu", noContextMenu);
    }, 10);

    this.#stopDrawing(event.offsetX, event.offsetY);

    this.addToAnnotationStorage();

    // Since the ink editor covers all of the page and we want to be able
    // to select another editor, we just put this one in the background.
    this.setInBackground();
  }

  /**
   * Create the canvas element.
   */
  #createCanvas() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = 0;
    this.canvas.className = "inkEditorCanvas";
    this.canvas.setAttribute("data-l10n-id", "pdfjs-ink-canvas");

    this.div!.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  /**
   * Create the resize observer.
   */
  #createObserver() {
    this.#observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) {
        this.setDimensions(rect.width, rect.height);
      }
    });
    this.#observer.observe(this.div!);
    this._uiManager._signal!.addEventListener("abort", () => {
      this.#observer?.disconnect();
      this.#observer = null;
    }, { once: true });
  }

  /** @inheritdoc */
  get isResizable() {
    return !this.isEmpty() && this.#disableEditing;
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

    this.div!.setAttribute("data-l10n-id", "pdfjs-ink");

    const [x, y, w, h] = this.#getInitialBBox();
    this.setAt(x, y, 0, 0);
    this.setDims(w, h);

    this.#createCanvas();

    if (this.width) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.setAspectRatio(this.width * parentWidth, this.height * parentHeight);
      this.setAt(
        baseX! * parentWidth,
        baseY! * parentHeight,
        this.width * parentWidth,
        this.height * parentHeight
      );
      this.#isCanvasInitialized = true;
      this.#setCanvasDims();
      this.setDims(this.width * parentWidth, this.height * parentHeight);
      this.#redraw();
      this.div!.classList.add("disabled");
    } else {
      this.div!.classList.add("editing");
      this.enableEditMode();
    }

    this.#createObserver();

    return this.div;
  }

  #setCanvasDims() {
    if (!this.#isCanvasInitialized) {
      return;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.canvas!.width = Math.ceil(this.width * parentWidth);
    this.canvas!.height = Math.ceil(this.height * parentHeight);
    this.#updateTransform();
  }

  /**
   * When the dimensions of the div change the inner canvas must
   * renew its dimensions, hence it must redraw its own contents.
   * @param {number} width - the new width of the div
   * @param {number} height - the new height of the div
   * @returns
   */
  setDimensions(width: number, height: number) {
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);
    if (
      this.#realWidth === roundedWidth &&
      this.#realHeight === roundedHeight
    ) {
      return;
    }

    this.#realWidth = roundedWidth;
    this.#realHeight = roundedHeight;

    this.canvas!.style.visibility = "hidden";

    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;
    this.fixAndSetPosition();

    if (this.#disableEditing) {
      this.#setScaleFactor(width, height);
    }

    this.#setCanvasDims();
    this.#redraw();

    this.canvas!.style.visibility = "visible";

    // For any reason the dimensions couldn't be in percent but in pixels, hence
    // we must fix them.
    this.fixDims();
  }

  #setScaleFactor(width: number, height: number) {
    const padding = this.#getPadding();
    const scaleFactorW = (width - padding) / this.#baseWidth;
    const scaleFactorH = (height - padding) / this.#baseHeight;
    this.scaleFactor = Math.min(scaleFactorW, scaleFactorH);
  }

  /**
   * Update the canvas transform.
   */
  #updateTransform() {
    const padding = this.#getPadding() / 2;
    this.ctx!.setTransform(
      this.scaleFactor,
      0,
      0,
      this.scaleFactor,
      this.translationX * this.scaleFactor + padding,
      this.translationY * this.scaleFactor + padding
    );
  }

  /**
   * Get the bounding box containing all the paths.
   * @returns {Array<number>}
   */
  #getBbox(): [number, number, number, number] {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;

    for (const path of this.paths) {
      for (const [first, control1, control2, second] of path) {
        const bbox = Util.bezierBoundingBox(
          ...<PointType>first,
          ...<PointType>control1,
          ...<PointType>control2,
          ...<PointType>second
        );
        xMin = Math.min(xMin, bbox[0]);
        yMin = Math.min(yMin, bbox[1]);
        xMax = Math.max(xMax, bbox[2]);
        yMax = Math.max(yMax, bbox[3]);
      }
    }

    return [xMin, yMin, xMax, yMax];
  }

  /**
   * The bounding box is computed with null thickness, so we must take
   * it into account for the display.
   * It corresponds to the total padding, hence it should be divided by 2
   * in order to have left/right paddings.
   * @returns {number}
   */
  #getPadding() {
    return this.#disableEditing
      ? Math.ceil(this.thickness! * this.parentScale)
      : 0;
  }

  /**
   * Set the div position and dimensions in order to fit to
   * the bounding box of the contents.
   * @returns {undefined}
   */
  #fitToContent(firstTime = false) {
    if (this.isEmpty()) {
      return;
    }

    if (!this.#disableEditing) {
      this.#redraw();
      return;
    }

    const bbox = this.#getBbox();
    const padding = this.#getPadding();
    this.#baseWidth = Math.max(AnnotationEditorHelper.MIN_SIZE, bbox[2] - bbox[0]);
    this.#baseHeight = Math.max(AnnotationEditorHelper.MIN_SIZE, bbox[3] - bbox[1]);

    const width = Math.ceil(padding + this.#baseWidth * this.scaleFactor);
    const height = Math.ceil(padding + this.#baseHeight * this.scaleFactor);

    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;

    this.setAspectRatio(width, height);

    const prevTranslationX = this.translationX;
    const prevTranslationY = this.translationY;

    this.translationX = -bbox[0];
    this.translationY = -bbox[1];
    this.#setCanvasDims();
    this.#redraw();

    this.#realWidth = width;
    this.#realHeight = height;

    this.setDims(width, height);
    const unscaledPadding = firstTime ? padding / this.scaleFactor / 2 : 0;
    this.translate(
      prevTranslationX - this.translationX - unscaledPadding,
      prevTranslationY - this.translationY - unscaledPadding
    );
  }
}
