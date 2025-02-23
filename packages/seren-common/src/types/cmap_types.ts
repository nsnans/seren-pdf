
export interface CMap {

  numCodespaceRanges: number;

  name: string;

  vertical: boolean;

  builtInCMap: boolean;

  codespaceRanges: number[][];

  useCMap: CMap | null;

  length: number;

  isIdentityCMap: boolean

  addCodespaceRange(n: number, low: number, high: number): void;

  mapCidRange(low: number, high: number, dstLow: number): void;

  mapBfRange(low: number, high: number, dstLow: string): void;

  mapBfRangeToArray(low: number, high: number, array: (string | number)[]): void;

  // This is used for both bf and cid chars.
  mapOne(src: number, dst: number | string): void;

  lookup(code: number): string | number | undefined;

  contains(code: number): boolean;

  forEach(callback: (key: number, val: string | number) => void): void;

  charCodeOf(value: number): number;

  getMap(): (string | number)[];

  readCharCode(str: string, offset: number, out: { charcode: number, length: number }): void;

  getCharCodeLength(charCode: number): number;

}
