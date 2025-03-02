import { DataStream } from "../types/stream_types";
import { Dict } from "./dict";
import { Cmd, Name, Ref } from "./primitives";

export type ParsedType = string | number | boolean | Ref | Name | Dict | Cmd | DataStream | null | Symbol;

export interface ParsedEntry {
  offset: number;
  gen: number;
  free: boolean;
  uncompressed: boolean;
}

export type FetchResultType = ParsedEntry | ParsedType | ParsedType[] | Dict | Symbol;

export interface XRef {

  trailer: Dict | null

  topDict: Dict | null;

  getNewPersistentRef(obj: Dict): Ref;

  getNewTemporaryRef(): Ref;

  resetNewTemporaryRef(): void;

  setStartXRef(startXRef: number): void;

  parse(recoveryMode: boolean): void;

  parse(): void;

  fetch(currentNode: Ref, suppressEncryption: boolean): FetchResultType;
  
  fetch(currentNode: Ref): FetchResultType;

  fetchAsync(value: Ref, suppressEncryption: boolean): Promise<FetchResultType>;
  
  fetchAsync(value: Ref): Promise<FetchResultType>;
  
  fetchIfRef(obj: Ref | unknown): string | number | boolean | object | symbol | null;
  
  fetchIfRef(obj: Ref | unknown, suppressEncryption: boolean): string | number | boolean | object | symbol | null;

  fetchIfRefAsync<T>(obj: Ref | T): Promise<FetchResultType | T>;

  fetchIfRefAsync<T>(obj: Ref | T, suppressEncryption: boolean): Promise<FetchResultType | T>;

}
