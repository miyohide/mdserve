// args.ts のユニットテスト
// 実行: node --test （ビルド後の dist/args.test.js を対象）

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parseArgs, CliArgumentError, helpText } from "./args.js";

test("引数なしの場合はデフォルト値を返す", () => {
  const opts = parseArgs([]);
  assert.equal(opts.port, 3000);
  assert.equal(opts.host, "127.0.0.1");
  assert.equal(opts.open, false);
  assert.equal(opts.help, false);
  assert.equal(opts.version, false);
  // root はカレントディレクトリ
  assert.equal(opts.root, process.cwd());
});

test("位置引数はディレクトリとして絶対パスに解決される", () => {
  const opts = parseArgs(["./docs"]);
  assert.equal(opts.root, path.resolve(process.cwd(), "./docs"));
});

test("--port でポートを指定できる", () => {
  const opts = parseArgs(["--port", "8080"]);
  assert.equal(opts.port, 8080);
});

test("-p の短縮形でポートを指定できる", () => {
  const opts = parseArgs(["-p", "5000"]);
  assert.equal(opts.port, 5000);
});

test("--port=8080 の等号区切り形式に対応する", () => {
  const opts = parseArgs(["--port=8080"]);
  assert.equal(opts.port, 8080);
});

test("--host でホストを指定できる", () => {
  const opts = parseArgs(["--host", "0.0.0.0"]);
  assert.equal(opts.host, "0.0.0.0");
});

test("--host=... の等号区切り形式に対応する", () => {
  const opts = parseArgs(["--host=192.168.0.1"]);
  assert.equal(opts.host, "192.168.0.1");
});

test("--open / -o でブラウザ起動フラグが立つ", () => {
  assert.equal(parseArgs(["--open"]).open, true);
  assert.equal(parseArgs(["-o"]).open, true);
});

test("--help / -h でヘルプフラグが立つ", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("--version / -v でバージョンフラグが立つ", () => {
  assert.equal(parseArgs(["--version"]).version, true);
  assert.equal(parseArgs(["-v"]).version, true);
});

test("ディレクトリとオプションを組み合わせて指定できる", () => {
  const opts = parseArgs(["./docs", "-p", "8080", "--open"]);
  assert.equal(opts.root, path.resolve(process.cwd(), "./docs"));
  assert.equal(opts.port, 8080);
  assert.equal(opts.open, true);
});

test("ポートが範囲外なら CliArgumentError を投げる", () => {
  assert.throws(() => parseArgs(["--port", "0"]), CliArgumentError);
  assert.throws(() => parseArgs(["--port", "70000"]), CliArgumentError);
  assert.throws(() => parseArgs(["--port", "-1"]), CliArgumentError);
});

test("ポートが数値でないなら CliArgumentError を投げる", () => {
  assert.throws(() => parseArgs(["--port", "abc"]), CliArgumentError);
});

test("ポート値が欠けている場合は CliArgumentError を投げる", () => {
  assert.throws(() => parseArgs(["--port"]), CliArgumentError);
});

test("ホスト値が欠けている場合は CliArgumentError を投げる", () => {
  assert.throws(() => parseArgs(["--host"]), CliArgumentError);
  assert.throws(() => parseArgs(["--host="]), CliArgumentError);
});

test("不明なオプションは CliArgumentError を投げる", () => {
  assert.throws(() => parseArgs(["--unknown"]), CliArgumentError);
});

test("ディレクトリを2つ指定すると CliArgumentError を投げる", () => {
  assert.throws(() => parseArgs(["./a", "./b"]), CliArgumentError);
});

test("helpText は主要オプションを含む文字列を返す", () => {
  const text = helpText();
  assert.match(text, /--port/);
  assert.match(text, /--host/);
  assert.match(text, /--open/);
  assert.match(text, /--help/);
});
