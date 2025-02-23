import { Dict } from "./dict";
import { Ref } from "./primitives";

export interface XRef {
  trailer: Dict | null
  topDict: Dict | null;
  getNewPersistentRef(obj: Dict): Ref;
  getNewTemporaryRef(): Ref;
  resetNewTemporaryRef(): void;
  setStartXRef(startXRef: number): void;
  parse(recoveryMode?: boolean): void;
}