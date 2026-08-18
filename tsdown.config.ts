import { defineConfig } from 'tsdown'

/**
 * Host plugin bundle (lib/index.js) and the web client bundle
 * (lib/client.js). Peer dependencies are external; `zod` stays bundled-free
 * as a regular dependency. The client bundle targets the browser module
 * graph the client-modules node half serves at /plugins/dsh-ultra/client.js.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    platform: 'node',
    format: 'esm',
    dts: { sourcemap: true },
    outExtensions: () => ({ js: '.js' }),
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    platform: 'browser',
    format: 'esm',
    dts: { sourcemap: true },
    outExtensions: () => ({ js: '.js' }),
  },
])
