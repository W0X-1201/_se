const { getDailyCloses, momentumScore } = require('./yahoo');

// AI 情感分析：以真實價格動能（近 5 日 / 10 日漲跌幅）換算 -1 ~ 1 情緒分數
async function analyzeSentiment(symbol, news) {
    try {
        const { points } = await getDailyCloses(symbol, '3mo');
        const closes = points.map(p => p.close);
        const score = parseFloat(momentumScore(closes, closes.length - 1).toFixed(2));

        const last = closes[closes.length - 1];
        const pctOf = n => {
            const prev = closes[Math.max(0, closes.length - 1 - n)];
            return prev ? (last / prev - 1) * 100 : 0;
        };
        const chg5 = pctOf(5);
        const chg20 = pctOf(20);
        const chg60 = pctOf(60);

        // 52 週（此處以近 3 個月）高低點距離
        const high = Math.max(...closes);
        const low = Math.min(...closes);
        const distHigh = (last / high - 1) * 100;
        const distLow = (last / low - 1) * 100;

        // 年化波動度（近 3 個月日報酬標準差 × √252）
        const rets = [];
        for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
        const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + (b - mu) * (b - mu), 0) / Math.max(1, rets.length - 1);
        const annVol = Math.sqrt(variance) * Math.sqrt(252) * 100;

        // 動能在近 3 個月所有樣本中的百分位（越高代表近期動能越強）
        const r5List = [];
        for (let i = 5; i < closes.length; i++) r5List.push(closes[i] / closes[i - 5] - 1);
        const lastR5 = last / closes[Math.max(0, closes.length - 6)] - 1;
        const below = r5List.filter(r => r < lastR5).length;
        const momentumPctile = Math.round((below / Math.max(1, r5List.length)) * 100);

        const fmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
        const verdict = score > 0.3 ? '偏多' : score < -0.3 ? '偏空' : '中性';
        const summary =
            `近 5 日${chg5 >= 0 ? '上漲' : '下跌'} ${Math.abs(chg5).toFixed(2)}%、近 20 日 ${fmt(chg20)}，` +
            `動能在近 3 月第 ${momentumPctile} 百分位（${verdict}）；` +
            `年化波動 ${annVol.toFixed(1)}%，距期間高點 ${fmt(distHigh)}。`;

        const details = [
            { label: '近 5 日', value: fmt(chg5) },
            { label: '近 20 日', value: fmt(chg20) },
            { label: '近 60 日', value: fmt(chg60) },
            { label: '動能百分位', value: `P${momentumPctile}` },
            { label: '年化波動度', value: `${annVol.toFixed(1)}%` },
            { label: '距高點／低點', value: `${fmt(distHigh)} ／ ${fmt(distLow)}` }
        ];

        return { score, summary, details, news, source: 'momentum' };
    } catch (err) {
        console.warn(`[AI] ${symbol} 動能分析失敗，改用模擬:`, err.message);
        return mockSentiment(symbol, news);
    }
}

// 後備：無法連線時的模擬分析
function mockSentiment(symbol, news) {
    const mockScores = [0.8, -0.5, 0.1, 0.6, -0.2];
    const score = mockScores[Math.floor(Math.random() * mockScores.length)];
    const summaries = {
        positive: '市場對其近期表現反應熱烈，整體趨勢看好。',
        negative: '近期出現負面消息，投資者情緒較為悲觀。',
        neutral: '目前市場看法分歧，處於觀望狀態。'
    };
    const summary = score > 0.3 ? summaries.positive : (score < -0.3 ? summaries.negative : summaries.neutral);
    return { score, summary, details: [], news, source: 'mock' };
}

module.exports = { analyzeSentiment };
