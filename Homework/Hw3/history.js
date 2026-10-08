const { getDailyCloses, momentumScore } = require('./yahoo');

// 支援的回測期間（query 參數 range）
const PERIODS = {
    '30d': { key: '30d', label: '30 天', days: 30, opts: { range: '3mo' } },
    '1y':  { key: '1y',  label: '1 年',  years: 1,  opts: { years: 1 } },
    '3y':  { key: '3y',  label: '3 年',  years: 3,  opts: { years: 3 } },
    '10y': { key: '10y', label: '10 年', years: 10, opts: { years: 10 } },
    '20y': { key: '20y', label: '20 年', years: 20, opts: { years: 20 } },
    '30y': { key: '30y', label: '30 年', years: 30, opts: { years: 30 } },
};

function normalizePeriod(range) {
    return PERIODS[String(range || '').toLowerCase()] || PERIODS['30d'];
}

function formatDate(time) {
    const d = new Date(time * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// --- 真實歷史數據：Yahoo Finance 日線 + 每日價格動能情緒分數 ---
// fresh=true 時縮短短期資料快取（即時刷新用）
async function getHistoricalData(symbol, range, fresh = false) {
    const period = normalizePeriod(range);
    const ttlMs = fresh
        ? (period.years >= 3 ? 60 * 1000 : 15 * 1000) // 長線資料量大，快取拉長
        : undefined;
    try {
        const { currency, points } = await getDailyCloses(symbol, { ...period.opts, ttlMs });
        const closes = points.map(p => p.close);
        const days = period.days ? points.slice(-period.days) : points;
        const offset = points.length - days.length;

        const data = days.map((p, i) => {
            const idx = offset + i;
            return {
                day: i + 1,
                date: formatDate(p.time),
                price: parseFloat(p.close.toFixed(2)),
                sentiment: parseFloat(momentumScore(closes, idx).toFixed(2))
            };
        });

        return {
            days: data,
            currency: currency || 'TWD',
            source: 'yahoo',
            range: period.key,
            label: period.label
        };
    } catch (err) {
        console.warn(`[history] ${symbol} 取得真實歷史失敗，改用模擬資料:`, err.message);
        return {
            days: simulateHistoricalData(period),
            currency: 'TWD',
            source: 'simulated',
            range: period.key,
            label: period.label
        };
    }
}

// --- 後備：離線時的模擬數據 ---
function simulateHistoricalData(period) {
    const count = period.years ? Math.min(period.years * 252, 7560) : 30;
    const data = [];
    let currentPrice = 150 + Math.random() * 50;

    for (let i = 0; i < count; i++) {
        const change = 1 + (Math.random() * 0.04 - 0.02);
        currentPrice *= change;
        const sentiment = Math.random() * 2 - 1;

        data.push({
            day: i + 1,
            date: null,
            price: parseFloat(currentPrice.toFixed(2)),
            sentiment: parseFloat(sentiment.toFixed(2))
        });
    }
    return data;
}

module.exports = { getHistoricalData, normalizePeriod, PERIODS };
