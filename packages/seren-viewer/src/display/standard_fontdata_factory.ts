/* Copyright 2015 Mozilla Foundation
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

import { fetchData } from "./display_utils";
import { unreachable } from "../shared/util";
import { PlatformHelper } from "../../../seren-common/src/platform_helper";

export interface StandardFontDataFactory {

  fetch(filename: string): Promise<Uint8Array<ArrayBuffer>>;

}

export abstract class BaseStandardFontDataFactory implements StandardFontDataFactory {

  protected baseUrl: string | null;

  constructor(baseUrl: string | null) {
    if (PlatformHelper.isTesting() && this.constructor === BaseStandardFontDataFactory) {
      unreachable("Cannot initialize BaseStandardFontDataFactory.");
    }
    this.baseUrl = baseUrl;
  }

  async fetch(filename: string) {
    if (!this.baseUrl) {
      throw new Error(
        "Ensure that the `standardFontDataUrl` API parameter is provided."
      );
    }
    if (!filename) {
      throw new Error("Font filename must be specified.");
    }
    const url = `${this.baseUrl}${filename}`;

    return this._fetch(url).catch(_reason => {
      throw new Error(`Unable to load font data at: ${url}`);
    });
  }

  protected abstract _fetch(_url: string): Promise<Uint8Array<ArrayBuffer>>;

}

export class DOMStandardFontDataFactory extends BaseStandardFontDataFactory {

  constructor(baseUrl: string | null) {
    super(baseUrl);
  }

  protected async _fetch(url: string) {
    const data = await fetchData(url, /* type = */ "arraybuffer");
    return new Uint8Array(data);
  }
}
