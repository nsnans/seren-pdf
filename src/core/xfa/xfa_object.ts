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

import { AvailableSpace, RectType } from "../../display/display_utils";
import { shadow, utf8StringToString, warn } from "../../shared/util";
import { encodeToXmlString } from "../core_utils";
import { Builder } from "./builder";
import { Namespace } from "./namespace";
import { NamespaceIds } from "./namespaces";
import { searchNode } from "./som";
import {
  $root
} from "./symbol_utils";
import { Color, Subform, Template } from "./template";
import { getInteger, getKeyword, HTMLResult } from "./utils";


let uid = 0;

const NS_DATASETS = NamespaceIds.datasets.id;

// xml属性的基本类型，也就是所有的attribute类型
export interface XMLTagProperty { name: string, value: string }

/**
 * AttributeObj分为两部分 第一部分是传统的键值对，第二部分是nsAttribute部分
 * 通过分析XFAParser的源码，我们能够知道Attribute一开始就是XMLTagProperty类型
 * 通过进一部分分析_mkAttributes方法，我们进一步推算出了修饰过后的AttributeObj类型，具体如下：
 * attributeObj的接口的样子应该是下面这样的（所有的key和value都是string类型）：
 * {
 *   key1: value1;
 *   key2: value2;
 *   ......
 *   nsAttributes: {
 *     namespace1: {
 *       key1: value1;
 *       ....
 *     }
 *     .......
 *     namespaceN: {
 *       key1: value1;
 *     }
 *   }
 * }
 */
export type AttributesObj = Record<string, string> & {
  nsAttributes: Record<string, Record<string, string>> | null
};

// 只考虑xfa相关的nsAttributes，其它的一律去除
export type XFAAttributesObj = Record<string, string> & {
  nsAttributes: null | {
    xfa: Record<string, string>
  }
};

export const EmptyXFAAttributesObj: XFAAttributesObj = {
  nsAttributes: null
} as XFAAttributesObj;

class XFAObject {

  public namespaceId: number;

  readonly nodeName: string;

  protected _hasChildren: boolean;

  protected _children: XFAObject[];

  public uid: string;

  public globalData;

  public content: any | null;

  public _parent: XFAObject | null;

  public cleanup: {
    hasNamespace: boolean,
    prefixes: {
      prefix: string;
      value: string;
    }[], nsAgnostic: boolean
  } | null = null;

  protected name: string;

  public extra;

  protected use: string = "";

  protected usehref: string = "";

  protected id: string = "";

  protected _setAttributes: Set<string> = new Set();
  thickness: any;
  radius: number;
  value: any;
  oddOrEven: string;
  pagePosition: string;
  public template: Template | null = null;

  constructor(nsId: number, name: string, hasChildren = false) {
    this.namespaceId = nsId;
    this.nodeName = name;
    this._hasChildren = hasChildren;
    this._parent = null;
    this._children = [];
    this.uid = `${name}${uid++}`;
    this.globalData = null;
    this.content = null;
  }

  get isXFAObject() {
    return true;
  }

  get isXFAObjectArray() {
    return false;
  }

  cleanPage() {
    throw new Error("Method not implemented.");
  }

  getNextPage() {
    throw new Error("Method not implemented.");
  }

  createNodes(path: { name: string, index: number }[]): XFAObject | null {
    let root = <XFAObject>this;
    let node: XFAObject | null = null;
    for (const { name, index } of path) {
      for (let i = 0, ii = isFinite(index) ? index : 0; i <= ii; i++) {
        const nsId =
          root.namespaceId === NS_DATASETS ? -1 : root.namespaceId;
        node = new XmlObject(nsId, name);
        root.appendChild(node);
      }
      root = node!;
    }
    return node;
  }

  onChild(child: XFAObject) {
    if (!this._hasChildren || !this.onChildCheck(child)) {
      return false;
    }

    const name = child.nodeName;
    const node = this[name];

    if (node instanceof XFAObjectArray) {
      if (node.push(child)) {
        this.appendChild(child);
        return true;
      }
    } else {
      // IRL it's possible to already have a node.
      // So just replace it with the last version.
      if (node !== null) {
        this.removeChild(node);
      }
      this[name] = child;
      this.appendChild(child);
      return true;
    }

    let id = "";
    if (this.id) {
      id = ` (id: ${this.id})`;
    } else if (this.name) {
      id = ` (name: ${this.name} ${this.h.value})`;
    }
    warn(`XFA - node "${this.nodeName}"${id} has already enough "${name}"!`);
    return false;
  }

  onChildCheck(child) {
    return (
      this.hasOwnProperty(child.nodeName) &&
      child.namespaceId === this.namespaceId
    );
  }

  isNsAgnostic() {
    return false;
  }

  acceptWhitespace() {
    return false;
  }

  isCDATAXml() {
    return false;
  }

  isBindable() {
    return false;
  }

  popPara() {
    if (this.para) {
      this.getTemplateRoot().extra.paraStack.pop();
    }
  }

  pushPara() {
    this.getTemplateRoot().extra.paraStack.push(this.para);
  }

  setId(ids: Map<string | Symbol, XFAObject | null>) {
    if (this.id && this.namespaceId === NamespaceIds.template.id) {
      ids.set(this.id, this);
    }
  }

  getTemplateRoot() {
    return this.globalData.template;
  }

  isSplittable() {
    return false;
  }

  /**
     Return true if this node (typically a container)
     can provide more width during layout.
     The goal is to help to know what a descendant must
     do in case of horizontal overflow.
   */
  isThereMoreWidth() {
    return false;
  }

  appendChild(child: XFAObject) {
    child._parent = this;
    this._children.push(child);
    if (!child.globalData && this.globalData) {
      child.globalData = this.globalData;
    }
  }

  removeChild(child: XFAObject) {
    const i = this._children.indexOf(child);
    this._children.splice(i, 1);
  }

  hasSettableValue() {
    return this.hasOwnProperty("value");
  }

  setValue(_: unknown) { }

  onText(_text: string, _richText: boolean = false) { }

  finalize() { }

  clean(builder: Builder) {
    this._hasChildren = false;
    if (this.cleanup) {
      builder.clean(this.cleanup);
      // undefined 改为 null
      this.cleanup = null;
    }
  }

  indexOf(child: XFAObject) {
    return this._children.indexOf(child);
  }

  insertAt(i: number, child: XFAObject) {
    child._parent = this;
    this._children.splice(i, 0, child);
    if (!child.globalData && this.globalData) {
      child.globalData = this.globalData;
    }
  }

  /**
   * If true the element is transparent when searching a node using
   * a SOM expression which means that looking for "foo.bar" in
   * <... name="foo"><toto><titi><... name="bar"></titi></toto>...
   * is fine because toto and titi are transparent.
   */
  isTransparent() {
    return !this.name;
  }

  lastAttribute() {
    return "";
  }

  text(): string {
    if (this._children.length === 0) {
      return this.content!;
    }
    return this._children.map(c => c.text()).join("");
  }

  get _attributeNames() {
    // Lazily get attributes names
    const proto = Object.getPrototypeOf(this);
    if (!proto._attributes) {
      const attributes = (proto._attributes = new Set());
      for (const name of Object.getOwnPropertyNames(this)) {
        if (
          (<any>this)[name] === null ||
          (<any>this)[name] instanceof XFAObject ||
          (<any>this)[name] instanceof XFAObjectArray
        ) {
          break;
        }
        attributes.add(name);
      }
    }
    // TODO 这里有点特别，需要做特殊的处理
    return shadow(this, "_attributeNames", proto._attributes);
  }

  isDescendent(parent: XFAObject) {
    let node: XFAObject = this;
    while (node) {
      if (node === parent) {
        return true;
      }
      node = node.getParent();
    }
    return false;
  }

  getParent(): XFAObject {
    return this._parent;
  }

  getSubformParent(): XFAObject | Subform {
    return this.getParent();
  }

  getChildren(name = null) {
    if (!name) {
      return this._children;
    }

    return this[name];
  }

  dump() {
    const dumped = Object.create(null);
    if (this.content) {
      dumped.$content = this.content;
    }

    for (const name of Object.getOwnPropertyNames(this)) {
      const value = this[name];
      if (value === null) {
        continue;
      }
      if (value instanceof XFAObject) {
        dumped[name] = value.dump();
      } else if (value instanceof XFAObjectArray) {
        if (!value.isEmpty()) {
          dumped[name] = value.dump();
        }
      } else {
        dumped[name] = value;
      }
    }

    return dumped;
  }

  toStyle(_color: Color | null = null): string | null {
    return null;
  }

  toHTML(_availableSpace: AvailableSpace | null = null): HTMLResult | null {
    return HTMLResult.EMPTY;
  }

  *getContainedChildren() {
    // This function is overriden in Subform and SubformSet.
    for (const node of this.getChildren()) {
      yield node;
    }
  }

  *_filteredChildrenGenerator(filter: Set<string> | null, include: boolean) {
    for (const node of this.getContainedChildren()) {
      if (!filter || include === filter.has(node.nodeName)) {
        const availableSpace = this.getAvailableSpace();
        const res = node.toHTML(availableSpace)!;
        if (!res.success) {
          this.extra.failingNode = node;
        }
        yield res;
      }
    }
  }

  flushHTML() {
    return null;
  }

  addHTML(html, _bbox: RectType) {
    this.extra.children.push(html);
  }

  getAvailableSpace(): AvailableSpace | null {
    return null;
  }

  childrenToHTML(filter: Set<string> | null = null, include: boolean = true) {
    if (!this.extra.generator) {
      this.extra.generator = this._filteredChildrenGenerator(
        filter,
        include
      );
    } else {
      const availableSpace = this.getAvailableSpace();
      const res = this.extra.failingNode.toHTML(availableSpace);
      if (!res.success) {
        return res;
      }
      if (res.html) {
        this.addHTML(res.html, res.bbox);
      }
      delete this.extra.failingNode;
    }

    while (true) {
      const gen = this.extra.generator.next();
      if (gen.done) {
        break;
      }
      const res = gen.value;
      if (!res.success) {
        return res;
      }
      if (res.html) {
        this.addHTML(res.html, res.bbox);
      }
    }

    this.extra.generator = null;

    return HTMLResult.EMPTY;
  }

  setSetAttributes(attributes) {
    // Just keep set attributes because it can be used in a proto.
    this._setAttributes = new Set(Object.keys(attributes));
  }

  /**
   * Get attribute names which have been set in the proto but not in this.
   */
  _getUnsetAttributes(protoAttributes) {
    const allAttr = this._attributeNames;
    const setAttr = this._setAttributes;
    return [...protoAttributes].filter(x => allAttr.has(x) && !setAttr.has(x));
  }

  /**
   * Update the node with properties coming from a prototype and apply
   * this function recursively to all children.
   */
  resolvePrototypes(ids: Map<Symbol | string, XFAObject | null>, ancestors = new Set<XFAObject>()) {
    for (const child of this._children) {
      child._resolvePrototypesHelper(ids, ancestors);
    }
  }

  _resolvePrototypesHelper(ids: Map<Symbol | string, XFAObject | null>, ancestors: Set<XFAObject>) {
    const proto = this._getPrototype(ids, ancestors);
    if (proto) {
      // _applyPrototype will apply $resolvePrototypes with correct ancestors
      // to avoid infinite loop.
      this._applyPrototype(proto, ids, ancestors);
    } else {
      this.resolvePrototypes(ids, ancestors);
    }
  }

  _getPrototype(ids: Map<Symbol | string, XFAObject | null>, ancestors: Set<XFAObject>) {
    const { use, usehref } = this;
    if (!use && !usehref) {
      return null;
    }

    let proto: XFAObject | null = null;
    let somExpression = null;
    let id = null;
    let ref = use;

    // If usehref and use are non-empty then use usehref.
    if (usehref) {
      ref = usehref;
      // Href can be one of the following:
      // - #ID
      // - URI#ID
      // - #som(expression)
      // - URI#som(expression)
      // - URI
      // For now we don't handle URI other than "." (current document).
      if (usehref.startsWith("#som(") && usehref.endsWith(")")) {
        somExpression = usehref.slice("#som(".length, -1);
      } else if (usehref.startsWith(".#som(") && usehref.endsWith(")")) {
        somExpression = usehref.slice(".#som(".length, -1);
      } else if (usehref.startsWith("#")) {
        id = usehref.slice(1);
      } else if (usehref.startsWith(".#")) {
        id = usehref.slice(2);
      }
    } else if (use.startsWith("#")) {
      id = use.slice(1);
    } else {
      somExpression = use;
    }

    this.use = this.usehref = "";
    if (id) {
      proto = ids.get(id)!;
    } else {
      proto = searchNode(
        ids.get($root),
        this,
        somExpression!,
        true /* = dotDotAllowed */,
        false /* = useCache */
      );
      if (proto) {
        proto = proto[0];
      }
    }

    if (!proto) {
      warn(`XFA - Invalid prototype reference: ${ref}.`);
      return null;
    }

    if (proto.nodeName !== this.nodeName) {
      warn(
        `XFA - Incompatible prototype: ${proto.nodeName} !== ${this.nodeName}.`
      );
      return null;
    }

    if (ancestors.has(proto)) {
      // We've a cycle so break it.
      warn(`XFA - Cycle detected in prototypes use.`);
      return null;
    }

    ancestors.add(proto);

    // The prototype can have a "use" attribute itself.
    const protoProto = proto._getPrototype(ids, ancestors);
    if (protoProto) {
      proto._applyPrototype(protoProto, ids, ancestors);
    }

    // The prototype can have a child which itself has a "use" property.
    proto.resolvePrototypes(ids, ancestors);

    ancestors.delete(proto);

    return proto;
  }

  protected _applyPrototype(proto: XFAObject, ids: Map<Symbol | string, XFAObject | null>, ancestors: Set<XFAObject>) {
    if (ancestors.has(proto)) {
      // We've a cycle so break it.
      warn(`XFA - Cycle detected in prototypes use.`);
      return;
    }

    if (!this.content && proto.content) {
      this.content = proto.content;
    }

    const newAncestors = new Set(ancestors);
    newAncestors.add(proto);

    for (const unsetAttrName of this._getUnsetAttributes(
      proto._setAttributes
    )) {
      this[unsetAttrName] = proto[unsetAttrName];
      if (!!this._setAttributes) {
        this._setAttributes.add(unsetAttrName);
      }
    }

    for (const name of Object.getOwnPropertyNames(this)) {
      if (this._attributeNames.has(name)) {
        continue;
      }
      const value = this[name];
      const protoValue = proto[name];

      if (value instanceof XFAObjectArray) {
        for (const child of value._children) {
          child._resolvePrototypesHelper(ids, ancestors);
        }

        for (
          let i = value._children.length, ii = protoValue._children.length;
          i < ii;
          i++
        ) {
          const child = proto._children[i].clone();
          if (value.push(child)) {
            child._parent = this;
            this._children.push(child);
            child._resolvePrototypesHelper(ids, ancestors);
          } else {
            // No need to continue: other nodes will be rejected.
            break;
          }
        }
        continue;
      }

      if (value !== null) {
        value.resolvePrototypes(ids, ancestors);
        if (protoValue) {
          // protoValue must be treated as a prototype for value.
          value._applyPrototype(protoValue, ids, ancestors);
        }
        continue;
      }

      if (protoValue !== null) {
        const child = protoValue.clone();
        child._parent = this;
        this[name] = child;
        this._children.push(child);
        child._resolvePrototypesHelper(ids, ancestors);
      }
    }
  }

  static _cloneAttribute(obj) {
    if (Array.isArray(obj)) {
      return obj.map(x => XFAObject._cloneAttribute(x));
    }
    if (typeof obj === "object" && obj !== null) {
      return Object.assign({}, obj);
    }
    return obj;
  }

  clone() {
    const clone = Object.create(Object.getPrototypeOf(this));
    for (const $symbol of Object.getOwnPropertySymbols(this)) {
      try {
        clone[$symbol] = this[$symbol];
      } catch {
        shadow(clone, $symbol, this[$symbol]);
      }
    }
    clone.uid = `${clone.nodeName}${uid++}`;
    clone._children = [];

    for (const name of Object.getOwnPropertyNames(this)) {
      if (this._attributeNames.has(name)) {
        clone[name] = XFAObject._cloneAttribute(this[name]);
        continue;
      }
      const value = this[name];
      clone[name] =
        value instanceof XFAObjectArray
          ? new XFAObjectArray(value._max)
          : null;
    }

    for (const child of this._children) {
      const name = child.nodeName;
      const clonedChild = child.clone();
      clone._children.push(clonedChild);
      clonedChild._parent = clone;
      if (clone[name] === null) {
        clone[name] = clonedChild;
      } else {
        clone[name]._children.push(clonedChild);
      }
    }

    return clone;
  }

  getChildren(name = null) {
    if (!name) {
      return this._children;
    }

    return this._children.filter(c => c.nodeName === name);
  }

  getChildrenByClass(name) {
    return this[name];
  }

  getChildrenByName(name, allTransparent, first = true) {
    return Array.from(this.getChildrenByNameIt(name, allTransparent, first));
  }

  *getChildrenByNameIt(name, allTransparent, first = true) {
    if (name === "parent") {
      yield this._parent;
      return;
    }

    for (const child of this._children) {
      if (child.nodeName === name) {
        yield child;
      }

      if (child.name === name) {
        yield child;
      }

      if (allTransparent || child.isTransparent()) {
        yield* child.getChildrenByNameIt(name, allTransparent, false);
      }
    }

    if (first && this._attributeNames.has(name)) {
      yield new XFAAttribute(this, name, this[name]);
    }
  }
}

class XFAObjectArray<T extends XFAObject> {

  protected _children: T[];

  protected _max: number;

  constructor(max = Infinity) {
    this._max = max;
    this._children = [];
  }

  get isXFAObject() {
    return false;
  }

  get isXFAObjectArray() {
    return true;
  }

  push(child: T) {
    const len = this._children.length;
    if (len <= this._max) {
      this._children.push(child);
      return true;
    }
    warn(
      `XFA - node "${child.nodeName}" accepts no more than ${this._max} children`
    );
    return false;
  }

  isEmpty() {
    return this._children.length === 0;
  }

  dump() {
    return this._children.length === 1
      ? this._children[0].dump()
      : this._children.map(x => x.dump());
  }

  clone() {
    const clone = new XFAObjectArray(this._max);
    clone._children = this._children.map(c => c.clone());
    return clone;
  }

  get children() {
    return this._children;
  }

  clear() {
    this._children.length = 0;
  }
}

class XFAAttribute {
  constructor(node, name, value) {
    this._parent = node;
    this.nodeName = name;
    this.content = value;
    this.consumed = false;
    this.uid = `attribute${uid++}`;
  }

  getParent() {
    return this._parent;
  }

  isDataValue() {
    return true;
  }

  getDataValue() {
    return this.content.trim();
  }

  setValue(value) {
    value = value.value || "";
    this.content = value.toString();
  }

  text() {
    return this.content;
  }

  isDescendent(parent) {
    return this._parent === parent || this._parent.isDescendent(parent);
  }
}

class XmlObject extends XFAObject {

  protected _attributes: Map<any, any> | null = null;

  protected _dataValue: boolean | null;

  protected consumed: boolean;

  constructor(nsId: number, name: string, attributes = EmptyXFAAttributesObj) {
    super(nsId, name);
    this.content = "";
    this._dataValue = null;
    if (name !== "#text") {
      const map = new Map();
      this._attributes = map;
      for (const [attrName, value] of Object.entries(attributes)) {
        map.set(attrName, new XFAAttribute(this, attrName, value));
      }
      if (!!((<any>attributes).nsAttributes)) {
        // XFA attributes.
        const dataNode = attributes.nsAttributes.xfa.dataNode;
        if (dataNode !== undefined) {
          if (dataNode === "dataGroup") {
            this._dataValue = false;
          } else if (dataNode === "dataValue") {
            this._dataValue = true;
          }
        }
      }
    }
    this.consumed = false;
  }

  ToString(buf) {
    const tagName = this.nodeName;
    if (tagName === "#text") {
      buf.push(encodeToXmlString(this.content!));
      return;
    }
    const utf8TagName = utf8StringToString(tagName);
    const prefix = this.namespaceId === NS_DATASETS ? "xfa:" : "";
    buf.push(`<${prefix}${utf8TagName}`);
    for (const [name, value] of this._attributes!.entries()) {
      const utf8Name = utf8StringToString(name);
      buf.push(` ${utf8Name}="${encodeToXmlString(value.content)}"`);
    }
    if (this._dataValue !== null) {
      if (this._dataValue) {
        buf.push(` xfa:dataNode="dataValue"`);
      } else {
        buf.push(` xfa:dataNode="dataGroup"`);
      }
    }
    if (!this.content && this._children.length === 0) {
      buf.push("/>");
      return;
    }

    buf.push(">");
    if (this.content) {
      if (typeof this.content === "string") {
        buf.push(encodeToXmlString(this.content));
      } else {
        this.content.ToString(buf);
      }
    } else {
      for (const child of this._children) {
        child.ToString(buf);
      }
    }
    buf.push(`</${prefix}${utf8TagName}>`);
  }

  onChild(child: XFAObject) {
    if (this.content) {
      const node = new XmlObject(this.namespaceId, "#text");
      this.appendChild(node);
      node.content = this.content;
      this.content = "";
    }
    this.appendChild(child);
    return true;
  }

  onText(str: string) {
    this.content += str;
  }

  finalize() {
    if (this.content && this._children.length > 0) {
      const node = new XmlObject(this.namespaceId, "#text");
      this.appendChild(node);
      node.content = this.content;
      this.content = null;
    }
  }

  toHTML(_availableSpace: AvailableSpace | null = null) {
    if (this.nodeName === "#text") {
      return HTMLResult.success({
        name: "#text",
        value: this.content,
      });
    }

    return HTMLResult.EMPTY;
  }

  getChildren(name: string | null = null) {
    if (!name) {
      return this._children;
    }

    return this._children.filter(c => c.nodeName === name);
  }

  getAttributes() {
    return this._attributes;
  }

  getChildrenByClass(name: string) {
    const value = this._attributes!.get(name);
    if (value !== undefined) {
      return value;
    }
    return this.getChildren(name);
  }

  *getChildrenByNameIt(name: string, allTransparent: boolean) {
    const value = this._attributes!.get(name);
    if (value) {
      yield value;
    }

    for (const child of this._children) {
      if (child.nodeName === name) {
        yield child;
      }

      if (allTransparent) {
        yield* child.getChildrenByNameIt(name, allTransparent);
      }
    }
  }

  *getAttributeIt(name, skipConsumed) {
    const value = this._attributes!.get(name);
    if (value && (!skipConsumed || !value.consumed)) {
      yield value;
    }
    for (const child of this._children) {
      yield* child.getAttributeIt(name, skipConsumed);
    }
  }

  *getRealChildrenByNameIt(name, allTransparent, skipConsumed) {
    for (const child of this._children) {
      if (child.nodeName === name && (!skipConsumed || !child.consumed)) {
        yield child;
      }

      if (allTransparent) {
        yield* child.getRealChildrenByNameIt(
          name,
          allTransparent,
          skipConsumed
        );
      }
    }
  }

  isDataValue() {
    if (this._dataValue === null) {
      return (
        this._children.length === 0 ||
        this._children[0].namespaceId === NamespaceIds.xhtml.id
      );
    }
    return this._dataValue;
  }

  getDataValue() {
    if (this._dataValue === null) {
      if (this._children.length === 0) {
        return this.content.trim();
      }
      if (this._children[0].namespaceId === NamespaceIds.xhtml.id) {
        return this._children[0].text().trim();
      }
      return null;
    }
    return this.content.trim();
  }

  setValue(value) {
    value = value.value || "";
    this.content = value.toString();
  }

  dump(hasNS = false) {
    const dumped = Object.create(null);
    if (hasNS) {
      dumped.$ns = this.namespaceId;
    }
    if (this.content) {
      dumped.$content = this.content;
    }
    dumped.$name = this.nodeName;

    dumped.children = [];
    for (const child of this._children) {
      dumped.children.push(child.dump(hasNS));
    }

    dumped.attributes = Object.create(null);
    for (const [name, value] of this._attributes) {
      dumped.attributes[name] = value.content;
    }

    return dumped;
  }
}

class ContentObject extends XFAObject {
  constructor(nsId: number, name: string) {
    super(nsId, name);
    this.content = "";
  }

  onText(text: string) {
    this.content += text;
  }

  finalize() { }
}

class OptionObject extends ContentObject {

  protected _options: string[] | null;

  constructor(nsId: number, name: string, options: string[]) {
    super(nsId, name);
    this._options = options;
  }

  finalize() {
    this.content = getKeyword(
      this.content,
      this._options![0],
      k => this._options!.includes(k),
    );
  }

  clean(builder: Builder) {
    super.clean(builder);
    // delete this._options;
    this._options = null;
  }
}

class StringObject extends ContentObject {
  finalize() {
    this.content = this.content!.trim();
  }
}

class IntegerObject extends ContentObject {

  protected _defaultValue: number | null;

  protected _validator: ((n: number) => boolean) | null;

  constructor(nsId: number, name: string, defaultValue: number | null, validator: (n: number) => boolean) {
    super(nsId, name);
    this._defaultValue = defaultValue;
    this._validator = validator;
  }

  finalize() {
    this.content = getInteger(
      this.content,
      this._defaultValue!,
      this._validator!,
    );
  }

  clean(builder: Builder) {
    super.clean(builder);
    this._defaultValue = null;
    this._validator = null;
  }
}

class Option01 extends IntegerObject {
  constructor(nsId: number, name: string) {
    super(nsId, name, 0, n => n === 1);
  }
}

class Option10 extends IntegerObject {
  constructor(nsId: number, name: string) {
    super(nsId, name, 1, n => n === 0);
  }
}

export {
  ContentObject,
  IntegerObject,
  Option01,
  Option10,
  OptionObject,
  StringObject,
  XFAAttribute,
  XFAObject,
  XFAObjectArray,
  XmlObject
};

