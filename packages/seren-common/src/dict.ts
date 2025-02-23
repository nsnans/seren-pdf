import { XRefImpl } from "packages/seren-core/src/xref";
import { DictKey, DictValueTypeMapping } from "./primitives";

export interface Dict {

  suppressEncryption: boolean;

  xref: XRefImpl | null;

  objId: string | null;

  cacheKey: string | null;

  fontAliases: null;

  loadedName: string | null;

  assignXref(newXref: XRefImpl | null): void;

  size: number;

  getValue<
    T extends DictKey
  >(key: T): DictValueTypeMapping[T];

  getValueWithFallback<
    T1 extends DictKey,
    T2 extends DictKey
  >(key1: T1, key2: T2): DictValueTypeMapping[T1] | DictValueTypeMapping[T2];

  getValueWithFallback2<
    T1 extends DictKey,
    T2 extends DictKey,
    T3 extends DictKey
  >(key1: T1, key2: T2, key3: T3):
    DictValueTypeMapping[T1] |
    DictValueTypeMapping[T2] |
    DictValueTypeMapping[T3];

  getAsyncValue<T extends DictKey>(key: T): Promise<DictValueTypeMapping[T]>;

  getAsyncWithFallback<
    T1 extends DictKey,
    T2 extends DictKey
  >(key1: T1, key2: T2): Promise<DictValueTypeMapping[T1] | DictValueTypeMapping[T2]>;

  getArrayValue<T extends DictKey>(key: T): DictValueTypeMapping[T];

  getRaw<T extends DictKey>(key: T): DictValueTypeMapping[T];

  getRawValues(): any[]

  set<T extends DictKey>(key: T, value: DictValueTypeMapping[T]): void

  has(key: DictKey): boolean;

  forEach(callback: (key: DictKey, value: any) => void): void;

  clone(): Dict;

  delete(key: DictKey): void

}
