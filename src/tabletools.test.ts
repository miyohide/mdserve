// tabletools.ts のユニットテスト。
// クライアントスクリプトはブラウザ上で動作するため、ここでは生成される
// 文字列に必要な実装（ロジックのキーワード）が含まれるかを検証する。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TABLE_TOOLS_MARKER,
  tableToolsClientScript,
  tableToolsStyle,
} from "./tabletools.js";

test("マーカー定数は {.table-tools}", () => {
  assert.equal(TABLE_TOOLS_MARKER, "{.table-tools}");
});

test("tableToolsStyle は空でない文字列を返す", () => {
  const style = tableToolsStyle();
  assert.equal(typeof style, "string");
  assert.ok(style.length > 0);
});

test("tableToolsStyle はフィルター入力とツールクラスのスタイルを含む", () => {
  const style = tableToolsStyle();
  assert.match(style, /\.mdserve-table-filter/);
  assert.match(style, /\.mdserve-table-tools/);
  assert.match(style, /\.mdserve-sort-indicator/);
});

test("tableToolsStyle はダークモード対応を含む", () => {
  const style = tableToolsStyle();
  assert.match(style, /prefers-color-scheme:\s*dark/);
});

test("tableToolsClientScript は空でない script 要素を返す", () => {
  const script = tableToolsClientScript();
  assert.equal(typeof script, "string");
  assert.match(script, /^<script>/);
  assert.match(script, /<\/script>$/);
});

test("スクリプトはマーカー検出ロジックを含む", () => {
  const script = tableToolsClientScript();
  // マーカー文字列が埋め込まれている
  assert.match(script, /\{\.table-tools\}/);
  // マーカー段落の直後の table を対象化する
  assert.match(script, /data-table-tools/);
  // マーカー段落を除去する
  assert.match(script, /removeChild/);
});

test("スクリプトはフィルター実装を含む", () => {
  const script = tableToolsClientScript();
  assert.match(script, /type = "search"|type="search"/);
  assert.match(script, /addEventListener\("input"/);
  // 非該当行を隠す
  assert.match(script, /style\.display/);
});

test("スクリプトはソート実装を含む", () => {
  const script = tableToolsClientScript();
  // ヘッダークリック
  assert.match(script, /addEventListener\("click"/);
  // 数値比較と日本語ロケールの文字列比較
  assert.match(script, /localeCompare\([^)]*"ja"/);
  // 方向トグルと方向インジケータ
  assert.match(script, /sortState/);
  assert.match(script, /▲|▼/);
});

test("スクリプトは集計（tfoot）実装を含む", () => {
  const script = tableToolsClientScript();
  // 数値列判定
  assert.match(script, /isNumeric/);
  // 合計・平均・件数
  assert.match(script, /合計/);
  assert.match(script, /平均/);
  assert.match(script, /件数/);
  // tfoot の生成
  assert.match(script, /createTFoot/);
});
