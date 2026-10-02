// Self-contained basic-reading preview, intentionally disconnected from the AI service.
export function previewHTML({ html, css, app, data, engine, daily, dailyClient }) {
  const strip = source => source.replace(/^import\s[\s\S]*?;\s*\n/gm, '')
    .replace(/^export \{[^}]+\};?\n/gm, '').replace(/^export /gm, '');
  const client = strip(app);
  const configStart = client.lastIndexOf("fetch('/api/config')");
  if (configStart < 0) throw new Error('Preview configuration boundary not found');
  const code = [strip(data), strip(engine), strip(daily), strip(dailyClient),
    client.slice(0, configStart), 'state.aiEnabled = false;'].join('\n');
  if (code.includes('</script')) throw new Error('Unexpected closing script tag');
  return html.replace('<link rel="stylesheet" href="/styles.css">', '<style>' + css + '</style>')
    .replace('  <link rel="icon" type="image/svg+xml" href="/favicon.svg">\n', '')
    .replace('<script type="module" src="/app.js"></script>', '<script type="module">' + code + '</script>');
}
