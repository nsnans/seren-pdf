import { Dict, DictKey, DictValueTypeMapping, isName, isNull, PlatformHelper, Ref, shadow, unreachable, XRef } from "seren-common";

export class DictImpl implements Dict {

  protected _map: Map<DictKey, DictValueTypeMapping[DictKey]> = new Map();

  public suppressEncryption = false;

  public xref: XRef | null;

  public objId: string | null;

  // 这几个值都是畸形的，而且只有一个地方用到了这个值
  // 把Dict当成record在用，乱往里面加值、减值
  public cacheKey: string | null = null;

  public fontAliases: null = null;

  public loadedName: string | null = null;

  constructor(xref: XRef | null = null) {
    // Map should only be used internally, use functions below to access.
    this._map = new Map();
    this.xref = xref;
    this.objId = null;
  }

  assignXref(newXref: XRef | null) {
    this.xref = newXref;
  }

  get size() {
    return this._map.size;
  }

  getValue<T extends DictKey>(key: T): DictValueTypeMapping[T] {
    return <DictValueTypeMapping[T]>this.get(key)
  }

  getValueWithFallback<T1 extends DictKey, T2 extends DictKey>(key1: T1, key2: T2): DictValueTypeMapping[T1] | DictValueTypeMapping[T2] {
    return <DictValueTypeMapping[T1] | DictValueTypeMapping[T2]>this.get(key1, key2);
  }

  getValueWithFallback2<T1 extends DictKey, T2 extends DictKey, T3 extends DictKey>(
    key1: T1, key2: T2, key3: T3
  ): DictValueTypeMapping[T1] | DictValueTypeMapping[T2] | DictValueTypeMapping[T3] {
    return <DictValueTypeMapping[T1] | DictValueTypeMapping[T2] | DictValueTypeMapping[T3]>this.get(key1, key2, key3);
  }

  // 自动将Ref对象解引用
  protected get(key1: DictKey, key2?: DictKey, key3?: DictKey) {
    let value = this._map.get(key1);
    if (isNull(value) && !isNull(key2)) {
      if (
        (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
        key2.length < key1.length
      ) {
        unreachable("Dict.get: Expected keys to be ordered by length.");
      }
      value = this._map.get(key2);
      if (isNull(value) && !isNull(key3)) {
        if (
          (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
          key3.length < key2.length
        ) {
          unreachable("Dict.get: Expected keys to be ordered by length.");
        }
        value = this._map.get(key3);
      }
    }
    if (value instanceof Ref && this.xref) {
      return this.xref.fetch(value, this.suppressEncryption);
    }
    return value;
  }


  // 为了获取到更精确的参数类型和返回类型，而编写的兼容性代码
  async getAsyncValue<T extends DictKey>(key: T): Promise<DictValueTypeMapping[T]> {
    return <DictValueTypeMapping[T]>await this.getAsync(key);
  }

  async getAsyncWithFallback<T1 extends DictKey, T2 extends DictKey>(key1: T1, key2: T2):
    Promise<DictValueTypeMapping[T1] | DictValueTypeMapping[T2]> {
    return <DictValueTypeMapping[T1] | DictValueTypeMapping[T2]>await this.getAsync(key1, key2);
  }

  // Same as get(), but returns a promise and uses fetchIfRefAsync().
  protected async getAsync(key1: DictKey, key2?: DictKey, key3?: DictKey) {
    let value = this._map.get(key1);
    if (isNull(value) && !isNull(key2)) {
      if (
        (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
        key2.length < key1.length
      ) {
        unreachable("Dict.getAsync: Expected keys to be ordered by length.");
      }
      value = this._map.get(key2);
      if (isNull(value) && !isNull(key3)) {
        if (
          (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
          key3.length < key2.length
        ) {
          unreachable("Dict.getAsync: Expected keys to be ordered by length.");
        }
        value = this._map.get(key3);
      }
    }
    if (value instanceof Ref && this.xref) {
      return this.xref.fetchAsync(value, this.suppressEncryption);
    }
    return value;
  }

  // 为了获取到更精确的参数类型和返回类型，而编写的兼容性代码
  getArrayValue<T extends DictKey>(key: T): DictValueTypeMapping[T] {
    return this.getArray(key);
  }

  getArrayWithFallback<T1 extends DictKey, T2 extends DictKey>(key1: T1, key2: T2):
    DictValueTypeMapping[T1] | DictValueTypeMapping[T2] {
    return this.getArray(key1, key2);
  }


  // Same as get(), but dereferences all elements if the result is an Array.
  // 这里的值其实不应当细究，不然会带来很多麻烦
  protected getArray(key1: DictKey, key2?: DictKey, key3?: DictKey) {
    let value: any = this._map.get(key1);
    if (isNull(value) && !isNull(key2)) {
      if (
        (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
        key2.length < key1.length
      ) {
        unreachable("Dict.getArray: Expected keys to be ordered by length.");
      }
      value = this._map.get(key2);
      if (isNull(value) && !isNull(key3)) {
        if (
          (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) &&
          key3.length < key2.length
        ) {
          unreachable("Dict.getArray: Expected keys to be ordered by length.");
        }
        value = this._map.get(key3);
      }
    }
    if (value instanceof Ref && this.xref) {
      value = this.xref.fetch(value, this.suppressEncryption);
    }

    if (Array.isArray(value)) {
      value = value.slice(); // Ensure that we don't modify the Dict data.
      for (let i = 0, ii = value.length; i < ii; i++) {
        if (value[i] instanceof Ref && this.xref) {
          value[i] = this.xref.fetch(<Ref>value[i], this.suppressEncryption);
        }
      }
    }
    return value;
  }

  // No dereferencing.
  getRaw<T extends DictKey>(key: T): DictValueTypeMapping[T] {
    return <DictValueTypeMapping[T]>this._map.get(key);
  }

  getKeys(): DictKey[] {
    return Array.from(this._map.keys());
  }

  // No dereferencing.
  getRawValues(): any[] {
    return Array.from(this._map.values());
  }

  set<T extends DictKey>(key: T, value: DictValueTypeMapping[T]) {
    this._map.set(key, value);
  }

  has(key: DictKey) {
    return this._map.has(key);
  }

  forEach(callback: (key: DictKey, value: any) => void) {
    for (const key in this._map) {
      const dictKey = <DictKey>key;
      callback(dictKey, this.getValue(dictKey));
    }
  }

  static get empty(): DictImpl {
    const emptyDict = new DictImpl(null);

    emptyDict.set = (_key, _value) => {
      unreachable("Should not call `set` on the empty dictionary.");
    };
    return shadow(this, "empty", emptyDict);
  }

  static merge(xref: XRef, dictArray: Dict[], mergeSubDicts = false) {
    const mergedDict = new DictImpl(xref);
    const properties = new Map();

    for (const dict of dictArray) {
      if (!(dict instanceof DictImpl)) {
        continue;
      }
      for (const [key, value] of dict._map.entries()) {
        let property = properties.get(key);
        if (isNull(property)) {
          property = [];
          properties.set(key, property);
        } else if (!mergeSubDicts || !(value instanceof DictImpl)) {
          // Ignore additional entries, if either:
          //  - This is a "shallow" merge, where only the first element matters.
          //  - The value is *not* a `Dict`, since other types cannot be merged.
          continue;
        }
        property.push(value);
      }
    }
    for (const [name, values] of properties) {
      if (values.length === 1 || !(values[0] instanceof DictImpl)) {
        mergedDict._map.set(<DictKey>name, values[0]);
        continue;
      }
      const subDict = new DictImpl(xref);

      for (const dict of values) {
        for (const [key, value] of dict._map.entries()) {
          if (subDict._map.has(<DictKey>key)) {
            subDict._map.set(<DictKey>key, <any>value);
          }
        }
      }
      if (subDict.size > 0) {
        mergedDict.set(<DictKey>name, subDict);
      }
    }
    properties.clear();

    return mergedDict.size > 0 ? mergedDict : DictImpl.empty;
  }

  clone(): Dict {
    const dict = new DictImpl(this.xref);
    for (const key of this.getKeys()) {
      dict.set(key, <any>this.getRaw(key));
    }
    return dict;
  }

  delete(key: DictKey) {
    this._map.delete(key);
  }
}

export function isDict(v: unknown, type: string) {
  return (
    v instanceof DictImpl && (isNull(type) || isName(v.getValue(DictKey.Type), type))
  );
}
