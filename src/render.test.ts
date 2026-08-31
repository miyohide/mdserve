// render.ts のユニットテスト

import { test } from "node:test";
import assert from "node:assert/strict";

import { markdownToHtml, escapeHtml, renderPage } from "./render.js";

test("見出しをHTMLに変換する", async () => {
  const html = await markdownToHtml("# タイトル");
  assert.match(html, /<h1[^>]*>タイトル<\/h1>/);
});

test("強調をHTMLに変換する", async () => {
  const html = await markdownToHtml("**太字** と *斜体*");
  assert.match(html, /<strong>太字<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
});

test("コードブロックをHTMLに変換する", async () => {
  const html = await markdownToHtml("```\nconst a = 1;\n```");
  assert.match(html, /<pre><code/);
  assert.match(html, /const a = 1;/);
});

test("表（GFM）をHTMLに変換する", async () => {
  const md = "| 列1 | 列2 |\n| --- | --- |\n| a | b |";
  const html = await markdownToHtml(md);
  assert.match(html, /<table>/);
  assert.match(html, /<th>列1<\/th>/);
});

test("リンクをHTMLに変換する（新しいタブで開く）", async () => {
  const html = await markdownToHtml("[リンク](./page.md)");
  assert.match(html, /<a href="\.\/page\.md"[^>]*>リンク<\/a>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("escapeHtml は特殊文字をエスケープする", () => {
  assert.equal(
    escapeHtml(`<script>alert("x")&'`),
    "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;"
  );
});

test("escapeHtml は通常の文字列を変えない", () => {
  assert.equal(escapeHtml("こんにちは world"), "こんにちは world");
});

test("renderPage は完全なHTMLドキュメントを生成する", () => {
  const html = renderPage("テスト", "<h1>本文</h1>");
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<title>テスト<\/title>/);
  assert.match(html, /<h1>本文<\/h1>/);
});

test("renderPage はタイトルをエスケープする", () => {
  const html = renderPage("<x>", "本文");
  assert.match(html, /<title>&lt;x&gt;<\/title>/);
});

test("renderPage はパンくずを指定するとヘッダーを含む", () => {
  const html = renderPage("t", "b", "<a>パンくず</a>");
  assert.match(html, /class="mdserve-header"/);
  assert.match(html, /パンくず/);
});

test("renderPage はパンくず未指定ならヘッダーを含まない", () => {
  const html = renderPage("t", "b");
  assert.doesNotMatch(html, /class="mdserve-header"/);
});
