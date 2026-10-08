// ============================================================
// OmniStock AI - 第二階段【AI 情感雷達】設定檔
// ============================================================

module.exports = {
    // --- Gemini API ---
    // 1) 到 Google AI Studio 取得金鑰：https://aistudio.google.com/apikey
    // 2) 填入方式二擇一：
    //    a) 直接填在下面引號內：GEMINI_API_KEY: 'AIzaXxxx...'
    //    b) 維持留空，改用環境變數啟動（建議，金鑰不會進 git）：
    //       Windows CMD : set GEMINI_API_KEY=AIzaXxxx... && npm start
    //       PowerShell  : $env:GEMINI_API_KEY='AIzaXxxx...'; npm start
    //       Linux/macOS : GEMINI_API_KEY=AIzaXxxx... npm start
    //    未填金鑰（或仍是下方預設值）時，後端會自動改用「模擬 AI」，
    //    功能照常運作，不會報錯。
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

    // 使用的 Gemini 模型（可依需求更換，例如 gemini-2.5-flash）
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

    // 呼叫 Gemini 的逾時時間（毫秒），逾時自動降級為模擬 AI
    GEMINI_TIMEOUT_MS: Number(process.env.GEMINI_TIMEOUT_MS) || 10000,

    // 情感分析結果快取時間（毫秒），避免重複消耗 API 額度
    SENTIMENT_CACHE_TTL_MS: Number(process.env.SENTIMENT_CACHE_TTL_MS) || 5 * 60 * 1000,
};
