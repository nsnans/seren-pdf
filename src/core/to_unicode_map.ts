/* Copyright 2012 Mozilla Foundation
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

import { unreachable } from "../shared/util";

class ToUnicodeMap {

  protected _map: (number | string)[];

  constructor(cmap: (number | string)[] = []) {
    // The elements of this._map can be integers or strings, depending on how
    // `cmap` was created.
    this._map = cmap;
  }

  get length() {
    return this._map.length;
  }

  forEach(callback: (index: number, char: number) => void) {
    for (const _charCode in this._map) {
      const charCode = Number.parseInt(_charCode);
      callback(charCode, (<string>this._map[charCode]).charCodeAt(0));
    }
  }

  has(i: number) {
    return this._map[i] !== undefined;
  }

  get(i: number) {
    return this._map[i];
  }

  // 究竟是数字还是字符串，需要再考虑一下
  charCodeOf(value: string | number) {
    // `Array.prototype.indexOf` is *extremely* inefficient for arrays which
    // are both very sparse and very large (see issue8372.pdf).
    const map = this._map;
    if (map.length <= 0x10000) {
      return map.indexOf(value);
    }
    for (const charCode in map) {
      if (map[charCode] === value) {
        return charCode | 0;
      }
    }
    return -1;
  }

  amend(map) {
    for (const charCode in map) {
      this._map[charCode] = map[charCode];
    }
  }
}

class IdentityToUnicodeMap {

  protected firstChar: number;

  protected lastChar: number;

  constructor(firstChar: number, lastChar: number) {
    this.firstChar = firstChar;
    this.lastChar = lastChar;
  }

  get length() {
    return this.lastChar + 1 - this.firstChar;
  }

  forEach(callback: (i1: number, i2: number) => void) {
    for (let i = this.firstChar, ii = this.lastChar; i <= ii; i++) {
      callback(i, i);
    }
  }

  has(i: number) {
    return this.firstChar <= i && i <= this.lastChar;
  }

  get(i: number) {
    if (this.firstChar <= i && i <= this.lastChar) {
      return String.fromCharCode(i);
    }
    return undefined;
  }

  charCodeOf(v: number) {
    return Number.isInteger(v) && v >= this.firstChar && v <= this.lastChar
      ? v
      : -1;
  }

  amend() {
    unreachable("Should not call amend()");
  }
}

export { IdentityToUnicodeMap, ToUnicodeMap };
