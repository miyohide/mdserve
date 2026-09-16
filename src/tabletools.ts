// Markdownの表に集計・フィルター・ソート機能を付与するモジュール。
//
// 設計方針:
// - 外部ライブラリは使わず、ブラウザに埋め込むインラインの <script>/<style> のみで実装する
//   （livereload.ts の liveReloadClientScript() と同じ注入パターン）。
// - サーバー側は markdownToHtml() の出力を変更しない。オプトインマーカーの検出と
//   機能付与はすべてブラウザ側のDOM操作で行う。
//
// オプトイン方法:
// - 表の直前に「{.table-tools}」だけの段落を置くと、その直後の表に機能が付与される。
//   marked は {.table-tools} を属性として解釈せず <p>{.table-tools}</p> として出力するため、
//   その段落を目印に検出し、マーカー段落は表示上除去する。

/** オプトインを示すマーカー段落のテキスト */
export const TABLE_TOOLS_MARKER = "{.table-tools}";

/**
 * テーブル機能用のCSSを返す。render.ts の <style> に合流させて使う。
 * ダークモードにも対応する（色は prefers-color-scheme で切り替え）。
 */
export function tableToolsStyle(): string {
  return `
/* --- table-tools（表の集計・フィルター・ソート）--- */
.mdserve-table-tools { margin: 1rem 0; }
.mdserve-table-filter {
  width: 100%;
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.5rem;
  font-size: 0.95rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #ffffff;
  color: #24292f;
}
.mdserve-table-filter:focus {
  outline: none;
  border-color: #0969da;
  box-shadow: 0 0 0 2px rgba(9,105,218,0.25);
}
.mdserve-table-tools table th[data-sortable] {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.mdserve-table-tools table th[data-sortable]:hover {
  background: rgba(9,105,218,0.08);
}
.mdserve-sort-indicator { opacity: 0.9; margin-left: 0.3rem; font-size: 0.85em; }
.mdserve-table-tools tfoot td, .mdserve-table-tools tfoot th {
  font-weight: 600;
  background: rgba(175,184,193,0.15);
}
.mdserve-agg-empty { color: #656d76; font-weight: 400; }
@media (prefers-color-scheme: dark) {
  .mdserve-table-filter {
    background: #0d1117;
    color: #c9d1d9;
    border-color: #30363d;
  }
  .mdserve-table-filter:focus { border-color: #58a6ff; box-shadow: 0 0 0 2px rgba(88,166,255,0.3); }
  .mdserve-table-tools table th[data-sortable]:hover { background: rgba(88,166,255,0.12); }
  .mdserve-table-tools tfoot td, .mdserve-table-tools tfoot th { background: rgba(110,118,129,0.18); }
  .mdserve-agg-empty { color: #8b949e; }
}
`;
}

/**
 * ブラウザに埋め込むテーブル機能のクライアントスクリプトを返す。
 * DOMContentLoaded 後に {.table-tools} マーカーを検出し、対象の表へ
 * フィルター・ソート・集計を付与する。
 */
export function tableToolsClientScript(): string {
  return `<script>
(function () {
  var MARKER = ${JSON.stringify(TABLE_TOOLS_MARKER)};

  // マーカー段落（<p>{.table-tools}</p>）を探し、直後の表を対象化する。
  // マーカー段落自体は表示から取り除く。
  function collectTargetTables() {
    var tables = [];
    var paragraphs = document.querySelectorAll("p");
    for (var i = 0; i < paragraphs.length; i++) {
      var p = paragraphs[i];
      if (p.textContent.trim() !== MARKER) continue;
      // 直後の要素（空白テキストノードを飛ばす）を探す
      var next = p.nextElementSibling;
      if (next && next.tagName === "TABLE") {
        next.setAttribute("data-table-tools", "");
        tables.push(next);
      }
      // マーカー段落は除去する
      p.parentNode.removeChild(p);
    }
    return tables;
  }

  // セルの生テキストを取得する
  function cellText(cell) {
    return (cell.textContent || "").trim();
  }

  // 厳密な数値判定。空文字は数値とみなさない。
  function parseStrictNumber(text) {
    if (text === "") return NaN;
    var n = Number(text);
    return n;
  }

  function isNumeric(text) {
    return !Number.isNaN(parseStrictNumber(text));
  }

  // 表を初期化する。ラッパー生成・フィルター・ソート・集計をまとめて適用する。
  function initTable(table) {
    var thead = table.tHead;
    var tbody = table.tBodies[0];
    if (!thead || !tbody) return;

    var headerCells = thead.rows.length ? Array.prototype.slice.call(thead.rows[0].cells) : [];
    var colCount = headerCells.length;

    // データ行のスナップショット。ソートで並べ替えても同じ行要素を使い回すため、
    // この配列は集計対象の全行として有効であり続ける。
    var allRows = Array.prototype.slice.call(tbody.rows);

    // ラッパーで表を包み、上部に検索ボックスを置く
    var wrapper = document.createElement("div");
    wrapper.className = "mdserve-table-tools";
    table.parentNode.insertBefore(wrapper, table);

    var filter = document.createElement("input");
    filter.type = "search";
    filter.className = "mdserve-table-filter";
    filter.placeholder = "この表を絞り込み...";
    wrapper.appendChild(filter);
    wrapper.appendChild(table);

    // --- フィルター ---
    filter.addEventListener("input", function () {
      var q = filter.value.toLowerCase();
      var rows = tbody.rows;
      for (var i = 0; i < rows.length; i++) {
        var text = (rows[i].textContent || "").toLowerCase();
        rows[i].style.display = text.indexOf(q) !== -1 ? "" : "none";
      }
      // 絞り込み後、表示中の行だけで集計を再計算する
      recalcAggregation();
    });

    // --- ソート ---
    var sortState = { col: -1, dir: 1 }; // dir: 1=昇順, -1=降順
    headerCells.forEach(function (th, colIndex) {
      th.setAttribute("data-sortable", "");
      var indicator = document.createElement("span");
      indicator.className = "mdserve-sort-indicator";
      th.appendChild(indicator);

      th.addEventListener("click", function () {
        if (sortState.col === colIndex) {
          sortState.dir = -sortState.dir; // 同じ列なら方向をトグル
        } else {
          sortState.col = colIndex;
          sortState.dir = 1;
        }
        sortByColumn(colIndex, sortState.dir);
        updateIndicators();
      });
    });

    function updateIndicators() {
      headerCells.forEach(function (th, colIndex) {
        var ind = th.querySelector(".mdserve-sort-indicator");
        if (!ind) return;
        if (colIndex === sortState.col) {
          ind.textContent = sortState.dir === 1 ? "▲" : "▼";
        } else {
          ind.textContent = "";
        }
      });
    }

    function sortByColumn(colIndex, dir) {
      var rows = Array.prototype.slice.call(tbody.rows);
      // 列が全て数値なら数値比較、そうでなければ文字列比較
      var allNumeric = rows.length > 0 && rows.every(function (row) {
        var cell = row.cells[colIndex];
        return cell && isNumeric(cellText(cell));
      });
      rows.sort(function (a, b) {
        var ca = a.cells[colIndex] ? cellText(a.cells[colIndex]) : "";
        var cb = b.cells[colIndex] ? cellText(b.cells[colIndex]) : "";
        var cmp;
        if (allNumeric) {
          cmp = parseStrictNumber(ca) - parseStrictNumber(cb);
        } else {
          cmp = ca.localeCompare(cb, "ja");
        }
        return cmp * dir;
      });
      // 並べ替えた順序で再配置（display状態は各行に保持されているため維持される）
      rows.forEach(function (row) { tbody.appendChild(row); });
    }

    // --- 集計（tfoot）---
    // 列種別（数値列か否か）は全データ行を基準に一度だけ確定する。
    // フィルターやソートで表示行が変わっても列種別は変えず、集計値のみ再計算する。
    var isNumericCol = [];
    for (var c = 0; c < colCount; c++) {
      var numeric = allRows.length > 0;
      for (var r = 0; r < allRows.length; r++) {
        var cell0 = allRows[r].cells[c];
        var text0 = cell0 ? cellText(cell0) : "";
        if (!isNumeric(text0)) { numeric = false; break; }
      }
      isNumericCol[c] = numeric;
    }
    var hasNumericCol = isNumericCol.some(function (v) { return v; });

    // tfoot の骨組みを作る。件数行は常に、合計・平均行は数値列がある場合に用意する。
    var tfoot = table.createTFoot();
    var countRow = tfoot.insertRow();
    var totalRow = hasNumericCol ? tfoot.insertRow() : null;
    var avgRow = hasNumericCol ? tfoot.insertRow() : null;

    for (var c1 = 0; c1 < colCount; c1++) {
      countRow.appendChild(document.createElement("td"));
      if (totalRow) totalRow.appendChild(document.createElement("td"));
      if (avgRow) avgRow.appendChild(document.createElement("td"));
    }

    // 表示中の行だけで合計・平均・件数を計算し、tfoot を更新する。
    function recalcAggregation() {
      // display が none でない（＝表示中の）行だけを対象にする
      var visibleRows = allRows.filter(function (row) {
        return row.style.display !== "none";
      });
      var count = visibleRows.length;

      // 件数行: 先頭セルに件数を表示、他はダッシュ
      for (var cc = 0; cc < colCount; cc++) {
        var td = countRow.cells[cc];
        if (cc === 0) {
          td.textContent = "件数: " + count;
        } else {
          td.innerHTML = '<span class="mdserve-agg-empty">—</span>';
        }
      }

      if (!hasNumericCol) return;

      // 数値列ごとに表示中の行で合計・平均を出す
      for (var col = 0; col < colCount; col++) {
        var tdTotal = totalRow.cells[col];
        var tdAvg = avgRow.cells[col];
        if (isNumericCol[col]) {
          var sum = 0;
          for (var i = 0; i < visibleRows.length; i++) {
            var cell = visibleRows[i].cells[col];
            sum += parseStrictNumber(cell ? cellText(cell) : "");
          }
          tdTotal.textContent = "合計: " + formatNumber(sum);
          tdAvg.textContent = count > 0 ? "平均: " + formatNumber(sum / count) : "平均: —";
        } else if (col === 0) {
          tdTotal.innerHTML = '<span class="mdserve-agg-empty">合計</span>';
          tdAvg.innerHTML = '<span class="mdserve-agg-empty">平均</span>';
        } else {
          tdTotal.innerHTML = '<span class="mdserve-agg-empty">—</span>';
          tdAvg.innerHTML = '<span class="mdserve-agg-empty">—</span>';
        }
      }
    }

    // 初期表示（全行）で一度集計する
    recalcAggregation();
  }

  // 数値を見やすく整形する（整数はそのまま、小数は最大2桁まで）
  function formatNumber(n) {
    if (Number.isInteger(n)) return n.toLocaleString("ja-JP");
    return n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  }

  function init() {
    var tables = collectTargetTables();
    tables.forEach(initTable);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
</script>`;
}
