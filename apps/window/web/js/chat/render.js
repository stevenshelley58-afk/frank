/* Shared rendering helpers for the Hub chat modules.
   Moved verbatim from app.js so the chat modules and the rest of the
   window share one markdown/escape implementation. */

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

const DT = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export function fmtDate(sec) { try { return DT.format(new Date(sec * 1000)); } catch { return ""; } }

const TM = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit" });
export function fmtTime(sec) { try { return TM.format(new Date(sec * 1000)); } catch { return ""; } }

export function safeUrl(raw) {
  const base = globalThis.location?.href || "http://localhost/";
  const origin = globalThis.location?.origin || "http://localhost";
  try {
    const url = new URL(String(raw).trim(), base);
    return ["http:", "https:", "mailto:"].includes(url.protocol) || url.origin === origin ? url.href : "";
  } catch { return ""; }
}

export function inlineMd(source) {
  const tokens = [];
  const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = String(source)
    .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (_, alt, raw) => {
      const url = safeUrl(raw);
      return url ? hold(`<button type="button" class="md-image" data-preview-url="${escapeHtml(url)}" aria-label="Preview ${escapeHtml(alt || "image")}"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy"></button>`) : escapeHtml(alt);
    })
    .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (_, label, raw) => {
      const url = safeUrl(raw);
      return url ? hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`) : escapeHtml(label);
    });
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || "");
}

export function renderMd(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      const language = fence[1].trim() || "code";
      out.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(language)}</span><button type="button" data-copy-code>Copy</button></div><pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { const level = heading[1].length; out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`); i += 1; continue; }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inlineMd(quote.join("<br>"))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(`<li>${inlineMd(lines[i++].replace(/^\s*[-*+]\s+/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(`<li>${inlineMd(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((cell) => `<th>${inlineMd(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMd(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*```|^#{1,4}\s|^\s*>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[i])) paragraph.push(lines[i++]);
    out.push(`<p>${paragraph.map(inlineMd).join("<br>")}</p>`);
  }
  return out.join("");
}
