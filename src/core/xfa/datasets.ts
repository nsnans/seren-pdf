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

import { Namespace } from "./namespace";
import { NamespaceIds } from "./namespaces";
import { XFAAttributesObj, XFAObject, XmlObject } from "./xfa_object";

const DATASETS_NS_ID = NamespaceIds.datasets.id;

class Data extends XmlObject {
  constructor(attributes: XFAAttributesObj) {
    super(DATASETS_NS_ID, "data", attributes);
  }

  isNsAgnostic() {
    return true;
  }
}

export class Datasets extends XFAObject {

  public Signature: XFAObject | null;

  public data: Data | null;

  constructor(_attributes: XFAAttributesObj) {
    super(DATASETS_NS_ID, "datasets", /* hasChildren = */ true);
    this.data = null;
    this.Signature = null;
  }

  onChild(child: XFAObject) {
    const name = child.nodeName;
    if (
      (name === "data" && child.namespaceId === DATASETS_NS_ID) ||
      (name === "Signature" &&
        child.namespaceId === NamespaceIds.signature.id)
    ) {
      if (name === "data") {
        this.data = <Data>child;
      } else if (name === "Signature") {
        this.Signature = child;
      }
    }
    this.appendChild(child);
    // 默认没有返回值，返回undefined相当于false
    return false;
  }
}

class DatasetsNamespace implements Namespace {

  public static readonly DEFAULT = new DatasetsNamespace();

  protected constructor() { }

  buildXFAObject(name: string, attributes: XFAAttributesObj) {
    if (this.hasOwnProperty(name)) {
      return (this as any)[name](attributes);
    }
    return undefined;
  }

  datasets(attributes: XFAAttributesObj) {
    return new Datasets(attributes);
  }

  data(attributes: XFAAttributesObj) {
    return new Data(attributes);
  }
}

export { DatasetsNamespace };
