// ライブリロード機能を担当するモジュール。
// - ファイル監視（fs.watch）で公開ディレクトリ配下の変更を検知する
// - Server-Sent Events（SSE）でブラウザへ「リロードして」という通知を送る
// - 各ページに埋め込むクライアントスクリプトを提供する
//
// 外部ライブラリは使わず、Node.js標準機能のみで実装している。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

/** SSEを受け付けるエンドポイントのパス。通常のファイルと衝突しにくい名前にする。 */
export const LIVERELOAD_PATH = "/__mdserve_livereload";

/**
 * ライブリロードの中核。SSEで接続中のブラウザを管理し、
 * ファイル変更を検知したら全ブラウザへリロード通知を送る。
 */
export class LiveReload {
  /** 接続中のSSEクライアント（レスポンスストリーム）の集合 */
  private clients = new Set<http.ServerResponse>();
  /** fs.watch のウォッチャー */
  private watcher: fs.FSWatcher | null = null;
  /** 連続した変更イベントをまとめるためのデバウンスタイマー */
  private debounceTimer: NodeJS.Timeout | null = null;
  /** 生存確認（キープアライブ）用のタイマー */
  private keepAliveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly root: string) {}

  /**
   * リクエストがSSEエンドポイント宛かどうかを判定する。
   */
  static isLiveReloadRequest(pathname: string): boolean {
    return pathname === LIVERELOAD_PATH;
  }

  /**
   * SSE接続を確立する。ブラウザはこの接続を張りっぱなしにして通知を待つ。
   */
  handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // 接続直後にコメント行を送り、接続確立を明示する
    res.write(": connected\n\n");

    this.clients.add(res);

    // 接続が切れたらクライアント一覧から取り除く
    const cleanup = () => {
      this.clients.delete(res);
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
  }

  /**
   * ファイル監視を開始する。すでに開始済みの場合は何もしない。
   */
  start(): void {
    if (this.watcher) {
      return;
    }
    try {
      // recursive はmacOS / Windowsで対応。Linuxでは未対応の場合がある。
      this.watcher = fs.watch(
        this.root,
        { recursive: true },
        (_eventType, filename) => {
          this.onFileChange(filename);
        }
      );
    } catch {
      // recursive非対応の環境では、ルート直下のみを監視するフォールバック
      try {
        this.watcher = fs.watch(this.root, (_eventType, filename) => {
          this.onFileChange(filename);
        });
        console.warn(
          "警告: 再帰的なファイル監視に非対応の環境のため、サブディレクトリの変更は検知されない場合があります。"
        );
      } catch (err) {
        console.warn(
          `警告: ファイル監視を開始できませんでした。ライブリロードは無効になります: ${
            (err as Error).message
          }`
        );
      }
    }

    // 一定間隔でコメントを送り、プロキシ等による接続切断を防ぐ
    this.keepAliveTimer = setInterval(() => {
      for (const client of this.clients) {
        client.write(": keep-alive\n\n");
      }
    }, 30000);
    this.keepAliveTimer.unref();
  }

  /** ファイル変更イベントの処理。短時間の連続変更はまとめて1回の通知にする。 */
  private onFileChange(filename: string | null): void {
    // エディタの一時ファイルなどは無視する
    if (filename && shouldIgnore(filename)) {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.notifyReload();
    }, 100);
  }

  /** 接続中の全ブラウザへリロード通知を送る。 */
  private notifyReload(): void {
    for (const client of this.clients) {
      client.write("event: reload\ndata: reload\n\n");
    }
  }

  /**
   * 監視と全接続を終了する。サーバー終了時に呼び出す。
   */
  close(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }
}

/**
 * 監視対象から除外すべきファイルかどうかを判定する。
 * エディタのスワップファイルや一時ファイルによる余計なリロードを防ぐ。
 * （テストから参照するためエクスポートする）
 */
export function shouldIgnore(filename: string): boolean {
  const base = path.basename(filename);
  // Vim のスワップ（.swp/.swx）、Emacs の一時（~ 終端, #...#）、
  // エディタの一時保存（.tmp）、隠しドットファイルの一部などを除外
  if (base.endsWith("~")) return true;
  if (base.endsWith(".swp") || base.endsWith(".swx")) return true;
  if (base.endsWith(".tmp")) return true;
  if (base.startsWith("#") && base.endsWith("#")) return true;
  if (base.startsWith(".#")) return true;
  if (base === ".DS_Store") return true;
  return false;
}

/**
 * ブラウザに埋め込むライブリロード用クライアントスクリプトを返す。
 * SSEでリロード通知を受け取ると location.reload() する。
 * 接続が切れた場合は自動で再接続を試みる。
 */
export function liveReloadClientScript(): string {
  return `<script>
(function () {
  function connect() {
    var es = new EventSource(${JSON.stringify(LIVERELOAD_PATH)});
    es.addEventListener("reload", function () {
      location.reload();
    });
    es.onerror = function () {
      // 接続が切れたら閉じて、少し待ってから再接続する
      es.close();
      setTimeout(connect, 1000);
    };
  }
  connect();
})();
</script>`;
}
