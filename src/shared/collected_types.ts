import { Stream } from "../core/stream";

// 数据类型实在是太多太杂了，因此需要收纳起来，避免json对象传来传去
export interface CreateStampImageResult {
  width: number;
  height: number;
  imageStream: Stream;
  smaskStream: Stream | null;
}