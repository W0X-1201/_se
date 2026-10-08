// Yahoo Finance 真實數據（歷史收盤價 / 即時價 / 匯率）＋ 價格動能情緒分數
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TTL = {
    chart: 10 * 60 * 1000,     // 短期日線 10 分鐘
    chartLong: 6 * 60 * 60 * 1000, // 長期日線（3 年以上）6 小時
    quote: 5 * 60 * 1000,  // 報價 5 分鐘
    fx: 30 * 60 * 1000,    // 匯率 30 分鐘
};

const cache = new Map();

// 台股代碼 → .TW（純數字 2330、含字母 00981A）；美股維持 AAPL
function toYahooSymbol(symbol) {
    const s = String(symbol || '').trim().toUpperCase();
    if (!s) throw new Error('缺少股票代碼');
    return /^\d+$/.test(s) || /^\d+[A-Z]$/.test(s) ? `${s}.TW` : s;
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

async function fetchJSON(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'application/json' },
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`Yahoo API HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

function cached(key, ttlMs, loader) {
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && now - hit.ts < ttlMs) return hit.promise;
    const promise = loader();
    cache.set(key, { ts: now, promise });
    promise.catch(() => {
        const cur = cache.get(key);
        if (cur && cur.promise === promise) cache.delete(key);
    });
    return promise;
}

// 取得日線收盤序列（含 meta：currency、regularMarketPrice）
// opts 可為字串（Yahoo range，如 '3mo'、'1y'）或 { range } / { years }（自訂年限）
async function getDailyCloses(symbol, opts = '3mo') {
    if (typeof opts === 'string') opts = { range: opts };
    const range = opts.range || null;
    const years = Number(opts.years) || 0;
    if (!range && !years) throw new Error('缺少期間參數');

    const ySym = toYahooSymbol(symbol);
    const key = `chart:${ySym}:${range || 'y' + years}`;
    const ttl = opts.ttlMs || (years >= 3 || ['5y', '10y', 'max'].includes(range) ? TTL.chartLong : TTL.chart);

    return cached(key, ttl, async () => {
        const load = async (targetSym) => {
            const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(targetSym)}?interval=1d`;
            let url;
            if (years) {
                const now = Math.floor(Date.now() / 1000);
                const period1 = now - Math.round(years * 365.25 * 86400);
                url = `${base}&period1=${period1}&period2=${now}`;
            } else {
                url = `${base}&range=${encodeURIComponent(range)}`;
            }

            const json = await fetchJSON(url);
            const result = json && json.chart && json.chart.result && json.chart.result[0];
            if (!result) {
                const desc = json && json.chart && json.chart.error && json.chart.error.description;
                throw new Error(desc || `查無 ${targetSym} 的資料`);
            }
            const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0].close) || [];
            const times = result.timestamp || [];
            const points = [];
            for (let i = 0; i < closes.length; i++) {
                if (typeof closes[i] === 'number') points.push({ time: times[i], close: closes[i] });
            }
            if (!points.length) throw new Error(`${targetSym} 無收盤價資料`);
            const meta = result.meta || {};
            return {
                symbol: targetSym,
                currency: (meta.currency || '').toUpperCase() || null,
                marketPrice: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null,
                points
            };
        };

        try {
            return await load(ySym);
        } catch (err) {
            // 上市查無 → 嘗試上櫃 (.TWO)，例如 5483 中美晶、8069 元太
            if (/404/.test(err.message) && ySym.endsWith('.TW')) {
                return load(ySym.replace(/\.TW$/, '.TWO'));
            }
            throw err;
        }
    });
}

// 目前價（市價優於最後收盤價）；opts.ttlMs 可覆寫快取時間（即時刷新用）
async function getQuote(symbol, opts = {}) {
    const { symbol: ySym, currency, marketPrice, points } =
        await getDailyCloses(symbol, { range: '5d', ttlMs: opts.ttlMs });
    const last = points[points.length - 1].close;
    const price = marketPrice != null ? marketPrice : last;
    return { symbol: ySym, price: Number(price.toFixed(2)), currency: currency || 'USD' };
}

// 匯率：X 兌 TWD（USD → USD/TWD）
async function getFxRateToTWD(currency) {
    const c = String(currency || 'TWD').toUpperCase();
    if (c === 'TWD') return 1;
    const { marketPrice, points } = await getDailyCloses(`${c}TWD=X`, '5d');
    const rate = marketPrice != null ? marketPrice : points[points.length - 1].close;
    if (!rate || !isFinite(rate)) throw new Error(`無法取得 ${c}/TWD 匯率`);
    return rate;
}

// 近 12 個月每股股息（Yahoo events=div，含上市/上櫃 fallback）
async function getDividends(symbol) {
    const ySym = toYahooSymbol(symbol);
    return cached(`div:${ySym}`, TTL.chartLong, async () => {
        const load = async (targetSym) => {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(targetSym)}?range=2y&interval=1d&events=div`;
            const json = await fetchJSON(url);
            const result = json && json.chart && json.chart.result && json.chart.result[0];
            if (!result) throw new Error(`查無 ${targetSym} 的股息資料`);

            const meta = result.meta || {};
            const events = (result.events && result.events.dividends) || {};
            const nowSec = Math.floor(Date.now() / 1000);

            const all = Object.values(events)
                .map(e => ({ time: Number(e.date), amount: Number(e.amount) }))
                .filter(e => e.time > 0 && e.amount > 0 && isFinite(e.amount))
                .sort((a, b) => a.time - b.time);

            const ttmEvents = all.filter(e => e.time >= nowSec - 365 * 86400);
            const ttm = ttmEvents.reduce((sum, e) => sum + e.amount, 0);

            return {
                symbol: targetSym,
                currency: (meta.currency || '').toUpperCase() || null,
                ttm: Number(ttm.toFixed(4)),          // 近 12 個月每股股息合計
                ttmCount: ttmEvents.length,           // 近 12 個月發放次數
                last: all.length ? all[all.length - 1] : null // 最近一次除息
            };
        };

        try {
            return await load(ySym);
        } catch (err) {
            if (/404/.test(err.message) && ySym.endsWith('.TW')) {
                return load(ySym.replace(/\.TW$/, '.TWO'));
            }
            throw err;
        }
    });
}

// 價格動能情緒分數：把「近 5 日報酬」放回該股自己的歷史分佈算百分位，映射到 -1 ~ 1
// 漲幅位在前段（相對自己過去）→ 正分，後段 → 負分，資料不足時退回固定係數
function momentumScore(closes, index) {
    const n = closes.length;
    if (n < 6) return 0;
    const i = clamp(index, 0, n - 1);
    if (i < 5) return 0; // 資料不足，先視為中立

    const r5s = [];
    for (let j = 5; j <= i; j++) r5s.push(closes[j] / closes[j - 5] - 1);
    const current = closes[i] / closes[i - 5] - 1;

    if (r5s.length >= 12) {
        let atOrBelow = 0;
        for (const r of r5s) if (r <= current) atOrBelow++;
        const percentile = atOrBelow / r5s.length;
        return clamp(2 * percentile - 1, -1, 1);
    }

    return clamp(current * 20, -1, 1);
}

module.exports = {
    toYahooSymbol,
    getDailyCloses,
    getQuote,
    getFxRateToTWD,
    getDividends,
    momentumScore,
    clamp
};
