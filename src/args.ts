// コマンドライン引数の解析を担当するモジュール

import path from "node:path";

/** 解析済みのCLIオプション */
export interface CliOptions {
  /** 公開対象のルートディレクトリ（絶対パス） */
  root: string;
  /** リッスンするポート番号 */
  port: number;
  /** バインドするホスト */
  host: string;
  /** 起動時にブラウザを自動で開くか */
  open: boolean;
  /** ファイル変更時にブラウザを自動リロードするか（ライブリロード） */
  live: boolean;
  /** ヘルプ表示のみを行うか */
  help: boolean;
  /** バージョン表示のみを行うか */
  version: boolean;
}

/** オプションのデフォルト値 */
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";

/**
 * process.argv から渡された引数配列（node と script を除いた部分）を解析する。
 * 例: ["./docs", "--port", "8080", "--open"]
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    open: false,
    live: true,
    help: false,
    version: false,
  };

  // 位置引数（ディレクトリ）を受け取ったかどうか
  let rootSpecified = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;

      case "-v":
      case "--version":
        options.version = true;
        break;

      case "-o":
      case "--open":
        options.open = true;
        break;

      case "--live":
        options.live = true;
        break;

      case "--no-live":
        options.live = false;
        break;

      case "-p":
      case "--port": {
        const value = argv[++i];
        const parsed = parsePort(value);
        options.port = parsed;
        break;
      }

      case "--host": {
        const value = argv[++i];
        if (!value) {
          throw new CliArgumentError("--host にはホスト名が必要です");
        }
        options.host = value;
        break;
      }

      default: {
        // --port=8080 のような "=" 区切り形式に対応
        if (arg.startsWith("--port=")) {
          options.port = parsePort(arg.slice("--port=".length));
        } else if (arg.startsWith("--host=")) {
          const value = arg.slice("--host=".length);
          if (!value) {
            throw new CliArgumentError("--host にはホスト名が必要です");
          }
          options.host = value;
        } else if (arg.startsWith("-")) {
          throw new CliArgumentError(`不明なオプションです: ${arg}`);
        } else {
          // 位置引数はディレクトリとして扱う（最初の1つのみ）
          if (rootSpecified) {
            throw new CliArgumentError(
              `ディレクトリは1つだけ指定できます: ${arg}`
            );
          }
          options.root = path.resolve(process.cwd(), arg);
          rootSpecified = true;
        }
        break;
      }
    }
  }

  return options;
}

/** ポート番号の文字列をバリデーションして数値に変換する */
function parsePort(value: string | undefined): number {
  if (!value) {
    throw new CliArgumentError("--port にはポート番号が必要です");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliArgumentError(
      `ポート番号は 1〜65535 の整数で指定してください: ${value}`
    );
  }
  return port;
}

/** 引数解析時のエラーを表す独自エラー型 */
export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}

/** ヘルプメッセージ（日本語）を返す */
export function helpText(): string {
  return `mdserve - Markdownファイルを配信するローカルWebサーバー

使い方:
  mdserve [ディレクトリ] [オプション]

引数:
  ディレクトリ            公開するディレクトリ（省略時はカレントディレクトリ）

オプション:
  -p, --port <番号>       リッスンするポート番号（既定: ${DEFAULT_PORT}）
      --host <ホスト>     バインドするホスト（既定: ${DEFAULT_HOST}）
  -o, --open              起動時にブラウザを自動で開く
      --no-live           ライブリロードを無効にする（既定: 有効）
  -h, --help              このヘルプを表示する
  -v, --version           バージョンを表示する

例:
  mdserve
  mdserve ./docs --port 8080
  mdserve ./docs -p 8080 --open
`;
}
