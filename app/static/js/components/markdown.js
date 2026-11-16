// components/markdown.js — Safe, lightweight client-side Markdown renderer for JDs & Notes.
// Zero dependencies, strict HTML escaping, XSS-safe tag generation, and skill keyword highlighting.

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return '#';
}

export function renderMarkdown(rawMd = '', highlightTerm = null) {
  if (!rawMd || !rawMd.trim()) {
    return '';
  }

  // 1. Normalize line breaks
  let text = rawMd.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. Extract code blocks so markdown rules don't mutate them
  const codeBlocks = [];
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
    const token = `%%CODE_BLOCK_${codeBlocks.length}%%`;
    const escapedCode = escapeHtml(code);
    codeBlocks.push(
      `<pre class="md-code-block"><code class="mono-code">${escapedCode}</code></pre>`,
    );
    return token;
  });

  // 3. Escape all remaining raw HTML to prevent XSS
  text = escapeHtml(text);

  // 4. Extract inline code
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (match, code) => {
    const token = `%%INLINE_CODE_${inlineCodes.length}%%`;
    inlineCodes.push(`<code class="md-code-inline">${code}</code>`);
    return token;
  });

  // Helper for inline markdown formatting
  function formatInline(str) {
    // Bold: **text** or __text__
    str = str.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    str = str.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    str = str.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    str = str.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    str = str.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Links: [label](url)
    str = str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
      const safeUrl = sanitizeUrl(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${label}</a>`;
    });

    // Skill highlighting if requested
    if (highlightTerm) {
      const escapedTerm = highlightTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const termRegex = new RegExp(`(\\b${escapedTerm}\\b)`, 'gi');
      str = str.replace(termRegex, '<mark class="jd-highlight">$1</mark>');
    }

    return str;
  }

  // 5. Parse line-by-line block structures
  const lines = text.split('\n');
  const output = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Restore Code Block token if line matches
    if (line.includes('%%CODE_BLOCK_')) {
      if (inUl) { output.push('</ul>'); inUl = false; }
      if (inOl) { output.push('</ol>'); inOl = false; }
      output.push(line);
      continue;
    }

    // Horizontal Rule: --- or *** or ___
    if (/^(---|___|\*\*\*)\s*$/.test(line)) {
      if (inUl) { output.push('</ul>'); inUl = false; }
      if (inOl) { output.push('</ol>'); inOl = false; }
      output.push('<hr class="md-hr" />');
      continue;
    }

    // Headings: #, ##, ###, ####
    const h1 = line.match(/^#\s+(.*)$/);
    const h2 = line.match(/^##\s+(.*)$/);
    const h3 = line.match(/^###\s+(.*)$/);
    const h4 = line.match(/^####\s+(.*)$/);

    if (h1 || h2 || h3 || h4) {
      if (inUl) { output.push('</ul>'); inUl = false; }
      if (inOl) { output.push('</ol>'); inOl = false; }
      if (h1) output.push(`<h3 class="md-h1">${formatInline(h1[1])}</h3>`);
      else if (h2) output.push(`<h4 class="md-h2">${formatInline(h2[1])}</h4>`);
      else if (h3) output.push(`<h5 class="md-h3">${formatInline(h3[1])}</h5>`);
      else output.push(`<h6 class="md-h4">${formatInline(h4[1])}</h6>`);
      continue;
    }

    // Blockquote: > text or &gt; text
    const bq = line.match(/^(&gt;|>)\s+(.*)$/);
    if (bq) {
      if (inUl) { output.push('</ul>'); inUl = false; }
      if (inOl) { output.push('</ol>'); inOl = false; }
      output.push(`<blockquote class="md-blockquote">${formatInline(bq[2])}</blockquote>`);
      continue;
    }

    // Unordered List: - item, * item, + item
    const ulMatch = line.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (inOl) { output.push('</ol>'); inOl = false; }
      if (!inUl) { output.push('<ul class="md-ul">'); inUl = true; }
      output.push(`<li>${formatInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered List: 1. item, 2. item
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (inUl) { output.push('</ul>'); inUl = false; }
      if (!inOl) { output.push('<ol class="md-ol">'); inOl = true; }
      output.push(`<li>${formatInline(olMatch[1])}</li>`);
      continue;
    }

    // Empty blank line
    if (!line.trim()) {
      if (inUl) { output.push('</ul>'); inUl = false; }
      if (inOl) { output.push('</ol>'); inOl = false; }
      output.push('');
      continue;
    }

    // Normal paragraph line
    if (inUl) { output.push('</ul>'); inUl = false; }
    if (inOl) { output.push('</ol>'); inOl = false; }
    output.push(`<p class="md-p">${formatInline(line)}</p>`);
  }

  if (inUl) output.push('</ul>');
  if (inOl) output.push('</ol>');

  let result = output.join('\n');

  // 6. Restore codeblocks and inline code tokens
  result = result.replace(/%%CODE_BLOCK_(\d+)%%/g, (m, idx) => codeBlocks[idx] || '');
  result = result.replace(/%%INLINE_CODE_(\d+)%%/g, (m, idx) => inlineCodes[idx] || '');

  return result;
}
