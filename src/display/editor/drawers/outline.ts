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

import { unreachable } from "../../../shared/util";
import { RectType } from "../../display_utils";
import { BBoxType } from "./freedraw";

export abstract class Outline {
  /**
   * @returns {string} The SVG path of the outline.
   */
  abstract toSVGPath(): string;

  /**
   * @type {Object|null} The bounding box of the outline.
   */
  // eslint-disable-next-line getter-return
  abstract get box(): BBoxType | null;

  serialize(_bbox: RectType, _rotation: number) {
    unreachable("Abstract method `serialize` must be implemented.");
  }

  // eslint-disable-next-line getter-return
  abstract get classNamesForDrawing(): string[];

  // eslint-disable-next-line getter-return
  abstract get classNamesForOutlining(): string[];

  get mustRemoveSelfIntersections() {
    return false;
  }
}
