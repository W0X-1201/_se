import { getTemplate, listTemplates } from "./templates.js";

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 100000;
const MAX_CART_ITEMS = 50;
const MAX_ITEM_QTY = 999;
const MAX_PRICE = 10000000;

const encoder = new TextEncoder();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256
  );
  return toHex(bits);
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(signature);
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }
  return null;
}

function isSecure(request) {
  return new URL(request.url).protocol === "https:";
}

function buildSessionCookie(token, request) {
  const secure = isSecure(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function buildClearCookie(request) {
  const secure = isSecure(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

async function signSession(userId, secret) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${expiry}`;
  const signature = await hmacHex(secret, payload);
  return `${payload}.${signature}`;
}

async function verifySession(token, secret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [userIdRaw, expiryRaw, signature] = parts;
  const userId = Number(userIdRaw);
  const expiry = Number(expiryRaw);

  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;

  const expected = await hmacHex(secret, `${userIdRaw}.${expiryRaw}`);
  if (!timingSafeEqual(signature, expected)) return null;

  return { userId };
}

async function getSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  return verifySession(token, env.AUTH_SECRET);
}

async function getShopByUser(env, userId) {
  return env.DB.prepare(
    "SELECT id, name, template, created_at FROM shops WHERE user_id = ?"
  )
    .bind(userId)
    .first();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function parseIntStrict(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "請求格式不正確" }, 400);

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim() || email.split("@")[0];

  if (!isValidEmail(email)) {
    return json({ error: "電子郵件格式不正確" }, 400);
  }
  if (password.length < 6 || password.length > 128) {
    return json({ error: "密碼長度需介於 6 到 128 字元" }, 400);
  }
  if (name.length < 1 || name.length > 50) {
    return json({ error: "名稱長度需介於 1 到 50 字元" }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (existing) {
    return json({ error: "此電子郵件已經註冊" }, 409);
  }

  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  const result = await env.DB.prepare(
    "INSERT INTO users (email, name, salt, password_hash) VALUES (?, ?, ?, ?)"
  )
    .bind(email, name, salt, passwordHash)
    .run();

  const userId = result.meta.last_row_id;
  const token = await signSession(userId, env.AUTH_SECRET);

  return json(
    { user: { id: userId, email, name }, shop: null },
    201,
    { "Set-Cookie": buildSessionCookie(token, request) }
  );
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "請求格式不正確" }, 400);

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!isValidEmail(email) || password.length === 0) {
    return json({ error: "電子郵件或密碼錯誤" }, 401);
  }

  const user = await env.DB.prepare(
    "SELECT id, email, name, salt, password_hash FROM users WHERE email = ?"
  )
    .bind(email)
    .first();

  if (!user) {
    return json({ error: "電子郵件或密碼錯誤" }, 401);
  }

  const passwordHash = await hashPassword(password, user.salt);
  if (!timingSafeEqual(passwordHash, user.password_hash)) {
    return json({ error: "電子郵件或密碼錯誤" }, 401);
  }

  const token = await signSession(user.id, env.AUTH_SECRET);
  const shop = await getShopByUser(env, user.id);

  return json(
    {
      user: { id: user.id, email: user.email, name: user.name },
      shop: shop || null,
    },
    200,
    { "Set-Cookie": buildSessionCookie(token, request) }
  );
}

async function handleMe(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "請先登入" }, 401);

  const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?")
    .bind(session.userId)
    .first();
  if (!user) return json({ error: "請先登入" }, 401);

  const shop = await getShopByUser(env, user.id);
  return json({ user, shop: shop || null });
}

async function handleCreateShop(request, env, session) {
  const body = await readJson(request);
  if (!body) return json({ error: "請求格式不正確" }, 400);

  const name = String(body.name || "").trim();
  const templateKey = String(body.template || "");
  const template = getTemplate(templateKey);

  if (name.length < 1 || name.length > 50) {
    return json({ error: "店名長度需介於 1 到 50 字元" }, 400);
  }
  if (!template) {
    return json({ error: "請選擇有效的店鋪模板" }, 400);
  }

  const existing = await getShopByUser(env, session.userId);
  if (existing) {
    return json({ error: "你已經開過店了" }, 409);
  }

  const result = await env.DB.prepare(
    "INSERT INTO shops (user_id, name, template) VALUES (?, ?, ?)"
  )
    .bind(session.userId, name, templateKey)
    .run();
  const shopId = result.meta.last_row_id;

  const statements = template.products.map((product) =>
    env.DB.prepare("INSERT INTO products (shop_id, name, price) VALUES (?, ?, ?)").bind(
      shopId,
      product.name,
      product.price
    )
  );
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  const shop = await env.DB.prepare(
    "SELECT id, name, template, created_at FROM shops WHERE id = ?"
  )
    .bind(shopId)
    .first();

  return json({ shop }, 201);
}

async function handleListProducts(request, env, session) {
  const shop = await getShopByUser(env, session.userId);
  if (!shop) return json({ error: "尚未開店" }, 404);

  const { results } = await env.DB.prepare(
    "SELECT id, name, price FROM products WHERE shop_id = ? AND is_deleted = 0 ORDER BY id ASC"
  )
    .bind(shop.id)
    .all();

  return json({ products: results });
}

async function handleCreateProduct(request, env, session) {
  const shop = await getShopByUser(env, session.userId);
  if (!shop) return json({ error: "尚未開店" }, 404);

  const body = await readJson(request);
  if (!body) return json({ error: "請求格式不正確" }, 400);

  const name = String(body.name || "").trim();
  const price = parseIntStrict(body.price);

  if (name.length < 1 || name.length > 50) {
    return json({ error: "商品名稱長度需介於 1 到 50 字元" }, 400);
  }
  if (price === null || price < 1 || price > MAX_PRICE) {
    return json({ error: "售價需為正整數" }, 400);
  }

  const result = await env.DB.prepare(
    "INSERT INTO products (shop_id, name, price) VALUES (?, ?, ?)"
  )
    .bind(shop.id, name, price)
    .run();

  return json(
    { product: { id: result.meta.last_row_id, name, price } },
    201
  );
}

async function handleDeleteProduct(request, env, session, productId) {
  const shop = await getShopByUser(env, session.userId);
  if (!shop) return json({ error: "尚未開店" }, 404);

  const product = await env.DB.prepare(
    "SELECT id FROM products WHERE id = ? AND shop_id = ? AND is_deleted = 0"
  )
    .bind(productId, shop.id)
    .first();

  if (!product) return json({ error: "找不到商品" }, 404);

  await env.DB.prepare(
    "UPDATE products SET is_deleted = 1 WHERE id = ? AND shop_id = ?"
  )
    .bind(productId, shop.id)
    .run();

  return json({ ok: true });
}

async function handleListOrders(request, env, session, url) {
  const shop = await getShopByUser(env, session.userId);
  if (!shop) return json({ error: "尚未開店" }, 404);

  const date = url.searchParams.get("date") || todayString();
  if (!isValidDate(date)) {
    return json({ error: "日期格式需為 YYYY-MM-DD" }, 400);
  }

  const { results: orders } = await env.DB.prepare(
    "SELECT id, total, local_date, created_at FROM orders WHERE shop_id = ? AND local_date = ? ORDER BY id DESC"
  )
    .bind(shop.id, date)
    .all();

  const { results: itemRows } = await env.DB.prepare(
    `SELECT oi.order_id, oi.product_id, oi.name, oi.price, oi.qty, oi.subtotal
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.shop_id = ? AND o.local_date = ?
     ORDER BY oi.id ASC`
  )
    .bind(shop.id, date)
    .all();

  const ordersById = new Map();
  for (const order of orders) {
    ordersById.set(order.id, { ...order, items: [] });
  }
  for (const row of itemRows) {
    const order = ordersById.get(row.order_id);
    if (!order) continue;
    order.items.push({
      productId: row.product_id,
      name: row.name,
      price: row.price,
      qty: row.qty,
      subtotal: row.subtotal,
    });
  }

  return json({ date, orders: Array.from(ordersById.values()) });
}

async function handleCreateOrder(request, env, session) {
  const shop = await getShopByUser(env, session.userId);
  if (!shop) return json({ error: "尚未開店" }, 404);

  const body = await readJson(request);
  if (!body) return json({ error: "請求格式不正確" }, 400);

  const localDate = String(body.localDate || "");
  if (!isValidDate(localDate)) {
    return json({ error: "日期格式需為 YYYY-MM-DD" }, 400);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return json({ error: "購物車是空的" }, 400);
  }
  if (items.length > MAX_CART_ITEMS) {
    return json({ error: "購物車品項過多" }, 400);
  }

  const quantities = new Map();
  for (const item of items) {
    const productId = parseIntStrict(item.productId);
    const qty = parseIntStrict(item.qty);

    if (productId === null || productId <= 0) {
      return json({ error: "商品編號不正確" }, 400);
    }
    if (qty === null || qty < 1 || qty > MAX_ITEM_QTY) {
      return json({ error: "商品數量不正確" }, 400);
    }

    const nextQty = (quantities.get(productId) || 0) + qty;
    if (nextQty > MAX_ITEM_QTY) {
      return json({ error: "商品數量超過上限" }, 400);
    }
    quantities.set(productId, nextQty);
  }

  const productIds = Array.from(quantities.keys());
  const placeholders = productIds.map(() => "?").join(", ");
  const { results: products } = await env.DB.prepare(
    `SELECT id, name, price FROM products
     WHERE shop_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
  )
    .bind(shop.id, ...productIds)
    .all();

  if (products.length !== productIds.length) {
    return json({ error: "部分商品不存在或已下架，請重新整理" }, 400);
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  const lineItems = [];
  let total = 0;

  for (const [productId, qty] of quantities) {
    const product = productMap.get(productId);
    const price = product.price;
    const subtotal = price * qty;
    total += subtotal;
    lineItems.push({
      productId,
      name: product.name,
      price,
      qty,
      subtotal,
    });
  }

  if (total <= 0) {
    return json({ error: "交易金額不正確" }, 400);
  }

  const orderResult = await env.DB.prepare(
    "INSERT INTO orders (shop_id, total, local_date) VALUES (?, ?, ?)"
  )
    .bind(shop.id, total, localDate)
    .run();
  const orderId = orderResult.meta.last_row_id;

  const statements = lineItems.map((item) =>
    env.DB.prepare(
      "INSERT INTO order_items (order_id, product_id, name, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      orderId,
      item.productId,
      item.name,
      item.price,
      item.qty,
      item.subtotal
    )
  );
  await env.DB.batch(statements);

  return json(
    {
      order: {
        id: orderId,
        total,
        localDate,
        items: lineItems,
      },
    },
    201
  );
}

async function handleReport(request, env, session, url) {
  const shop = await getShopByUser(env, session.userId);
  if (!shop) return json({ error: "尚未開店" }, 404);

  const date = url.searchParams.get("date") || todayString();
  if (!isValidDate(date)) {
    return json({ error: "日期格式需為 YYYY-MM-DD" }, 400);
  }

  const summary = await env.DB.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE shop_id = ? AND local_date = ?"
  )
    .bind(shop.id, date)
    .first();

  const { results: products } = await env.DB.prepare(
    `SELECT oi.product_id AS productId, oi.name AS name,
            SUM(oi.qty) AS qty, SUM(oi.subtotal) AS subtotal
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.shop_id = ? AND o.local_date = ?
     GROUP BY oi.product_id, oi.name
     ORDER BY qty DESC, name ASC`
  )
    .bind(shop.id, date)
    .all();

  const count = summary.count || 0;
  const revenue = summary.revenue || 0;

  return json({
    date,
    count,
    revenue,
    avgOrderValue: count > 0 ? Math.round(revenue / count) : 0,
    products,
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 16) {
    return json({ error: "伺服器尚未設定 AUTH_SECRET（長度需至少 16 字元）" }, 500);
  }

  if (pathname === "/api/auth/register" && method === "POST") {
    return handleRegister(request, env);
  }
  if (pathname === "/api/auth/login" && method === "POST") {
    return handleLogin(request, env);
  }
  if (pathname === "/api/auth/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": buildClearCookie(request) });
  }
  if (pathname === "/api/auth/me" && method === "GET") {
    return handleMe(request, env);
  }
  if (pathname === "/api/templates" && method === "GET") {
    return json({ templates: listTemplates() });
  }
  if (pathname === "/api/shop" && method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    const shop = await getShopByUser(env, session.userId);
    return json({ shop: shop || null });
  }
  if (pathname === "/api/shop" && method === "POST") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    return handleCreateShop(request, env, session);
  }
  if (pathname === "/api/products" && method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    return handleListProducts(request, env, session);
  }
  if (pathname === "/api/products" && method === "POST") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    return handleCreateProduct(request, env, session);
  }

  const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (productMatch && method === "DELETE") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    return handleDeleteProduct(request, env, session, Number(productMatch[1]));
  }

  if (pathname === "/api/orders" && method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    return handleListOrders(request, env, session, url);
  }
  if (pathname === "/api/orders" && method === "POST") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    return handleCreateOrder(request, env, session);
  }

  if (pathname === "/api/report" && method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "請先登入" }, 401);
    return handleReport(request, env, session, url);
  }

  return json({ error: "找不到 API 端點" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        console.error("API error:", error);
        return json({ error: "伺服器發生錯誤，請稍後再試" }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
