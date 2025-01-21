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

import { RectType } from "../display/display_utils";
import { AnnotationPrefix, stringToPDFString, warn } from "../shared/util";
import { lookupNormalRect, stringToAsciiOrUTF16BE } from "./core_utils";
import { NumberTree } from "./name_number_tree";
import { PDFManager } from "./pdf_manager";
import { Dict, DictKey, isName, Name, Ref, RefSetCache } from "./primitives";
import { writeObject } from "./writer";
import { XRef } from "./xref";

const MAX_DEPTH = 40;

const StructElementType = {
  PAGE_CONTENT: 1,
  STREAM_CONTENT: 2,
  OBJECT: 3,
  ANNOTATION: 4,
  ELEMENT: 5,
};

export class StructTreeRoot {

  public roleMap = new Map<string, string>();

  protected ref: Ref | null;

  public dict: Dict;

  public structParentIds: RefSetCache<Ref, [number, number][]> | null;

  constructor(rootDict: Dict, rootRef: object) {
    this.dict = rootDict;
    this.ref = rootRef instanceof Ref ? rootRef : null;
    this.roleMap = new Map();
    this.structParentIds = null;
  }

  init() {
    this.readRoleMap();
  }

  #addIdToPage(pageRef: Ref, id: number, type: number) {
    if (!(pageRef instanceof Ref) || id < 0) {
      return;
    }
    this.structParentIds ||= new RefSetCache();
    let ids = this.structParentIds.get(pageRef);
    if (!ids) {
      ids = [];
      this.structParentIds.put(pageRef, ids);
    }
    ids.push([id, type]);
  }

  addAnnotationIdToPage(pageRef: Ref, id: number) {
    this.#addIdToPage(pageRef, id, StructElementType.ANNOTATION);
  }

  readRoleMap() {
    const roleMapDict = this.dict.getValue(DictKey.RoleMap);
    if (!(roleMapDict instanceof Dict)) {
      return;
    }
    roleMapDict.forEach((key, value) => {
      if (!(value instanceof Name)) {
        return;
      }
      this.roleMap.set(key, value.name);
    });
  }

  static async canCreateStructureTree(
    catalogRef: Ref | object,
    pdfManager: PDFManager,
    newAnnotationsByPage: Map<number, Record<string, any>[]>
  ) {
    if (!(catalogRef instanceof Ref)) {
      warn("Cannot save the struct tree: no catalog reference.");
      return false;
    }

    let nextKey = 0;
    let hasNothingToUpdate = true;

    for (const [pageIndex, elements] of newAnnotationsByPage) {
      const { ref: pageRef } = await pdfManager.getPage(pageIndex);
      if (!(pageRef instanceof Ref)) {
        warn(`Cannot save the struct tree: page ${pageIndex} has no ref.`);
        hasNothingToUpdate = true;
        break;
      }
      for (const element of elements) {
        if (element.accessibilityData?.type) {
          // Each tag must have a structure type.
          element.parentTreeId = nextKey++;
          hasNothingToUpdate = false;
        }
      }
    }

    if (hasNothingToUpdate) {
      for (const elements of newAnnotationsByPage.values()) {
        for (const element of elements) {
          delete element.parentTreeId;
        }
      }
      return false;
    }

    return true;
  }

  static async createStructureTree(
    newAnnotationsByPage: Map<number, Record<string, any>[]>,
    xref: XRef,
    catalogRef: Ref,
    pdfManager: PDFManager,
    newRefs: { ref: Ref; data: string | null; }[],
  ) {
    const root = pdfManager.catalog.cloneDict();
    const cache = new RefSetCache<Ref, Dict | Ref[]>();
    cache.put(catalogRef, root);

    const structTreeRootRef = xref.getNewTemporaryRef();
    root.set(DictKey.StructTreeRoot, structTreeRootRef);

    const structTreeRoot = new Dict(xref);
    structTreeRoot.set(DictKey.Type, Name.get("StructTreeRoot"));
    const parentTreeRef = xref.getNewTemporaryRef();
    structTreeRoot.set(DictKey.ParentTree, parentTreeRef);
    const kids: Ref[] = [];
    structTreeRoot.set(DictKey.K, kids);
    cache.put(structTreeRootRef, structTreeRoot);

    const parentTree = new Dict(xref);
    const nums: (Ref | number)[] = [];
    parentTree.set(DictKey.Nums, nums);

    const nextKey = await this.#writeKids(
      newAnnotationsByPage,
      structTreeRootRef,
      null,
      kids,
      nums,
      xref,
      pdfManager,
      newRefs,
      cache,
    );
    structTreeRoot.set(DictKey.ParentTreeNextKey, nextKey);

    cache.put(parentTreeRef, parentTree);

    const buffer: string[] = [];
    for (const [ref, obj] of cache.items()) {
      buffer.length = 0;
      await writeObject(ref, obj, buffer, xref.encrypt);
      newRefs.push({ ref, data: buffer.join("") });
    }
  }

  async canUpdateStructTree(
    pdfManager: PDFManager,
    xref: XRef,
    newAnnotationsByPage: Map<number, Record<string, any>[]>
  ) {
    if (!this.ref) {
      warn("Cannot update the struct tree: no root reference.");
      return false;
    }

    let nextKey = this.dict.getValue(DictKey.ParentTreeNextKey);
    if (!Number.isInteger(nextKey) || nextKey < 0) {
      warn("Cannot update the struct tree: invalid next key.");
      return false;
    }

    const parentTree = this.dict.getValue(DictKey.ParentTree);
    if (!(parentTree instanceof Dict)) {
      warn("Cannot update the struct tree: ParentTree isn't a dict.");
      return false;
    }
    const nums = parentTree.getValue(DictKey.Nums);
    if (!Array.isArray(nums)) {
      warn("Cannot update the struct tree: nums isn't an array.");
      return false;
    }
    const numberTree = new NumberTree(parentTree, xref);

    for (const pageIndex of newAnnotationsByPage.keys()) {
      const { pageDict } = await pdfManager.getPage(pageIndex);
      if (!pageDict.has(DictKey.StructParents)) {
        // StructParents is required when the content stream has some tagged
        // contents but a page can just have tagged annotations.
        continue;
      }
      const id = pageDict.getValue(DictKey.StructParents);
      if (!Number.isInteger(id) || !Array.isArray(numberTree.get(id))) {
        warn(`Cannot save the struct tree: page ${pageIndex} has a wrong id.`);
        return false;
      }
    }

    let hasNothingToUpdate = true;
    for (const [pageIndex, elements] of newAnnotationsByPage) {
      const { pageDict } = await pdfManager.getPage(pageIndex);
      StructTreeRoot.#collectParents(
        elements,
        this.dict.xref!,
        pageDict,
        numberTree,
      );

      for (const element of elements) {
        if (element.accessibilityData?.type) {
          // structParent can be undefined and in this case the positivity check
          // will fail (it's why the expression isn't equivalent to a `.<.`).
          if (!(element.accessibilityData.structParent >= 0)) {
            // Each tag must have a structure type.
            element.parentTreeId = nextKey++;
          }
          hasNothingToUpdate = false;
        }
      }
    }

    if (hasNothingToUpdate) {
      for (const elements of newAnnotationsByPage.values()) {
        for (const element of elements) {
          delete element.parentTreeId;
          delete element.structTreeParent;
        }
      }
      return false;
    }

    return true;
  }

  async updateStructureTree(
    newAnnotationsByPage: Map<number, Record<string, any>[]>,
    pdfManager: PDFManager, newRefs: { ref: Ref, data: string }[]
  ) {
    const xref = this.dict.xref!;
    const structTreeRoot = this.dict.clone();
    const structTreeRootRef = this.ref!;
    const cache = new RefSetCache<Ref, Dict>();
    cache.put(structTreeRootRef, structTreeRoot);

    let parentTreeRef = structTreeRoot.getRaw(DictKey.ParentTree);
    let parentTree;
    if (parentTreeRef instanceof Ref) {
      parentTree = xref.fetch(parentTreeRef);
    } else {
      parentTree = parentTreeRef;
      parentTreeRef = xref.getNewTemporaryRef();
      structTreeRoot.set(DictKey.ParentTree, parentTreeRef);
    }
    parentTree = parentTree!.clone();
    cache.put(parentTreeRef, parentTree);

    let nums = parentTree.getRaw("Nums");
    let numsRef = null;
    if (nums instanceof Ref) {
      numsRef = nums;
      nums = xref.fetch(numsRef);
    }
    nums = nums.slice();
    if (!numsRef) {
      parentTree.set("Nums", nums);
    }

    const newNextKey = await StructTreeRoot.#writeKids(
      newAnnotationsByPage, structTreeRootRef, this, null, nums, xref, pdfManager, newRefs, cache,
    );

    if (newNextKey === -1) {
      // No new tags were added.
      return;
    }

    structTreeRoot.set(DictKey.ParentTreeNextKey, newNextKey);

    if (numsRef) {
      cache.put(numsRef, nums);
    }

    const buffer: string[] = [];
    for (const [ref, obj] of cache.items()) {
      buffer.length = 0;
      await writeObject(ref, obj, buffer, xref.encrypt);
      newRefs.push({ ref, data: buffer.join("") });
    }
  }

  static async #writeKids(
    newAnnotationsByPage: Map<number, Record<string, any>[]>,
    structTreeRootRef: Ref,
    structTreeRoot: StructTreeRoot | null,
    kids: Ref[] | null,
    nums: (Ref | number)[],
    xref: XRef,
    pdfManager: PDFManager,
    newRefs: { ref: Ref, data: string | null }[],
    cache: RefSetCache<Ref, Dict | Ref[]>,
  ) {
    const objr = Name.get("OBJR");
    let nextKey = -1;
    let structTreePageObjs;
    const buffer: string[] = [];

    for (const [pageIndex, elements] of newAnnotationsByPage) {
      const page = await pdfManager.getPage(pageIndex);
      const { ref: pageRef } = page;
      const isPageRef = pageRef instanceof Ref;
      for (const {
        accessibilityData,
        ref,
        parentTreeId,
        structTreeParent,
      } of elements) {
        if (!accessibilityData?.type) {
          continue;
        }

        // We've some accessibility data, so we need to create a new tag or
        // update an existing one.
        const { structParent } = accessibilityData;

        if (
          structTreeRoot &&
          Number.isInteger(structParent) &&
          structParent >= 0
        ) {
          let objs = (structTreePageObjs ||= new Map()).get(pageIndex);
          if (objs === undefined) {
            // We need to collect the objects for the page.
            const structTreePage = new StructTreePage(
              structTreeRoot,
              page.pageDict
            );
            objs = structTreePage.collectObjects(pageRef!);
            structTreePageObjs.set(pageIndex, objs);
          }
          const objRef = objs?.get(structParent);
          if (objRef) {
            // We update the existing tag.
            const tagDict = xref.fetch(objRef).clone();
            StructTreeRoot.#writeProperties(tagDict, accessibilityData);
            buffer.length = 0;
            await writeObject(objRef, tagDict, buffer, xref.encrypt);
            newRefs.push({ ref: objRef, data: buffer.join("") });
            continue;
          }
        }
        nextKey = Math.max(nextKey, parentTreeId);

        const tagRef = xref.getNewTemporaryRef();
        const tagDict = new Dict(xref);

        StructTreeRoot.#writeProperties(tagDict, accessibilityData);

        await this.#updateParentTag(
          structTreeParent,
          tagDict,
          tagRef,
          structTreeRootRef,
          kids!,
          xref,
          cache,
        );

        const objDict = new Dict(xref);
        tagDict.set(DictKey.K, objDict);
        objDict.set(DictKey.Type, objr);
        if (isPageRef) {
          // Pg is optional.
          objDict.set(DictKey.Pg, pageRef);
        }
        objDict.set(DictKey.Obj, ref);

        cache.put(tagRef, tagDict);
        nums.push(parentTreeId, tagRef);
      }
    }
    return nextKey + 1;
  }

  static #writeProperties(
    tagDict: Dict,
    { type, title, lang, alt, expanded, actualText }:
      {
        type: string, title: string | null, lang: string | null,
        alt: string | null, expanded: string | null, actualText: string | null
      }
  ) {
    // The structure type is required.
    tagDict.set(DictKey.S, Name.get(type));

    if (title) {
      tagDict.set(DictKey.T, stringToAsciiOrUTF16BE(title));
    }
    if (lang) {
      tagDict.set(DictKey.Lang, stringToAsciiOrUTF16BE(lang));
    }
    if (alt) {
      tagDict.set(DictKey.Alt, stringToAsciiOrUTF16BE(alt));
    }
    if (expanded) {
      tagDict.set(DictKey.E, stringToAsciiOrUTF16BE(expanded));
    }
    if (actualText) {
      tagDict.set(DictKey.ActualText, stringToAsciiOrUTF16BE(actualText));
    }
  }

  static #collectParents(
    elements: Record<string, any>[], xref: XRef,
    pageDict: Dict, numberTree: NumberTree
  ) {
    const idToElements = new Map();
    for (const element of elements) {
      if (element.structTreeParentId) {
        const id = parseInt(element.structTreeParentId.split("_mc")[1], 10);
        let elems = idToElements.get(id);
        if (!elems) {
          elems = [];
          idToElements.set(id, elems);
        }
        elems.push(element);
      }
    }

    const id = pageDict.getValue(DictKey.StructParents);
    if (!Number.isInteger(id)) {
      return;
    }
    // The parentArray type has already been checked by the caller.
    const parentArray = numberTree.get(id);

    const updateElement = (kid: number, pageKid: Dict, kidRef: Ref) => {
      const elems = idToElements.get(kid);
      if (elems) {
        const parentRef = pageKid.getRaw(DictKey.P);
        const parentDict = xref.fetchIfRef(parentRef);
        if (parentRef instanceof Ref && parentDict instanceof Dict) {
          // It should always the case, but we check just in case.
          const params = { ref: kidRef, dict: pageKid };
          for (const element of elems) {
            element.structTreeParent = params;
          }
        }
        return true;
      }
      return false;
    };
    for (const kidRef of parentArray) {
      if (!(kidRef instanceof Ref)) {
        continue;
      }
      const pageKid = <Dict>xref.fetch(kidRef);
      const k = pageKid.getValue(DictKey.K);
      if (Number.isInteger(k)) {
        updateElement(<number>k, pageKid, kidRef);
        continue;
      }

      if (!Array.isArray(k)) {
        continue;
      }
      for (let kid of k) {
        const kidValue = xref.fetchIfRef(kid);
        if (Number.isInteger(kid) && updateElement(<number>kidValue, pageKid, kidRef)) {
          break;
        }
        if (!(kid instanceof Dict)) {
          continue;
        }
        if (!isName(kid.getValue(DictKey.Type), "MCR")) {
          break;
        }
        const mcid = kid.getValue(DictKey.MCID);
        if (Number.isInteger(mcid) && updateElement(mcid, pageKid, kidRef)) {
          break;
        }
      }
    }
  }

  static async #updateParentTag(
    structTreeParent: { ref: Ref, dict: Dict },
    tagDict: Dict,
    newTagRef: Ref,
    structTreeRootRef: Ref,
    fallbackKids: Ref[],
    xref: XRef,
    cache: RefSetCache<Ref, Dict | Ref[]>,
  ) {
    let ref = null;
    let parentRef;
    if (structTreeParent) {
      ({ ref } = structTreeParent);

      // We get the parent of the tag.
      parentRef = structTreeParent.dict.getRaw(DictKey.P) || structTreeRootRef;
    } else {
      parentRef = structTreeRootRef;
    }

    tagDict.set(DictKey.P, parentRef);

    // We get the kids in order to insert a new tag at the right position.
    const parentDict = xref.fetchIfRef(parentRef);
    if (!parentDict) {
      fallbackKids.push(newTagRef);
      return;
    }

    let cachedParentDict = <Dict | null>cache.get(<Ref>parentRef);
    if (!cachedParentDict) {
      cachedParentDict = parentDict.clone();
      cache.put(<Ref>parentRef, cachedParentDict!);
    }
    const parentKidsRaw = <Ref>cachedParentDict!.getRaw(DictKey.K);
    let cachedParentKids = parentKidsRaw instanceof Ref ? <Ref[]>cache.get(parentKidsRaw) : null;
    if (!cachedParentKids) {
      cachedParentKids = <Ref[]>xref.fetchIfRef(parentKidsRaw);
      cachedParentKids = Array.isArray(cachedParentKids) ? cachedParentKids.slice() : [parentKidsRaw];
      const parentKidsRef = xref.getNewTemporaryRef();
      cachedParentDict!.set(DictKey.K, parentKidsRef);
      cache.put(parentKidsRef, cachedParentKids);
    }

    const index = cachedParentKids.indexOf(ref!);
    cachedParentKids.splice(
      index >= 0 ? index + 1 : cachedParentKids.length,
      0,
      newTagRef
    );
  }
}

/**
 * Instead of loading the whole tree we load just the page's relevant structure
 * elements, which means we need a wrapper structure to represent the tree.
 */
class StructElementNode {

  protected tree: StructTreePage;

  public dict: Dict;

  public kids: StructElement[];

  constructor(tree: StructTreePage, dict: Dict) {
    this.tree = tree;
    this.dict = dict;
    this.kids = [];
    this.parseKids();
  }

  get role() {
    const nameObj = this.dict.getValue(DictKey.S);
    const name = nameObj instanceof Name ? nameObj.name : "";
    const { root } = this.tree;
    if (root.roleMap.has(name)) {
      return root.roleMap.get(name)!;
    }
    return name;
  }

  parseKids() {
    let pageObjId = null;
    const objRef = this.dict.getRaw(DictKey.Pg);
    if (objRef instanceof Ref) {
      pageObjId = objRef.toString();
    }
    const kids = this.dict.getValue(DictKey.K);
    if (Array.isArray(kids)) {
      for (const kid of kids) {
        const element = this.parseKid(pageObjId, kid);
        if (element) {
          this.kids.push(element);
        }
      }
    } else {
      const element = this.parseKid(pageObjId, kids);
      if (element) {
        this.kids.push(element);
      }
    }
  }

  parseKid(pageObjId: string | null, kid: number | Ref | Dict) {
    // A direct link to content, the integer is an mcid.
    if (Number.isInteger(kid)) {
      if (this.tree.pageDict.objId !== pageObjId) {
        return null;
      }

      return new StructElement(
        StructElementType.PAGE_CONTENT,
        <number>kid,
        pageObjId,
      );
    }

    // Find the dictionary for the kid.
    let kidDict = null;
    if (kid instanceof Ref) {
      kidDict = this.dict.xref!.fetch(kid);
    } else if (kid instanceof Dict) {
      kidDict = kid;
    }
    if (!kidDict) {
      return null;
    }
    const pageRef = kidDict.getRaw("Pg");
    if (pageRef instanceof Ref) {
      pageObjId = pageRef.toString();
    }

    const type =
      kidDict.get("Type") instanceof Name ? kidDict.get("Type").name : null;
    if (type === "MCR") {
      if (this.tree.pageDict.objId !== pageObjId) {
        return null;
      }
      const kidRef = kidDict.getRaw("Stm");
      return new StructElement(
        StructElementType.STREAM_CONTENT,
        kidDict.getValue(DictKey.MCID),
        pageObjId,
        kidRef instanceof Ref ? kidRef.toString() : null,
      );
    }

    if (type === "OBJR") {
      if (this.tree.pageDict.objId !== pageObjId) {
        return null;
      }
      const kidRef = kidDict.getRaw("Obj");
      return new StructElement(
        StructElementType.OBJECT,
        null,
        pageObjId,
        kidRef instanceof Ref ? kidRef.toString() : null,
      );
    }

    return new StructElement(StructElementType.ELEMENT, null, null, null, kidDict);
  }
}

class StructElement {

  public type: number;

  public dict: Dict | null;

  public mcid: number | null;

  public pageObjId: string | null;

  public refObjId: string | null;

  public parentNode: StructElementNode | null;

  constructor(
    type: number,
    mcid: number | null = null,
    pageObjId: string | null = null,
    refObjId: string | null = null,
    dict: Dict | null = null,
  ) {
    this.type = type;
    this.dict = dict;
    this.mcid = mcid;
    this.pageObjId = pageObjId;
    this.refObjId = refObjId;
    this.parentNode = null;
  }
}

interface StructTreeSerialLeaf {
  type: string;
  id: string;
}

export class StructTreeSerialNode {

  public role: string;

  public children: (StructTreeSerialNode | StructTreeSerialLeaf)[] = []

  public alt: string | null = null;

  public bbox: RectType | null = null;

  public lang: string | null = null;

  constructor(role: string) {
    this.role = role;
  }
}

export class StructTreePage {

  public root: StructTreeRoot;

  protected rootDict: Dict | null;

  public pageDict: Dict;

  protected nodes: StructElementNode[];

  constructor(structTreeRoot: StructTreeRoot, pageDict: Dict) {
    this.root = structTreeRoot;
    this.rootDict = structTreeRoot ? structTreeRoot.dict : null;
    this.pageDict = pageDict;
    this.nodes = [];
  }

  /**
   * Collect all the objects (i.e. tag) that are part of the page and return a
   * map of the structure element id to the object reference.
   * @param {Ref} pageRef
   * @returns {Map<number, Ref>}
   */
  collectObjects(pageRef: Ref) {
    if (!this.root || !this.rootDict || !(pageRef instanceof Ref)) {
      return null;
    }

    const parentTree = this.rootDict.getValue(DictKey.ParentTree);
    if (!parentTree) {
      return null;
    }
    const ids = this.root.structParentIds?.get(pageRef);
    if (!ids) {
      return null;
    }

    const map = new Map();
    const numberTree = new NumberTree(parentTree, this.rootDict.xref!);

    for (const [elemId] of ids) {
      const obj = numberTree.getRaw(elemId);
      if (obj instanceof Ref) {
        map.set(elemId, obj);
      }
    }
    return map;
  }

  parse(pageRef: Ref) {
    if (!this.root || !this.rootDict || !(pageRef instanceof Ref)) {
      return;
    }

    const parentTree = this.rootDict.getValue(DictKey.ParentTree);
    if (!parentTree) {
      return;
    }
    const id = this.pageDict.getValue(DictKey.StructParents);
    const ids = this.root.structParentIds?.get(pageRef);
    if (!Number.isInteger(id) && !ids) {
      return;
    }

    const map = new Map();
    const numberTree = new NumberTree(parentTree, this.rootDict.xref!);

    if (Number.isInteger(id)) {
      const parentArray = numberTree.get(id);
      if (Array.isArray(parentArray)) {
        for (const ref of parentArray) {
          if (ref instanceof Ref) {
            this.addNode(this.rootDict.xref!.fetch(ref), map);
          }
        }
      }
    }

    if (!ids) {
      return;
    }
    for (const [elemId, type] of ids) {
      const obj = numberTree.get(elemId);
      if (obj) {
        const elem = this.addNode(this.rootDict.xref!.fetchIfRef(obj), map);
        if (
          elem?.kids?.length === 1 &&
          elem.kids[0].type === StructElementType.OBJECT
        ) {
          // The node in the struct tree is wrapping an object (annotation
          // or xobject), so we need to update the type of the node to match
          // the type of the object.
          elem.kids[0].type = type;
        }
      }
    }
  }

  addNode(dict: Dict, map: Map<Dict, StructElementNode>, level = 0) {
    if (level > MAX_DEPTH) {
      warn("StructTree MAX_DEPTH reached.");
      return null;
    }
    if (!(dict instanceof Dict)) {
      return null;
    }

    if (map.has(dict)) {
      return map.get(dict);
    }

    const element = new StructElementNode(this, dict);
    map.set(dict, element);

    const parent = <Dict>dict.getValue(DictKey.P);

    if (!parent || isName(parent.getValue(DictKey.Type), "StructTreeRoot")) {
      if (!this.addTopLevelNode(dict, element)) {
        map.delete(dict);
      }
      return element;
    }

    const parentNode = this.addNode(parent, map, level + 1);
    if (!parentNode) {
      return element;
    }
    let save = false;
    for (const kid of parentNode.kids) {
      if (kid.type === StructElementType.ELEMENT && kid.dict === dict) {
        kid.parentNode = element;
        save = true;
      }
    }
    if (!save) {
      map.delete(dict);
    }
    return element;
  }

  addTopLevelNode(dict: Dict, element: StructElementNode) {
    const obj = this.rootDict!.getValue(DictKey.K);
    if (!obj) {
      return false;
    }

    if (obj instanceof Dict) {
      if (obj.objId !== dict.objId) {
        return false;
      }
      this.nodes[0] = element;
      return true;
    }

    if (!Array.isArray(obj)) {
      return true;
    }
    let save = false;
    for (let i = 0; i < obj.length; i++) {
      const kidRef = obj[i];
      if (kidRef?.toString() === dict.objId) {
        this.nodes[i] = element;
        save = true;
      }
    }
    return save;
  }

  /**
   * Convert the tree structure into a simplified object literal that can
   * be sent to the main thread.
   */
  get serializable(): StructTreeSerialNode {

    function nodeToSerializable(
      node: StructElementNode,
      parent: StructTreeSerialNode,
      level = 0
    ) {
      if (level > MAX_DEPTH) {
        warn("StructTree too deep to be fully serialized.");
        return;
      }
      const obj = new StructTreeSerialNode(node.role);
      obj.children = [];
      parent.children.push(obj);
      let alt = node.dict.getValue(DictKey.Alt);
      if (typeof alt !== "string") {
        alt = node.dict.getValue(DictKey.ActualText);
      }
      if (typeof alt === "string") {
        obj.alt = stringToPDFString(alt);
      }

      const a = node.dict.getValue(DictKey.A);
      if (a instanceof Dict) {
        const bbox = lookupNormalRect(a.getArrayValue(DictKey.BBox), null);
        if (bbox) {
          obj.bbox = bbox;
        } else {
          const width = a.getValue(DictKey.Width);
          const height = a.getValue(DictKey.Height);
          if (
            typeof width === "number" &&
            width > 0 &&
            typeof height === "number" &&
            height > 0
          ) {
            obj.bbox = [0, 0, width, height];
          }
        }
        // TODO: If the bbox is not available, we should try to get it from
        // the content stream.
        // For example when rendering on the canvas the commands between the
        // beginning and the end of the marked-content sequence, we can
        // compute the overall bbox.
      }

      const lang = node.dict.getValue(DictKey.Lang);
      if (typeof lang === "string") {
        obj.lang = stringToPDFString(lang);
      }

      for (const kid of node.kids) {
        const kidElement =
          kid.type === StructElementType.ELEMENT ? kid.parentNode : null;
        if (kidElement) {
          nodeToSerializable(kidElement, obj, level + 1);
          continue;
        } else if (
          kid.type === StructElementType.PAGE_CONTENT ||
          kid.type === StructElementType.STREAM_CONTENT
        ) {
          obj.children.push({
            type: "content",
            id: `p${kid.pageObjId}_mc${kid.mcid}`,
          });
        } else if (kid.type === StructElementType.OBJECT) {
          obj.children.push({
            type: "object",
            id: kid.refObjId!,
          });
        } else if (kid.type === StructElementType.ANNOTATION) {
          obj.children.push({
            type: "annotation",
            id: `${AnnotationPrefix}${kid.refObjId}`,
          });
        }
      }
    }

    const root = new StructTreeSerialNode("Root");
    for (const child of this.nodes) {
      if (!child) {
        continue;
      }
      nodeToSerializable(child, root);
    }
    return root;
  }
}

