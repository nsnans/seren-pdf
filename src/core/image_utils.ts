/* Copyright 2019 Mozilla Foundation
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

import { RectType, TransformType } from "../display/display_utils";
import { PlatformHelper } from "../platform/platform_helper";
import {
  MAX_IMAGE_SIZE_TO_CACHE,
  OPS,
  unreachable,
  warn
} from "../shared/util";
import { ColorSpace } from "./colorspace";
import { ImageMask, SMaskOptions } from "./core_types";
import { Dict, DictKey, Ref, RefSet, RefSetCache } from "./primitives";

abstract class BaseLocalCache<T> {

  protected _imageCache = new RefSetCache<Ref | string, T>();

  constructor() {
    if (PlatformHelper.isTesting() && this.constructor === BaseLocalCache) {
      unreachable("Cannot initialize BaseLocalCache.");
    }
  }

  getByRef(ref: Ref | string): T | null {
    return this._imageCache.get(ref) || null;
  }

  abstract set(_name: string | null, ref: Ref | string | null, data: T): void;
}

abstract class NameLocalCache<DATA> extends BaseLocalCache<DATA> {

  protected _nameRefMap: Map<string | null, string | Ref> = new Map();

  protected _imageMap: Map<string | null, DATA> = new Map();

  getByName(name: string | null): DATA | null {
    const ref = this._nameRefMap.get(name) ?? null;
    if (ref) {
      return this.getByRef(ref);
    }
    return this._imageMap.get(name) || null;
  }
}

export interface OptionalContent {
  type: string;
  id?: string | null;
  ids?: (string | null)[];
  expression?: (string | string[])[] | null;
  policy?: string | null;
}

export interface GroupOptions {
  matrix: TransformType | null,
  bbox: RectType | null,
  smask: SMaskOptions | null,
  isolated: boolean,
  knockout: boolean,
}

export interface ImageMaskXObject {
  data: string;
  width: number;
  height: number;
  interpolate: number[];
  count: number;
}

export interface ImageCacheData {
  objId?: string | null;
  fn: OPS;
  args: ImageMask[] | ImageMaskXObject[] | (string | number)[];
  optionalContent: OptionalContent | null;
}

export interface GlobalImageCacheData extends ImageCacheData {
  byteSize: number;
}

class LocalImageCache extends NameLocalCache<ImageCacheData> {

  set(name: string, ref: string | null, data: ImageCacheData) {
    if (typeof name !== "string") {
      throw new Error('LocalImageCache.set - expected "name" argument.');
    }
    if (ref) {
      if (this._imageCache.has(ref!)) {
        return;
      }
      this._nameRefMap!.set(name, ref);
      this._imageCache.put(ref, data);
      return;
    }
    // name
    if (this._imageMap!.has(name)) {
      return;
    }
    this._imageMap!.set(name, data);
  }
}

class LocalColorSpaceCache extends NameLocalCache<ColorSpace> {

  set(name: string | null, ref: Ref | null, data: ColorSpace) {
    if (typeof name !== "string" && !ref) {
      throw new Error(
        'LocalColorSpaceCache.set - expected "name" and/or "ref" argument.'
      );
    }
    if (ref) {
      if (this._imageCache.has(ref)) {
        return;
      }
      if (name !== null) {
        // Optional when `ref` is defined.
        this._nameRefMap!.set(name, ref);
      }
      this._imageCache.put(ref, data);
      return;
    }
    // name
    if (this._imageMap!.has(name)) {
      return;
    }
    this._imageMap!.set(name, data);
  }
}

class LocalFunctionCache<Function> extends BaseLocalCache<Function> {

  set(_name: string | null, ref: Ref | string, data: Function) {
    if (!ref) {
      throw new Error('LocalFunctionCache.set - expected "ref" argument.');
    }
    if (this._imageCache.has(ref)) {
      return;
    }
    this._imageCache.put(ref, data);
  }
}

class LocalGStateCache extends NameLocalCache<[DictKey, any][] | boolean> {
  set(name: string, ref: string, data: [DictKey, any][] | boolean) {
    if (typeof name !== "string") {
      throw new Error('LocalGStateCache.set - expected "name" argument.');
    }
    if (ref) {
      if (this._imageCache.has(ref)) {
        return;
      }
      this._nameRefMap!.set(name, ref);
      this._imageCache.put(ref, data);
      return;
    }
    // name
    if (this._imageMap!.has(name)) {
      return;
    }
    this._imageMap!.set(name, data);
  }
}

export interface LocalTilingPatternData {
  operatorListIR: {
    // 操作符构成的数组
    fnArray: number[],
    // 二维数组，是fn对应函数的参数
    // 每一个不同的fn有不同对应的参数，具体请查看OPSArgsType
    argsArray: (any[] | null)[],
    length: number,
  },
  dict: Dict
}

class LocalTilingPatternCache extends BaseLocalCache<LocalTilingPatternData> {

  set(_name: string | null, ref: Ref | string, data: LocalTilingPatternData) {
    if (!ref) {
      throw new Error('LocalTilingPatternCache.set - expected "ref" argument.');
    }
    if (this._imageCache.has(ref)) {
      return;
    }
    this._imageCache.put(ref, data);
  }
}



class RegionalImageCache extends BaseLocalCache<ImageCacheData> {

  set(_name: string | null, ref: Ref | string, data: ImageCacheData) {
    if (!ref) {
      throw new Error('RegionalImageCache.set - expected "ref" argument.');
    }
    if (this._imageCache.has(ref)) {
      return;
    }
    this._imageCache.put(ref, data);
  }
}

class GlobalImageCache {

  static NUM_PAGES_THRESHOLD = 2;

  static MIN_IMAGES_TO_CACHE = 10;

  static MAX_BYTE_SIZE = 5 * MAX_IMAGE_SIZE_TO_CACHE;

  protected _decodeFailedSet = new RefSet();

  protected _refCache = new RefSetCache<string | Ref, Set<number>>();

  protected _imageCache = new RefSetCache<string, GlobalImageCacheData>();

  get #byteSize() {
    let byteSize = 0;
    for (const imageData of this._imageCache) {
      byteSize += imageData.byteSize;
    }
    return byteSize;
  }

  get #cacheLimitReached() {
    if (this._imageCache.size < GlobalImageCache.MIN_IMAGES_TO_CACHE) {
      return false;
    }
    if (this.#byteSize < GlobalImageCache.MAX_BYTE_SIZE) {
      return false;
    }
    return true;
  }

  shouldCache(ref: string, pageIndex: number) {
    let pageIndexSet = this._refCache.get(ref);
    if (!pageIndexSet) {
      pageIndexSet = new Set();
      this._refCache.put(ref, pageIndexSet);
    }
    pageIndexSet.add(pageIndex);

    if (pageIndexSet.size < GlobalImageCache.NUM_PAGES_THRESHOLD) {
      return false;
    }
    if (!this._imageCache.has(ref) && this.#cacheLimitReached) {
      return false;
    }
    return true;
  }

  addDecodeFailed(ref: string | Ref) {
    this._decodeFailedSet.put(ref);
  }

  hasDecodeFailed(ref: string | Ref) {
    return this._decodeFailedSet.has(ref);
  }

  /**
   * PLEASE NOTE: Must be called *after* the `setData` method.
   */
  addByteSize(ref: string, byteSize: number) {
    const imageData = this._imageCache.get(ref);
    if (!imageData) {
      return; // The image data isn't cached (the limit was reached).
    }
    if (imageData.byteSize) {
      return; // The byte-size has already been set.
    }
    imageData.byteSize = byteSize;
  }

  getData(ref: Ref, pageIndex: number) {
    const pageIndexSet = this._refCache.get(ref);
    if (!pageIndexSet) {
      return null;
    }
    if (pageIndexSet.size < GlobalImageCache.NUM_PAGES_THRESHOLD) {
      return null;
    }
    const imageData = this._imageCache.get(ref.toString());
    if (!imageData) {
      return null;
    }
    // Ensure that we keep track of all pages containing the image reference.
    pageIndexSet.add(pageIndex);

    return imageData;
  }

  setData(ref: string, data: GlobalImageCacheData) {
    if (!this._refCache.has(ref)) {
      throw new Error(
        'GlobalImageCache.setData - expected "shouldCache" to have been called.'
      );
    }
    if (this._imageCache.has(ref)) {
      return;
    }
    if (this.#cacheLimitReached) {
      warn("GlobalImageCache.setData - cache limit reached.");
      return;
    }
    this._imageCache.put(ref, data);
  }

  clear(onlyData = false) {
    if (!onlyData) {
      this._decodeFailedSet.clear();
      this._refCache.clear();
    }
    this._imageCache.clear();
  }
}

export {
  GlobalImageCache,
  LocalColorSpaceCache,
  LocalFunctionCache,
  LocalGStateCache,
  LocalImageCache,
  LocalTilingPatternCache,
  RegionalImageCache
};
