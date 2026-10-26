// UI of recovery.html: a single offline file. No network access is possible (its CSP has
// default-src 'none'); everything happens in this page.
import {
  collect,
  decryptAll,
  outputsToZip,
  unlock,
  type Collected,
  type InputFile,
  type RecoveryResult,
} from './core'

type Child = Node | string | null | undefined | false

function h(
  tag: string,
  attrs: Record<string, string | boolean> = {},
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue
    el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children) if (c) el.append(c)
  return el
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let inputs: InputFile[] = []
let collected: Collected | null = null
let result: RecoveryResult | null = null
const urls: string[] = []

function link(blob: Blob, name: string, label: string): HTMLElement {
  const url = URL.createObjectURL(blob)
  urls.push(url)
  return h('a', { href: url, download: name }, label)
}

function setStatus(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
  const el = $('status')
  el.textContent = text
  el.className = `status ${kind}`
}

async function addFiles(list: File[]) {
  if (!list.length) return
  for (const f of list) {
    inputs.push({ path: f.webkitRelativePath || f.name, blob: f })
  }
  setStatus('Reading files…')
  collected = await collect(inputs)
  const entries = collected.containers.filter((c) => c.header.kind === 'entry').length
  const files = collected.containers.filter((c) => c.header.kind === 'file').length
  const summary = `${inputs.length} file(s) selected · vault.json: ${collected.vaults.length ? 'found' : 'NOT FOUND'} · ${entries} entries · ${files} attachments`
  $('selection').textContent = summary
  setStatus(
    collected.vaults.length
      ? 'Ready. Enter your passphrase or recovery words.'
      : 'No vault.json found yet. Add the VaultDiary folder or zip that contains it.',
    collected.vaults.length ? 'ok' : 'error',
  )
  $<HTMLButtonElement>('decrypt').disabled = !collected.vaults.length
}

function renderResult(r: RecoveryResult) {
  const out = $('results')
  out.replaceChildren()
  out.append(
    h(
      'h2',
      {},
      `Recovered ${r.entries.length} entries and ${r.outputs.length - r.entries.length} files`,
    ),
  )
  const all = h('button', { type: 'button', class: 'primary' }, 'Download everything (.zip)')
  all.addEventListener('click', async () => {
    all.textContent = 'Preparing zip…'
    const zip = await outputsToZip(r.outputs)
    const a = link(zip, 'VaultDiary-recovered.zip', 'save')
    a.click()
    all.textContent = 'Download everything (.zip)'
  })
  out.append(all)
  if (r.problems.length) {
    out.append(
      h(
        'div',
        { class: 'status error' },
        h('strong', {}, `${r.problems.length} problem(s):`),
        h('ul', {}, ...r.problems.map((p) => h('li', {}, p))),
      ),
    )
  }
  const byPath = new Map(r.outputs.map((o) => [o.path, o]))
  const days = new Map<string, HTMLElement>()
  for (const o of r.outputs) {
    const m = /^entries\/(\d{4}-\d{2}-\d{2})\//.exec(o.path)
    if (!m) continue
    let list = days.get(m[1])
    if (!list) {
      list = h('ul')
      days.set(m[1], list)
      out.append(h('h3', {}, m[1]), list)
    }
    const name = o.path.split('/').pop()!
    list.append(h('li', {}, link(o.blob, name, name)))
  }
  const files = r.outputs.filter((o) => o.path.startsWith('files/'))
  if (files.length) {
    out.append(h('h3', {}, 'Attachments'))
    out.append(
      h(
        'ul',
        {},
        ...files.map((o) =>
          h(
            'li',
            {},
            link(
              byPath.get(o.path)!.blob,
              o.path.slice(6).replace(/^[0-9a-f]{8}-/, ''),
              o.path.slice(6),
            ),
          ),
        ),
      ),
    )
  }
}

async function decrypt() {
  if (!collected) return
  const mode = ($<HTMLInputElement>('mode-words').checked ? 'words' : 'passphrase') as
    'words' | 'passphrase'
  const secret = $<HTMLInputElement | HTMLTextAreaElement>(
    mode === 'words' ? 'words' : 'passphrase',
  ).value
  const button = $<HTMLButtonElement>('decrypt')
  button.disabled = true
  try {
    setStatus(
      mode === 'words'
        ? 'Checking recovery words…'
        : 'Checking passphrase (this takes a few seconds)…',
    )
    const mk = await unlock(
      collected,
      mode === 'words' ? { words: secret } : { passphrase: secret },
    )
    for (const u of urls.splice(0)) URL.revokeObjectURL(u)
    result = await decryptAll(mk, collected, (done, total) =>
      setStatus(`Decrypting ${done} of ${total}…`),
    )
    renderResult(result)
    setStatus(
      result.problems.length
        ? 'Done, with problems (listed below).'
        : 'Done. Everything decrypted.',
      result.problems.length ? 'error' : 'ok',
    )
  } catch (e) {
    setStatus((e as Error).message, 'error')
  } finally {
    button.disabled = false
  }
}

function init() {
  for (const id of ['pick-zip', 'pick-folder']) {
    $(id).addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement
      const files = input.files ? [...input.files] : []
      input.value = '' // so choosing the same file again still fires "change"
      void addFiles(files)
    })
  }
  $('clear').addEventListener('click', () => {
    inputs = []
    collected = null
    $('selection').textContent = 'Nothing selected yet.'
    $('results').replaceChildren()
    $<HTMLButtonElement>('decrypt').disabled = true
    setStatus('')
  })
  const sync = () => {
    const words = $<HTMLInputElement>('mode-words').checked
    $('passphrase-field').hidden = words
    $('words-field').hidden = !words
  }
  $('mode-pass').addEventListener('change', sync)
  $('mode-words').addEventListener('change', sync)
  $('form').addEventListener('submit', (e) => {
    e.preventDefault()
    void decrypt()
  })
  sync()
}

init()
