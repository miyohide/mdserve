#!/usr/bin/env node
// CLIのエントリポイント。引数を解析してHTTPサーバーを起動する。

import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { parseArgs, helpText, CliArgumentError } from "./args.js";
import { createServer } from "./server.js";

const require = createRequire(import.meta.url);

/** package.json からバージョンを読み取る */
function getVersion(): string {
  try {
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** OSに応じてブラウザでURLを開く（Windows / macOS / Linux 対応） */
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "win32") {
    // Windows: start コマンド。第1引数はウィンドウタイトル用の空文字
    command = "cmd";
    args = ["/c", "start", "", url];
  } else if (platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {
      console.warn(`ブラウザの自動起動に失敗しました。手動で開いてください: ${url}`);
    });
    child.unref();
  } catch {
    console.warn(`ブラウザの自動起動に失敗しました。手動で開いてください: ${url}`);
  }
}

function main(): void {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliArgumentError) {
      console.error(`エラー: ${err.message}`);
      console.error('詳しい使い方は "mdserve --help" を実行してください。');
      process.exit(1);
    }
    throw err;
  }

  if (options.help) {
    console.log(helpText());
    return;
  }

  if (options.version) {
    console.log(`mdserve ${getVersion()}`);
    return;
  }

  // 公開対象ディレクトリの存在確認
  let stat: fs.Stats;
  try {
    stat = fs.statSync(options.root);
  } catch {
    console.error(`エラー: 指定されたディレクトリが見つかりません: ${options.root}`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error(`エラー: 指定されたパスはディレクトリではありません: ${options.root}`);
    process.exit(1);
  }

  const server = createServer({
    root: options.root,
    port: options.port,
    host: options.host,
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `エラー: ポート ${options.port} は既に使用されています。別のポートを指定してください（--port）。`
      );
    } else if (err.code === "EACCES") {
      console.error(
        `エラー: ポート ${options.port} を使用する権限がありません。1024以上のポートを試してください。`
      );
    } else {
      console.error(`サーバーの起動に失敗しました: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(options.port, options.host, () => {
    // 表示用URL。0.0.0.0 の場合は localhost で案内する
    const displayHost =
      options.host === "0.0.0.0" || options.host === "::"
        ? "localhost"
        : options.host;
    const url = `http://${displayHost}:${options.port}/`;
    console.log("mdserve を起動しました");
    console.log(`  公開ディレクトリ: ${options.root}`);
    console.log(`  URL: ${url}`);
    console.log("  終了するには Ctrl+C を押してください");

    if (options.open) {
      openBrowser(url);
    }
  });

  // Ctrl+C での終了を綺麗に処理する
  const shutdown = () => {
    console.log("\nmdserve を終了します");
    server.close(() => process.exit(0));
    // 一定時間で強制終了（接続が残っている場合の保険）
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
