import DOMPurify from 'dompurify'
import { marked } from 'marked'

let hooked = false

/** Markdown → sanitised HTML. Remote images and embeds are stripped (no network requests). */
export function renderMarkdown(markdown: string): string {
  if (!hooked) {
    hooked = true
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      }
    })
  }
  const html = marked.parse(markdown, { gfm: true, breaks: true, async: false })
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'source'],
    FORBID_ATTR: ['style', 'srcset'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  })
}
