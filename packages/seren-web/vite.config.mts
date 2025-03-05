import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'seren-web',
      fileName: 'seren-web',
      formats: ['es', 'umd']
    }
  },
});