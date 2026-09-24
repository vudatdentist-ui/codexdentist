const namedEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function headingText(html) {
  const markup = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
  // Strip markup first so encoded angle brackets remain visible heading text.
  return markup.replace(/<[^>]+>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key) => {
    if (!key.startsWith('#')) return namedEntities[key.toLowerCase()];
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  }).trim();
}
