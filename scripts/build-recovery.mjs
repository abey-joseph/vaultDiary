// Builds recovery/recovery.html: one self-contained file with all JavaScript and the Argon2 wasm
// inlined, and a CSP that forbids every network request (default-src 'none').
//   node scripts/build-recovery.mjs [--copy-to dist]
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const rawText = {
  name: 'raw-text',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: new URL(args.path.replace(/\?raw$/, ''), `file://${args.resolveDir}/`).pathname,
      namespace: 'raw',
    }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text',
    }))
  },
}

const result = await build({
  entryPoints: ['src/recovery/recovery-main.ts'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2022',
  write: false,
  legalComments: 'none',
  plugins: [rawText],
})
// Escape "</script" so the inline script can't terminate early.
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const style = readFileSync('src/recovery/recovery.css', 'utf8').trim()
const template = readFileSync('src/recovery/recovery.template.html', 'utf8')
const assembled = template.replace('%STYLE%', () => style).replace('%SCRIPT%', () => script)

// Hash exactly what ends up between the tags (including any whitespace from the template).
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`
const inner = (tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(assembled)
  if (!m) throw new Error(`No <${tag}> in template`)
  return m[1]
}
const csp = [
  "default-src 'none'",
  `script-src ${sha(inner('script'))} 'wasm-unsafe-eval'`,
  `style-src ${sha(inner('style'))}`,
  'img-src blob: data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
const html = assembled.replace('%CSP%', csp)
writeFileSync('recovery/recovery.html', html)
console.log(`recovery/recovery.html: ${(html.length / 1024).toFixed(0)} KiB`)

const copyTo = process.argv.indexOf('--copy-to')
if (copyTo > 0) {
  const dir = process.argv[copyTo + 1]
  copyFileSync('recovery/recovery.html', `${dir}/recovery.html`)
  console.log(`copied to ${dir}/recovery.html`)
}
