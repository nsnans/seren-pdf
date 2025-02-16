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

import { AnnotationData } from "../../core/annotation";
import { PlatformHelper } from "../../platform/platform_helper";
import { RGBType } from "../../shared/scripting_utils";
import {
  AnnotationEditorParamsType,
  AnnotationEditorPrefix,
  AnnotationEditorType,
  FeatureTest,
  getUuid,
  shadow,
  Util
} from "../../shared/util";
import { EventBus, MLManager } from "../../viewer/common/component_types";
import { AltTextManager } from "../../viewer/web/alt_text_manager";
import { AnnotationElement } from "../annotation_layer";
import { AnnotationStorage } from "../annotation_storage";
import { PDFDocumentProxy } from "../api";
import {
  fetchData,
  getColorValues,
  getRGB,
  PixelsPerInch,
} from "../display_utils";
import { FilterFactory } from "../filter_factory";
import { AnnotationEditorLayer } from "./annotation_editor_layer";
import { ColorPicker } from "./color_picker";
import { AnnotationEditor } from "./editor";
import { InkEditor } from "./ink";
import { HighlightToolbar } from "./toolbar";

function bindEvents<T extends AnnotationEditor>(
  obj: T,
  element: HTMLDivElement,
  names: (keyof T)[]
) {
  for (const name of names) {
    element.addEventListener(<string>name, (<Function>obj[name]).bind(obj));
  }
}

/**
 * Convert a number between 0 and 100 into an hex number between 0 and 255.
 * @param {number} opacity
 */
function opacityToHex(opacity: number) {
  return Math.round(Math.min(255, Math.max(1, 255 * opacity)))
    .toString(16).padStart(2, "0");
}

/**
 * Class to create some unique ids for the different editors.
 */
class IdManager {
  #id = 0;

  constructor() {
    if (PlatformHelper.isTesting()) {
      Object.defineProperty(this, "reset", {
        value: () => (this.#id = 0),
      });
    }
  }

  /**
   * Get a unique id.
   * @returns {string}
   */
  get id(): string {
    return `${AnnotationEditorPrefix}${this.#id++}`;
  }
}

export interface CacheImage {
  bitmap: ImageBitmap | HTMLImageElement | null;
  id: string;
  refCounter: number;
  isSvg: boolean;
  url: string | null;
  file: File | null;
  svgUrl: string | null;
  blobPromise: Promise<Blob> | null;
}

/**
 * Class to manage the images used by the editors.
 * The main idea is to try to minimize the memory used by the images.
 * The images are cached and reused when possible
 * We use a refCounter to know when an image is not used anymore but we need to
 * be able to restore an image after a remove+undo, so we keep a file reference
 * or an url one.
 */
class ImageManager {
  #baseId = getUuid();

  #id = 0;

  #cache: Map<string, CacheImage | null> | null = null;

  static get _isSVGFittingCanvas() {
    // By default, Firefox doesn't rescale without preserving the aspect ratio
    // when drawing an SVG image on a canvas, see https://bugzilla.mozilla.org/1547776.
    // The "workaround" is to append "svgView(preserveAspectRatio(none))" to the
    // url, but according to comment #15, it seems that it leads to unexpected
    // behavior in Safari.
    const svg = `data:image/svg+xml;charset=UTF-8,<svg viewBox="0 0 1 1" width="1" height="1" xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" style="fill:red;"/></svg>`;
    const canvas = new OffscreenCanvas(1, 3);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const image = new Image();
    image.src = svg;
    const promise = image.decode().then(() => {
      ctx.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 3);
      return new Uint32Array(ctx.getImageData(0, 0, 1, 1).data.buffer)[0] === 0;
    });

    return shadow(this, "_isSVGFittingCanvas", promise);
  }

  async #get(key: string, rawData: string | File | Blob) {
    this.#cache ||= new Map();
    let data = this.#cache!.get(key) ?? null;
    if (data === null) {
      // We already tried to load the image but it failed.
      return null;
    }
    if (data?.bitmap) {
      data.refCounter += 1;
      return data;
    }
    try {
      data ||= {
        bitmap: null,
        id: `image_${this.#baseId}_${this.#id++}`,
        refCounter: 0,
        isSvg: false,
        url: null,
        file: null,
        svgUrl: null,
        blobPromise: null,
      };
      let image;
      if (typeof rawData === "string") {
        data!.url = rawData;
        image = await fetchData(rawData, "blob");
      } else if (rawData instanceof File) {
        image = data!.file = rawData;
      } else if (rawData instanceof Blob) {
        image = rawData;
      }

      if (image.type === "image/svg+xml") {
        // Unfortunately, createImageBitmap doesn't work with SVG images.
        // (see https://bugzilla.mozilla.org/1841972).
        const mustRemoveAspectRatioPromise = ImageManager._isSVGFittingCanvas;
        const fileReader = new FileReader();
        const imageElement = new Image();
        const imagePromise = new Promise((resolve, reject) => {
          imageElement.onload = () => {
            data!.bitmap = imageElement;
            data!.isSvg = true;
            resolve(undefined);
          };
          fileReader.onload = async () => {
            const url = (data!.svgUrl = <string>fileReader.result);
            // We need to set the preserveAspectRatio to none in order to let
            // the image fits the canvas when resizing.
            imageElement.src = (await mustRemoveAspectRatioPromise)
              ? `${url}#svgView(preserveAspectRatio(none))`
              : <string>url;
          };
          imageElement.onerror = fileReader.onerror = reject;
        });
        fileReader.readAsDataURL(image);
        await imagePromise;
      } else {
        data!.bitmap = await createImageBitmap(image);
      }
      data!.refCounter = 1;
    } catch (e) {
      console.error(e);
      data = null;
    }
    this.#cache.set(key, data);
    if (data) {
      this.#cache.set(data.id, data);
    }
    return data;
  }

  async getFromFile(file: File) {
    const { lastModified, name, size, type } = file;
    return this.#get(`${lastModified}_${name}_${size}_${type}`, file);
  }

  async getFromUrl(url: string) {
    return this.#get(url, url);
  }

  async getFromBlob(id: string, blobPromise: Promise<Blob>) {
    const blob = await blobPromise;
    return this.#get(id, blob);
  }

  async getFromId(id: string) {
    this.#cache ||= new Map();
    const data = this.#cache.get(id);
    if (!data) {
      return null;
    }
    if (data.bitmap) {
      data.refCounter += 1;
      return data;
    }

    if (data.file) {
      return this.getFromFile(data.file);
    }
    if (data.blobPromise) {
      const { blobPromise } = data;
      data.blobPromise = null;
      return this.getFromBlob(data.id, blobPromise);
    }
    return this.getFromUrl(data.url!);
  }

  getFromCanvas(id: string, canvas: HTMLCanvasElement) {
    this.#cache ||= new Map();
    let data = this.#cache.get(id);
    if (data?.bitmap) {
      data.refCounter += 1;
      return data;
    }
    const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = offscreen.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    data = {
      bitmap: offscreen.transferToImageBitmap(),
      id: `image_${this.#baseId}_${this.#id++}`,
      refCounter: 1,
      isSvg: false,
      url: null,
      file: null,
      svgUrl: null,
      blobPromise: null,
    };
    this.#cache.set(id, data);
    this.#cache.set(data.id, data);
    return data;
  }

  getSvgUrl(id: string) {
    const data = this.#cache!.get(id);
    if (!data?.isSvg) {
      return null;
    }
    return data.svgUrl;
  }

  deleteId(id: string) {
    this.#cache ||= new Map();
    const data = this.#cache.get(id);
    if (!data) {
      return;
    }
    data.refCounter -= 1;
    if (data.refCounter !== 0) {
      return;
    }
    const bitmap = data.bitmap!;
    if (!data.url && !data.file) {
      // The image has no way to be restored (ctrl+z) so we must fix that.
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("bitmaprenderer")!;
      ctx.transferFromImageBitmap(<ImageBitmap>bitmap);
      data.blobPromise = canvas.convertToBlob();
    }

    (<ImageBitmap>bitmap).close?.();
    data.bitmap = null;
  }

  // We can use the id only if it belongs this manager.
  // We must take care of having the right manager because we can copy/paste
  // some images from other documents, hence it'd be a pity to use an id from an
  // other manager.
  isValidId(id: string) {
    return id.startsWith(`image_${this.#baseId}_`);
  }
}

interface Command {
  cmd: () => void;
  undo: () => void;
  post: () => void;
  type: number;
}

/**
 * Class to handle undo/redo.
 * Commands are just saved in a buffer.
 * If we hit some memory issues we could likely use a circular buffer.
 * It has to be used as a singleton.
 */
class CommandManager {
  #commands: Command[] = [];

  #locked = false;

  #maxSize;

  #position = -1;

  constructor(maxSize = 128) {
    this.#maxSize = maxSize;
  }

  /**
   * @typedef {Object} addOptions
   * @property {function} cmd
   * @property {function} undo
   * @property {function} [post]
   * @property {boolean} mustExec
   * @property {number} type
   * @property {boolean} overwriteIfSameType
   * @property {boolean} keepUndo
   */

  /**
   * Add a new couple of commands to be used in case of redo/undo.
   * @param {addOptions} options
   */
  add(
    cmd: () => void,
    undo: () => void,
    post: () => void,
    mustExec: boolean,
    type = NaN,
    overwriteIfSameType = false,
    keepUndo = false,
  ) {
    if (mustExec) {
      cmd();
    }

    if (this.#locked) {
      return;
    }

    const save = { cmd, undo, post, type };
    if (this.#position === -1) {
      if (this.#commands.length > 0) {
        // All the commands have been undone and then a new one is added
        // hence we clear the queue.
        this.#commands.length = 0;
      }
      this.#position = 0;
      this.#commands.push(save);
      return;
    }

    if (overwriteIfSameType && this.#commands[this.#position].type === type) {
      // For example when we change a color we don't want to
      // be able to undo all the steps, hence we only want to
      // keep the last undoable action in this sequence of actions.
      if (keepUndo) {
        save.undo = this.#commands[this.#position].undo;
      }
      this.#commands[this.#position] = save;
      return;
    }

    const next = this.#position + 1;
    if (next === this.#maxSize) {
      this.#commands.splice(0, 1);
    } else {
      this.#position = next;
      if (next < this.#commands.length) {
        this.#commands.splice(next);
      }
    }

    this.#commands.push(save);
  }

  /**
   * Undo the last command.
   */
  undo() {
    if (this.#position === -1) {
      // Nothing to undo.
      return;
    }

    // Avoid to insert something during the undo execution.
    this.#locked = true;
    const { undo, post } = this.#commands[this.#position];
    undo();
    post?.();
    this.#locked = false;

    this.#position -= 1;
  }

  /**
   * Redo the last command.
   */
  redo() {
    if (this.#position < this.#commands.length - 1) {
      this.#position += 1;

      // Avoid to insert something during the redo execution.
      this.#locked = true;
      const { cmd, post } = this.#commands[this.#position];
      cmd();
      post?.();
      this.#locked = false;
    }
  }

  /**
   * Check if there is something to undo.
   * @returns {boolean}
   */
  hasSomethingToUndo() {
    return this.#position !== -1;
  }

  /**
   * Check if there is something to redo.
   * @returns {boolean}
   */
  hasSomethingToRedo() {
    return this.#position < this.#commands.length - 1;
  }

  destroy() {
    this.#commands = [];
  }
}

/**
 * Class to handle the different keyboards shortcuts we can have on mac or
 * non-mac OSes.
 */
class KeyboardManager<T> {

  protected callbacks;

  protected allKeys;

  protected buffer: string[];
  /**
   * Create a new keyboard manager class.
   * @param {Array<Array>} callbacks - an array containing an array of shortcuts
   * and a callback to call.
   * A shortcut is a string like `ctrl+c` or `mac+ctrl+c` for mac OS.
   */
  constructor(callbacks: ([string[], Function] | [string[], Function, unknown])[]) {
    this.buffer = [];
    this.callbacks = new Map();
    this.allKeys = new Set();

    const { isMac } = FeatureTest.platform;
    for (const [keys, callback, options = {}] of callbacks) {
      for (const key of keys) {
        const isMacKey = key.startsWith("mac+");
        if (isMac && isMacKey) {
          this.callbacks.set(key.slice(4), { callback, options });
          this.allKeys.add(key.split("+").at(-1));
        } else if (!isMac && !isMacKey) {
          this.callbacks.set(key, { callback, options });
          this.allKeys.add(key.split("+").at(-1));
        }
      }
    }
  }

  /**
   * Serialize an event into a string in order to match a
   * potential key for a callback.
   */
  #serialize(event: KeyboardEvent) {
    if (event.altKey) {
      this.buffer.push("alt");
    }
    if (event.ctrlKey) {
      this.buffer.push("ctrl");
    }
    if (event.metaKey) {
      this.buffer.push("meta");
    }
    if (event.shiftKey) {
      this.buffer.push("shift");
    }
    this.buffer.push(event.key);
    const str = this.buffer.join("+");
    this.buffer.length = 0;

    return str;
  }

  /**
   * Execute a callback, if any, for a given keyboard event.
   * The self is used as `this` in the callback.
   * @param {Object} self
   * @param {KeyboardEvent} event
   * @returns
   */
  exec(self: T, event: KeyboardEvent) {
    if (!this.allKeys.has(event.key)) {
      return;
    }
    const info = this.callbacks.get(this.#serialize(event));
    if (!info) {
      return;
    }
    const {
      callback,
      options: { bubbles = false, args = [], checker = null },
    } = info;

    if (checker && !checker(self, event)) {
      return;
    }
    callback.bind(self, ...args, event)();

    // For example, ctrl+s in a FreeText must be handled by the viewer, hence
    // the event must bubble.
    if (!bubbles) {
      event.stopPropagation();
      event.preventDefault();
    }
  }
}

class ColorManager {
  static _colorsMapping = new Map([
    ["CanvasText", [0, 0, 0]],
    ["Canvas", [255, 255, 255]],
  ]);

  get _colors() {
    if (PlatformHelper.testLib() && typeof document === "undefined") {
      return shadow(this, "_colors", ColorManager._colorsMapping);
    }

    const colors = new Map([
      ["CanvasText", null],
      ["Canvas", null],
    ]);
    getColorValues(colors);
    return shadow(this, "_colors", colors);
  }

  /**
   * In High Contrast Mode, the color on the screen is not always the
   * real color used in the pdf.
   * For example in some cases white can appear to be black but when saving
   * we want to have white.
   * @param {string} color
   * @returns {Array<number>}
   */
  convert(color: string): number[] {
    const rgb = getRGB(color);
    if (!window.matchMedia("(forced-colors: active)").matches) {
      return rgb;
    }

    for (const [name, RGB] of this._colors) {
      if (RGB!.every((x, i) => x === rgb[i])) {
        return ColorManager._colorsMapping.get(name)!;
      }
    }
    return rgb;
  }

  /**
   * An input element must have its color value as a hex string
   * and not as color name.
   * So this function converts a name into an hex string.
   * @param {string} name
   */
  getHexCode(name: string) {
    const rgb = <RGBType>this._colors.get(name);
    if (!rgb) {
      return name;
    }
    return Util.makeHexColor(...rgb);
  }
}

interface DragEditorInfo {
  savedX: number;
  savedY: number;
  savedPageIndex: number;
  newX: number;
  newY: number;
  newPageIndex: number;
}


/**
 * A pdf has several pages and each of them when it will rendered
 * will have an AnnotationEditorLayer which will contain the some
 * new Annotations associated to an editor in order to modify them.
 *
 * This class is used to manage all the different layers, editors and
 * some action like copy/paste, undo/redo, ...
 */
class AnnotationEditorUIManager {

  static TRANSLATE_SMALL = 1; // page units.

  static TRANSLATE_BIG = 10; // page units.

  static get _keyboardManager() {
    const proto = AnnotationEditorUIManager.prototype;

    /**
     * If the focused element is an input, we don't want to handle the arrow.
     * For example, sliders can be controlled with the arrow keys.
     */
    const arrowChecker = (self: AnnotationEditorUIManager) =>
      self.#container!.contains(document.activeElement) &&
      document.activeElement!.tagName !== "BUTTON" &&
      self.hasSomethingToControl();

    const textInputChecker = (_self: AnnotationEditorUIManager, { target: el }: KeyboardEvent) => {
      if (el instanceof HTMLInputElement) {
        const { type } = el;
        return type !== "text" && type !== "number";
      }
      return true;
    };

    const small = this.TRANSLATE_SMALL;
    const big = this.TRANSLATE_BIG;

    return shadow(this, "_keyboardManager", new KeyboardManager([
      [
        ["ctrl+a", "mac+meta+a"],
        proto.selectAll,
        { checker: textInputChecker },
      ],
      [["ctrl+z", "mac+meta+z"], proto.undo, { checker: textInputChecker }],
      [
        // On mac, depending of the OS version, the event.key is either "z" or
        // "Z" when the user presses "meta+shift+z".
        [
          "ctrl+y",
          "ctrl+shift+z",
          "mac+meta+shift+z",
          "ctrl+shift+Z",
          "mac+meta+shift+Z",
        ],
        proto.redo,
        { checker: textInputChecker },
      ],
      [
        [
          "Backspace",
          "alt+Backspace",
          "ctrl+Backspace",
          "shift+Backspace",
          "mac+Backspace",
          "mac+alt+Backspace",
          "mac+ctrl+Backspace",
          "Delete",
          "ctrl+Delete",
          "shift+Delete",
          "mac+Delete",
        ],
        proto.delete,
        { checker: textInputChecker },
      ],
      [
        ["Enter", "mac+Enter"],
        proto.addNewEditorFromKeyboard,
        {
          // Those shortcuts can be used in the toolbar for some other actions
          // like zooming, hence we need to check if the container has the
          // focus.
          checker: (self: AnnotationEditorUIManager, { target: el }: KeyboardEvent) =>
            !(el instanceof HTMLButtonElement) &&
            self.#container!.contains(<Node>el) &&
            !self.isEnterHandled,
        },
      ],
      [
        [" ", "mac+ "],
        proto.addNewEditorFromKeyboard,
        {
          // Those shortcuts can be used in the toolbar for some other actions
          // like zooming, hence we need to check if the container has the
          // focus.
          checker: (self: AnnotationEditorUIManager, { target: el }: KeyboardEvent) =>
            !(el instanceof HTMLButtonElement) &&
            self.#container!.contains(document.activeElement),
        },
      ],
      [["Escape", "mac+Escape"], proto.unselectAll],
      [
        ["ArrowLeft", "mac+ArrowLeft"],
        proto.translateSelectedEditors,
        { args: [-small, 0], checker: arrowChecker },
      ],
      [
        ["ctrl+ArrowLeft", "mac+shift+ArrowLeft"],
        proto.translateSelectedEditors,
        { args: [-big, 0], checker: arrowChecker },
      ],
      [
        ["ArrowRight", "mac+ArrowRight"],
        proto.translateSelectedEditors,
        { args: [small, 0], checker: arrowChecker },
      ],
      [
        ["ctrl+ArrowRight", "mac+shift+ArrowRight"],
        proto.translateSelectedEditors,
        { args: [big, 0], checker: arrowChecker },
      ],
      [
        ["ArrowUp", "mac+ArrowUp"],
        proto.translateSelectedEditors,
        { args: [0, -small], checker: arrowChecker },
      ],
      [
        ["ctrl+ArrowUp", "mac+shift+ArrowUp"],
        proto.translateSelectedEditors,
        { args: [0, -big], checker: arrowChecker },
      ],
      [
        ["ArrowDown", "mac+ArrowDown"],
        proto.translateSelectedEditors,
        { args: [0, small], checker: arrowChecker },
      ],
      [
        ["ctrl+ArrowDown", "mac+shift+ArrowDown"],
        proto.translateSelectedEditors,
        { args: [0, big], checker: arrowChecker },
      ],
    ]));
  }

  #abortController: AbortController | null = new AbortController();

  #activeEditor: AnnotationEditor | null = null;

  #allEditors = new Map<string, AnnotationEditor>();

  #allLayers = new Map<number, AnnotationEditorLayer>();

  #altTextManager: AltTextManager | null;

  #annotationStorage: AnnotationStorage | null = null;

  #changedExistingAnnotations: Map<string, string> | null = null;

  #commandManager = new CommandManager();

  #copyPasteAC: AbortController | null = null;

  #currentPageIndex = 0;

  #deletedAnnotationsElementIds = new Set();

  #draggingEditors: Map<AnnotationEditor, DragEditorInfo> | null = null;

  #editorTypes = null;

  #editorsToRescale = new Set<AnnotationEditor>();

  #enableHighlightFloatingButton = false;

  #enableUpdatedAddImage = false;

  #enableNewAltTextWhenAddingImage = false;

  #filterFactory: FilterFactory | null = null;

  #focusMainContainerTimeoutId: number | null = null;

  #focusManagerAC: AbortController | null = null;

  #highlightColors: string | null = null;

  #highlightWhenShiftUp = false;

  #highlightToolbar: HighlightToolbar | null = null;

  #idManager = new IdManager();

  #isEnabled = false;

  #isWaiting = false;

  #keyboardManagerAC: AbortController | null = null;

  #lastActiveElement: [AnnotationEditor
    , HTMLElement] | null = null;

  #mainHighlightColorPicker: ColorPicker | null = null;

  #mlManager: MLManager | null = null;

  #mode = AnnotationEditorType.NONE;

  #selectedEditors = new Set<AnnotationEditor>();

  #selectedTextNode: Node | null = null;

  #pageColors: { background: string, foreground: string } | null = null;

  #showAllStates: Map<AnnotationEditorParamsType, boolean> | null = null;

  #previousStates = {
    isEditing: false,
    isEmpty: true,
    hasSomethingToUndo: false,
    hasSomethingToRedo: false,
    hasSelectedEditor: false,
    hasSelectedText: false,
  };

  #translation = [0, 0];

  #translationTimeoutId: number | null = null;

  #container: HTMLDivElement | null = null;

  #viewer: HTMLDivElement | null = null;

  #updateModeCapability: PromiseWithResolvers<void> | null = null;

  public viewParameters: { realScale: number; rotation: number; };

  public _signal: AbortSignal | null;

  public _eventBus: EventBus;

  protected isShiftKeyDown: boolean;

  constructor(
    container: HTMLDivElement,
    viewer: HTMLDivElement,
    altTextManager: AltTextManager | null,
    eventBus: EventBus,
    pdfDocument: PDFDocumentProxy,
    pageColors: { background: string, foreground: string } | null,
    highlightColors: string | null,
    enableHighlightFloatingButton: boolean,
    enableUpdatedAddImage: boolean,
    enableNewAltTextWhenAddingImage: boolean
  ) {
    const signal = (this._signal = this.#abortController!.signal);
    this.#container = container;
    this.#viewer = viewer;
    this.#altTextManager = altTextManager;
    this._eventBus = eventBus;
    eventBus._on("editingaction", this.onEditingAction.bind(this), { signal });
    eventBus._on("pagechanging", this.onPageChanging.bind(this), { signal });
    eventBus._on("scalechanging", this.onScaleChanging.bind(this), { signal });
    eventBus._on("rotationchanging", this.onRotationChanging.bind(this), {
      signal,
    });
    eventBus._on("setpreference", this.onSetPreference.bind(this), { signal });
    eventBus._on(
      "switchannotationeditorparams",
      (evt: {
        type: AnnotationEditorParamsType,
        value: string | number | boolean | null
      }) => this.updateParams(evt.type, evt.value),
      { signal }
    );
    this.#addSelectionListener();
    this.#addDragAndDropListeners();
    this.#addKeyboardManager();
    this.#annotationStorage = pdfDocument.annotationStorage;
    this.#filterFactory = pdfDocument.filterFactory;
    this.#pageColors = pageColors;
    this.#highlightColors = highlightColors || null;
    this.#enableHighlightFloatingButton = enableHighlightFloatingButton;
    this.#enableUpdatedAddImage = enableUpdatedAddImage;
    this.#enableNewAltTextWhenAddingImage = enableNewAltTextWhenAddingImage;
    this.viewParameters = {
      realScale: PixelsPerInch.PDF_TO_CSS_UNITS,
      rotation: 0,
    };
    this.isShiftKeyDown = false;

  }

  destroy() {
    this.#updateModeCapability?.resolve();
    this.#updateModeCapability = null;

    this.#abortController?.abort();
    this.#abortController = null;
    this._signal = null;

    for (const layer of this.#allLayers.values()) {
      layer.destroy();
    }
    this.#allLayers.clear();
    this.#allEditors.clear();
    this.#editorsToRescale.clear();
    this.#activeEditor = null;
    this.#selectedEditors.clear();
    this.#commandManager.destroy();
    this.#altTextManager?.destroy();
    this.#highlightToolbar?.hide();
    this.#highlightToolbar = null;
    if (this.#focusMainContainerTimeoutId) {
      clearTimeout(this.#focusMainContainerTimeoutId);
      this.#focusMainContainerTimeoutId = null;
    }
    if (this.#translationTimeoutId) {
      clearTimeout(this.#translationTimeoutId);
      this.#translationTimeoutId = null;
    }
  }

  combinedSignal(ac: AbortController) {
    return AbortSignal.any([this._signal!, ac.signal]);
  }

  get mlManager() {
    return this.#mlManager;
  }

  get useNewAltTextFlow() {
    return this.#enableUpdatedAddImage;
  }

  get useNewAltTextWhenAddingImage() {
    return this.#enableNewAltTextWhenAddingImage;
  }

  get hcmFilter() {
    return shadow(
      this,
      "hcmFilter",
      this.#pageColors
        ? this.#filterFactory!.addHCMFilter(
          this.#pageColors.foreground,
          this.#pageColors.background
        )
        : "none"
    );
  }

  get direction() {
    return shadow(this, "direction", getComputedStyle(this.#container!).direction);
  }

  get highlightColors() {
    return shadow(
      this,
      "highlightColors",
      this.#highlightColors ? new Map(
        <[string, string][]>(this.#highlightColors!.split(",")
          .map(pair => pair.split("=").map(x => x.trim()))
        )) : null
    );
  }

  get highlightColorNames() {
    return shadow(this, "highlightColorNames", this.highlightColors
      ? new Map(<[string, string][]>Array.from(this.highlightColors!, e => e.reverse())) : null
    );
  }

  setMainHighlightColorPicker(colorPicker: ColorPicker) {
    this.#mainHighlightColorPicker = colorPicker;
  }

  editAltText(editor: AnnotationEditor, firstTime = false) {
    this.#altTextManager?.editAltText(this, editor, firstTime);
  }

  switchToMode(mode: AnnotationEditorType, callback: () => void) {
    // Switching to a mode can be asynchronous.
    this._eventBus.on("annotationeditormodechanged", callback, {
      once: true,
      signal: this._signal,
    });
    this._eventBus.dispatch("showannotationeditorui", {
      source: this,
      mode,
    });
  }

  setPreference(name: string, value: boolean) {
    this._eventBus.dispatch("setpreference", {
      source: this,
      name,
      value,
    });
  }

  onSetPreference({ name, value }: { name: string, value: boolean }) {
    switch (name) {
      case "enableNewAltTextWhenAddingImage":
        this.#enableNewAltTextWhenAddingImage = value;
        break;
    }
  }

  onPageChanging({ pageNumber }: { pageNumber: number }) {
    this.#currentPageIndex = pageNumber - 1;
  }

  focusMainContainer() {
    this.#container!.focus();
  }

  findParent(x: number, y: number) {
    for (const layer of this.#allLayers.values()) {
      const {
        x: layerX,
        y: layerY,
        width,
        height,
      } = layer.div!.getBoundingClientRect();
      if (
        x >= layerX &&
        x <= layerX + width &&
        y >= layerY &&
        y <= layerY + height
      ) {
        return layer;
      }
    }
    return null;
  }

  disableUserSelect(value = false) {
    this.#viewer!.classList.toggle("noUserSelect", value);
  }

  addShouldRescale(editor: AnnotationEditor) {
    this.#editorsToRescale.add(editor);
  }

  removeShouldRescale(editor: AnnotationEditor) {
    this.#editorsToRescale.delete(editor);
  }

  onScaleChanging({ scale }: { scale: number }) {
    this.commitOrRemove();
    this.viewParameters.realScale = scale * PixelsPerInch.PDF_TO_CSS_UNITS;
    for (const editor of this.#editorsToRescale) {
      if (editor instanceof InkEditor) {
        editor!.onScaleChanging();
      }
    }
  }

  onRotationChanging({ pagesRotation }: { pagesRotation: number }) {
    this.commitOrRemove();
    this.viewParameters.rotation = pagesRotation;
  }

  #getAnchorElementForSelection({ anchorNode }: { anchorNode: Node | null }) {
    return anchorNode!.nodeType === Node.TEXT_NODE
      ? anchorNode!.parentElement
      : anchorNode!;
  }

  #getLayerForTextLayer(textLayer: HTMLDivElement) {
    const { currentLayer } = this;
    if (currentLayer.hasTextLayer(textLayer)) {
      return currentLayer;
    }
    for (const layer of this.#allLayers.values()) {
      if (layer.hasTextLayer(textLayer)) {
        return layer;
      }
    }
    return null;
  }

  highlightSelection(methodOfCreation = "") {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
    const text = selection.toString();
    const anchorElement = this.#getAnchorElementForSelection(selection);
    const textLayer = (<HTMLElement>anchorElement).closest(".textLayer");
    const boxes = this.getSelectionBoxes(<HTMLDivElement>textLayer);
    if (!boxes) {
      return;
    }
    selection.empty();

    const layer = this.#getLayerForTextLayer(<HTMLDivElement>textLayer!);
    const isNoneMode = this.#mode === AnnotationEditorType.NONE;
    const callback = () => {
      layer?.createAndAddNewEditor({ offsetX: 0, offsetY: 0 }, false, {
        methodOfCreation,
        boxes,
        anchorNode,
        anchorOffset,
        focusNode,
        focusOffset,
        text,
      });
      if (isNoneMode) {
        this.showAllEditors(AnnotationEditorType.HIGHLIGHT, true, true);
      }
    };
    if (isNoneMode) {
      this.switchToMode(AnnotationEditorType.HIGHLIGHT, callback);
      return;
    }
    callback();
  }

  #displayHighlightToolbar() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    const anchorElement = this.#getAnchorElementForSelection(selection);
    const textLayer = (<HTMLElement>anchorElement).closest(".textLayer");
    const boxes = this.getSelectionBoxes(<HTMLDivElement>textLayer);
    if (!boxes) {
      return;
    }
    this.#highlightToolbar ||= new HighlightToolbar(this);
    this.#highlightToolbar.show(<HTMLDivElement>textLayer, boxes, this.direction === "ltr");
  }

  /**
   * Add an editor in the annotation storage.
   * @param {AnnotationEditor} editor
   */
  addToAnnotationStorage(editor: AnnotationEditor) {
    if (
      !editor.isEmpty() &&
      this.#annotationStorage &&
      !this.#annotationStorage.has(editor.id)
    ) {
      this.#annotationStorage.setValue(editor.id, editor);
    }
  }

  #selectionChange() {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
      if (this.#selectedTextNode) {
        this.#highlightToolbar?.hide();
        this.#selectedTextNode = null;
        this.#dispatchUpdateStates({
          hasSelectedText: false,
        });
      }
      return;
    }
    const { anchorNode } = selection;
    if (anchorNode === this.#selectedTextNode) {
      return;
    }

    const anchorElement = this.#getAnchorElementForSelection(selection);
    const textLayer = <HTMLDivElement | null>(<HTMLElement>anchorElement).closest(".textLayer");
    if (!textLayer) {
      if (this.#selectedTextNode) {
        this.#highlightToolbar?.hide();
        this.#selectedTextNode = null;
        this.#dispatchUpdateStates({
          hasSelectedText: false,
        });
      }
      return;
    }

    this.#highlightToolbar?.hide();
    this.#selectedTextNode = anchorNode;
    this.#dispatchUpdateStates({
      hasSelectedText: true,
    });

    if (
      this.#mode !== AnnotationEditorType.HIGHLIGHT &&
      this.#mode !== AnnotationEditorType.NONE
    ) {
      return;
    }

    if (this.#mode === AnnotationEditorType.HIGHLIGHT) {
      this.showAllEditors(AnnotationEditorType.HIGHLIGHT, true, true);
    }

    this.#highlightWhenShiftUp = this.isShiftKeyDown;
    if (!this.isShiftKeyDown) {
      const activeLayer = this.#mode === AnnotationEditorType.HIGHLIGHT
        ? this.#getLayerForTextLayer(textLayer) : null;
      activeLayer?.toggleDrawing();

      const ac = new AbortController();
      const signal = this.combinedSignal(ac);

      const pointerup = (e: Event) => {
        if (e.type === "pointerup" && (<PointerEvent>e).button !== 0) {
          // Do nothing on right click.
          return;
        }
        ac.abort();
        activeLayer?.toggleDrawing(true);
        if (e.type === "pointerup") {
          this.#onSelectEnd("main_toolbar");
        }
      };
      window.addEventListener("pointerup", pointerup, { signal });
      window.addEventListener("blur", pointerup, { signal });
    }
  }

  #onSelectEnd(methodOfCreation = "") {
    if (this.#mode === AnnotationEditorType.HIGHLIGHT) {
      this.highlightSelection(methodOfCreation);
    } else if (this.#enableHighlightFloatingButton) {
      this.#displayHighlightToolbar();
    }
  }

  #addSelectionListener() {
    document.addEventListener(
      "selectionchange",
      this.#selectionChange.bind(this),
      { signal: this._signal! }
    );
  }

  #addFocusManager() {
    if (this.#focusManagerAC) {
      return;
    }
    this.#focusManagerAC = new AbortController();
    const signal = this.combinedSignal(this.#focusManagerAC);

    window.addEventListener("focus", this.focus.bind(this), { signal });
    window.addEventListener("blur", this.blur.bind(this), { signal });
  }

  #removeFocusManager() {
    this.#focusManagerAC?.abort();
    this.#focusManagerAC = null;
  }

  blur() {
    this.isShiftKeyDown = false;
    if (this.#highlightWhenShiftUp) {
      this.#highlightWhenShiftUp = false;
      this.#onSelectEnd("main_toolbar");
    }
    if (!this.hasSelection) {
      return;
    }
    // When several editors are selected and the window loses focus, we want to
    // keep the last active element in order to be able to focus it again when
    // the window gets the focus back but we don't want to trigger any focus
    // callbacks else only one editor will be selected.
    const { activeElement } = document;
    for (const editor of this.#selectedEditors) {
      if (editor.div!.contains(activeElement)) {
        this.#lastActiveElement = [editor, <HTMLElement>activeElement];
        editor._focusEventsAllowed = false;
        break;
      }
    }
  }

  focus() {
    if (!this.#lastActiveElement) {
      return;
    }
    const [lastEditor, lastActiveElement] = this.#lastActiveElement;
    this.#lastActiveElement = null;
    lastActiveElement!.addEventListener(
      "focusin",
      () => {
        lastEditor._focusEventsAllowed = true;
      },
      { once: true, signal: this._signal! }
    );
    lastActiveElement!.focus();
  }

  #addKeyboardManager() {
    if (this.#keyboardManagerAC) {
      return;
    }
    this.#keyboardManagerAC = new AbortController();
    const signal = this.combinedSignal(this.#keyboardManagerAC);

    // The keyboard events are caught at the container level in order to be able
    // to execute some callbacks even if the current page doesn't have focus.
    window.addEventListener("keydown", this.keydown.bind(this), { signal });
    window.addEventListener("keyup", this.keyup.bind(this), { signal });
  }

  #removeKeyboardManager() {
    this.#keyboardManagerAC?.abort();
    this.#keyboardManagerAC = null;
  }

  #addCopyPasteListeners() {
    if (this.#copyPasteAC) {
      return;
    }
    this.#copyPasteAC = new AbortController();
  }

  #removeCopyPasteListeners() {
    this.#copyPasteAC?.abort();
    this.#copyPasteAC = null;
  }

  #addDragAndDropListeners() {
    const signal = this._signal!;
    document.addEventListener("dragover", this.dragOver.bind(this), { signal });
    document.addEventListener("drop", this.drop.bind(this), { signal });
  }

  addEditListeners() {
    this.#addKeyboardManager();
    this.#addCopyPasteListeners();
  }

  removeEditListeners() {
    this.#removeKeyboardManager();
    this.#removeCopyPasteListeners();
  }

  dragOver(_event: DragEvent) {
  }

  /**
   * Drop callback.
   * @param {DragEvent} event
   */
  drop(_event: DragEvent) {
  }

  /**
   * Keydown callback.
   * @param {KeyboardEvent} event
   */
  keydown(event: KeyboardEvent) {
    if (!this.isShiftKeyDown && event.key === "Shift") {
      this.isShiftKeyDown = true;
    }
    if (
      this.#mode !== AnnotationEditorType.NONE &&
      !this.isEditorHandlingKeyboard
    ) {
      AnnotationEditorUIManager._keyboardManager.exec(this, event);
    }
  }

  /**
   * Keyup callback.
   * @param {KeyboardEvent} event
   */
  keyup(event: KeyboardEvent) {
    if (this.isShiftKeyDown && event.key === "Shift") {
      this.isShiftKeyDown = false;
      if (this.#highlightWhenShiftUp) {
        this.#highlightWhenShiftUp = false;
        this.#onSelectEnd("main_toolbar");
      }
    }
  }

  /**
   * Execute an action for a given name.
   * For example, the user can click on the "Undo" entry in the context menu
   * and it'll trigger the undo action.
   */
  onEditingAction({ name }: { name: string }) {
    switch (name) {
      case "undo":
      case "redo":
      case "delete":
      case "selectAll":
        this[name]();
        break;
      case "highlightSelection":
        this.highlightSelection("context_menu");
        break;
    }
  }

  /**
   * Update the different possible states of this manager, e.g. is there
   * something to undo, redo, ...
   * @param {Object} details
   */
  #dispatchUpdateStates(details: Partial<{
    isEditing: boolean;
    isEmpty: boolean;
    hasSomethingToUndo: boolean;
    hasSomethingToRedo: boolean;
    hasSelectedEditor: boolean;
    hasSelectedText: boolean;
  }>) {
    const hasChanged = Object.entries(details).some(
      ([key, value]) => (<Record<string, boolean>>this.#previousStates)[key] !== value
    );

    if (hasChanged) {
      this._eventBus.dispatch("annotationeditorstateschanged", {
        source: this,
        details: Object.assign(this.#previousStates, details),
      });
      // We could listen on our own event but it sounds like a bit weird and
      // it's a way to simpler to handle that stuff here instead of having to
      // add something in every place where an editor can be unselected.
      if (
        this.#mode === AnnotationEditorType.HIGHLIGHT &&
        details.hasSelectedEditor === false
      ) {
        this.#dispatchUpdateUI([
          [AnnotationEditorParamsType.HIGHLIGHT_FREE, true],
        ]);
      }
    }
  }

  #dispatchUpdateUI(details: [AnnotationEditorParamsType, unknown][]) {
    this._eventBus.dispatch("annotationeditorparamschanged", {
      source: this,
      details,
    });
  }

  /**
   * Set the editing state.
   * It can be useful to temporarily disable it when the user is editing a
   * FreeText annotation.
   * @param {boolean} isEditing
   */
  setEditingState(isEditing: boolean) {
    if (isEditing) {
      this.#addFocusManager();
      this.#addCopyPasteListeners();
      this.#dispatchUpdateStates({
        isEditing: this.#mode !== AnnotationEditorType.NONE,
        isEmpty: this.#isEmpty(),
        hasSomethingToUndo: this.#commandManager.hasSomethingToUndo(),
        hasSomethingToRedo: this.#commandManager.hasSomethingToRedo(),
        hasSelectedEditor: false,
      });
    } else {
      this.#removeFocusManager();
      this.#removeCopyPasteListeners();
      this.#dispatchUpdateStates({
        isEditing: false,
      });
      this.disableUserSelect(false);
    }
  }

  /**
   * Get an id.
   */
  getId() {
    return this.#idManager.id;
  }

  get currentLayer() {
    return this.#allLayers.get(this.#currentPageIndex)!;
  }

  getLayer(pageIndex: number) {
    return this.#allLayers.get(pageIndex);
  }

  get currentPageIndex() {
    return this.#currentPageIndex;
  }

  /**
   * Add a new layer for a page which will contains the editors.
   * @param {AnnotationEditorLayer} layer
   */
  addLayer(layer: AnnotationEditorLayer) {
    this.#allLayers.set(layer.pageIndex, layer);
    if (this.#isEnabled) {
      layer.enable();
    } else {
      layer.disable();
    }
  }

  /**
   * Remove a layer.
   * @param {AnnotationEditorLayer} layer
   */
  removeLayer(layer: AnnotationEditorLayer) {
    this.#allLayers.delete(layer.pageIndex);
  }

  /**
   * Change the editor mode (None, FreeText, Ink, ...)
   * @param isFromKeyboard - true if the mode change is due to a
   *   keyboard action.
   */
  async updateMode(mode: AnnotationEditorType, editId: string | null = null, isFromKeyboard = false) {
    if (this.#mode === mode) {
      return;
    }

    if (this.#updateModeCapability) {
      await this.#updateModeCapability.promise;
      if (!this.#updateModeCapability) {
        // This ui manager has been destroyed.
        return;
      }
    }

    this.#updateModeCapability = Promise.withResolvers();

    this.#mode = mode;
    if (mode === AnnotationEditorType.NONE) {
      this.setEditingState(false);
      this.#disableAll();

      this.#updateModeCapability.resolve();
      return;
    }
    this.setEditingState(true);
    await this.#enableAll();
    this.unselectAll();
    for (const layer of this.#allLayers.values()) {
      layer.updateMode(mode);
    }
    if (!editId) {
      if (isFromKeyboard) {
        this.addNewEditorFromKeyboard();
      }

      this.#updateModeCapability.resolve();
      return;
    }

    for (const editor of this.#allEditors.values()) {
      if (editor.annotationElementId === editId) {
        this.setSelected(editor);
        editor.enterInEditMode();
      } else {
        editor.unselect();
      }
    }

    this.#updateModeCapability.resolve();
  }

  addNewEditorFromKeyboard() {
    if (this.currentLayer.canCreateNewEmptyEditor()) {
      this.currentLayer.addNewEditor();
    }
  }

  /**
   * Update the toolbar if it's required to reflect the tool currently used.
   */
  updateToolbar(mode: AnnotationEditorType) {
    if (mode === this.#mode) {
      return;
    }
    this._eventBus.dispatch("switchannotationeditormode", {
      source: this,
      mode,
    });
  }

  /**
   * Update a parameter in the current editor or globally.
   * @param {number} type
   * @param {*} value
   */
  updateParams(type: AnnotationEditorParamsType, value: string | number | boolean | null) {
    if (!this.#editorTypes) {
      return;
    }

    switch (type) {
      case AnnotationEditorParamsType.CREATE:
        this.currentLayer.addNewEditor();
        return;
      case AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR:
        this.#mainHighlightColorPicker?.updateColor(<string>value);
        break;
      case AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL:
        (this.#showAllStates ||= new Map()).set(type, value);
        this.showAllEditors(AnnotationEditorType.HIGHLIGHT, <boolean>value);
        break;
    }

    for (const editor of this.#selectedEditors) {
      editor.updateParams(type, value);
    }
  }

  showAllEditors(type: AnnotationEditorType, visible: boolean, _updateButton = false) {
    for (const editor of this.#allEditors.values()) {
      if (editor.editorType === type) {
        editor.show(visible);
      }
    }
    const state = this.#showAllStates?.get(AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL) ?? true;
    if (state !== visible) {
      this.#dispatchUpdateUI([
        [AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL, visible],
      ]);
    }
  }

  enableWaiting(mustWait = false) {
    if (this.#isWaiting === mustWait) {
      return;
    }
    this.#isWaiting = mustWait;
    for (const layer of this.#allLayers.values()) {
      if (mustWait) {
        layer.disableClick();
      } else {
        layer.enableClick();
      }
      layer.div!.classList.toggle("waiting", mustWait);
    }
  }

  /**
   * Enable all the layers.
   */
  async #enableAll() {
    if (!this.#isEnabled) {
      this.#isEnabled = true;
      const promises = [];
      for (const layer of this.#allLayers.values()) {
        promises.push(layer.enable());
      }
      await Promise.all(promises);
      for (const editor of this.#allEditors.values()) {
        editor.enable();
      }
    }
  }

  /**
   * Disable all the layers.
   */
  #disableAll() {
    this.unselectAll();
    if (this.#isEnabled) {
      this.#isEnabled = false;
      for (const layer of this.#allLayers.values()) {
        layer.disable();
      }
      for (const editor of this.#allEditors.values()) {
        editor.disable();
      }
    }
  }

  /**
   * Get all the editors belonging to a given page.
   * @param {number} pageIndex
   * @returns {Array<AnnotationEditor>}
   */
  getEditors(pageIndex: number) {
    const editors = [];
    for (const editor of this.#allEditors.values()) {
      if (editor.pageIndex === pageIndex) {
        editors.push(editor);
      }
    }
    return editors;
  }

  /**
   * Get an editor with the given id.
   */
  getEditor(id: string) {
    return this.#allEditors.get(id);
  }

  /**
   * Add a new editor.
   * @param {AnnotationEditor} editor
   */
  addEditor(editor: AnnotationEditor) {
    this.#allEditors.set(editor.id, editor);
  }

  /**
   * Remove an editor.
   */
  removeEditor(editor: AnnotationEditor) {
    if (editor.div!.contains(document.activeElement)) {
      if (this.#focusMainContainerTimeoutId) {
        clearTimeout(this.#focusMainContainerTimeoutId);
      }
      this.#focusMainContainerTimeoutId = setTimeout(() => {
        // When the div is removed from DOM the focus can move on the
        // document.body, so we need to move it back to the main container.
        this.focusMainContainer();
        this.#focusMainContainerTimeoutId = null;
      }, 0);
    }
    this.#allEditors.delete(editor.id);
    this.unselect(editor);
    if (
      !editor.annotationElementId ||
      !this.#deletedAnnotationsElementIds.has(editor.annotationElementId)
    ) {
      this.#annotationStorage?.remove(editor.id);
    }
  }

  /**
   * The annotation element with the given id has been deleted.
   * @param {AnnotationEditor} editor
   */
  addDeletedAnnotationElement(editor: AnnotationEditor) {
    this.#deletedAnnotationsElementIds.add(editor.annotationElementId);
    this.addChangedExistingAnnotation(editor.annotationElementId!, editor.id);
    editor.deleted = true;
  }

  /**
   * Check if the annotation element with the given id has been deleted.
   */
  isDeletedAnnotationElement(annotationElementId: string) {
    return this.#deletedAnnotationsElementIds.has(annotationElementId);
  }

  /**
   * The annotation element with the given id have been restored.
   * @param {AnnotationEditor} editor
   */
  removeDeletedAnnotationElement(editor: AnnotationEditor) {
    this.#deletedAnnotationsElementIds.delete(editor.annotationElementId);
    this.removeChangedExistingAnnotation(editor.annotationElementId!);
    editor.deleted = false;
  }

  /**
   * Add an editor to the layer it belongs to or add it to the global map.
   * @param {AnnotationEditor} editor
   */
  #addEditorToLayer(editor: AnnotationEditor) {
    const layer = this.#allLayers.get(editor.pageIndex);
    if (layer) {
      layer.addOrRebuild(editor);
    } else {
      this.addEditor(editor);
      this.addToAnnotationStorage(editor);
    }
  }

  /**
   * Set the given editor as the active one.
   * @param {AnnotationEditor} editor
   */
  setActiveEditor(editor: AnnotationEditor | null) {
    if (this.#activeEditor === editor) {
      return;
    }

    this.#activeEditor = editor;
    if (editor) {
      this.#dispatchUpdateUI(editor.propertiesToUpdate);
    }
  }

  get #lastSelectedEditor() {
    let ed = null;
    for (ed of this.#selectedEditors) {
      // Iterate to get the last element.
    }
    return ed;
  }

  /**
   * Update the UI of the active editor.
   * @param {AnnotationEditor} editor
   */
  updateUI(editor: AnnotationEditor) {
    if (this.#lastSelectedEditor === editor) {
      this.#dispatchUpdateUI(editor.propertiesToUpdate);
    }
  }

  /**
   * Add or remove an editor the current selection.
   * @param {AnnotationEditor} editor
   */
  toggleSelected(editor: AnnotationEditor) {
    if (this.#selectedEditors.has(editor)) {
      this.#selectedEditors.delete(editor);
      editor.unselect();
      this.#dispatchUpdateStates({
        hasSelectedEditor: this.hasSelection,
      });
      return;
    }
    this.#selectedEditors.add(editor);
    editor.select();
    this.#dispatchUpdateUI(editor.propertiesToUpdate);
    this.#dispatchUpdateStates({
      hasSelectedEditor: true,
    });
  }

  /**
   * Set the last selected editor.
   * @param {AnnotationEditor} editor
   */
  setSelected(editor: AnnotationEditor) {
    for (const ed of this.#selectedEditors) {
      if (ed !== editor) {
        ed.unselect();
      }
    }
    this.#selectedEditors.clear();

    this.#selectedEditors.add(editor);
    editor.select();
    this.#dispatchUpdateUI(editor.propertiesToUpdate);
    this.#dispatchUpdateStates({
      hasSelectedEditor: true,
    });
  }

  /**
   * Check if the editor is selected.
   * @param {AnnotationEditor} editor
   */
  isSelected(editor: AnnotationEditor) {
    return this.#selectedEditors.has(editor);
  }

  get firstSelectedEditor() {
    return this.#selectedEditors.values().next().value;
  }

  /**
   * Unselect an editor.
   * @param {AnnotationEditor} editor
   */
  unselect(editor: AnnotationEditor) {
    editor.unselect();
    this.#selectedEditors.delete(editor);
    this.#dispatchUpdateStates({
      hasSelectedEditor: this.hasSelection,
    });
  }

  get hasSelection() {
    return this.#selectedEditors.size !== 0;
  }

  get isEnterHandled() {
    return (
      this.#selectedEditors.size === 1 &&
      this.firstSelectedEditor!.isEnterHandled
    );
  }

  /**
   * Undo the last command.
   */
  undo() {
    this.#commandManager.undo();
    this.#dispatchUpdateStates({
      hasSomethingToUndo: this.#commandManager.hasSomethingToUndo(),
      hasSomethingToRedo: true,
      isEmpty: this.#isEmpty(),
    });
  }

  /**
   * Redo the last undoed command.
   */
  redo() {
    this.#commandManager.redo();
    this.#dispatchUpdateStates({
      hasSomethingToUndo: true,
      hasSomethingToRedo: this.#commandManager.hasSomethingToRedo(),
      isEmpty: this.#isEmpty(),
    });
  }

  /**
   * Add a command to execute (cmd) and another one to undo it.
   * @param {Object} params
   */
  addCommands(
    cmd: () => void,
    undo: () => void,
    post: () => void,
    mustExec: boolean,
    type = NaN,
    overwriteIfSameType = false,
    keepUndo = false
  ) {
    this.#commandManager.add(
      cmd, undo, post, mustExec, type, overwriteIfSameType, keepUndo
    );
    this.#dispatchUpdateStates({
      hasSomethingToUndo: true,
      hasSomethingToRedo: false,
      isEmpty: this.#isEmpty(),
    });
  }

  #isEmpty() {
    if (this.#allEditors.size === 0) {
      return true;
    }

    if (this.#allEditors.size === 1) {
      for (const editor of this.#allEditors.values()) {
        return editor.isEmpty();
      }
    }

    return false;
  }

  /**
   * Delete the current editor or all.
   */
  delete() {
    this.commitOrRemove();
    if (!this.hasSelection) {
      return;
    }

    const editors = [...this.#selectedEditors];
    const cmd = () => {
      for (const editor of editors) {
        editor.remove();
      }
    };
    const undo = () => {
      for (const editor of editors) {
        this.#addEditorToLayer(editor);
      }
    };

    this.addCommands(cmd, undo, () => { }, true);
  }

  commitOrRemove() {
    // An editor is being edited so just commit it.
    this.#activeEditor?.commitOrRemove();
  }

  hasSomethingToControl() {
    return this.#activeEditor || this.hasSelection;
  }

  /**
   * Select the editors.
   * @param {Array<AnnotationEditor>} editors
   */
  #selectEditors(editors: IteratorObject<AnnotationEditor>) {
    for (const editor of this.#selectedEditors) {
      editor.unselect();
    }
    this.#selectedEditors.clear();
    for (const editor of editors) {
      if (editor.isEmpty()) {
        continue;
      }
      this.#selectedEditors.add(editor);
      editor.select();
    }
    this.#dispatchUpdateStates({ hasSelectedEditor: this.hasSelection });
  }

  /**
   * Select all the editors.
   */
  selectAll() {
    for (const editor of this.#selectedEditors) {
      editor.commit();
    }
    this.#selectEditors(this.#allEditors.values());
  }

  /**
   * Unselect all the selected editors.
   */
  unselectAll() {
    if (this.#activeEditor) {
      // An editor is being edited so just commit it.
      this.#activeEditor.commitOrRemove();
      if (this.#mode !== AnnotationEditorType.NONE) {
        // If the mode is NONE, we want to really unselect the editor, hence we
        // mustn't return here.
        return;
      }
    }

    if (!this.hasSelection) {
      return;
    }
    for (const editor of this.#selectedEditors) {
      editor.unselect();
    }
    this.#selectedEditors.clear();
    this.#dispatchUpdateStates({
      hasSelectedEditor: false,
    });
  }

  translateSelectedEditors(x: number, y: number, noCommit = false) {
    if (!noCommit) {
      this.commitOrRemove();
    }
    if (!this.hasSelection) {
      return;
    }

    this.#translation[0] += x;
    this.#translation[1] += y;
    const [totalX, totalY] = this.#translation;
    const editors = [...this.#selectedEditors];

    // We don't want to have an undo/redo for each translation so we wait a bit
    // before adding the command to the command manager.
    const TIME_TO_WAIT = 1000;

    if (this.#translationTimeoutId) {
      clearTimeout(this.#translationTimeoutId);
    }

    this.#translationTimeoutId = setTimeout(() => {
      this.#translationTimeoutId = null;
      this.#translation[0] = this.#translation[1] = 0;

      this.addCommands(
        () => {
          for (const editor of editors) {
            if (this.#allEditors.has(editor.id)) {
              editor.translateInPage(totalX, totalY);
            }
          }
        },
        () => {
          for (const editor of editors) {
            if (this.#allEditors.has(editor.id)) {
              editor.translateInPage(-totalX, -totalY);
            }
          }
        },
        () => { },
        false,
      );
    }, TIME_TO_WAIT);

    for (const editor of editors) {
      editor.translateInPage(x, y);
    }
  }

  /**
   * Set up the drag session for moving the selected editors.
   */
  setUpDragSession() {
    // Note: don't use any references to the editor's parent which can be null
    // if the editor belongs to a destroyed page.
    if (!this.hasSelection) {
      return;
    }
    // Avoid to have spurious text selection in the text layer when dragging.
    this.disableUserSelect(true);
    this.#draggingEditors = new Map<AnnotationEditor, DragEditorInfo>();
    for (const editor of this.#selectedEditors) {
      this.#draggingEditors!.set(editor, {
        savedX: editor.x,
        savedY: editor.y,
        savedPageIndex: editor.pageIndex,
        newX: 0,
        newY: 0,
        newPageIndex: -1,
      });
    }
  }

  /**
   * Ends the drag session.
   * @returns {boolean} true if at least one editor has been moved.
   */
  endDragSession() {
    if (!this.#draggingEditors) {
      return false;
    }
    this.disableUserSelect(false);
    const map = this.#draggingEditors!;
    this.#draggingEditors = null;
    let mustBeAddedInUndoStack = false;

    for (const [{ x, y, pageIndex }, value] of map) {
      value.newX = x;
      value.newY = y;
      value.newPageIndex = pageIndex;
      mustBeAddedInUndoStack ||=
        x !== value.savedX ||
        y !== value.savedY ||
        pageIndex !== value.savedPageIndex;
    }

    if (!mustBeAddedInUndoStack) {
      return false;
    }

    const move = (
      editor: AnnotationEditor,
      x: number, y: number, pageIndex: number) => {
      if (this.#allEditors.has(editor.id)) {
        // The editor can be undone/redone on a page which is not visible (and
        // which potentially has no annotation editor layer), hence we need to
        // use the pageIndex instead of the parent.
        const parent = this.#allLayers.get(pageIndex);
        if (parent) {
          editor._setParentAndPosition(parent, x, y);
        } else {
          editor.pageIndex = pageIndex;
          editor.x = x;
          editor.y = y;
        }
      }
    };

    this.addCommands(
      () => {
        for (const [editor, { newX, newY, newPageIndex }] of map) {
          move(editor, newX, newY, newPageIndex);
        }
      },
      () => {
        for (const [editor, { savedX, savedY, savedPageIndex }] of map) {
          move(editor, savedX, savedY, savedPageIndex);
        }
      },
      () => { },
      true,
    );

    return true;
  }

  /**
   * Drag the set of selected editors.
   * @param {number} tx
   * @param {number} ty
   */
  dragSelectedEditors(tx: number, ty: number) {
    if (!this.#draggingEditors) {
      return;
    }
    for (const editor of this.#draggingEditors.keys()) {
      editor.drag(tx, ty);
    }
  }

  /**
   * Rebuild the editor (usually on undo/redo actions) on a potentially
   * non-rendered page.
   * @param {AnnotationEditor} editor
   */
  rebuild(editor: AnnotationEditor) {
    if (editor.parent === null) {
      const parent = this.getLayer(editor.pageIndex);
      if (parent) {
        parent.changeParent(editor);
        parent.addOrRebuild(editor);
      } else {
        this.addEditor(editor);
        this.addToAnnotationStorage(editor);
        editor.rebuild();
      }
    } else {
      editor.parent.addOrRebuild(editor);
    }
  }

  get isEditorHandlingKeyboard() {
    return (
      this.getActive()?.shouldGetKeyboardEvents() ||
      (this.#selectedEditors.size === 1 &&
        this.firstSelectedEditor!.shouldGetKeyboardEvents())
    );
  }

  /**
   * Is the current editor the one passed as argument?
   * @param {AnnotationEditor} editor
   * @returns
   */
  isActive(editor: AnnotationEditor) {
    return this.#activeEditor === editor;
  }

  /**
   * Get the current active editor.
   * @returns {AnnotationEditor|null}
   */
  getActive() {
    return this.#activeEditor;
  }

  /**
   * Get the current editor mode.
   */
  getMode() {
    return this.#mode;
  }

  get imageManager() {
    return shadow(this, "imageManager", new ImageManager());
  }

  getSelectionBoxes(textLayer: HTMLDivElement) {
    if (!textLayer) {
      return null;
    }
    const selection = document.getSelection()!;
    for (let i = 0, ii = selection.rangeCount; i < ii; i++) {
      if (
        !textLayer.contains(selection.getRangeAt(i).commonAncestorContainer)
      ) {
        return null;
      }
    }

    const {
      x: layerX,
      y: layerY,
      width: parentWidth,
      height: parentHeight,
    } = textLayer.getBoundingClientRect();

    // We must rotate the boxes because we want to have them in the non-rotated
    // page coordinates.
    let rotator;
    switch (textLayer.getAttribute("data-main-rotation")) {
      case "90":
        rotator = (x: number, y: number, w: number, h: number) => ({
          x: (y - layerY) / parentHeight,
          y: 1 - (x + w - layerX) / parentWidth,
          width: h / parentHeight,
          height: w / parentWidth,
        });
        break;
      case "180":
        rotator = (x: number, y: number, w: number, h: number) => ({
          x: 1 - (x + w - layerX) / parentWidth,
          y: 1 - (y + h - layerY) / parentHeight,
          width: w / parentWidth,
          height: h / parentHeight,
        });
        break;
      case "270":
        rotator = (x: number, y: number, w: number, h: number) => ({
          x: 1 - (y + h - layerY) / parentHeight,
          y: (x - layerX) / parentWidth,
          width: h / parentHeight,
          height: w / parentWidth,
        });
        break;
      default:
        rotator = (x: number, y: number, w: number, h: number) => ({
          x: (x - layerX) / parentWidth,
          y: (y - layerY) / parentHeight,
          width: w / parentWidth,
          height: h / parentHeight,
        });
        break;
    }

    const boxes = [];
    for (let i = 0, ii = selection.rangeCount; i < ii; i++) {
      const range = selection.getRangeAt(i);
      if (range.collapsed) {
        continue;
      }
      for (const { x, y, width, height } of range.getClientRects()) {
        if (width === 0 || height === 0) {
          continue;
        }
        boxes.push(rotator(x, y, width, height));
      }
    }
    return boxes.length === 0 ? null : boxes;
  }

  addChangedExistingAnnotation(annotationElementId: string, id: string) {
    (this.#changedExistingAnnotations ||= new Map()).set(
      annotationElementId, id
    );
  }

  removeChangedExistingAnnotation(annotationElementId: string) {
    this.#changedExistingAnnotations?.delete(annotationElementId);
  }

  renderAnnotationElement(annotation: AnnotationElement<AnnotationData>) {
    const editorId = this.#changedExistingAnnotations?.get(annotation.data.id);
    if (!editorId) {
      return;
    }
    const editor = this.#annotationStorage!.getRawValue(editorId);
    if (!editor) {
      return;
    }
    if (this.#mode === AnnotationEditorType.NONE && !editor.hasBeenModified) {
      return;
    }
    editor.renderAnnotationElement(annotation);
  }
}

export {
  AnnotationEditorUIManager,
  bindEvents,
  ColorManager,
  CommandManager,
  KeyboardManager,
  opacityToHex
};

