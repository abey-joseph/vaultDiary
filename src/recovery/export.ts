// Plain-text export layout shared by recovery.html. recover.py implements the same rules and a
// test checks both produce byte-identical files from the committed fixture.
import { displayTitle, type Entry } from '../model/entry'

export function slugify(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .toLowerCase()
  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
  return slug || 'untitled'
}

export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '')
  const limited = Array.from(cleaned).slice(0, 120).join('')
  return limited || 'file'
}

export function entryPath(e: Entry): string {
  return `entries/${e.date}/${slugify(displayTitle(e))}-${e.id.slice(0, 8)}.md`
}

export function attachmentPath(fileId: string, name: string): string {
  return `files/${fileId.slice(0, 8)}-${safeFileName(name)}`
}

export function orphanPath(fileId: string): string {
  return `files/${fileId.slice(0, 8)}-unreferenced.bin`
}

export function entryToMarkdown(e: Entry, available: (fileId: string) => boolean): string {
  const lines = [
    '---',
    `id: ${e.id}`,
    `date: ${e.date}`,
    `title: ${JSON.stringify(e.title)}`,
    `created: ${e.createdAt}`,
    `updated: ${e.updatedAt}`,
    `mood: ${e.mood ?? 'null'}`,
    `tags: ${JSON.stringify(e.tags)}`,
    '---',
    '',
    `# ${displayTitle(e)}`,
    '',
  ]
  if (e.body) lines.push(e.body.replace(/\r\n/g, '\n'), '')
  if (e.attachments.length) {
    lines.push('## Attachments', '')
    for (const a of e.attachments) {
      const note = available(a.fileId) ? `${a.size} bytes` : 'missing from this copy'
      lines.push(
        `- [${a.name.replace(/[[\]]/g, '')}](<../../${attachmentPath(a.fileId, a.name)}>) (${note})`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}
