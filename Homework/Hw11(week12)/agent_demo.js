#!/usr/bin/env node

let config = null;

const TOOLS_SPEC = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "查詢指定城市的本地示範天氣資料（離線、不需聯網）",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名稱，例如：台北、金門" }
        },
        required: ["city"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "安全解析並計算四則運算式，支援括號、小數點與負數，不使用 eval",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "例如：(23 + 31) / 2" }
        },
        required: ["expression"],
        additionalProperties: false
      }
    }
  }
];

const WEATHER_DATA = {
  "台北": { condition: "多雲時晴", temperatureC: 27, humidity: 68 },
  "金門": { condition: "晴，微風", temperatureC: 26, humidity: 72 },
  "台中": { condition: "午後陣雨", temperatureC: 29, humidity: 75 },
  "高雄": { condition: "晴朗", temperatureC: 31, humidity: 64 }
};

function tokenize(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let number = "";
      let dots = 0;
      while (index < expression.length && /[0-9.]/.test(expression[index])) {
        if (expression[index] === ".") dots += 1;
        number += expression[index];
        index += 1;
      }
      if (dots > 1 || number === ".") throw new Error(`數字格式無效：${number}`);
      tokens.push({ type: "number", value: Number(number) });
      continue;
    }
    if ("+-*/()".includes(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    throw new Error(`不允許的字元：${char}`);
  }
  return tokens;
}

class ExpressionParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  peek() {
    return this.tokens[this.position];
  }

  consume() {
    return this.tokens[this.position++];
  }

  parse() {
    const value = this.parseExpression();
    if (this.peek()) throw new Error(`多餘的內容：${this.peek().value}`);
    return value;
  }

  parseExpression() {
    let value = this.parseTerm();
    while (this.peek() && (this.peek().value === "+" || this.peek().value === "-")) {
      const operator = this.consume().value;
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  parseTerm() {
    let value = this.parseFactor();
    while (this.peek() && (this.peek().value === "*" || this.peek().value === "/")) {
      const operator = this.consume().value;
      const right = this.parseFactor();
      if (operator === "/" && right === 0) throw new Error("除數不可為 0");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  parseFactor() {
    const token = this.peek();
    if (!token) throw new Error("運算式不完整");
    if (token.value === "+" || token.value === "-") {
      this.consume();
      const value = this.parseFactor();
      return token.value === "-" ? -value : value;
    }
    if (token.value === "(") {
      this.consume();
      const value = this.parseExpression();
      if (!this.peek() || this.peek().value !== ")") throw new Error("缺少右括號");
      this.consume();
      return value;
    }
    if (token.type === "number") {
      this.consume();
      return token.value;
    }
    throw new Error(`非預期的符號：${token.value}`);
  }
}

function calculate(expression) {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new Error("expression 必須是非空字串");
  }
  if (expression.length > 200) throw new Error("運算式過長（上限 200 字元）");
  const value = new ExpressionParser(tokenize(expression)).parse();
  if (!Number.isFinite(value)) throw new Error("計算結果不是有限數值");
  return { expression, result: Number(value.toFixed(10)) };
}

function getWeather(city) {
  const name = typeof city === "string" && city.trim() ? city.trim() : "台北";
  const known = WEATHER_DATA[name];
  if (known) return { city: name, source: "本地示範資料", ...known };
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)) % 9973;
  return {
    city: name,
    source: "本地示範資料（由城市名稱決定）",
    condition: "晴時多雲",
    temperatureC: 20 + (hash % 12),
    humidity: 50 + (hash % 30)
  };
}

const LOCAL_TOOLS = {
  get_weather: (args) => getWeather(args.city),
  calculate: (args) => calculate(args.expression)
};

function parseArguments(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || raw.trim() === "") return {};
  return JSON.parse(raw);
}

function executeToolCall(call) {
  const name = call.function && call.function.name;
  if (!Object.prototype.hasOwnProperty.call(LOCAL_TOOLS, name)) {
    return { ok: false, error: `未知工具：${name}` };
  }
  try {
    const args = parseArguments(call.function.arguments);
    return { ok: true, data: LOCAL_TOOLS[name](args) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function extractCity(goal) {
  const known = Object.keys(WEATHER_DATA).find((name) => goal.includes(name));
  if (known) return known;
  const match = goal.match(/([\u4e00-\u9fa5A-Za-z]{1,8})(?:的天氣|天氣如何|天氣|weather)/i);
  if (!match) return "台北";
  const cleaned = match[1].replace(/^(請問|請告訴我|幫我|查詢|我想要)/, "");
  return cleaned.slice(-3);
}

function mockArguments(goal) {
  const city = extractCity(goal);
  const mathMatch = goal.match(/((?:\d+(?:\.\d+)?|[()+\-*/×÷\s]){3,})/);
  let expression = mathMatch
    ? mathMatch[1].replace(/×/g, "*").replace(/÷/g, "/").trim()
    : "(23 + 31) / 2";
  try {
    calculate(expression);
  } catch {
    expression = "(23 + 31) / 2";
  }
  return { city, expression };
}

function mockChatCompletion(messages, goal) {
  const { city, expression } = mockArguments(goal);
  const observations = messages.filter((message) => message.role === "tool");
  if (observations.length === 0) {
    return {
      content: "我需要先取得天氣與計算結果，才能完整回答使用者。",
      tool_calls: [
        {
          id: "call_mock_1",
          type: "function",
          function: { name: "get_weather", arguments: JSON.stringify({ city }) }
        },
        {
          id: "call_mock_2",
          type: "function",
          function: { name: "calculate", arguments: JSON.stringify({ expression }) }
        }
      ]
    };
  }
  const parts = [];
  for (const message of observations) {
    const payload = JSON.parse(message.content);
    if (!payload.ok) {
      parts.push(`${message.name} 失敗：${payload.error}`);
    } else if (message.name === "get_weather") {
      const data = payload.data;
      parts.push(`${data.city} 天氣為${data.condition}，氣溫約 ${data.temperatureC}°C，濕度 ${data.humidity}%`);
    } else if (message.name === "calculate") {
      const data = payload.data;
      parts.push(`${data.expression} = ${data.result}`);
    }
  }
  return {
    content: `根據工具觀察結果，${parts.join("；")}。以上數值皆由本地工具產生，未呼叫任何外部服務。`,
    tool_calls: []
  };
}

async function requestChatCompletion(messages, config) {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: TOOLS_SPEC,
      tool_choice: "auto",
      temperature: 0.2
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LLM API 回應 ${response.status}：${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  const message = payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!message) throw new Error(`LLM API 回應缺少 choices[0].message：${text.slice(0, 500)}`);
  return { content: message.content || "", tool_calls: message.tool_calls || [] };
}

function printJson(label, value) {
  console.log(`${label}\n${JSON.stringify(value, null, 2)}`);
}

async function runAgent(goal, maxSteps = 6) {
  const messages = [{ role: "user", content: goal }];

  console.log("=".repeat(64));
  console.log(config.mock
    ? "🧪 目前為離線模擬模式（MOCK），未呼叫任何外部 API"
    : `🌐 目前為真實 LLM API 模式（model: ${config.model}）`);
  console.log("=".repeat(64));
  console.log(`🎯 目標：${goal}\n`);

  for (let step = 1; step <= maxSteps; step += 1) {
    console.log(`--- Step ${step} / ${maxSteps} ---`);
    let reply;
    try {
      reply = config.mock
        ? mockChatCompletion(messages, goal)
        : await requestChatCompletion(messages, config);
    } catch (error) {
      console.error(`❌ LLM 請求失敗：${error.message}`);
      return { answer: null, messages, steps: step };
    }

    const assistantMessage = { role: "assistant", content: reply.content };
    if (reply.tool_calls.length > 0) assistantMessage.tool_calls = reply.tool_calls;
    messages.push(assistantMessage);
    console.log(`🧠 模型回覆：${reply.content || "(無文字，僅回傳工具呼叫)"}`);

    if (reply.tool_calls.length === 0) {
      console.log("✅ 最終回覆：");
      console.log(reply.content);
      console.log(`\n📊 完成：共 ${step} 個 step、${step} 輪模型請求、${messages.length} 則訊息。`);
      return { answer: reply.content, messages, steps: step };
    }

    printJson("🔧 tool_calls：", reply.tool_calls);
    for (const call of reply.tool_calls) {
      const result = executeToolCall(call);
      const toolMessage = {
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result)
      };
      messages.push(toolMessage);
      console.log(`⚙️  本地執行 ${call.function.name}：${toolMessage.content}`);
      printJson("📨 回傳 role: \"tool\" 訊息：", toolMessage);
    }
    console.log("");
  }

  const warning = `⚠️ 已達 maxSteps=${maxSteps} 上限，為避免無限迴圈已強制停止。`;
  console.warn(warning);
  return { answer: null, messages, steps: maxSteps, warning };
}

function parseArgs(argv) {
  const options = {
    mock: false,
    goal: "請告訴我台北的天氣，並幫我計算 (23 + 31) / 2 的結果。"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mock") {
      options.mock = true;
    } else if (argument === "--goal") {
      options.goal = argv[++index];
      if (!options.goal) throw new Error("--goal 後方必須提供目標字串");
    } else if (argument === "--help" || argument === "-h") {
      console.log("用法：node agent_demo.js [--mock] [--goal \"你的目標\"]");
      process.exit(0);
    } else {
      throw new Error(`未知參數：${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !options.mock) {
    console.log("ℹ️ 未偵測到 OPENAI_API_KEY，自動切換為離線模擬模式（也可用 --mock 明確指定）。\n");
    options.mock = true;
  }
  config = {
    mock: options.mock,
    apiKey: apiKey || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.LLM_MODEL || "gpt-4o-mini"
  };
  await runAgent(options.goal, 6);
}

main().catch((error) => {
  console.error(`程式錯誤：${error.message}`);
  process.exitCode = 1;
});
