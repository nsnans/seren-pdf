/* Copyright 2023 Mozilla Foundation
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

import {
  AnnotationEditorParamsType,
  shadow
} from "seren-common";
import { noContextMenu } from "../display_utils";
import { AnnotationEditor } from "./editor";
import {
  AnnotationEditorUIManager,
  KeyboardManager
} from "./tools";

export class ColorPicker {

  static #l10nColor: {
    blue: "pdfjs-editor-colorpicker-blue";
    green: "pdfjs-editor-colorpicker-green";
    pink: "pdfjs-editor-colorpicker-pink";
    red: "pdfjs-editor-colorpicker-red";
    yellow: "pdfjs-editor-colorpicker-yellow";
  } | null = null;

  static get _keyboardManager() {
    return shadow(
      this,
      "_keyboardManager",
      new KeyboardManager<ColorPicker>([
        [
          ["Escape", "mac+Escape"],
          ColorPicker.prototype._hideDropdownFromKeyboard,
        ],
        [[" ", "mac+ "], ColorPicker.prototype._colorSelectFromKeyboard],
        [
          ["ArrowDown", "ArrowRight", "mac+ArrowDown", "mac+ArrowRight"],
          ColorPicker.prototype._moveToNext,
        ],
        [
          ["ArrowUp", "ArrowLeft", "mac+ArrowUp", "mac+ArrowLeft"],
          ColorPicker.prototype._moveToPrevious,
        ],
        [["Home", "mac+Home"], ColorPicker.prototype._moveToBeginning],
        [["End", "mac+End"], ColorPicker.prototype._moveToEnd],
      ])
    );
  }

  #button: HTMLButtonElement | null = null;

  #buttonSwatch: HTMLSpanElement | null = null;

  #defaultColor;

  #dropdown: HTMLDivElement | null = null;

  #dropdownWasFromKeyboard = false;

  #isMainColorPicker = false;

  #editor: AnnotationEditor | null = null;

  #eventBus;

  #openDropdownAC: AbortController | null = null;

  #uiManager: AnnotationEditorUIManager | null = null;

  #type: AnnotationEditorParamsType;

  constructor(
    editor: AnnotationEditor | null = null,
    uiManager: AnnotationEditorUIManager | null = null
  ) {
    if (editor) {
      this.#isMainColorPicker = false;
      this.#type = AnnotationEditorParamsType.HIGHLIGHT_COLOR;
      this.#editor = editor;
    } else {
      this.#isMainColorPicker = true;
      this.#type = AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR;
    }
    this.#uiManager = editor?._uiManager || uiManager;
    this.#eventBus = this.#uiManager!._eventBus;
    this.#defaultColor = (<{ color?: string }>editor).color ||
      this.#uiManager?.highlightColors!.values().next().value ||
      "#FFFF98";

    ColorPicker.#l10nColor ||= Object.freeze({
      blue: "pdfjs-editor-colorpicker-blue",
      green: "pdfjs-editor-colorpicker-green",
      pink: "pdfjs-editor-colorpicker-pink",
      red: "pdfjs-editor-colorpicker-red",
      yellow: "pdfjs-editor-colorpicker-yellow",
    });
  }

  renderButton() {
    const button = (this.#button = document.createElement("button"));
    button.className = "colorPicker";
    button.tabIndex = 0;
    button.setAttribute("data-l10n-id", "pdfjs-editor-colorpicker-button");
    button.setAttribute("aria-haspopup", "true");
    const signal = this.#uiManager!._signal!;
    button.addEventListener("click", this.#openDropdown.bind(this), { signal });
    button.addEventListener("keydown", this.#keyDown.bind(this), { signal });
    const swatch = (this.#buttonSwatch = document.createElement("span"));
    swatch.className = "swatch";
    swatch.setAttribute("aria-hidden", "true");
    swatch.style.backgroundColor = this.#defaultColor;
    button.append(swatch);
    return button;
  }

  renderMainDropdown() {
    const dropdown = (this.#dropdown = this.#getDropdownRoot());
    dropdown.setAttribute("aria-orientation", "horizontal");
    dropdown.setAttribute("aria-labelledby", "highlightColorPickerLabel");

    return dropdown;
  }

  #getDropdownRoot() {
    const div = document.createElement("div");
    const signal = this.#uiManager!._signal!;
    div.addEventListener("contextmenu", noContextMenu, { signal });
    div.className = "dropdown";
    div.role = "listbox";
    div.setAttribute("aria-multiselectable", "false");
    div.setAttribute("aria-orientation", "vertical");
    div.setAttribute("data-l10n-id", "pdfjs-editor-colorpicker-dropdown");
    for (const [name, color] of this.#uiManager!.highlightColors!) {
      const button = document.createElement("button");
      button.tabIndex = 0;
      button.role = "option";
      button.setAttribute("data-color", color);
      button.title = name;
      button.setAttribute("data-l10n-id", (<Record<string, string>>ColorPicker.#l10nColor)[name]);
      const swatch = document.createElement("span");
      button.append(swatch);
      swatch.className = "swatch";
      swatch.style.backgroundColor = color;
      button.setAttribute("aria-selected", `${color === this.#defaultColor}`);
      button.addEventListener("click", this.#colorSelect.bind(this, color), {
        signal,
      });
      div.append(button);
    }

    div.addEventListener("keydown", this.#keyDown.bind(this), { signal });

    return div;
  }

  #colorSelect(color: string, event: Event) {
    event.stopPropagation();
    this.#eventBus.dispatch("switchannotationeditorparams", {
      source: this,
      type: this.#type,
      value: color,
    });
  }

  _colorSelectFromKeyboard(event: KeyboardEvent) {
    if (event.target === this.#button) {
      this.#openDropdown(event);
      return;
    }
    const color = (<HTMLElement>event.target).getAttribute("data-color");
    if (!color) {
      return;
    }
    this.#colorSelect(color, event);
  }

  _moveToNext(event: KeyboardEvent) {
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
      return;
    }
    if (event.target === this.#button) {
      (<HTMLElement>this.#dropdown!.firstChild)?.focus();
      return;
    }
    (<HTMLElement>(<HTMLElement>event.target).nextSibling)?.focus();
  }

  _moveToPrevious(event: KeyboardEvent) {
    if (
      event.target === this.#dropdown?.firstChild ||
      event.target === this.#button
    ) {
      if (this.#isDropdownVisible) {
        this._hideDropdownFromKeyboard();
      }
      return;
    }
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
    }
    (<HTMLElement>(<HTMLElement>event.target).previousSibling)?.focus();
  }

  _moveToBeginning(event: KeyboardEvent) {
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
      return;
    }
    (<HTMLElement>this.#dropdown!.firstChild)?.focus();
  }

  _moveToEnd(event: KeyboardEvent) {
    if (!this.#isDropdownVisible) {
      this.#openDropdown(event);
      return;
    }
    (<HTMLElement>this.#dropdown!.lastChild)?.focus();
  }

  #keyDown(event: KeyboardEvent) {
    ColorPicker._keyboardManager.exec(this, event);
  }

  #openDropdown(event: Event) {
    if (this.#isDropdownVisible) {
      this.hideDropdown();
      return;
    }
    this.#dropdownWasFromKeyboard = (<KeyboardEvent>event).detail === 0;

    if (!this.#openDropdownAC) {
      this.#openDropdownAC = new AbortController();

      window.addEventListener("pointerdown", this.#pointerDown.bind(this), {
        signal: this.#uiManager!.combinedSignal(this.#openDropdownAC),
      });
    }
    if (this.#dropdown) {
      this.#dropdown.classList.remove("hidden");
      return;
    }
    const root = (this.#dropdown = this.#getDropdownRoot());
    this.#button!.append(root);
  }

  #pointerDown(event: Event) {
    if (this.#dropdown?.contains(<Node | null>event.target)) {
      return;
    }
    this.hideDropdown();
  }

  hideDropdown() {
    this.#dropdown?.classList.add("hidden");
    this.#openDropdownAC?.abort();
    this.#openDropdownAC = null;
  }

  get #isDropdownVisible() {
    return this.#dropdown && !this.#dropdown.classList.contains("hidden");
  }

  _hideDropdownFromKeyboard() {
    if (this.#isMainColorPicker) {
      return;
    }
    if (!this.#isDropdownVisible) {
      // The user pressed Escape with no dropdown visible, so we must
      // unselect it.
      this.#editor?.unselect();
      return;
    }
    this.hideDropdown();
    this.#button!.focus({
      preventScroll: true,
      focusVisible: this.#dropdownWasFromKeyboard,
    });
  }

  updateColor(color: string) {
    if (this.#buttonSwatch) {
      this.#buttonSwatch.style.backgroundColor = color;
    }
    if (!this.#dropdown) {
      return;
    }

    const i = this.#uiManager!.highlightColors!.values();
    for (const child of this.#dropdown.children) {
      child.setAttribute("aria-selected", `${i.next().value === color}`);
    }
  }

  destroy() {
    this.#button?.remove();
    this.#button = null;
    this.#buttonSwatch = null;
    this.#dropdown?.remove();
    this.#dropdown = null;
  }
}
