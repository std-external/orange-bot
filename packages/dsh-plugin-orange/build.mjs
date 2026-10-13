// Build: node half (ESM, dsh packages resolved from the dsh install at runtime)
// and browser half (CJS factory registered through window.__ModuleLoader__).
// The browser half resolves react / dsh primitives from the shell's module table;
// lucide-react is bundled. CSS modules are injected as one style tag.
import { build } from 'esbuild'

await build({
  entryPoints: { index: 'src/index.ts', tools: 'src/tools-plugin.ts' },
  outdir: 'lib',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/*', 'ws', 'yaml', '@satorijs/element', 'node:*'],
  sourcemap: true,
  logLevel: 'info',
})

const id = 'dsh-plugin-orange'
const result = await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  loader: { '.module.css': 'local-css' },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})
const { writeFile } = await import('node:fs/promises')
const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text
const cssText = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? ''
const inject = `(()=>{if(typeof document==='undefined'||document.querySelector('style[data-plugin="${id}"]'))return;const s=document.createElement('style');s.dataset.plugin=${JSON.stringify(id)};s.textContent=${JSON.stringify(cssText)};document.head.appendChild(s)})();`
await writeFile('lib/client.js', `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n${inject}\n${js}\nreturn module.exports; } });\n`)
console.log(`client.js ${(js.length / 1024).toFixed(1)}kb, css ${(cssText.length / 1024).toFixed(1)}kb`)
