import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'registry-loader': 'src/registry-loader.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: {
    build: true
  },
  tsconfig: '../../tsconfig.json'
})
