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

import { warn } from "../../shared/util";
import { XMLParserBase, XMLParserErrorCode } from "../xml_parser";
import { Builder } from "./builder";
import { Namespace } from "./namespace";
import { AttributesObj, XFAObject, XMLTagProperty } from "./xfa_object";

class XFAParser extends XMLParserBase {

  protected _builder: Builder;

  protected _whiteRegex: RegExp;

  protected _nbsps: RegExp;

  protected _richText: boolean;

  protected _errorCode: number;

  protected _current: XFAObject;

  protected _ids: Map<Symbol | string, XFAObject | null>;

  protected _stack: XFAObject[];

  constructor(rootNameSpace: Namespace | null = null, richText = false) {
    super();
    this._builder = new Builder(rootNameSpace);
    this._stack = [];
    this._globalData = {
      usedTypefaces: new Set(),
    };
    this._ids = new Map();
    this._current = this._builder.buildRoot(this._ids);
    this._errorCode = XMLParserErrorCode.NoError;
    this._whiteRegex = /^\s+$/;
    this._nbsps = /\xa0+/g;
    this._richText = richText;
  }

  parse(data: string) {
    this.parseXml(data);

    if (this._errorCode !== XMLParserErrorCode.NoError) {
      return undefined;
    }

    this._current.finalize();

    return this._current.element;
  }

  onText(text: string) {
    // Normally by definition a &nbsp is unbreakable
    // but in real life Acrobat can break strings on &nbsp.
    text = text.replace(this._nbsps, match => match.slice(1) + " ");
    if (this._richText || this._current.acceptWhitespace()) {
      this._current.onText(text, this._richText);
      return;
    }

    if (this._whiteRegex.test(text)) {
      return;
    }
    this._current.onText(text.trim());
  }

  onCdata(text: string) {
    this._current.onText(text);
  }

  _mkAttributes(attributes: XMLTagProperty[], tagName: string):
    [string | null, { prefix: string; value: string; }[] | null, AttributesObj] {
    // Transform attributes into an object and get out
    // namespaces information.
    let namespace = null;
    let prefixes = null;
    const attributeObj = Object.create({}) as AttributesObj;
    for (const { name, value } of attributes) {
      // xmlns的标签是记录命名空间的，所以直接不管了
      if (name === "xmlns") {
        if (!namespace) {
          namespace = value;
        } else {
          warn(`XFA - multiple namespace definition in <${tagName}>`);
        }
      }
      // 如果是“xmlns:”开头的属性，记录到前缀里去
      else if (name.startsWith("xmlns:")) {
        const prefix = name.substring("xmlns:".length);
        if (!prefixes) {
          prefixes = [];
        }
        prefixes.push({ prefix, value });
      }
      // 剩下的才是真正要关注的属性
      else {
        const i = name.indexOf(":");

        // 对于没有冒号分隔的，直接保留
        if (i === -1) {
          attributeObj[name] = value;
        } else {
          // 对于有namespace的，需要按照namespace来进行分类
          // Attributes can have their own namespace.
          // For example in data, we can have <foo xfa:dataNode="dataGroup"/>
          let nsAttrs = attributeObj.nsAttributes;
          if (!nsAttrs) {
            nsAttrs = attributeObj.nsAttributes = <Record<string, Record<string, string>>>Object.create(null);
          }
          const [ns, attrName] = [name.slice(0, i), name.slice(i + 1)];
          const attrs = (nsAttrs[ns] ||= Object.create(null));
          attrs[attrName] = value;
        }
      }
    }
    return [namespace, prefixes, attributeObj];
  }

  _getNameAndPrefix(name: string, nsAgnostic: boolean): [string, string | null] {
    const i = name.indexOf(":");
    if (i === -1) {
      return [name, null];
    }
    return [name.substring(i + 1), nsAgnostic ? "" : name.substring(0, i)];
  }

  onBeginElement(tagName: string, attributes: XMLTagProperty[], isEmpty: boolean) {
    const [namespace, prefixes, attributesObj] = this._mkAttributes(
      attributes,
      tagName
    );
    const [name, nsPrefix] = this._getNameAndPrefix(
      tagName,
      this._builder.isNsAgnostic()
    );
    const node = this._builder.build(
      nsPrefix,
      name,
      attributesObj,
      namespace,
      prefixes,
    );
    node.globalData = this._globalData;

    if (isEmpty) {
      // No children: just push the node into its parent.
      node.finalize();
      if (this._current.onChild(node)) {
        node.setId(this._ids);
      }
      node.clean(this._builder);
      return;
    }

    this._stack.push(this._current);
    this._current = node;
  }

  onEndElement(_name: string) {
    const node = this._current;
    if (node.isCDATAXml() && typeof node.content === "string") {
      const parser = new XFAParser();
      parser._globalData = this._globalData;
      const root = parser.parse(node.content);
      node.content = null;
      node.onChild(root);
    }

    node.finalize();
    this._current = this._stack.pop()!;
    if (this._current.onChild(node)) {
      node.setId(this._ids);
    }
    node.clean(this._builder);
  }

  onError(code: number) {
    this._errorCode = code;
  }
}

export { XFAParser };
