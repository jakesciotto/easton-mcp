import type { Consent } from './provider.js'

const SCOPE_TEXT: Record<string, string> = {
  'leaderboard:read': 'Read competitors, results and rankings',
  'docs:read': 'Read the registered Easton documents',
  'leaderboard:write': 'File data issue reports',
  'docs:write': 'Add comments and rows to registered documents',
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

export function consentPage(consent: Consent, clientName: string, consentToken: string): string {
  const host = new URL(consent.redirectUri).host
  const items = consent.scopes
    .map(s => `<li>${escape(SCOPE_TEXT[s] ?? s)}</li>`)
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Easton MCP</title>
<style>
:root { color-scheme: light dark; --fg: #111; --muted: #666; --line: #ddd; --bg: #fff; }
@media (prefers-color-scheme: dark) { :root { --fg: #eee; --muted: #999; --line: #333; --bg: #0a0a0a; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 420px; margin: 10vh auto; padding: 0 16px; }
h1 { font-size: 18px; margin: 0 0 4px; }
p { margin: 0 0 16px; color: var(--muted); }
ul { padding-left: 20px; margin: 0 0 24px; }
code { font-family: ui-monospace, monospace; font-size: 13px; }
.row { display: flex; gap: 8px; }
button { flex: 1; padding: 10px 14px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--fg); font: inherit; cursor: pointer; }
button.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); }
</style>
</head>
<body>
<main>
<h1>Allow ${escape(clientName)}?</h1>
<p>Signed in as <code>${escape(consent.subject)}</code>. After you allow, the browser returns to <code>${escape(host)}</code>.</p>
<ul>${items}</ul>
<form method="post" action="/oauth/consent" class="row">
<input type="hidden" name="consent" value="${escape(consentToken)}">
<button type="submit" name="decision" value="deny">Deny</button>
<button type="submit" name="decision" value="allow" class="primary">Allow</button>
</form>
</main>
</body>
</html>`
}
