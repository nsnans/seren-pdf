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
/** @typedef {import("./tools.js").AnnotationEditorUIManager} AnnotationEditorUIManager */
/** @typedef {import("../display_utils.js").PageViewport} PageViewport */
// eslint-disable-next-line max-len
/** @typedef {import("../../../web/text_accessibility.js").TextAccessibilityManager} TextAccessibilityManager */
/** @typedef {import("../../../web/interfaces").IL10n} IL10n */
// eslint-disable-next-line max-len
/** @typedef {import("../annotation_layer.js").AnnotationLayer} AnnotationLayer */
/** @typedef {import("../draw_layer.js").DrawLayer} DrawLayer */
// eslint-disable-next-line max-len
/** @typedef {import("../src/display/struct_tree_layer_builder.js").StructTreeLayerBuilder} StructTreeLayerBuilder */

import { AnnotationEditorType, FeatureTest } from "../../shared/util";
import { IL10n } from "../../viewer/common/component_types";
import { TextAccessibilityManager } from "../../viewer/common/text_accessibility";
import { AnnotationLayer } from "../annotation_layer";
import { PageViewport, setLayerDimensions } from "../display_utils";
import { DrawLayer } from "../draw_layer";
import { AnnotationEditor, AnnotationEditorHelper } from "./editor";
import { EditorManager } from "./editor_manager";
import { FreeTextEditor } from "./freetext";
import { HighlightEditor } from "./highlight";
import { InkEditor } from "./ink";
import { StampEditor } from "./stamp";
import { AnnotationEditorSerial } from "./state/editor_serializable";
import { AnnotationEditorState } from "./state/editor_state";
import { AnnotationEditorUIManager } from "./tools";

/**
 * @typedef {Object} AnnotationEditorLayerOptions
 * @property {Object} mode
 * @property {HTMLDivElement} div
 * @property {StructTreeLayerBuilder} structTreeLayer
 * @property {AnnotationEditorUIManager} uiManager
 * @property {boolean} enabled
 * @property {TextAccessibilityManager} [accessibilityManager]
 * @property {number} pageIndex
 * @property {IL10n} l10n
 * @property {AnnotationLayer} [annotationLayer]
 * @property {HTMLDivElement} [textLayer]
 * @property {DrawLayer} drawLayer
 * @property {PageViewport} viewport
 */

/**
 * @typedef {Object} RenderEditorLayerOptions
 * @property {PageViewport} viewport
 */

/**
 * Manage all the different editors on a page.
 */
export class AnnotationEditorLayer {

  static _initialized = false;

  #accessibilityManager: TextAccessibilityManager;

  #allowClick = false;

  #annotationLayer: AnnotationLayer | null = null;

  #clickAC: AbortController | null = null;

  #editorFocusTimeoutId: number | null = null;

  #editors = new Map<string, AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>>();

  #hadPointerDown = false;

  #isCleaningUp = false;

  #isDisabling = false;

  #textLayer: null = null;

  #textSelectionAC: AbortController | null = null;

  #uiManager: AnnotationEditorUIManager;

  protected div: HTMLDivElement | null;

  public viewport: PageViewport;

  public pageIndex: number;

  public isMultipleSelection: boolean | null = null;

  public drawLayer: DrawLayer;

  /**
   * @param {AnnotationEditorLayerOptions} options
   */
  constructor(
    uiManager: AnnotationEditorUIManager,
    pageIndex: number,
    div: HTMLDivElement,
    structTreeLayer,
    accessibilityManager: TextAccessibilityManager,
    annotationLayer: AnnotationLayer,
    drawLayer: DrawLayer,
    textLayer,
    viewport: PageViewport,
    l10n: IL10n,
  ) {
    const editorInitalizers = EditorManager.getL10nInitializer();
    if (!AnnotationEditorLayer._initialized) {
      AnnotationEditorLayer._initialized = true;
      for (const initializer of editorInitalizers) {
        initializer(l10n, uiManager);
      }
    }
    uiManager.registerEditorTypes(editorInitalizers);

    this.#uiManager = uiManager;
    this.pageIndex = pageIndex;
    this.div = div;
    this.#accessibilityManager = accessibilityManager;
    this.#annotationLayer = annotationLayer;
    this.viewport = viewport;
    this.#textLayer = textLayer;
    this.drawLayer = drawLayer;
    this._structTree = structTreeLayer;

    this.#uiManager.addLayer(this);
  }

  get isEmpty() {
    return this.#editors.size === 0;
  }

  get isInvisible() {
    return (
      this.isEmpty && this.#uiManager.getMode() === AnnotationEditorType.NONE
    );
  }

  /**
   * Update the toolbar if it's required to reflect the tool currently used.
   * @param {number} mode
   */
  updateToolbar(mode: AnnotationEditorType) {
    this.#uiManager.updateToolbar(mode);
  }

  /**
   * The mode has changed: it must be updated.
   * @param {number} mode
   */
  updateMode(mode = this.#uiManager.getMode()) {
    this.#cleanup();
    switch (mode) {
      case AnnotationEditorType.NONE:
        this.disableTextSelection();
        this.togglePointerEvents(false);
        this.toggleAnnotationLayerPointerEvents(true);
        this.disableClick();
        return;
      case AnnotationEditorType.INK:
        // We always want to have an ink editor ready to draw in.
        this.addInkEditorIfNeeded(false);

        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.disableClick();
        break;
      case AnnotationEditorType.HIGHLIGHT:
        this.enableTextSelection();
        this.togglePointerEvents(false);
        this.disableClick();
        break;
      default:
        this.disableTextSelection();
        this.togglePointerEvents(true);
        this.enableClick();
    }

    this.toggleAnnotationLayerPointerEvents(false);
    const { classList } = this.div!;
    for (const editorType of EditorManager.getEditorBasicInfo()) {
      classList.toggle(
        `${editorType.name}Editing`,
        mode === editorType.type
      );
    }
    this.div!.hidden = false;
  }

  hasTextLayer(textLayer: HTMLDivElement) {
    return textLayer === this.#textLayer?.div;
  }

  addInkEditorIfNeeded(isCommitting: boolean) {
    if (this.#uiManager.getMode() !== AnnotationEditorType.INK) {
      // We don't want to add an ink editor if we're not in ink mode!
      return;
    }

    if (!isCommitting) {
      // We're removing an editor but an empty one can already exist so in this
      // case we don't need to create a new one.
      for (const editor of this.#editors.values()) {
        if (editor.isEmpty()) {
          editor.setInBackground();
          return;
        }
      }
    }

    const editor = this.createAndAddNewEditor(
      { offsetX: 0, offsetY: 0 }, false
    );
    editor.setInBackground();
  }

  /**
   * Set the editing state.
   */
  setEditingState(isEditing: boolean) {
    this.#uiManager.setEditingState(isEditing);
  }

  /**
   * Add some commands into the CommandManager (undo/redo stuff).
   */
  addCommands(cmd: () => void, undo: () => void, mustExec: boolean) {
    this.#uiManager.addCommands(cmd, undo, () => { }, mustExec);
  }

  toggleDrawing(enabled = false) {
    this.div!.classList.toggle("drawing", !enabled);
  }

  togglePointerEvents(enabled = false) {
    this.div!.classList.toggle("disabled", !enabled);
  }

  toggleAnnotationLayerPointerEvents(enabled = false) {
    this.#annotationLayer?.div.classList.toggle("disabled", !enabled);
  }

  /**
   * Enable pointer events on the main div in order to enable
   * editor creation.
   */
  async enable() {
    this.div!.tabIndex = 0;
    this.togglePointerEvents(true);
    const annotationElementIds = new Set();
    for (const editor of this.#editors.values()) {
      editor.enableEditing();
      editor.show(true);
      if (editor.annotationElementId) {
        this.#uiManager.removeChangedExistingAnnotation(editor.annotationElementId!);
        annotationElementIds.add(editor.annotationElementId);
      }
    }

    if (!this.#annotationLayer) {
      return;
    }

    const editables = this.#annotationLayer.getEditableAnnotations();
    for (const editable of editables) {
      // The element must be hidden whatever its state is.
      editable.hide();
      if (this.#uiManager.isDeletedAnnotationElement(editable.data.id)) {
        continue;
      }
      if (annotationElementIds.has(editable.data.id)) {
        continue;
      }
      const editor = await this.deserialize(editable);
      if (!editor) {
        continue;
      }
      this.addOrRebuild(editor);
      editor.enableEditing();
    }
  }

  /**
   * Disable editor creation.
   */
  disable() {
    this.#isDisabling = true;
    this.div!.tabIndex = -1;
    this.togglePointerEvents(false);
    const changedAnnotations = new Map<string, AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>>();
    const resetAnnotations = new Map<string, AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>>();
    for (const editor of this.#editors.values()) {
      editor.disableEditing();
      if (!editor.annotationElementId) {
        continue;
      }
      if (editor.serialize() !== null) {
        changedAnnotations.set(editor.annotationElementId, editor);
        continue;
      } else {
        resetAnnotations.set(editor.annotationElementId, editor);
      }
      this.getEditableAnnotation(editor.annotationElementId)?.show();
      editor.remove();
    }

    if (this.#annotationLayer) {
      // Show the annotations that were hidden in enable().
      const editables = this.#annotationLayer.getEditableAnnotations();
      for (const editable of editables) {
        const { id } = editable.data;
        if (this.#uiManager.isDeletedAnnotationElement(id)) {
          continue;
        }
        let editor = resetAnnotations.get(id);
        if (editor) {
          editor.resetAnnotationElement(editable);
          editor.show(false);
          editable.show();
          continue;
        }

        editor = changedAnnotations.get(id);
        if (editor) {
          this.#uiManager.addChangedExistingAnnotation(editor.annotationElementId!, editor.id);
          if (editor.renderAnnotationElement(editable)) {
            // Content has changed, so we need to hide the editor.
            editor.show(false);
          }
        }
        editable.show();
      }
    }

    this.#cleanup();
    if (this.isEmpty) {
      this.div!.hidden = true;
    }
    const { classList } = this.div!;
    for (const editorType of EditorManager.getEditorBasicInfo()) {
      classList.remove(`${editorType.type}Editing`);
    }
    this.disableTextSelection();
    this.toggleAnnotationLayerPointerEvents(true);

    this.#isDisabling = false;
  }

  getEditableAnnotation(id: string) {
    return this.#annotationLayer?.getEditableAnnotation(id) || null;
  }

  /**
   * Set the current editor.
   * @param {AnnotationEditor} editor
   */
  setActiveEditor(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    const currentActive = this.#uiManager.getActive();
    if (currentActive === editor) {
      return;
    }

    this.#uiManager.setActiveEditor(editor);
  }

  enableTextSelection() {
    this.div!.tabIndex = -1;
    if (this.#textLayer?.div && !this.#textSelectionAC) {
      this.#textSelectionAC = new AbortController();
      const signal = this.#uiManager.combinedSignal(this.#textSelectionAC);

      this.#textLayer.div.addEventListener(
        "pointerdown",
        this.#textLayerPointerDown.bind(this),
        { signal }
      );
      this.#textLayer.div.classList.add("highlighting");
    }
  }

  disableTextSelection() {
    this.div!.tabIndex = 0;
    if (this.#textLayer?.div && this.#textSelectionAC) {
      this.#textSelectionAC.abort();
      this.#textSelectionAC = null;

      this.#textLayer.div.classList.remove("highlighting");
    }
  }

  #textLayerPointerDown(event: PointerEvent) {
    // Unselect all the editors in order to let the user select some text
    // without being annoyed by an editor toolbar.
    this.#uiManager.unselectAll();
    const target = <HTMLElement>event.target;
    if (
      target === this.#textLayer.div ||
      ((target.getAttribute("role") === "img" ||
        target.classList.contains("endOfContent")) &&
        this.#textLayer.div.contains(target))
    ) {
      const { isMac } = FeatureTest.platform;
      if (event.button !== 0 || (event.ctrlKey && isMac)) {
        // Do nothing on right click.
        return;
      }
      this.#uiManager.showAllEditors(
        AnnotationEditorType.HIGHLIGHT,
        true,
        /* updateButton = */ true
      );
      this.#textLayer.div.classList.add("free");
      this.toggleDrawing();
      HighlightEditor.startHighlighting(
        this,
        this.#uiManager.direction === "ltr",
        { target: this.#textLayer.div, x: event.x, y: event.y }
      );
      this.#textLayer.div.addEventListener(
        "pointerup",
        () => {
          this.#textLayer.div.classList.remove("free");
          this.toggleDrawing(true);
        },
        { once: true, signal: this.#uiManager._signal }
      );
      event.preventDefault();
    }
  }

  enableClick() {
    if (this.#clickAC) {
      return;
    }
    this.#clickAC = new AbortController();
    const signal = this.#uiManager.combinedSignal(this.#clickAC);

    this.div!.addEventListener("pointerdown", this.pointerdown.bind(this), {
      signal,
    });
    this.div!.addEventListener("pointerup", this.pointerup.bind(this), {
      signal,
    });
  }

  disableClick() {
    this.#clickAC?.abort();
    this.#clickAC = null;
  }

  attach(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    this.#editors.set(editor.id, editor);
    const { annotationElementId } = editor;
    if (
      annotationElementId &&
      this.#uiManager.isDeletedAnnotationElement(annotationElementId)
    ) {
      this.#uiManager.removeDeletedAnnotationElement(editor);
    }
  }

  detach(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    this.#editors.delete(editor.id);
    this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv!);

    if (!this.#isDisabling && editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor);
    }
  }

  /**
   * Remove an editor.
   * @param {AnnotationEditor} editor
   */
  remove(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    this.detach(editor);
    this.#uiManager.removeEditor(editor);
    editor.div!.remove();
    editor.isAttachedToDOM = false;

    if (!this.#isCleaningUp) {
      this.addInkEditorIfNeeded(false);
    }
  }

  /**
   * An editor can have a different parent, for example after having
   * being dragged and droped from a page to another.
   * @param {AnnotationEditor} editor
   */
  changeParent(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    if (editor.parent === this) {
      return;
    }

    if (editor.parent && editor.annotationElementId) {
      this.#uiManager.addDeletedAnnotationElement(editor);
      AnnotationEditorHelper.deleteAnnotationElement(editor);
      editor.annotationElementId = null;
    }

    this.attach(editor);
    editor.parent?.detach(editor);
    editor.setParent(this);
    if (editor.div && editor.isAttachedToDOM) {
      editor.div.remove();
      this.div!.append(editor.div);
    }
  }

  /**
   * Add a new editor in the current view.
   * @param {AnnotationEditor} editor
   */
  add(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    if (editor.parent === this && editor.isAttachedToDOM) {
      return;
    }
    this.changeParent(editor);
    this.#uiManager.addEditor(editor);
    this.attach(editor);

    if (!editor.isAttachedToDOM) {
      const div = editor.render()!;
      this.div!.append(div);
      editor.isAttachedToDOM = true;
    }

    // The editor will be correctly moved into the DOM (see fixAndSetPosition).
    editor.fixAndSetPosition();
    editor.onceAdded();
    this.#uiManager.addToAnnotationStorage(editor);
    editor._reportTelemetry(editor.telemetryInitialData);
  }

  moveEditorInDOM(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    if (!editor.isAttachedToDOM) {
      return;
    }

    const { activeElement } = document;
    if (editor.div!.contains(activeElement) && !this.#editorFocusTimeoutId) {
      // When the div is moved in the DOM the focus can move somewhere else,
      // so we want to be sure that the focus will stay on the editor but we
      // don't want to call any focus callbacks, hence we disable them and only
      // re-enable them when the editor has the focus.
      editor._focusEventsAllowed = false;
      this.#editorFocusTimeoutId = setTimeout(() => {
        this.#editorFocusTimeoutId = null;
        if (!editor.div!.contains(document.activeElement)) {
          editor.div!.addEventListener("focusin",
            () => { editor._focusEventsAllowed = true; },
            { once: true, signal: this.#uiManager._signal! }
          );
          (<HTMLElement>activeElement!).focus();
        } else {
          editor._focusEventsAllowed = true;
        }
      }, 0);
    }

    editor._structTreeParentId = this.#accessibilityManager?.moveElementInDOM(
      this.div!, editor.div!, editor.contentDiv!, true
    );
  }

  /**
   * Add or rebuild depending if it has been removed or not.
   * @param {AnnotationEditor} editor
   */
  addOrRebuild(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    if (editor.needsToBeRebuilt()) {
      editor.parent ||= this;
      editor.rebuild();
      editor.show();
    } else {
      this.add(editor);
    }
  }

  /**
   * Add a new editor and make this addition undoable.
   * @param {AnnotationEditor} editor
   */
  addUndoableEditor(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    const cmd = () => editor._uiManager.rebuild(editor);
    const undo = () => {
      editor.remove();
    };

    this.addCommands(cmd, undo, false);
  }

  /**
   * Get an id for an editor.
   * @returns {string}
   */
  getNextId(): string {
    return this.#uiManager.getId();
  }

  get #currentEditorDescriptor() {
    return EditorManager.getDescriptor(this.#uiManager.getMode())!;
  }

  combinedSignal(ac: AbortController) {
    return this.#uiManager.combinedSignal(ac);
  }

  /**
   * Create a new editor
   * @param {Object} params
   * @returns {AnnotationEditor}
   */
  #createNewEditor(params) {
    const editorDescriptor = this.#currentEditorDescriptor;
    return editorDescriptor ? editorDescriptor.create(params) : null;
  }

  canCreateNewEmptyEditor() {
    return this.#currentEditorDescriptor?.canCreateNewEmptyEditor;
  }

  /**
   * Paste some content into a new editor.
   */
  pasteEditor(mode: AnnotationEditorType, params) {
    this.#uiManager.updateToolbar(mode);
    this.#uiManager.updateMode(mode);

    const { offsetX, offsetY } = this.#getCenterPoint();
    const id = this.getNextId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: offsetX,
      y: offsetY,
      uiManager: this.#uiManager,
      isCentered: true,
      ...params,
    });
    if (editor) {
      this.add(editor);
    }
  }

  /**
   * Create a new editor
   * @param {Object} data
   * @returns {AnnotationEditor | null}
   */
  async deserialize(data) {
    return ((await EditorManager.getDescriptor(data.annotationType ?? data.annotationEditorType)
      ?.deserialize(data, this, this.#uiManager)) || null
    );
  }

  /**
   * Create and add a new editor.
   * @param {PointerEvent} event
   * @param {boolean} isCentered
   * @param [Object] data
   * @returns {AnnotationEditor}
   */
  createAndAddNewEditor(event: { offsetX: number, offsetY: number }, isCentered: boolean, data = {}) {
    const id = this.getNextId();
    const editor = this.#createNewEditor({
      parent: this,
      id,
      x: event.offsetX,
      y: event.offsetY,
      uiManager: this.#uiManager,
      isCentered,
      ...data,
    });
    if (editor) {
      this.add(editor);
    }

    return editor;
  }

  #getCenterPoint() {
    const { x, y, width, height } = this.div!.getBoundingClientRect();
    const tlX = Math.max(0, x);
    const tlY = Math.max(0, y);
    const brX = Math.min(window.innerWidth, x + width);
    const brY = Math.min(window.innerHeight, y + height);
    const centerX = (tlX + brX) / 2 - x;
    const centerY = (tlY + brY) / 2 - y;
    const [offsetX, offsetY] = this.viewport.rotation % 180 === 0
      ? [centerX, centerY] : [centerY, centerX];

    return { offsetX, offsetY };
  }

  /**
   * Create and add a new editor.
   */
  addNewEditor() {
    this.createAndAddNewEditor(this.#getCenterPoint(), /* isCentered = */ true);
  }

  /**
   * Set the last selected editor.
   * @param {AnnotationEditor} editor
   */
  setSelected(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    this.#uiManager.setSelected(editor);
  }

  /**
   * Add or remove an editor the current selection.
   * @param {AnnotationEditor} editor
   */
  toggleSelected(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    this.#uiManager.toggleSelected(editor);
  }

  /**
   * Unselect an editor.
   * @param {AnnotationEditor} editor
   */
  unselect(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>) {
    this.#uiManager.unselect(editor);
  }

  /**
   * Pointerup callback.
   * @param {PointerEvent} event
   */
  pointerup(event: PointerEvent) {
    const { isMac } = FeatureTest.platform;
    if (event.button !== 0 || (event.ctrlKey && isMac)) {
      // Don't create an editor on right click.
      return;
    }

    if (event.target !== this.div) {
      return;
    }

    if (!this.#hadPointerDown) {
      // It can happen when the user starts a drag inside a text editor
      // and then releases the mouse button outside of it. In such a case
      // we don't want to create a new editor, hence we check that a pointerdown
      // occurred on this div previously.
      return;
    }
    this.#hadPointerDown = false;

    if (!this.#allowClick) {
      this.#allowClick = true;
      return;
    }

    if (this.#uiManager.getMode() === AnnotationEditorType.STAMP) {
      this.#uiManager.unselectAll();
      return;
    }

    this.createAndAddNewEditor(event, /* isCentered = */ false);
  }

  /**
   * Pointerdown callback.
   * @param {PointerEvent} event
   */
  pointerdown(event: PointerEvent) {
    if (this.#uiManager.getMode() === AnnotationEditorType.HIGHLIGHT) {
      this.enableTextSelection();
    }
    if (this.#hadPointerDown) {
      // It's possible to have a second pointerdown event before a pointerup one
      // when the user puts a finger on a touchscreen and then add a second one
      // to start a pinch-to-zoom gesture.
      // That said, in case it's possible to have two pointerdown events with
      // a mouse, we don't want to create a new editor in such a case either.
      this.#hadPointerDown = false;
      return;
    }
    const { isMac } = FeatureTest.platform;
    if (event.button !== 0 || (event.ctrlKey && isMac)) {
      // Do nothing on right click.
      return;
    }

    if (event.target !== this.div) {
      return;
    }

    this.#hadPointerDown = true;

    const editor = this.#uiManager.getActive();
    this.#allowClick = !editor || editor.isEmpty();
  }

  /**
   *
   * @param {AnnotationEditor} editor
   * @param {number} x
   * @param {number} y
   * @returns
   */
  findNewParent(editor: AnnotationEditor<AnnotationEditorState, AnnotationEditorSerial>, x: number, y: number) {
    const layer = this.#uiManager.findParent(x, y);
    if (layer === null || layer === this) {
      return false;
    }
    layer.changeParent(editor);
    return true;
  }

  /**
   * Destroy the main editor.
   */
  destroy() {
    if (this.#uiManager.getActive()?.parent === this) {
      // We need to commit the current editor before destroying the layer.
      this.#uiManager.commitOrRemove();
      this.#uiManager.setActiveEditor(null);
    }

    if (this.#editorFocusTimeoutId) {
      clearTimeout(this.#editorFocusTimeoutId);
      this.#editorFocusTimeoutId = null;
    }

    for (const editor of this.#editors.values()) {
      this.#accessibilityManager?.removePointerInTextLayer(editor.contentDiv!);
      editor.setParent(null);
      editor.isAttachedToDOM = false;
      editor.div!.remove();
    }
    this.div = null;
    this.#editors.clear();
    this.#uiManager.removeLayer(this);
  }

  #cleanup() {
    // When we're cleaning up, some editors are removed but we don't want
    // to add a new one which will induce an addition in this.#editors, hence
    // an infinite loop.
    this.#isCleaningUp = true;
    for (const editor of this.#editors.values()) {
      if (editor.isEmpty()) {
        editor.remove();
      }
    }
    this.#isCleaningUp = false;
  }

  /**
   * Render the main editor.
   * @param {RenderEditorLayerOptions} parameters
   */
  render({ viewport }: { viewport: PageViewport }) {
    this.viewport = viewport;
    setLayerDimensions(this.div!, viewport);
    for (const editor of this.#uiManager.getEditors(this.pageIndex)) {
      this.add(editor);
      editor.rebuild();
    }
    // We're maybe rendering a layer which was invisible when we started to edit
    // so we must set the different callbacks for it.
    this.updateMode();
  }

  /**
   * Update the main editor.
   * @param {RenderEditorLayerOptions} parameters
   */
  update({ viewport }: { viewport: PageViewport }) {
    // Editors have their dimensions/positions in percent so to avoid any
    // issues (see #15582), we must commit the current one before changing
    // the viewport.
    this.#uiManager.commitOrRemove();
    this.#cleanup();

    const oldRotation = this.viewport.rotation;
    const rotation = viewport.rotation;
    this.viewport = viewport;
    setLayerDimensions(this.div!, { rotation });
    if (oldRotation !== rotation) {
      for (const editor of this.#editors.values()) {
        editor.rotate(rotation);
      }
    }
    this.addInkEditorIfNeeded(/* isCommitting = */ false);
  }

  /**
   * Get page dimensions.
   * @returns {Object} dimensions.
   */
  get pageDimensions(): [number, number] {
    const { pageWidth, pageHeight } = this.viewport.rawDims;
    return [pageWidth, pageHeight];
  }

  get scale() {
    return this.#uiManager.viewParameters.realScale;
  }
}
