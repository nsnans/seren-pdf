// 这个类型应该要加到tsconfig当中去。
interface ImportMeta {
  readonly env: {
    SEREN_WORKER_URL: string;
  }
}