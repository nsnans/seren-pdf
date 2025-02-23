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

import { PlatformHelper } from "../../../seren-common/src/utils/platform_helper";
import { stringToBytes, unreachable } from "../shared/util";
import { fetchData } from "../../../../src/display/display_utils";

export interface CMapReaderFactory {

  // 这个接口应该删掉
  _fetch(url: string): Promise<Uint8Array>;

  fetch(name: string): Promise<{
    cMapData: Uint8Array<ArrayBuffer>;
    isCompressed: boolean;
  }>;
}

export abstract class BaseCMapReaderFactory implements CMapReaderFactory {

  protected baseUrl: string | null;

  protected isCompressed: boolean;

  constructor(baseUrl: string | null = null, isCompressed = true) {
    if (PlatformHelper.isTesting() && this.constructor === BaseCMapReaderFactory) {
      unreachable("Cannot initialize BaseCMapReaderFactory.");
    }
    this.baseUrl = baseUrl;
    this.isCompressed = isCompressed;
  }


  async fetch(name: string) {
    if (!this.baseUrl) {
      throw new Error(
        "Ensure that the `cMapUrl` and `cMapPacked` API parameters are provided."
      );
    }
    if (!name) {
      throw new Error("CMap name must be specified.");
    }
    const url = this.baseUrl + name + (this.isCompressed ? ".bcmap" : "");

    return this._fetch(url)
      .then(cMapData => ({ cMapData, isCompressed: this.isCompressed }))
      .catch(_reason => {
        throw new Error(
          `Unable to load ${this.isCompressed ? "binary " : ""}CMap at: ${url}`
        );
      });
  }

  abstract _fetch(url: string): Promise<Uint8Array<ArrayBuffer>>;
}

export class DOMCMapReaderFactory extends BaseCMapReaderFactory {

  constructor(baseUrl: string | null = null, isCompressed = true) {
    super(baseUrl, isCompressed);
  }

  /**
   * @ignore
   */
  async _fetch(url: string) {
    const data = await fetchData(
      url,
      /* type = */ this.isCompressed ? "arraybuffer" : "text"
    );
    return data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : stringToBytes(data);
  }
}

