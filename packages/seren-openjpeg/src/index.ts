import _OpenJPEG from "./openjpeg";

// TODO 这东西怎么搞，还需要好好想想，seren-openjpeg应当独立。
export interface OpenJPEGModule {
  decode: (
    data: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>,
    option: Partial<{
      numComponents: number;
      isIndexedColormap: boolean;
      smaskInData: boolean;
    }> | null
  ) => Uint8Array<ArrayBuffer>;
}

// 在这里纠正一下OpenJPEG的类型，厘清变量的结果和返回值
export type OpenJPEGType = (options: Partial<{
  warn: (msg: unknown) => void
}>) => OpenJPEGModule;

export const OpenJPEG = <OpenJPEGType>_OpenJPEG;

