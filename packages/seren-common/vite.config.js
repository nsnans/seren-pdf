import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'seren-common',
      fileName: 'seren-common',
      formats: ['es']
    }
  },
});