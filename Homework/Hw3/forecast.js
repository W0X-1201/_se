const { getDailyCloses } = require('./yahoo');

// 預測期間（以交易日計）
const HORIZONS = {
    '30d':  { key: '30d',  label: '30 天',  days: 30 },
    '90d':  { key: '90d',  label: '90 天',  days: 90 },
    '180d': { key: '180d', label: '6 個月', days: 180 },
    '1y':   { key: '1y',   label: '1 年',   days: 252 },
};

function normalizeHorizon(h) {
    return HORIZONS[String(h || '').toLowerCase()] || HORIZONS['90d'];
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

// 以代號＋期間＋日期做種子的擬真亂數（同一天結果固定，不會每次刷新都跳）
function seededRandom(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
        h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 標準常態（Box-Muller）
function randn(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function formatDate(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 從最後一個交易日往後推，只排週一～週五（忽略放假）
function nextBusinessDays(lastTime, days) {
    const out = [];
    const d = new Date(lastTime * 1000);
    d.setUTCDate(d.getUTCDate() + 1);
    while (out.length < days) {
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) out.push(formatDate(d));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

// 依最近 1 年真實日報酬的均值/波動，做蒙地卡羅價格預測
async function getForecast(symbol, horizon) {
    const h = normalizeHorizon(horizon);
    try {
        const { currency, points } = await getDailyCloses(symbol, { range: '1y' });
        if (points.length < 30) throw new Error('歷史資料不足');

        const closes = points.map(p => p.close);
        const current = closes[closes.length - 1];

        // 日對數報酬統計
        const rets = [];
        for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
        const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (rets.length - 1);
        const sigma = Math.sqrt(variance);

        // 趨勢外推先打 5 折，且年化漂移限制在 ±20%，避免把去年漲幅直接複製到未來
        const annualDrift = Math.max(-0.20, Math.min(0.20, mu * 252 * 0.5));
        const muUsed = annualDrift / 252;

        const PATHS = 400;
        const today = new Date();
        const todayKey = `${today.getUTCFullYear()}${today.getUTCMonth() + 1}${today.getUTCDate()}`;
        const rand = seededRandom(`${symbol}|${h.key}|${todayKey}`);

        // 模擬 PATHS 條未來路徑
        const finals = [];
        const dayValues = Array.from({ length: h.days }, () => []);
        for (let p = 0; p < PATHS; p++) {
            let s = current;
            for (let d = 0; d < h.days; d++) {
                s = s * Math.exp(muUsed + sigma * randn(rand));
                dayValues[d].push(s);
            }
            finals.push(s);
        }

        const series = dayValues.map((vals, i) => {
            const sorted = [...vals].sort((a, b) => a - b);
            return {
                step: i + 1,
                p10: Number(percentile(sorted, 0.10).toFixed(2)),
                median: Number(percentile(sorted, 0.50).toFixed(2)),
                p90: Number(percentile(sorted, 0.90).toFixed(2))
            };
        });

        const sortedFinals = [...finals].sort((a, b) => a - b);
        const probProfit = finals.filter(v => v > current).length / PATHS;
        const medianFinal = percentile(sortedFinals, 0.5);
        const meanFinal = finals.reduce((a, b) => a + b, 0) / PATHS;

        return {
            source: 'yahoo',
            symbol,
            horizon: h.key,
            label: h.label,
            days: h.days,
            currency: currency || 'TWD',
            current: Number(current.toFixed(2)),
            stats: {
                annReturn: Number(((Math.exp(mu * 252) - 1) * 100).toFixed(2)),  // 過去一年實際年化報酬
                annVol: Number((sigma * Math.sqrt(252) * 100).toFixed(2))         // 年化波動度
            },
            probProfit: Number((probProfit * 100).toFixed(1)),
            medianReturn: Number(((medianFinal / current - 1) * 100).toFixed(2)),
            meanReturn: Number(((meanFinal / current - 1) * 100).toFixed(2)),
            // 近期實際收盤（接到預測線前面）
            recent: points.slice(-30).map(p => ({
                date: formatDate(new Date(p.time * 1000)),
                close: Number(p.close.toFixed(2))
            })),
            futureDates: nextBusinessDays(points[points.length - 1].time, h.days),
            series
        };
    } catch (err) {
        console.warn(`[forecast] ${symbol} 預測失敗，改用模擬:`, err.message);
        return simulateForecast(symbol, h, err.message);
    }
}

// 後備：離線時用簡單隨機走勢預測
function simulateForecast(symbol, h, reason) {
    const current = 150 + Math.random() * 50;
    const sigma = 0.02;
    const rand = seededRandom(`${symbol}|${h.key}|sim`);
    const finals = [];
    const dayValues = Array.from({ length: h.days }, () => []);
    for (let p = 0; p < 400; p++) {
        let s = current;
        for (let d = 0; d < h.days; d++) {
            s = s * Math.exp(-0.5 * sigma * sigma + sigma * randn(rand));
            dayValues[d].push(s);
        }
        finals.push(s);
    }
    const series = dayValues.map((vals, i) => {
        const sorted = [...vals].sort((a, b) => a - b);
        return {
            step: i + 1,
            p10: Number(percentile(sorted, 0.10).toFixed(2)),
            median: Number(percentile(sorted, 0.50).toFixed(2)),
            p90: Number(percentile(sorted, 0.90).toFixed(2))
        };
    });
    const probProfit = finals.filter(v => v > current).length / finals.length;
    return {
        source: 'simulated',
        symbol,
        horizon: h.key,
        label: h.label,
        days: h.days,
        currency: 'TWD',
        current: Number(current.toFixed(2)),
        stats: { annReturn: 0, annVol: Number((sigma * Math.sqrt(252) * 100).toFixed(2)) },
        probProfit: Number((probProfit * 100).toFixed(1)),
        medianReturn: 0,
        meanReturn: 0,
        recent: [],
        futureDates: nextBusinessDays(Math.floor(Date.now() / 1000), h.days),
        series,
        reason
    };
}

module.exports = { getForecast, normalizeHorizon, HORIZONS };
