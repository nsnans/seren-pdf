import { defineConfig } from 'vite';
import path from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'seren-openjpeg',
      fileName: 'seren-openjpeg',
      formats: ['es', 'umd']
    }
  },
});