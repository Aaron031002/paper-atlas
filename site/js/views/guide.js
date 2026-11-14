// How to use the system, for the people who visit the site.
import { esc } from '../util.js';

export function renderGuide(main, ctx) {
  const { index } = ctx;
  const repo = index.site.repo_url;
  main.className = 'page page-guide';
  main.innerHTML = `
    <div class="prose">
      <h1>使用說明</h1>
      <p>${esc(index.site.name)} 收錄 ${esc(index.domain.name)} 領域的論文介紹。每篇介紹都用同一個格式撰寫，paper 之間的引用與關聯會自動畫成知識圖譜。</p>

      <h2>瀏覽</h2>
      <ul>
        <li><a href="#/">文獻庫</a>：每篇 paper 先顯示分類與一句話介紹。可以依加入時間或發表時間排序，也可以用分類、tag、關鍵字篩選。</li>
        <li><a href="#/graph">知識圖譜</a>：圓點是 paper，顏色代表分類；菱形是多篇 paper 共用的概念。拖曳節點可以移動，拖曳空白處平移，滾輪或雙指縮放。點節點會顯示它的關聯。</li>
        <li>每篇介紹的最後列出它的參考文獻，已收錄的會標示出來並可直接點進去。</li>
      </ul>

      <h2>新增 paper 與取得研究建議</h2>
      <p>這兩件事都交給 agent 做。在這個專案的資料夾裡開啟 Claude Code 或其他支援 skill / MCP 的 agent，直接用一句話說你要什麼：</p>
      <ul class="examples">
        <li>「幫我找 RAG 評測方面的論文，加到文獻庫。」</li>
        <li>「找 5 篇 2025 年之後關於 agent 記憶機制的 paper。」</li>
        <li>「我的研究題目是用檢索改善長文件問答，目前做完 baseline，卡在檢索品質。請給我建議。」</li>
      </ul>
      <p>Agent 會依照專案內的規則到指定來源搜尋、排除已收錄與先前已評估過的論文、用固定格式寫介紹，然後更新網站。研究建議會消耗 LLM 額度，因此不開放給網站訪客。</p>
      ${repo ? `<p>完整的規則、指令與格式寫在專案的 <a href="${esc(repo)}#readme" target="_blank" rel="noopener">README</a>。</p>` : ''}

      <h2>目前的分類</h2>
      <dl class="category-list">
        ${index.categories.map((c) => `<div style="--cat:${esc(c.color)}"><dt><span class="dot" aria-hidden="true"></span>${esc(c.name)}</dt><dd>${esc(c.description || '')}</dd></div>`).join('')}
      </dl>
    </div>`;
}
