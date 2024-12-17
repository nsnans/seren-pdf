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

import { shadow, stringToPDFString, warn } from "../shared/util";
import { BaseStream } from "./base_stream";
import { Dict, DictKey, Ref } from "./primitives";
import { XRef } from "./xref";

function pickPlatformItem(dict?: Dict) {
  if (!(dict instanceof Dict)) {
    return null;
  }
  // Look for the filename in this order:
  // UF, F, Unix, Mac, DOS
  if (dict.has(DictKey.UF)) {
    return dict.getValue(DictKey.UF);
  } else if (dict.has(DictKey.F)) {
    return dict.getValue(DictKey.F);
  } else if (dict.has(DictKey.Unix)) {
    return dict.getValue(DictKey.Unix);
  } else if (dict.has(DictKey.Mac)) {
    return dict.getValue(DictKey.Mac);
  } else if (dict.has(DictKey.DOS)) {
    return dict.getValue(DictKey.DOS);
  }
  return null;
}

function stripPath(str: string) {
  return str.substring(str.lastIndexOf("/") + 1);
}

export interface FileSpecSerializable {

  rawFilename: string;

  filename: string;

  content: Uint8Array | null;

  description: string;
}

/**
 * "A PDF file can refer to the contents of another file by using a File
 * Specification (PDF 1.1)", see the spec (7.11) for more details.
 * NOTE: Only embedded files are supported (as part of the attachments support)
 * TODO: support the 'URL' file system (with caching if !/V), portable
 * collections attributes and related files (/RF)
 */
export class FileSpec {

  #contentAvailable = false;

  protected root?: Dict;

  protected xref: XRef | null = null;

  protected fs;

  protected _contentRef: Ref | null = null;

  constructor(root: Dict, xref: XRef | null, skipContent = false) {
    if (!(root instanceof Dict)) {
      return;
    }
    this.xref = xref;
    this.root = root;
    if (root.has(DictKey.FS)) {
      this.fs = root.getValue(DictKey.FS);
    }
    if (root.has(DictKey.RF)) {
      warn("Related file specifications are not supported");
    }
    if (!skipContent) {
      if (root.has(DictKey.EF)) {
        this.#contentAvailable = true;
      } else {
        warn("Non-embedded file specifications are not supported");
      }
    }
  }

  get filename() {
    let filename = "";

    const item = pickPlatformItem(this.root);
    if (item && typeof item === "string") {
      filename = stringToPDFString(item)
        .replaceAll("\\\\", "\\")
        .replaceAll("\\/", "/")
        .replaceAll("\\", "/");
    }
    return shadow(this, "filename", filename || "unnamed");
  }

  get content() {
    if (!this.#contentAvailable) {
      return null;
    }
    this._contentRef ||= <Ref>pickPlatformItem(this.root?.getValue(DictKey.EF));

    let content = null;
    if (this._contentRef) {
      const fileObj = this.xref!.fetchIfRef(this._contentRef);
      if (fileObj instanceof BaseStream) {
        content = fileObj.getBytes();
      } else {
        warn(
          "Embedded file specification points to non-existing/invalid content"
        );
      }
    } else {
      warn("Embedded file specification does not have any content");
    }
    return content;
  }

  get description() {
    let description = "";

    const desc = this.root?.getValue(DictKey.Desc);
    if (desc && typeof desc === "string") {
      description = stringToPDFString(desc);
    }
    return shadow(this, "description", description);
  }

  get serializable(): FileSpecSerializable {
    return {
      rawFilename: this.filename,
      filename: stripPath(this.filename),
      content: <Uint8Array | null>this.content,
      description: this.description,
    };
  }
}
