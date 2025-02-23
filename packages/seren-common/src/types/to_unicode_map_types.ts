
export interface ToUnicodeMap {

  length: number;

  forEach(callback: (index: number, char: number) => void): void;

  has(i: number): boolean;

  get(i: number): string | number | null;

  // 究竟是数字还是字符串，需要再考虑一下
  charCodeOf(value: string | number): number;

  amend(map: string[]): void;
}
