const form = document.getElementById('holding-form');
const formMessage = document.getElementById('form-message');
const tbody = document.getElementById('portfolio-body');
const emptyState = document.getElementById('empty-state');

const simulatedPrices = new Map();
const quoteMap = new Map(); // symbol -> { price, currency, priceTWD }（Yahoo 真實報價）
let lastRows = [];          // 最近一次渲染的持倉（自動刷新時沿用）
let busyAnalyses = 0;       // 進行中的 AI 分析數（分析中不刷新，避免洗掉畫面）

const symbolInput = document.getElementById('stock_symbol');
const nameInput = document.getElementById('company_name');
const symbolHint = document.getElementById('symbol-hint');
const autoHint = document.getElementById('auto-hint');
const symbolDatalist = document.getElementById('symbol-list');

const stockMap = new Map();
let lastAutoName = '';

function resolveSymbol() {
    const symbol = symbolInput.value.trim().toUpperCase();
    if (symbolInput.value !== symbol) symbolInput.value = symbol;

    const knownName = stockMap.get(symbol);
    const currentName = nameInput.value.trim();

    if (knownName) {
        symbolHint.textContent = knownName;
        symbolHint.classList.remove('warn');
        symbolHint.hidden = false;

        if (!currentName || currentName === lastAutoName) {
            nameInput.value = knownName;
            lastAutoName = knownName;
            autoHint.hidden = false;
        }
    } else {
        if (currentName === lastAutoName) {
            nameInput.value = '';
            lastAutoName = '';
        }
        autoHint.hidden = true;
        symbolHint.textContent = symbol ? '查無此代碼，請手動輸入名稱' : '';
        symbolHint.classList.add('warn');
        symbolHint.hidden = !symbol;
    }
}

function resetSymbolHints() {
    lastAutoName = '';
    autoHint.hidden = true;
    symbolHint.hidden = true;
    symbolHint.textContent = '';
}

async function loadStocks() {
    try {
        const res = await fetch('/api/stocks');
        const json = await res.json();
        json.data.forEach(s => {
            stockMap.set(s.symbol, s.name);
            const option = document.createElement('option');
            option.value = s.symbol;
            option.label = s.name;
            symbolDatalist.appendChild(option);
        });
    } catch (err) {
        console.error('載入股票代碼失敗', err);
    }
}

symbolInput.addEventListener('input', resolveSymbol);
nameInput.addEventListener('input', () => {
    if (nameInput.value.trim() !== lastAutoName) {
        lastAutoName = '';
        autoHint.hidden = true;
    }
});

function simulatePrice(row) {
    if (!simulatedPrices.has(row.id)) {
        const drift = 0.92 + Math.random() * 0.2;
        simulatedPrices.set(row.id, Math.round(row.buy_price * drift * 100) / 100);
    }
    return simulatedPrices.get(row.id);
}

// 批次取得 Yahoo 真實報價（台股換算新台幣）；fresh=1 時繞過大部分快取
async function loadQuotes(symbols, fresh = false) {
    const codes = [...new Set(symbols.filter(Boolean))];
    if (!codes.length) return;
    try {
        const url = '/api/quotes?codes=' + encodeURIComponent(codes.join(',')) + (fresh ? '&fresh=1' : '');
        const res = await fetch(url);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || '取得報價失敗');
        Object.entries(json.data).forEach(([code, quote]) => {
            if (quote) quoteMap.set(code.toUpperCase(), quote);
        });
    } catch (err) {
        console.error('取得真實報價失敗，將退回模擬價:', err);
    }
}

function currencySymbol(currency) {
    if (currency === 'TWD') return 'NT$ ';
    if (currency === 'USD') return 'US$ ';
    return currency ? currency + ' ' : '';
}

function money(value) {
    return 'NT$ ' + value.toLocaleString('zh-TW', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function signedMoney(value) {
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return sign + 'NT$ ' + Math.abs(value).toLocaleString('zh-TW', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function pnlClass(value) {
    if (value > 0) return 'pnl-positive';
    if (value < 0) return 'pnl-negative';
    return '';
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

const aiResults = new Map(); // symbol -> { score, summary, news, source }

function verdictOf(score) {
    if (score > 0.3) return { cls: 'pos', label: '🟢 看漲' };
    if (score < -0.3) return { cls: 'neg', label: '🔴 看跌' };
    return { cls: 'neu', label: '🟡 中立' };
}

function aiButtonHtml(symbol, disabled = false, label = 'AI 分析') {
    return `<button class="btn-ai" data-symbol="${escapeHtml(symbol)}"${disabled ? ' disabled' : ''}>${label}</button>`;
}

// 卡片第一行：AI 分析鍵＋刪除鍵並排
function aiHeadHtml(symbol, opts = {}) {
    const row = lastRows.find(r => String(r.stock_symbol).toUpperCase() === String(symbol).toUpperCase());
    const id = row ? row.id : '';
    const dis = opts.disabled ? ' disabled' : '';
    return `<div class="ai-card-head">` +
        `<button class="btn-ai" data-symbol="${escapeHtml(symbol)}"${dis}>${escapeHtml(opts.label || 'AI 分析')}</button>` +
        `<button class="btn-delete" data-id="${id}"${dis}>刪除</button>` +
        `</div>`;
}

// AI 卡片：第一列＝按鈕列，第二列起＝評級、摘要與細節
function aiCardHtml(symbol, rowId) {
    const head = aiHeadHtml(symbol);
    const result = aiResults.get(symbol);
    if (!result) {
        return head + `<span class="ai-idle">尚未分析，點「AI 分析」查看即時評級</span>`;
    }

    const v = verdictOf(result.score);
    const newsTitle = escapeHtml((result.news || []).join('\n'));
    const sourceLabels = { momentum: '價格動能（真實股價）', gemini: 'Gemini', mock: '模擬 AI' };
    const sourceLabel = sourceLabels[result.source] || result.source || '未知';
    const detailsHtml = (result.details || [])
        .map(d => `<span class="ai-detail"><b>${escapeHtml(d.label)}</b> ${escapeHtml(d.value)}</span>`)
        .join('');
    return head +
        `<span class="ai-badge ai-${v.cls}" title="分數 ${result.score.toFixed(2)}（來源：${sourceLabel}）&#10;${newsTitle}">
            ${v.label} <b>${result.score > 0 ? '+' : ''}${result.score.toFixed(2)}</b>
        </span>
        <span class="ai-summary">${escapeHtml(result.summary)}</span>
        <span class="ai-details">${detailsHtml}</span>`;
}

function showMessage(text, ok) {
    formMessage.textContent = text;
    formMessage.className = 'form-message ' + (ok ? 'ok' : 'err');
    formMessage.hidden = false;
    if (ok) setTimeout(() => { formMessage.hidden = true; }, 2500);
}

function render(rows) {
    lastRows = rows;
    tbody.innerHTML = '';
    emptyState.hidden = rows.length > 0;

    let totalCost = 0;
    let totalValue = 0;
    let totalDividend = 0; // 年度股息估計（新台幣）

    rows.forEach(row => {
        const quote = quoteMap.get(String(row.stock_symbol).toUpperCase());
        // 真實報價優先（Yahoo），查不到才退回模擬價
        const price = quote ? quote.price : simulatePrice(row);
        const priceTWD = quote ? quote.priceTWD : price;
        const cur = quote ? quote.currency : 'TWD';

        const cost = row.buy_price * row.shares; // 成本以買入時輸入的價格（視同新台幣）計
        const value = priceTWD * row.shares;      // 市值統一換算新台幣
        const pnl = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;

        totalCost += cost;
        totalValue += value;

        // 股息：近 12 個月每股股息 × 股數（換算新台幣）
        let divCell = '—';
        let divTWD = 0;
        if (quote && quote.dividend && quote.dividend.ttm > 0) {
            const divCur = quote.dividend.currency || cur;
            const yieldPct = quote.dividendYield != null ? quote.dividendYield * 100 : null;
            divTWD = quote.dividend.ttm * quote.fxRate * row.shares;
            totalDividend += divTWD;
            divCell =
                `${currencySymbol(divCur)}${quote.dividend.ttm.toFixed(2)}` +
                (yieldPct != null ? `<br><small>${yieldPct.toFixed(2)}%</small>` : '');
        }

        // 含息損益＝不含息損益＋近 12 個月股息（股息未計持有期間，僅供參考）
        const pnlDiv = pnl + divTWD;
        const pnlDivPct = cost > 0 ? (pnlDiv / cost) * 100 : 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="symbol-cell">${escapeHtml(row.stock_symbol)}</td>
            <td class="company-cell">${escapeHtml(row.company_name)}</td>
            <td class="num">${row.shares.toLocaleString('zh-TW')}</td>
            <td class="num">${row.buy_price.toFixed(2)}</td>
            <td class="num" title="${quote ? `Yahoo 即時報價（${quote.currency}）` : '目前查不到報價，顯示模擬價'}">${currencySymbol(cur)}${price.toFixed(2)}</td>
            <td class="num">${money(cost)}</td>
            <td class="num">${money(value)}</td>
            <td class="num ${pnlClass(pnl)}" title="不含息＝單純價差；含息＝再加計近 12 個月股息">
                ${signedMoney(pnl)}
                <br><small>不含息 ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</small>
                <br><small class="${pnlClass(pnlDiv)}">含息 ${pnlDivPct >= 0 ? '+' : ''}${pnlDivPct.toFixed(2)}%</small>
            </td>
            <td class="num">${divCell}</td>
            <td class="ai-cell">
                <div class="ai-result" data-ai="${escapeHtml(row.stock_symbol)}">${aiCardHtml(row.stock_symbol, row.id)}</div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    document.getElementById('total-market-value').textContent = money(totalValue);
    document.getElementById('total-cost').textContent = money(totalCost);

    const pnlEl = document.getElementById('total-pnl');
    pnlEl.textContent = signedMoney(totalPnl);
    pnlEl.className = 'summary-value ' + pnlClass(totalPnl);

    const pnlPctEl = document.getElementById('total-pnl-percent');
    pnlPctEl.textContent = '不含息 ' + (totalPnlPct >= 0 ? '+' : '') + totalPnlPct.toFixed(2) + '%';
    pnlPctEl.className = 'summary-sub ' + pnlClass(totalPnl);

    // 含息＝不含息＋近 12 個月股息（未計持有期間，僅供參考）
    const totalPnlDiv = totalPnl + totalDividend;
    const totalPnlDivPct = totalCost > 0 ? (totalPnlDiv / totalCost) * 100 : 0;
    const pnlDivEl = document.getElementById('total-pnl-div');
    pnlDivEl.textContent =
        '含息 ' + signedMoney(totalPnlDiv) + '（' + (totalPnlDivPct >= 0 ? '+' : '') + totalPnlDivPct.toFixed(2) + '%）';
    pnlDivEl.className = 'summary-sub ' + pnlClass(totalPnlDiv);
    pnlDivEl.title = '含息損益＝不含息損益＋近 12 個月股息×股數（股息未依持有期間拆算，僅供參考）';

    document.getElementById('total-dividend').textContent = money(totalDividend);
    document.getElementById('total-dividend-percent').textContent =
        '股息率 ' + (totalCost > 0 ? (totalDividend / totalCost) * 100 : 0).toFixed(2) + '%（對成本）';

    document.getElementById('holding-count').textContent = rows.length;
}

// --- 每日必買：後端掃描全清單，依動能分數取前 5 ---
async function loadDailyPicks() {
    const body = document.getElementById('picks-body');
    const empty = document.getElementById('picks-empty');
    const hint = document.getElementById('picks-hint');
    try {
        const res = await fetch('/api/daily-picks');
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || '取得失敗');

        body.innerHTML = '';
        empty.hidden = json.picks.length > 0;

        json.picks.forEach((p, i) => {
            const v = verdictOf(p.score);
            const price = p.price != null
                ? `${currencySymbol(p.currency)}${p.price.toFixed(2)}`
                : '—';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="symbol-cell">#${i + 1}</td>
                <td class="symbol-cell">${escapeHtml(p.symbol)}</td>
                <td class="company-cell">${escapeHtml(p.name)}</td>
                <td class="num"><span class="ai-badge ai-${v.cls}">${v.label} ${p.score > 0 ? '+' : ''}${p.score.toFixed(2)}</span></td>
                <td class="num ${pnlClass(p.chg5)}">${p.chg5 >= 0 ? '+' : ''}${p.chg5.toFixed(2)}%</td>
                <td class="num">${price}</td>
                <td><button class="btn-pick" data-symbol="${escapeHtml(p.symbol)}" data-name="${escapeHtml(p.name)}">帶入表單</button></td>
            `;
            body.appendChild(tr);
        });

        hint.textContent = `掃描 ${json.totalScanned} 檔 · 買進訊號分數 > 0.5 · ${json.date} 更新`;
    } catch (err) {
        empty.textContent = '每日必買取得失敗：' + err.message;
        empty.hidden = false;
    }
}

// 「帶入表單」：把推薦股票填進新增持倉表單
document.getElementById('picks-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-pick');
    if (!btn) return;

    symbolInput.value = btn.dataset.symbol;
    nameInput.value = btn.dataset.name || '';
    lastAutoName = '';
    resolveSymbol();
    document.getElementById('holding-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('shares').focus();
});

async function loadPortfolio() {
    const res = await fetch('/api/portfolio');
    const json = await res.json();
    if (!json.success) throw new Error(json.message || '讀取失敗');
    await loadQuotes(json.data.map(r => r.stock_symbol)); // 先抓真實報價再渲染
    render(json.data);
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        stock_symbol: document.getElementById('stock_symbol').value,
        company_name: document.getElementById('company_name').value,
        shares: document.getElementById('shares').value,
        buy_price: document.getElementById('buy_price').value
    };

    try {
        const res = await fetch('/api/portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || '新增失敗');

        form.reset();
        resetSymbolHints();
        showMessage(`已新增 ${json.data.stock_symbol}（${json.data.company_name}）`, true);
        await loadPortfolio();
    } catch (err) {
        showMessage(err.message, false);
    }
});

let myChart = null;
let currentSymbol = null;   // 最近一次做 AI 分析的股票
let currentRange = '30d';   // 目前選取的回測期間
let backtestSeq = 0;        // 請求序號：只畫最新一次請求的結果

async function runBacktest(symbol, range = currentRange, opts = {}) {
    currentSymbol = symbol;
    currentRange = range;
    const summaryEl = document.getElementById('resultSummary');
    const seq = ++backtestSeq;

    try {
        // 手動切換才顯示計算中；自動刷新保持畫面安靜
        if (!opts.silent) summaryEl.innerText = '回測計算中…（首次抓取長期資料需數秒）';

        const response = await fetch(
            `/api/backtest/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&fresh=1`
        );
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || '回測失敗');
        if (seq !== backtestSeq) return; // 已有更新的請求，放棄這次結果

        const longPeriod = data.tradingDays > 60;
        const labels = data.equityCurve.map(d => {
            if (!d.date) return `第${d.day}天`;
            return longPeriod ? d.date.slice(0, 7) : d.date.slice(5);
        });
        const values = data.equityCurve.map(d => d.equity);
        const cur = currencySymbol(data.currency).trim() || data.currency;

        const capital = data.initialCapital || 10000;
        const gain = data.finalBalance - capital;
        const gainPct = (gain / capital) * 100;
        const m = data.metrics || {};
        const sourceNote = data.source === 'yahoo' ? '真實股價' : '離線模擬';
        const now = new Date();
        const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const chip = (label, value, cls = '') =>
            `<span class="metric-chip"><small>${label}</small><b class="${cls}">${value}</b></span>`;
        summaryEl.innerHTML =
            `<div class="metric-chips">` +
            chip('最終資產（股價基準）', `${cur} ${data.finalBalance.toFixed(2)}`, pnlClass(gain)) +
            chip('總報酬', `${gain >= 0 ? '+' : ''}${gainPct.toFixed(2)}%`, pnlClass(gain)) +
            chip('年化報酬', m.annualReturn != null ? `${m.annualReturn >= 0 ? '+' : ''}${m.annualReturn.toFixed(2)}%` : '—', pnlClass(m.annualReturn || 0)) +
            chip('最大回撤', m.maxDrawdown != null ? `-${m.maxDrawdown.toFixed(2)}%` : '—', 'pnl-negative') +
            chip('交易次數', m.roundTrips != null ? `${m.roundTrips}  round trip` : '—') +
            chip('勝率', m.winRate != null ? `${m.winRate.toFixed(0)}%` : '—') +
            chip('最佳／最差', m.bestTrade != null ? `${m.bestTrade >= 0 ? '+' : ''}${m.bestTrade.toFixed(1)}% ／ ${m.worstTrade.toFixed(1)}%` : '—') +
            chip('交易日', `${data.tradingDays} 天`) +
            `</div>` +
            `<div class="chart-stamp">${symbol} · ${data.label}回測 · ${sourceNote} · 更新於 ${stamp}</div>`;

        const ctx = document.getElementById('backtestChart').getContext('2d');

        if (myChart) myChart.destroy(); // 如果已有圖表，先刪除再重建

        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `總資產 (${data.currency})`,
                    data: values,
                    borderColor: '#0056b3',
                    tension: 0.1,
                    pointRadius: longPeriod ? 0 : 2,
                    fill: true,
                    backgroundColor: 'rgba(0, 86, 179, 0.1)'
                }]
            },
            options: {
                animation: false,
                scales: {
                    x: {
                        ticks: { autoSkip: true, maxTicksLimit: 12, color: '#7a8299', font: { size: 14 } }
                    },
                    y: {
                        ticks: { color: '#7a8299', font: { size: 14 } },
                        title: {
                            display: true,
                            text: `總資產（以股價計，起始＝首日收盤 ${capital.toLocaleString('zh-TW')}）`,
                            color: '#7a8299',
                            font: { size: 14, weight: '600' }
                        }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#1c2333', font: { size: 15 } } }
                }
            }
        });
    } catch (err) {
        if (seq !== backtestSeq) return;
        console.error('回測失敗', err);
        if (!opts.silent) summaryEl.innerText = `回測失敗：${err.message}`;
    }
}

// 回測期間切換按鈕
document.getElementById('range-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;

    document.querySelectorAll('#range-picker .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (currentSymbol) runBacktest(currentSymbol, btn.dataset.range);
    else currentRange = btn.dataset.range; // 還沒分析過就先記住，下次帶入
});

// --- 未來預測圖表（與過去回測分開的第二張圖） ---
let forecastChart = null;
let currentHorizon = '90d';   // 目前選取的預測期間
let forecastSeq = 0;          // 請求序號：只畫最新一次請求的結果

async function runForecast(symbol, horizon = currentHorizon, opts = {}) {
    if (!symbol) return;
    currentHorizon = horizon;
    const summaryEl = document.getElementById('forecastSummary');
    const seq = ++forecastSeq;

    try {
        if (!opts.silent) summaryEl.innerHTML = '<span class="chart-stamp">預測計算中…</span>';

        const res = await fetch(
            `/api/forecast/${encodeURIComponent(symbol)}?horizon=${encodeURIComponent(horizon)}`
        );
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || '預測失敗');
        if (seq !== forecastSeq) return; // 已有更新的請求，放棄這次結果

        const hist = data.recent || [];
        const futureCount = (data.futureDates || []).length;
        const labels = [
            ...hist.map(p => p.date.slice(5)),
            ...(data.futureDates || []).map(d => d.slice(5))
        ];
        const pad = arr => [...new Array(hist.length).fill(null), ...arr];
        const tail = [...hist.map(p => p.close), ...new Array(futureCount).fill(null)];

        const cur = currencySymbol(data.currency).trim() || data.currency;
        const p90 = data.series.map(s => s.p90);
        const p50 = data.series.map(s => s.median);
        const p10 = data.series.map(s => s.p10);

        // --- 詳細預測摘要 ---
        const retCls = pnlClass(data.medianReturn);
        const chip = (label, value, cls = '', title = '') =>
            `<span class="metric-chip" ${title ? `title="${escapeHtml(title)}"` : ''}><small>${label}</small><b class="${cls}">${value}</b></span>`;
        const pct = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
        const now = new Date();
        const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const endDate = futureCount ? data.futureDates[futureCount - 1] : '';

        // 如果這檔股票在持倉內，估算對你持倉的影響
        let holdingImpact = '';
        const row = lastRows.find(r => String(r.stock_symbol).toUpperCase() === symbol.toUpperCase());
        if (row) {
            const quote = quoteMap.get(String(row.stock_symbol).toUpperCase());
            if (quote && quote.priceTWD) {
                const delta = quote.priceTWD * row.shares * (data.medianReturn / 100);
                holdingImpact = chip(
                    `你的 ${row.shares} 股（中位數情境）`,
                    signedMoney(delta),
                    pnlClass(delta)
                );
            }
        }

        summaryEl.innerHTML =
            `<div class="metric-chips">` +
            chip('目前價', `${cur} ${data.current.toFixed(2)}`) +
            chip('中位數預估價', `${cur} ${p50[p50.length - 1].toFixed(2)}`, retCls, `${endDate} 的中位數情境`) +
            chip('預期報酬', pct(data.medianReturn), retCls, '400 次模擬的中位數報酬') +
            chip('獲利機率', `${data.probProfit.toFixed(1)}%`, data.probProfit >= 50 ? 'pnl-positive' : 'pnl-negative', '400 次模擬中收盤價高於目前價的比例') +
            chip('樂觀情境（前 10%）', pct((p90[p90.length - 1] / data.current - 1) * 100), 'pnl-positive', `預估價 ${cur} ${p90[p90.length - 1].toFixed(2)}`) +
            chip('悲觀情境（後 10%）', pct((p10[p10.length - 1] / data.current - 1) * 100), 'pnl-negative', `預估價 ${cur} ${p10[p10.length - 1].toFixed(2)}`) +
            chip('過去一年年化報酬', pct(data.stats.annReturn), pnlClass(data.stats.annReturn), '由近 1 年真實日報酬計算') +
            chip('年化波動度', `${data.stats.annVol.toFixed(1)}%`) +
            holdingImpact +
            `</div>` +
            `<div class="chart-stamp">${symbol} · 預測 ${data.label}（至 ${endDate}）· ` +
            `蒙地卡羅 400 次模擬，基於近 1 年真實日報酬` +
            `${data.source === 'yahoo' ? '' : '（離線模擬資料）'} · 更新於 ${stamp}</div>`;

        const ctx = document.getElementById('forecastChart').getContext('2d');
        if (forecastChart) forecastChart.destroy();

        forecastChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '樂觀（第 90 百分位）',
                        data: pad(p90),
                        borderColor: 'rgba(12, 166, 120, 0.5)',
                        backgroundColor: 'rgba(12, 166, 120, 0.12)',
                        fill: 1, // 填滿到第 10 百分位
                        pointRadius: 0,
                        borderWidth: 1,
                        tension: 0.1
                    },
                    {
                        label: '悲觀（第 10 百分位）',
                        data: pad(p10),
                        borderColor: 'rgba(224, 49, 49, 0.5)',
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 1,
                        tension: 0.1
                    },
                    {
                        label: '中位數預估',
                        data: pad(p50),
                        borderColor: '#0056b3',
                        pointRadius: 0,
                        borderWidth: 2,
                        borderDash: [6, 4],
                        tension: 0.1
                    },
                    {
                        label: '實際收盤（近 30 日）',
                        data: tail,
                        borderColor: '#1c2333',
                        pointRadius: 0,
                        borderWidth: 2,
                        tension: 0.1
                    }
                ]
            },
            options: {
                animation: false,
                scales: {
                    x: { ticks: { autoSkip: true, maxTicksLimit: 12, color: '#7a8299', font: { size: 14 } }, stacked: false },
                    y: {
                        ticks: { color: '#7a8299', font: { size: 14 } },
                        title: {
                            display: true,
                            text: `股價（${data.currency}）`,
                            color: '#7a8299',
                            font: { size: 14, weight: '600' }
                        }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#1c2333', font: { size: 15 } } }
                }
            }
        });
    } catch (err) {
        if (seq !== forecastSeq) return;
        console.error('預測失敗', err);
        if (!opts.silent) summaryEl.innerHTML = `<span class="chart-stamp">預測失敗：${escapeHtml(err.message)}</span>`;
    }
}

// 預測期間切換按鈕
document.getElementById('horizon-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;

    document.querySelectorAll('#horizon-picker .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (currentSymbol) runForecast(currentSymbol, btn.dataset.horizon);
    else currentHorizon = btn.dataset.horizon;
});

async function runSentiment(btn) {
    const symbol = btn.dataset.symbol;
    const cell = document.querySelector(`.ai-result[data-ai="${CSS.escape(symbol)}"]`);

    busyAnalyses++;
    if (cell) {
        // 卡片第一行：按鈕列（停用）；第二行：載入提示
        cell.innerHTML = aiHeadHtml(symbol, { disabled: true, label: '分析中…' }) +
            `<span class="ai-loading">AI 正在閱讀新聞…</span>`;
    } else {
        btn.disabled = true;
        btn.textContent = '分析中…';
    }

    try {
        const res = await fetch(`/api/sentiment/${encodeURIComponent(symbol)}`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || '分析失敗');

        aiResults.set(symbol, json.data);
        if (cell) cell.innerHTML = aiCardHtml(symbol); // 重新渲染整張卡片（含新按鈕）
        runBacktest(symbol);   // AI 分析完成後順便執行過去回測
        runForecast(symbol);   // 同時做未來預測
    } catch (err) {
        if (cell) {
            cell.innerHTML = aiHeadHtml(symbol) +
                `<span class="ai-error">${escapeHtml(err.message)}</span>`;
        }
    } finally {
        busyAnalyses = Math.max(0, busyAnalyses - 1);
        if (!cell) {
            btn.disabled = false;
            btn.textContent = 'AI 分析';
        }
    }
}

tbody.addEventListener('click', async (e) => {
    const aiBtn = e.target.closest('.btn-ai');
    if (aiBtn) return runSentiment(aiBtn);

    const btn = e.target.closest('.btn-delete');
    if (!btn) return;

    try {
        const res = await fetch(`/api/portfolio/${btn.dataset.id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || '刪除失敗');
        await loadPortfolio();
    } catch (err) {
        showMessage(err.message, false);
    }
});

// 每 30 秒自動刷新：持倉報價（含損益）＋ 回測曲線，讓數字近似即時跳動
async function autoRefresh() {
    if (document.hidden) return;       // 分頁在背景時不刷新
    if (busyAnalyses > 0) return;      // AI 分析進行中不刷新，避免洗掉畫面

    if (lastRows.length) {
        await loadQuotes(lastRows.map(r => r.stock_symbol), true);
        render(lastRows);
    }
    if (currentSymbol) {
        await Promise.all([
            runBacktest(currentSymbol, currentRange, { silent: true }),
            runForecast(currentSymbol, currentHorizon, { silent: true })
        ]);
    }
}
setInterval(autoRefresh, 30000);

loadStocks()
    .then(() => Promise.all([loadPortfolio(), loadDailyPicks()]))
    .catch(err => showMessage(err.message, false));
