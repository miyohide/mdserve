// MarkdownのHTML変換と、ページ全体のHTMLテンプレート生成を担当するモジュール

import { marked } from "marked";

// marked の基本設定
// - gfm: GitHub Flavored Markdown を有効化
// - breaks: 改行を <br> に変換
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Markdown文字列をHTML本文（body内）に変換する。
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  return marked.parse(markdown);
}

/**
 * HTMLの特殊文字をエスケープする。
 * ディレクトリ名やファイル名をHTMLに埋め込む際のXSS対策。
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** ページ全体のスタイル（GitHub風の読みやすい見た目） */
const PAGE_STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN",
    "Yu Gothic", Meiryo, sans-serif;
  line-height: 1.7;
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
  color: #24292f;
  background: #ffffff;
}
@media (prefers-color-scheme: dark) {
  body { color: #c9d1d9; background: #0d1117; }
  a { color: #58a6ff; }
  code { background: rgba(110,118,129,0.4); }
  pre { background: #161b22; }
  hr { border-color: #30363d; }
  table th, table td { border-color: #30363d; }
  .mdserve-header { border-color: #30363d; }
}
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
h1, h2, h3, h4 { line-height: 1.3; margin-top: 1.8rem; }
h1 { border-bottom: 1px solid #d0d7de; padding-bottom: 0.3rem; }
h2 { border-bottom: 1px solid #d0d7de; padding-bottom: 0.3rem; }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  background: rgba(175,184,193,0.2);
  padding: 0.2em 0.4em;
  border-radius: 6px;
  font-size: 85%;
}
pre { padding: 1rem; overflow: auto; border-radius: 6px; background: #f6f8fa; }
pre code { background: none; padding: 0; font-size: 100%; }
blockquote {
  margin: 0; padding: 0 1rem; color: #656d76;
  border-left: 0.25rem solid #d0d7de;
}
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
table th, table td { border: 1px solid #d0d7de; padding: 0.4rem 0.8rem; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 1.5rem 0; }
.mdserve-header {
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.9rem; margin-bottom: 1.5rem; padding-bottom: 0.8rem;
  border-bottom: 1px solid #d0d7de;
}
.mdserve-header a { color: inherit; opacity: 0.8; }
.mdserve-list { list-style: none; padding: 0; }
.mdserve-list li { padding: 0.3rem 0; }
.mdserve-list .icon { display: inline-block; width: 1.5rem; }
`;

/**
 * body内のHTMLを、完全なHTMLドキュメントに包む。
 * @param title  ページタイトル（<title> と表示に使用）
 * @param bodyHtml  bodyに埋め込むHTML
 * @param breadcrumb  パンくずリスト用のHTML（省略可）
 */
export function renderPage(
  title: string,
  bodyHtml: string,
  breadcrumb?: string
): string {
  const header = breadcrumb
    ? `<div class="mdserve-header">${breadcrumb}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${header}
${bodyHtml}
</body>
</html>`;
}
