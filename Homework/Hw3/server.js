const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getNewsForSymbol } = require('./news'); // 引入 news.js
const { analyzeSentiment } = require('./ai');   // 引入 ai.js
const { getHistoricalData } = require('./history'); // 引入 history.js
const { getForecast } = require('./forecast');      // 引入 forecast.js（未來預測）
const { getQuote, getFxRateToTWD, getDividends, momentumScore, getDailyCloses } = require('./yahoo'); // 引入 yahoo.js（真實報價）

const app = express();
const PORT = 3100;

// --- 中間件設定 ---
app.use(express.json());
app.use(express.static('public'));

// --- 股票代碼資料（前端自動帶入公司名稱用） ---
const stocks = require('./data/stocks.json');
const stockIndex = new Map(stocks.map(s => [s.symbol, s.name]));

app.get('/api/stocks', (req, res) => {
    res.json({ success: true, data: stocks });
});

app.get('/api/stocks/:symbol', (req, res) => {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    const name = stockIndex.get(symbol);
    if (!name) return res.status(404).json({ success: false, message: '查無此股票代碼' });
    res.json({ success: true, data: { stock_symbol: symbol, company_name: name } });
});

// --- 資料庫初始化 ---
const db = new sqlite3.Database('./portfolio.sqlite', (err) => {
    if (err) console.error('資料庫連線失敗:', err.message);
    else console.log('已連線至 SQLite 資料庫。');
});

// 建立持倉資料表
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS portfolio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_symbol TEXT,
        shares INTEGER,
        buy_price REAL,
        company_name TEXT
    )`);
});

// --- 路由 1：獲取所有持倉 (第一階段) ---
app.get('/api/portfolio', (req, res) => {
    db.all("SELECT * FROM portfolio", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: rows });
    });
});

// --- 路由 2：新增持倉 (第一階段) ---
app.post('/api/portfolio', (req, res) => {
    const { stock_symbol, shares, buy_price, company_name } = req.body || {};

    const symbol = typeof stock_symbol === 'string' ? stock_symbol.trim().toUpperCase() : '';
    const company = typeof company_name === 'string' ? company_name.trim() : '';
    const shareCount = Number(shares);
    const price = Number(buy_price);

    if (!symbol) return res.status(400).json({ success: false, message: '股票代碼不可為空' });
    if (!company && !stockIndex.has(symbol)) {
        return res.status(400).json({ success: false, message: '公司名稱不可為空（未知代碼需手動填寫）' });
    }
    const finalCompany = company || stockIndex.get(symbol);
    if (!Number.isFinite(shareCount) || shareCount <= 0) {
        return res.status(400).json({ success: false, message: '持有股數必須大於 0' });
    }
    if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({ success: false, message: '買入價格不可為負數' });
    }

    const sql = `INSERT INTO portfolio (stock_symbol, shares, buy_price, company_name) VALUES (?, ?, ?, ?)`;
    db.run(sql, [symbol, shareCount, price, finalCompany], function(err) {
        if (err) return res.status(500).json({ success: false, message: err.message });
        const data = { id: this.lastID, stock_symbol: symbol, shares: shareCount, buy_price: price, company_name: finalCompany };
        res.status(201).json({ success: true, id: this.lastID, data });
    });
});

// --- 路由 3：刪除持倉 (第一階段) ---
app.delete('/api/portfolio/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM portfolio WHERE id = ?`, id, function(err) {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true });
    });
});

// --- 路由 4：AI 情感分析 (第二階段) ---
app.get('/api/sentiment/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol;
        // 1. 獲取該股票的真實新聞
        const news = await getNewsForSymbol(symbol);
        // 2. 使用 ai.js 進行分析
        const result = await analyzeSentiment(symbol, news);
        // 3. 回傳結果
        res.json({ success: true, data: result });
    } catch (error) {
        console.error("AI 分析錯誤:", error);
        res.status(500).json({ success: false, message: "AI 分析失敗" });
    }
});

// --- 路由 5：策略回測 (第三階段，Yahoo 真實歷史數據)
// query 參數 range：30d / 1y / 3y / 10y / 20y / 30y（預設 30d）
app.get('/api/backtest/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol;
        const fresh = req.query.fresh === '1';
        const { days, currency, source, range, label } =
            await getHistoricalData(symbol, req.query.range, fresh);

        // 初始資金＝首日收盤價（以「股價」為基準，1 股的概念，走勢與股價同尺度）
        const initialCapital = days.length ? days[0].price : 10000;
        let cash = initialCapital;
        let shares = 0;
        const equityCurve = []; // 用來記錄每天的總資產

        // 交易統計：每次賣出結算一筆完整交易
        let buys = 0, sells = 0, roundTrips = 0, wins = 0;
        let lastBuyPrice = null;
        let bestTrade = null, worstTrade = null;

        days.forEach(day => {
            // 簡單策略：情緒 > 0.5 買入，情緒 < -0.3 賣出
            if (day.sentiment > 0.5 && cash > 0) {
                shares = cash / day.price; // 全倉買入
                cash = 0;
                buys++;
                if (lastBuyPrice === null) lastBuyPrice = day.price;
            } else if (day.sentiment < -0.3 && shares > 0) {
                cash = shares * day.price; // 全倉賣出
                shares = 0;
                sells++;
                if (lastBuyPrice !== null) {
                    const ret = (day.price / lastBuyPrice - 1) * 100;
                    roundTrips++;
                    if (ret > 0) wins++;
                    if (bestTrade === null || ret > bestTrade) bestTrade = ret;
                    if (worstTrade === null || ret < worstTrade) worstTrade = ret;
                    lastBuyPrice = null;
                }
            }

            const totalEquity = cash + (shares * day.price);
            equityCurve.push({ day: day.day, date: day.date, equity: parseFloat(totalEquity.toFixed(2)) });
        });

        // --- 詳細績效指標 ---
        const initial = initialCapital;
        const finalBalance = equityCurve[equityCurve.length - 1].equity;
        const totalReturn = (finalBalance / initial - 1) * 100;
        const years = equityCurve.length / 252;
        const annualReturn = years > 0
            ? (Math.pow(finalBalance / initial, 1 / years) - 1) * 100
            : totalReturn;

        // 最大回撤：資產從前高點下跌的最大幅度
        let peak = -Infinity, maxDrawdown = 0;
        equityCurve.forEach(d => {
            peak = Math.max(peak, d.equity);
            if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - d.equity) / peak);
        });

        res.json({
            success: true,
            symbol,
            source,            // yahoo = 真實數據 / simulated = 離線模擬
            currency,          // TWD / USD
            range,             // 30d / 1y / 3y / 10y / 20y / 30y
            label,             // 顯示名稱，如「10 年」
            tradingDays: equityCurve.length,
            initialCapital: initial,
            equityCurve,
            finalBalance,
            metrics: {
                totalReturn: parseFloat(totalReturn.toFixed(2)),
                annualReturn: parseFloat(annualReturn.toFixed(2)),
                maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
                buys,
                sells,
                roundTrips,
                winRate: roundTrips > 0 ? parseFloat((wins / roundTrips * 100).toFixed(1)) : null,
                bestTrade: bestTrade !== null ? parseFloat(bestTrade.toFixed(2)) : null,
                worstTrade: worstTrade !== null ? parseFloat(worstTrade.toFixed(2)) : null
            }
        });
    } catch (error) {
        console.error('回測錯誤:', error);
        res.status(500).json({ success: false, message: '回測失敗: ' + error.message });
    }
});

// --- 路由 6：未來走勢預測（蒙地卡羅，基於最近 1 年真實日報酬）
// query horizon：30d / 90d / 180d / 1y（預設 90d）
app.get('/api/forecast/:symbol', async (req, res) => {
    try {
        const result = await getForecast(req.params.symbol, req.query.horizon);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('預測錯誤:', error);
        res.status(500).json({ success: false, message: '預測失敗: ' + error.message });
    }
});

// --- 路由 7：真實報價（含換算新台幣，供持倉表格顯示）
// ?fresh=1 時縮短快取至 15 秒，供前端每 30 秒自動刷新使用
app.get('/api/quotes', async (req, res) => {
    try {
        const codes = String(req.query.codes || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 50);

        if (!codes.length) return res.status(400).json({ success: false, message: '缺少 codes 參數' });

        const fresh = req.query.fresh === '1';
        const ttlMs = fresh ? 15 * 1000 : undefined;

        const data = {};
        await Promise.all(codes.map(async code => {
            try {
                const quote = await getQuote(code, { ttlMs });
                const [fxRate, dividend] = await Promise.all([
                    getFxRateToTWD(quote.currency),
                    getDividends(code).catch(() => null) // 沒有股息資料不影響報價
                ]);
                data[code] = {
                    symbol: quote.symbol,
                    price: quote.price,
                    currency: quote.currency,
                    fxRate: parseFloat(fxRate.toFixed(4)),
                    priceTWD: parseFloat((quote.price * fxRate).toFixed(2)),
                    // 近 12 個月每股股息 + 股利率（以目前價計）
                    dividend: dividend && dividend.ttm > 0
                        ? {
                            ttm: dividend.ttm,
                            currency: dividend.currency || quote.currency,
                            count: dividend.ttmCount,
                            last: dividend.last
                        }
                        : null,
                    dividendYield: dividend && dividend.ttm > 0 && quote.price > 0
                        ? Number((dividend.ttm / quote.price).toFixed(4))
                        : null,
                    source: 'yahoo'
                };
            } catch (err) {
                data[code] = null; // 查不到就回 null，前端自行後退
            }
        }));

        res.json({ success: true, data });
    } catch (error) {
        console.error('報價錯誤:', error);
        res.status(500).json({ success: false, message: '取得報價失敗' });
    }
});

// 有限度併發執行（避免同時對 Yahoo 發太多請求）
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const idx = next++;
            out[idx] = await fn(items[idx]);
        }
    }));
    return out;
}

// --- 路由 8：每日必買（掃描股票清單，依價格動能分數排序取前 5）
const picksCache = { ts: 0, data: null };
app.get('/api/daily-picks', async (req, res) => {
    try {
        const TTL = 30 * 60 * 1000; // 30 分鐘內視為「今日」結果
        if (picksCache.data && Date.now() - picksCache.ts < TTL) {
            return res.json({ success: true, ...picksCache.data, cached: true });
        }

        const scored = await mapLimit(stocks, 8, async (s) => {
            try {
                const { points } = await getDailyCloses(s.symbol, { range: '3mo' });
                const closes = points.map(p => p.close);
                if (closes.length < 6) return null;
                const last = closes[closes.length - 1];
                const prev5 = closes[closes.length - 6];
                return {
                    symbol: s.symbol,
                    name: s.name,
                    score: parseFloat(momentumScore(closes, closes.length - 1).toFixed(2)),
                    chg5: parseFloat(((last / prev5 - 1) * 100).toFixed(2))
                };
            } catch (err) {
                console.warn(`[daily-picks] ${s.symbol} 掃描失敗:`, err.message);
                return null; // 個別抓不到就跳過
            }
        });

        const ranked = scored.filter(Boolean).sort((a, b) => b.score - a.score);
        // 買進訊號（分數 > 0.5）優先；不足時取排名前 5
        let picks = ranked.filter(r => r.score > 0.5).slice(0, 5);
        if (!picks.length) picks = ranked.slice(0, 5);

        // 只對入選的補報價
        await Promise.all(picks.map(async (p) => {
            try {
                const quote = await getQuote(p.symbol);
                const fx = await getFxRateToTWD(quote.currency);
                p.price = quote.price;
                p.currency = quote.currency;
                p.priceTWD = parseFloat((quote.price * fx).toFixed(2));
            } catch { /* 沒報價就不顯示價格 */ }
        }));

        const data = {
            date: new Date().toISOString().slice(0, 10),
            source: 'yahoo',
            totalScanned: ranked.length,
            picks
        };
        picksCache.ts = Date.now();
        picksCache.data = data;
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('每日必買錯誤:', error);
        res.status(500).json({ success: false, message: '每日必買產生失敗: ' + error.message });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`伺服器運行中: http://localhost:${PORT}`);
});