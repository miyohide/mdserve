// livereload.ts のユニットテストと、サーバー経由のライブリロード統合テスト

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import {
  shouldIgnore,
  liveReloadClientScript,
  LIVERELOAD_PATH,
  LiveReload,
} from "./livereload.js";
import { createServer, ServerWithLiveReload } from "./server.js";

// --- shouldIgnore のユニットテスト ---

test("shouldIgnore: エディタの一時ファイルを除外する", () => {
  assert.equal(shouldIgnore("README.md~"), true);
  assert.equal(shouldIgnore(".README.md.swp"), true);
  assert.equal(shouldIgnore("doc.swx"), true);
  assert.equal(shouldIgnore("page.tmp"), true);
  assert.equal(shouldIgnore("#note.md#"), true);
  assert.equal(shouldIgnore(".#note.md"), true);
  assert.equal(shouldIgnore(".DS_Store"), true);
});

test("shouldIgnore: 通常のMarkdownは除外しない", () => {
  assert.equal(shouldIgnore("README.md"), false);
  assert.equal(shouldIgnore("sub/page.md"), false);
});

// --- クライアントスクリプトのユニットテスト ---

test("liveReloadClientScript: SSEエンドポイントとreload処理を含む", () => {
  const script = liveReloadClientScript();
  assert.match(script, /EventSource/);
  assert.match(script, /location\.reload/);
  // エンドポイントのパスが埋め込まれている
  assert.ok(script.includes(LIVERELOAD_PATH));
});

// --- LiveReload.isLiveReloadRequest のユニットテスト ---

test("isLiveReloadRequest: SSEパスのみ真", () => {
  assert.equal(LiveReload.isLiveReloadRequest(LIVERELOAD_PATH), true);
  assert.equal(LiveReload.isLiveReloadRequest("/README.md"), false);
});

// --- サーバー統合テスト（ライブリロード有効） ---

let server: ServerWithLiveReload;
let baseUrl: string;
let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdserve-live-test-"));
  await fs.writeFile(
    path.join(tmpDir, "README.md"),
    "# トップ\n\n本文",
    "utf-8"
  );

  server = createServer({
    root: tmpDir,
    port: 0,
    host: "127.0.0.1",
    live: true,
  }) as ServerWithLiveReload;
  server.liveReload?.start();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  server.liveReload?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("ライブリロード有効時、Markdownページにスクリプトが注入される", async () => {
  const res = await fetch(`${baseUrl}/README.md`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /EventSource/);
  assert.ok(body.includes(LIVERELOAD_PATH));
});

test("SSEエンドポイントは event-stream を返す", async () => {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}${LIVERELOAD_PATH}`, {
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("content-type") ?? "",
    /text\/event-stream/
  );
  // 接続を閉じてストリームを解放する
  controller.abort();
});

test("ファイル変更でSSEにreloadイベントが流れる", async () => {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}${LIVERELOAD_PATH}`, {
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  // 接続確立後にファイルを更新する
  const changePromise = (async () => {
    await new Promise((r) => setTimeout(r, 100));
    await fs.writeFile(
      path.join(tmpDir, "README.md"),
      "# 更新後\n\n新しい本文",
      "utf-8"
    );
  })();

  let received = "";
  let sawReload = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
    if (received.includes("event: reload")) {
      sawReload = true;
      break;
    }
  }
  await changePromise;
  controller.abort();

  assert.equal(sawReload, true, "reloadイベントを受信できなかった");
});
