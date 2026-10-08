const fs = require('fs');
const path = require('path');

// 讀取代碼 → 公司名稱（用來查新聞）
const stocks = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'stocks.json'), 'utf8'));
const nameMap = new Map(stocks.map(s => [s.symbol.toUpperCase(), s.name]));

const mockNews = {
    'AAPL': [
        "蘋果公司發布新一代 AI 功能，市場反應熱烈",
        "分析師上調蘋果目標價，看好服務營收成長",
        "供應鏈傳出新產品量產延遲，部分投資者擔憂"
    ],
    'TSLA': [
        "特斯拉新款廉價車型曝光，預計增加市佔率",
        "馬斯克表示自動駕駛技術取得重大突破",
        "電動車市場競爭加劇，利潤率面臨壓力"
    ],
    'DEFAULT': [
        "市場整體呈現震盪走勢",
        "投資者關注下週公布的經濟數據",
        "產業分析師建議採取分批買入策略"
    ]
};

const cache = new Map();
const NEWS_TTL = 10 * 60 * 1000; // 10 分鐘

// 取得該股票的真實新聞標題（Google News RSS），失敗時退回模擬
async function getNewsForSymbol(symbol) {
    const key = String(symbol || '').toUpperCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < NEWS_TTL) return hit.value;

    const promise = fetchNews(key);
    cache.set(key, { ts: Date.now(), value: promise });
    return promise;
}

async function fetchNews(symbol) {
    const name = nameMap.get(symbol) || symbol;
    const query = encodeURIComponent(`${name} 股價`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml,text/xml' },
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
        const xml = await res.text();
        const titles = [];
        const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
        let m;
        while ((m = re.exec(xml)) !== null && titles.length < 5) {
            const t = m[1].trim();
            if (t) titles.push(t);
        }
        if (!titles.length) throw new Error('無新聞標題');
        console.log(`[news] ${symbol} 取得 ${titles.length} 則真實新聞`);
        return titles;
    } catch (err) {
        console.warn(`[news] ${symbol} 取得真實新聞失敗，改用模擬:`, err.message);
        return mockNews[symbol] || mockNews['DEFAULT'];
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { getNewsForSymbol };
