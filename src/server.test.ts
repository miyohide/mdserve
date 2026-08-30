// server.ts の統合テストと resolveSafePath のユニットテスト
// 実際にサーバーを起動し、一時ディレクトリを公開して fetch で検証する。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createServer, resolveSafePath } from "./server.js";

// --- resolveSafePath のユニットテスト ---

test("resolveSafePath: ルート直下のパスを解決する", () => {
  const root = path.resolve("/tmp/root");
  const resolved = resolveSafePath(root, "/file.md");
  assert.equal(resolved, path.join(root, "file.md"));
});

test("resolveSafePath: ルート自身（/）を解決する", () => {
  const root = path.resolve("/tmp/root");
  const resolved = resolveSafePath(root, "/");
  assert.equal(resolved, root);
});

test("resolveSafePath: サブディレクトリを解決する", () => {
  const root = path.resolve("/tmp/root");
  const resolved = resolveSafePath(root, "/sub/page.md");
  assert.equal(resolved, path.join(root, "sub", "page.md"));
});

test("resolveSafePath: 範囲外への脱出（..）は null を返す", () => {
  const root = path.resolve("/tmp/root");
  assert.equal(resolveSafePath(root, "/../secret.txt"), null);
  assert.equal(resolveSafePath(root, "/../../etc/passwd"), null);
});

test("resolveSafePath: root の兄弟ディレクトリへの脱出は null を返す", () => {
  // root と接頭辞が一致するが別ディレクトリ（例: /tmp/root-evil）を弾く
  const root = path.resolve("/tmp/root");
  const resolved = resolveSafePath(root, "/../root-evil/x");
  assert.equal(resolved, null);
});

// --- サーバー統合テスト ---

let server: Server;
let baseUrl: string;
let tmpDir: string;

before(async () => {
  // 一時ディレクトリを作成しテスト用ファイルを配置
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdserve-test-"));
  await fs.writeFile(
    path.join(tmpDir, "README.md"),
    "# トップページ\n\nようこそ。",
    "utf-8"
  );
  await fs.writeFile(
    path.join(tmpDir, "doc.md"),
    "# ドキュメント\n\n本文です。",
    "utf-8"
  );
  await fs.writeFile(path.join(tmpDir, "style.css"), "body { color: red; }", "utf-8");
  await fs.mkdir(path.join(tmpDir, "sub"));
  await fs.writeFile(
    path.join(tmpDir, "sub", "page.md"),
    "# サブページ",
    "utf-8"
  );
  // index も README も無いディレクトリ（一覧表示の確認用）
  await fs.mkdir(path.join(tmpDir, "empty-index"));
  await fs.writeFile(path.join(tmpDir, "empty-index", "a.md"), "# A", "utf-8");

  server = createServer({ root: tmpDir, port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("ルートは README.md を index として表示する", async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const body = await res.text();
  assert.match(body, /<h1[^>]*>トップページ<\/h1>/);
});

test("Markdownファイルを直接指定するとHTMLで返る", async () => {
  const res = await fetch(`${baseUrl}/doc.md`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1[^>]*>ドキュメント<\/h1>/);
  assert.match(body, /本文です。/);
});

test("index も README も無いディレクトリは一覧を表示する", async () => {
  const res = await fetch(`${baseUrl}/empty-index/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /mdserve-list/);
  assert.match(body, /a\.md/);
  // 親へ戻るリンクがある
  assert.match(body, />\.\.</);
});

test("サブディレクトリのMarkdownを表示する", async () => {
  const res = await fetch(`${baseUrl}/sub/page.md`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<h1[^>]*>サブページ<\/h1>/);
});

test("静的ファイル（CSS）は適切なMIMEタイプで返る", async () => {
  const res = await fetch(`${baseUrl}/style.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/css/);
  const body = await res.text();
  assert.match(body, /color: red/);
});

test("存在しないパスは404を返す", async () => {
  const res = await fetch(`${baseUrl}/notfound.md`);
  assert.equal(res.status, 404);
});

test("パストラバーサルは403を返す", async () => {
  // 生の ../ を送るため URL を手組みする（fetch は正規化するため
  // エンコード済みの %2e%2e%2f を使う）
  const res = await fetch(`${baseUrl}/%2e%2e%2fpackage.json`);
  assert.equal(res.status, 403);
});

test("GET/HEAD以外のメソッドは405を返す", async () => {
  const res = await fetch(`${baseUrl}/doc.md`, { method: "POST" });
  assert.equal(res.status, 405);
});

test("HEADリクエストはボディなしで200を返す", async () => {
  const res = await fetch(`${baseUrl}/style.css`, { method: "HEAD" });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, "");
});
