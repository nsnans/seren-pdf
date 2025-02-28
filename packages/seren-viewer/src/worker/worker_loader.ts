/**
 * 这个文件需要详细的说明一下：
 * 在seren-pdf的代码当中，seren-viewer和seren-worker是两个互不依赖的模块。
 * seren-worker最终会提供一个worker脚本供seren-viewer来进行处理。
 * 在开发环境下，这个值应该对应的是seren-worker目录下的main.ts，
 * 在编译过后，这个值应当是跟viewer打包之后，想通目录下的一个seren.pdf.worker.js文件。
 * 因为这个值有动态属性。因此需要隔离开来。避免嵌入到正常处理逻辑代码中去。
 */
export const WEB_WORKER_URL = import.meta.env.SEREN_WORKER_URL;