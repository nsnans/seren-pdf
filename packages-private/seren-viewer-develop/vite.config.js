import { defineConfig } from 'vite';

export default defineConfig({
    build: {
      outDir: 'dist', // 指定输出目录
      assetsDir: 'assets', // 指定静态资源目录
      sourcemap: true, // 是否生成 sourcemap
    },
});