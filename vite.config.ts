import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import path from 'node:path'

/**
 * Give every relative import of a declaration file a `.js` extension.
 *
 * The package is an ES module, so TypeScript resolves its declarations the way
 * Node.js resolves modules under `node16` and `nodenext`: a relative import
 * without an extension does not resolve, and the types it names silently turn
 * into `any` for the consumer.
 *
 * @param content - Emitted declaration file.
 * @returns Declaration file whose relative imports name their files.
 */
function addDeclarationExtensions(content: string): string {
  return content.replaceAll(
    /(?<=\b(?:from\s+|import\s*\(\s*))(?<quote>["'])(?<specifier>\.{1,2}\/[^"']+)(?<!\.js)\k<quote>/gu,
    '$<quote>$<specifier>.js$<quote>',
  )
}

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
      experimental: {
        attachDebugInfo: 'none',
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
      beforeWriteFile: (_filePath, content) => ({
        content: addDeclarationExtensions(content),
      }),
      include: ['core', 'types'],
      insertTypesEntry: true,
      copyDtsFiles: true,
      strictOutput: true,
      entryRoot: '.',
    }),
  ],
})
