// Self-contained basic-reading preview, intentionally disconnected from the AI service.
export function previewHTML({ html, css, app, data, engine }) {
  const strip = source => source.replace(/^import .*;\n/gm, '').replace(/^export \{[^}]+\};?\n/gm, '').replace(/^export /gm, '');
  const client = app.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*/, '');
  const configStart = client.lastIndexOf("fetch('/api/config')");
  if (configStart < 0) throw new Error('Preview configuration boundary not found');
  const code = strip(data) + '\n' + strip(engine) + '\n' + client.slice(0, configStart) + '\nstate.aiEnabled = false;\n';
  if (code.includes('</script')) throw new Error('Unexpected closing script tag');
  return html.replace('<link rel="stylesheet" href="/styles.css">', '<style>' + css + '</style>')
    .replace('  <link rel="icon" type="image/svg+xml" href="/favicon.svg">\n', '')
    .replace('<script type="module" src="/app.js"></script>', '<script type="module">' + code + '</script>');
}
