import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import path from 'node:path'

/**
 * Check if a module is external.
 *
 * @param id - The module ID.
 * @returns True if the module is external, false otherwise.
 */
function external(id: string): boolean {
  return !id.startsWith('.') && !path.isAbsolute(id)
}

/**
 * Vite configuration.
 */
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        chunkFileNames: '[name]-[hash].js',
        entryFileNames: '[name].js',
        preserveModules: true,
        exports: 'auto',
      },
      external,
    },
    lib: {
      entry: ['cli/index.ts', 'core/index.ts'],
      formats: ['es'],
    },
    minify: true,
  },
  plugins: [
    dts({
      include: ['cli', 'core', 'types'],
      insertTypesEntry: true,
      copyDtsFiles: true,
      strictOutput: true,
    }),
  ],
})
