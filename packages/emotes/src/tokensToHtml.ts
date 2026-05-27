import type { MessageToken } from '@overlive/core'

/**
 * Render parsed chat message tokens to an XSS-safe HTML string.
 *
 * The output is suitable for direct insertion into a chat overlay via
 * `innerHTML` or React's `dangerouslySetInnerHTML`. All user-supplied
 * strings are escaped; emote URLs and mention/url tokens go through the
 * same escape pipeline so even a maliciously crafted emote name can't
 * inject markup.
 *
 * Emit shape (mostly stable CSS classes you can style):
 *   text:    plain escaped text run
 *   mention: <span class="overlive-mention">@user</span>
 *   url:     <a class="overlive-url" href="..." rel="noreferrer">display</a>
 *   cheer:   <span class="overlive-cheer">123</span>
 *   emote:   <img class="overlive-emote" src="..." alt="name" title="name" />
 */
export function tokensToHtml(tokens: MessageToken[], fallbackText = ''): string {
  if (!tokens || tokens.length === 0) return esc(fallbackText)
  const parts: string[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        parts.push(esc(t.value))
        break
      case 'mention':
        parts.push(`<span class="overlive-mention">@${esc(t.username)}</span>`)
        break
      case 'url':
        parts.push(
          `<a class="overlive-url" href="${esc(t.href)}" rel="noreferrer">${esc(t.display)}</a>`,
        )
        break
      case 'cheer':
        parts.push(`<span class="overlive-cheer">${Number(t.amount) || 0}</span>`)
        break
      case 'emote': {
        const e = t.emote
        const url = e.urls?.x2 ?? e.urls?.x1 ?? ''
        if (!url) { parts.push(esc(e.name)); break }
        parts.push(
          `<img class="overlive-emote" src="${esc(url)}" alt="${esc(e.name)}" title="${esc(e.name)}" />`,
        )
        break
      }
    }
  }
  return parts.join(' ')
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!)
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
