// HTTPサーバー本体。リクエストを受け取り、ディレクトリ一覧・Markdownレンダリング・
// 静的ファイル配信を振り分ける。

import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

import { markdownToHtml, renderPage, escapeHtml } from "./render.js";

/** 拡張子ごとのMIMEタイプ */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** Markdownとして扱う拡張子 */
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);

export interface ServerConfig {
  root: string;
  port: number;
  host: string;
}

/**
 * HTTPサーバーを生成して返す。呼び出し側で listen する。
 */
export function createServer(config: ServerConfig): http.Server {
  return http.createServer((req, res) => {
    // 非同期処理をラップし、想定外エラーを500として返す
    handleRequest(req, res, config).catch((err) => {
      console.error("リクエスト処理中にエラーが発生しました:", err);
      if (!res.headersSent) {
        sendError(res, 500, "サーバー内部エラーが発生しました");
      } else {
        res.end();
      }
    });
  });
}

/** リクエスト1件の処理 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ServerConfig
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendError(res, 405, "許可されていないメソッドです");
    return;
  }

  // URLをデコードし、クエリ文字列を除去する
  const rawUrl = req.url ?? "/";
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
  } catch {
    sendError(res, 400, "不正なURLです");
    return;
  }

  // ルート配下の絶対パスへ解決し、パストラバーサルを防ぐ
  const resolved = resolveSafePath(config.root, pathname);
  if (resolved === null) {
    sendError(res, 403, "アクセスが許可されていません");
    return;
  }

  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(resolved);
  } catch {
    sendError(res, 404, "ファイルまたはディレクトリが見つかりません");
    return;
  }

  if (stat.isDirectory()) {
    await serveDirectory(res, config.root, resolved, pathname);
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    await serveMarkdown(res, config.root, resolved, pathname);
    return;
  }

  // その他は静的ファイルとして配信
  serveStaticFile(res, resolved, ext, req.method === "HEAD");
}

/**
 * ルートディレクトリ配下に収まる安全な絶対パスを返す。
 * 範囲外へ抜け出そうとした場合は null を返す。
 * （テストから参照するためエクスポートする）
 */
export function resolveSafePath(root: string, pathname: string): string | null {
  // 先頭スラッシュを除去して相対パス化してから解決
  const relative = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);

  // root自身、またはroot配下であることを確認する
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}

/** ディレクトリの内容を一覧HTMLとして返す */
async function serveDirectory(
  res: http.ServerResponse,
  root: string,
  dirPath: string,
  urlPath: string
): Promise<void> {
  // index.md / README.md があればそれを表示する
  const indexCandidates = ["index.md", "README.md", "readme.md"];
  for (const name of indexCandidates) {
    const candidate = path.join(dirPath, name);
    try {
      const s = await fs.stat(candidate);
      if (s.isFile()) {
        const joinedUrl = joinUrl(urlPath, name);
        await serveMarkdown(res, root, candidate, joinedUrl);
        return;
      }
    } catch {
      // 候補が無ければ次へ
    }
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  // ディレクトリを先に、次にファイルを名前順で並べる
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "ja"));
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "ja"));

  const items: string[] = [];

  // 親ディレクトリへのリンク（ルート以外）
  if (urlPath !== "/" && urlPath !== "") {
    const parent = joinUrl(urlPath, "..");
    items.push(
      `<li><span class="icon">↩</span><a href="${escapeAttr(parent)}">..</a></li>`
    );
  }

  for (const name of dirs) {
    const href = joinUrl(urlPath, name) + "/";
    items.push(
      `<li><span class="icon">📁</span><a href="${escapeAttr(href)}">${escapeHtml(name)}/</a></li>`
    );
  }
  for (const name of files) {
    const href = joinUrl(urlPath, name);
    const ext = path.extname(name).toLowerCase();
    const icon = MARKDOWN_EXTENSIONS.has(ext) ? "📄" : "📎";
    items.push(
      `<li><span class="icon">${icon}</span><a href="${escapeAttr(href)}">${escapeHtml(name)}</a></li>`
    );
  }

  const displayPath = urlPath === "" ? "/" : urlPath;
  const body = `<h1>${escapeHtml(displayPath)}</h1>
<ul class="mdserve-list">
${items.join("\n")}
</ul>`;

  const html = renderPage(
    `${displayPath} - mdserve`,
    body,
    buildBreadcrumb(urlPath)
  );
  sendHtml(res, html);
}

/** Markdownファイルを読み込み、HTMLに変換して返す */
async function serveMarkdown(
  res: http.ServerResponse,
  root: string,
  filePath: string,
  urlPath: string
): Promise<void> {
  const markdown = await fs.readFile(filePath, "utf-8");
  const bodyHtml = await markdownToHtml(markdown);
  const title = path.basename(filePath);
  const html = renderPage(
    `${title} - mdserve`,
    bodyHtml,
    buildBreadcrumb(urlPath)
  );
  sendHtml(res, html);
}

/** 静的ファイルをストリームで配信する */
function serveStaticFile(
  res: http.ServerResponse,
  filePath: string,
  ext: string,
  headOnly: boolean
): void {
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  if (headOnly) {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      sendError(res, 500, "ファイルの読み込みに失敗しました");
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

/** パンくずリストのHTMLを組み立てる */
function buildBreadcrumb(urlPath: string): string {
  const parts = urlPath.split("/").filter((p) => p.length > 0);
  const crumbs: string[] = [`<a href="/">🏠 ルート</a>`];
  let acc = "";
  for (const part of parts) {
    acc += "/" + part;
    crumbs.push(`<a href="${escapeAttr(acc)}">${escapeHtml(part)}</a>`);
  }
  return crumbs.join(' <span style="opacity:0.5">/</span> ');
}

/**
 * URLパスの結合。相対セグメント（..）も正規化する。
 * OSに依存しないよう path.posix を用いる。
 */
function joinUrl(base: string, segment: string): string {
  const joined = path.posix.join(base || "/", segment);
  return joined;
}

/** HTML属性値用のエスケープ */
function escapeAttr(text: string): string {
  return escapeHtml(text);
}

/** HTMLレスポンスを送信する */
function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** エラーレスポンスを送信する */
function sendError(
  res: http.ServerResponse,
  status: number,
  message: string
): void {
  const html = renderPage(
    `${status} エラー - mdserve`,
    `<h1>${status}</h1><p>${escapeHtml(message)}</p><p><a href="/">ルートへ戻る</a></p>`
  );
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}
