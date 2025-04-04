/* Copyright 2021 Mozilla Foundation
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
  Dict,
  DictKey,
  FormatError,
  PlatformHelper,
  Ref,
  RefSet,
  unreachable,
  warn,
  XRef
} from "seren-common";
import { DictImpl } from "./dict_impl";

/**
 * A NameTree/NumberTree is like a Dict but has some advantageous properties,
 * see the specification (7.9.6 and 7.9.7) for additional details.
 * TODO: implement all the Dict functions and make this more efficient.
 */
class NameOrNumberTree<T extends number | string> {

  protected root: Ref | string;

  protected xref: XRef;

  protected _type: string;

  constructor(root: Ref | string, xref: XRef, type: string) {
    if (PlatformHelper.isTesting() &&
      this.constructor === NameOrNumberTree
    ) {
      unreachable("Cannot initialize NameOrNumberTree.");
    }
    this.root = root;
    this.xref = xref;
    this._type = type;
  }

  getAll() {
    const map = new Map();
    if (!this.root) {
      return map;
    }
    const xref = this.xref;
    // Reading Name/Number tree.
    const processed = new RefSet();
    processed.put(<Ref>this.root);
    const queue = <(Ref | string)[]>[this.root];
    while (queue.length > 0) {
      const obj = xref.fetchIfRef(queue.shift()!);
      if (!(obj instanceof DictImpl)) {
        continue;
      }
      if (obj.has(DictKey.Kids)) {
        const kids = <Ref | string[]>obj.getValue(DictKey.Kids);
        if (!Array.isArray(kids)) {
          continue;
        }
        for (const kid of kids) {
          if (processed.has(kid)) {
            throw new FormatError(`Duplicate entry in "${this._type}" tree.`);
          }
          queue.push(kid);
          processed.put(kid);
        }
        continue;
      }
      const entries = obj.getValue(<DictKey>this._type);
      if (!Array.isArray(entries)) {
        continue;
      }
      for (let i = 0, ii = entries.length; i < ii; i += 2) {
        map.set(xref.fetchIfRef(entries[i]), xref.fetchIfRef(entries[i + 1]));
      }
    }
    return map;
  }

  getRaw(key: T) {
    if (!this.root) {
      return null;
    }
    const xref = this.xref;
    let kidsOrEntries = <Dict>xref.fetchIfRef(this.root);
    let loopCount = 0;
    const MAX_LEVELS = 10;

    // Perform a binary search to quickly find the entry that
    // contains the key we are looking for.
    while (kidsOrEntries.has(DictKey.Kids)) {
      if (++loopCount > MAX_LEVELS) {
        warn(`Search depth limit reached for "${this._type}" tree.`);
        return null;
      }

      const kids = kidsOrEntries.getValue(DictKey.Kids);
      if (!Array.isArray(kids)) {
        return null;
      }

      let l = 0,
        r = kids.length - 1;
      while (l <= r) {
        const m = (l + r) >> 1;
        const kid = <Dict>xref.fetchIfRef(kids[m]);
        const limits = kid.getValue(DictKey.Limits);

        if (key < <number | string>xref.fetchIfRef(limits[0])) {
          r = m - 1;
        } else if (key > <number | string>xref.fetchIfRef(limits[1])) {
          l = m + 1;
        } else {
          kidsOrEntries = kid;
          break;
        }
      }
      if (l > r) {
        return null;
      }
    }

    // If we get here, then we have found the right entry. Now go through the
    // entries in the dictionary until we find the key we're looking for.
    const entries = kidsOrEntries.getValue(<DictKey>this._type);
    if (Array.isArray(entries)) {
      // Perform a binary search to reduce the lookup time.
      let l = 0,
        r = entries.length - 2;
      while (l <= r) {
        // Check only even indices (0, 2, 4, ...) because the
        // odd indices contain the actual data.
        const tmp = (l + r) >> 1,
          m = tmp + (tmp & 1);
        const currentKey = <number | string>xref.fetchIfRef(entries[m]);
        if (key < currentKey) {
          r = m - 2;
        } else if (key > currentKey) {
          l = m + 2;
        } else {
          return entries[m + 1];
        }
      }
    }
    return null;
  }

  get(key: T) {
    return this.xref.fetchIfRef(this.getRaw(key));
  }
}

export class NameTree extends NameOrNumberTree<string> {
  constructor(root: Ref | string, xref: XRef) {
    super(root, xref, "Names");
  }
}

export class NumberTree extends NameOrNumberTree<number> {
  constructor(root: Ref | string, xref: XRef) {
    super(root, xref, "Nums");
  }
}
