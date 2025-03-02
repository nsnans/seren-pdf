import { defineConfig } from 'vite';
import path from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, './src/index.ts'),
      name: 'seren-core',
      fileName: 'seren-core',
      formats: ['es', 'umd']
    }
  },
});