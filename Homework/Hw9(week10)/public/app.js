const $ = (selector) => document.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  user: null,
  shop: null,
  products: [],
  templates: [],
  selectedTemplate: null,
  cart: new Map(),
};

const els = {
  toast: $("#toast"),
  authView: $("#auth-view"),
  setupView: $("#setup-view"),
  appView: $("#app-view"),
  loginForm: $("#login-form"),
  registerForm: $("#register-form"),
  shopForm: $("#shop-form"),
  templateGrid: $("#template-grid"),
  setupLogout: $("#setup-logout"),
  shopName: $("#shop-name"),
  shopTemplate: $("#shop-template"),
  userName: $("#user-name"),
  logoutBtn: $("#logout-btn"),
  productGrid: $("#product-grid"),
  productEmpty: $("#product-empty"),
  posDatePill: $("#pos-date-pill"),
  cartList: $("#cart-list"),
  cartEmpty: $("#cart-empty"),
  cartTotal: $("#cart-total"),
  cartDate: $("#cart-date"),
  checkoutBtn: $("#checkout-btn"),
  clearCart: $("#clear-cart"),
  ordersDate: $("#orders-date"),
  ordersQuery: $("#orders-query"),
  ordersList: $("#orders-list"),
  ordersEmpty: $("#orders-empty"),
  reportDate: $("#report-date"),
  reportQuery: $("#report-query"),
  reportCount: $("#report-count"),
  reportRevenue: $("#report-revenue"),
  reportAvg: $("#report-avg"),
  reportBody: $("#report-body"),
  reportEmpty: $("#report-empty"),
  productForm: $("#product-form"),
  productList: $("#product-list"),
  productListEmpty: $("#product-list-empty"),
};

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value) {
  return `NT$ ${Number(value || 0).toLocaleString("zh-TW")}`;
}

function formatTime(value) {
  if (!value) return "";
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString("zh-TW", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      (data && data.error) || `請求失敗（${response.status}）`
    );
    error.status = response.status;
    throw error;
  }

  return data || {};
}

let toastTimer = null;

function toast(message, type = "info") {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2600);
}

function showView(name) {
  els.authView.classList.toggle("hidden", name !== "auth");
  els.setupView.classList.toggle("hidden", name !== "setup");
  els.appView.classList.toggle("hidden", name !== "app");
}

function setFormError(form, message) {
  const target = form.querySelector("[data-error]");
  if (target) target.textContent = message || "";
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = busy;
}

function applySession(data) {
  state.user = data.user;
  state.shop = data.shop || null;
  els.userName.textContent = data.user ? data.user.name : "";

  if (state.shop) {
    enterApp();
  } else {
    openSetup();
  }
}

async function loadTemplates() {
  try {
    const { templates } = await api("/api/templates");
    state.templates = templates;
  } catch {
    state.templates = [];
  }
}

function templateLabel(key) {
  const template = state.templates.find((item) => item.key === key);
  return template ? `${template.emoji} ${template.label}` : key || "";
}

async function enterApp() {
  showView("app");
  els.shopName.textContent = state.shop ? state.shop.name : "我的商店";
  els.shopTemplate.textContent = state.shop ? templateLabel(state.shop.template) : "";
  els.userName.textContent = state.user ? state.user.name : "";

  els.ordersDate.value = els.ordersDate.value || localDateString();
  els.reportDate.value = els.reportDate.value || localDateString();

  switchPanel("pos");
  await loadProducts();
}

function openSetup() {
  showView("setup");
  state.selectedTemplate = null;
  els.shopForm.reset();
  setFormError(els.shopForm, "");
  renderTemplates();
}

function renderTemplates() {
  els.templateGrid.innerHTML = "";

  for (const template of state.templates) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `template-card${state.selectedTemplate === template.key ? " selected" : ""}`;

    const emoji = document.createElement("span");
    emoji.className = "template-emoji";
    emoji.textContent = template.emoji;

    const label = document.createElement("span");
    label.className = "template-label";
    label.textContent = template.label;

    const description = document.createElement("span");
    description.className = "template-desc";
    description.textContent = template.description;

    card.append(emoji, label, description);
    card.addEventListener("click", () => {
      state.selectedTemplate = template.key;
      renderTemplates();
    });

    els.templateGrid.append(card);
  }
}

function switchPanel(name) {
  $$(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.panel === name);
  });
  $$(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panelView === name);
  });

  if (name === "orders") {
    loadOrders();
  } else if (name === "report") {
    loadReport();
  } else if (name === "products") {
    loadProducts();
  }
}

async function loadProducts() {
  try {
    const { products } = await api("/api/products");
    state.products = products;
    renderProductGrid();
    renderProductList();
    renderCart();
  } catch (error) {
    if (error.status === 401) {
      showView("auth");
      return;
    }
    toast(error.message, "error");
  }
}

function renderProductGrid() {
  els.productGrid.innerHTML = "";
  els.productEmpty.classList.toggle("hidden", state.products.length > 0);

  for (const product of state.products) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "product-card";

    const name = document.createElement("span");
    name.className = "product-name";
    name.textContent = product.name;

    const price = document.createElement("span");
    price.className = "product-price";
    price.textContent = formatMoney(product.price);

    card.append(name, price);
    card.addEventListener("click", () => addToCart(product));
    els.productGrid.append(card);
  }
}

function renderProductList() {
  els.productList.innerHTML = "";
  els.productListEmpty.classList.toggle("hidden", state.products.length > 0);

  for (const product of state.products) {
    const row = document.createElement("div");
    row.className = "product-row";

    const info = document.createElement("div");
    info.className = "product-row-info";

    const name = document.createElement("span");
    name.className = "product-row-name";
    name.textContent = product.name;

    const price = document.createElement("span");
    price.className = "product-row-price";
    price.textContent = formatMoney(product.price);

    info.append(name, price);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn-danger";
    removeButton.textContent = "刪除";
    removeButton.addEventListener("click", () => deleteProduct(product));

    row.append(info, removeButton);
    els.productList.append(row);
  }
}

function addToCart(product) {
  const current = state.cart.get(product.id) || 0;
  if (current >= 999) {
    toast("單一商品數量已達上限", "error");
    return;
  }
  state.cart.set(product.id, current + 1);
  renderCart();
}

function changeQuantity(productId, delta) {
  const current = state.cart.get(productId) || 0;
  const next = current + delta;

  if (next <= 0) {
    state.cart.delete(productId);
  } else if (next <= 999) {
    state.cart.set(productId, next);
  }

  renderCart();
}

function renderCart() {
  const lines = [];
  for (const [productId, qty] of state.cart) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) {
      state.cart.delete(productId);
      continue;
    }
    lines.push({ product, qty });
  }

  els.cartList.innerHTML = "";
  els.cartEmpty.classList.toggle("hidden", lines.length > 0);

  let total = 0;

  for (const { product, qty } of lines) {
    const subtotal = product.price * qty;
    total += subtotal;

    const item = document.createElement("li");
    item.className = "cart-item";

    const info = document.createElement("div");

    const name = document.createElement("div");
    name.className = "cart-item-name";
    name.textContent = product.name;

    const detail = document.createElement("div");
    detail.className = "cart-item-sub";
    detail.textContent = `${formatMoney(product.price)} × ${qty} = ${formatMoney(subtotal)}`;

    info.append(name, detail);

    const controls = document.createElement("div");
    controls.className = "cart-controls";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "qty-btn";
    minus.textContent = "−";
    minus.addEventListener("click", () => changeQuantity(product.id, -1));

    const value = document.createElement("span");
    value.className = "qty-value";
    value.textContent = String(qty);

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "qty-btn";
    plus.textContent = "+";
    plus.addEventListener("click", () => changeQuantity(product.id, 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cart-remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", "移除商品");
    remove.addEventListener("click", () => {
      state.cart.delete(product.id);
      renderCart();
    });

    controls.append(minus, value, plus, remove);
    item.append(info, controls);
    els.cartList.append(item);
  }

  els.cartTotal.textContent = formatMoney(total);
  els.checkoutBtn.disabled = lines.length === 0;
  els.cartDate.textContent = localDateString();
  els.posDatePill.textContent = localDateString();
}

async function checkout() {
  if (state.cart.size === 0) return;

  const items = Array.from(state.cart, ([productId, qty]) => ({ productId, qty }));
  els.checkoutBtn.disabled = true;

  try {
    const { order } = await api("/api/orders", {
      method: "POST",
      body: { items, localDate: localDateString() },
    });

    state.cart.clear();
    renderCart();
    toast(`交易完成，共 ${formatMoney(order.total)}`, "success");

    if (els.ordersDate.value === order.localDate) loadOrders();
    if (els.reportDate.value === order.localDate) loadReport();
  } catch (error) {
    if (error.status === 401) {
      showView("auth");
      return;
    }
    toast(error.message, "error");
    els.checkoutBtn.disabled = state.cart.size === 0;
  }
}

async function loadOrders() {
  const date = els.ordersDate.value || localDateString();
  els.ordersDate.value = date;

  try {
    const { orders } = await api(`/api/orders?date=${encodeURIComponent(date)}`);
    renderOrders(orders);
  } catch (error) {
    if (error.status === 401) {
      showView("auth");
      return;
    }
    toast(error.message, "error");
  }
}

function renderOrders(orders) {
  els.ordersList.innerHTML = "";
  els.ordersEmpty.classList.toggle("hidden", orders.length > 0);

  for (const order of orders) {
    const card = document.createElement("article");
    card.className = "order-card";

    const head = document.createElement("div");
    head.className = "order-head";

    const left = document.createElement("div");

    const id = document.createElement("div");
    id.className = "order-id";
    id.textContent = `訂單 #${order.id}`;

    const meta = document.createElement("div");
    meta.className = "order-meta";
    meta.textContent = formatTime(order.created_at);

    left.append(id, meta);

    const total = document.createElement("div");
    total.className = "order-total";
    total.textContent = formatMoney(order.total);

    head.append(left, total);

    const list = document.createElement("ul");
    list.className = "order-items";

    for (const item of order.items) {
      const row = document.createElement("li");

      const name = document.createElement("span");
      name.className = "order-item-name";
      name.textContent = item.name;

      const detail = document.createElement("span");
      detail.className = "muted";
      detail.textContent = `${formatMoney(item.price)} × ${item.qty}`;

      const subtotal = document.createElement("strong");
      subtotal.textContent = formatMoney(item.subtotal);

      row.append(name, detail, subtotal);
      list.append(row);
    }

    card.append(head, list);
    els.ordersList.append(card);
  }
}

async function loadReport() {
  const date = els.reportDate.value || localDateString();
  els.reportDate.value = date;

  try {
    const report = await api(`/api/report?date=${encodeURIComponent(date)}`);

    els.reportCount.textContent = String(report.count);
    els.reportRevenue.textContent = formatMoney(report.revenue);
    els.reportAvg.textContent = formatMoney(report.avgOrderValue);

    els.reportBody.innerHTML = "";
    els.reportEmpty.classList.toggle("hidden", report.products.length > 0);

    for (const product of report.products) {
      const row = document.createElement("tr");

      const name = document.createElement("td");
      name.textContent = product.name;

      const qty = document.createElement("td");
      qty.className = "num";
      qty.textContent = String(product.qty);

      const subtotal = document.createElement("td");
      subtotal.className = "num";
      subtotal.textContent = formatMoney(product.subtotal);

      row.append(name, qty, subtotal);
      els.reportBody.append(row);
    }
  } catch (error) {
    if (error.status === 401) {
      showView("auth");
      return;
    }
    toast(error.message, "error");
  }
}

async function createProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.name.value.trim();
  const price = Number(form.price.value);

  if (!name) return;
  if (!Number.isInteger(price) || price < 1) {
    toast("請輸入有效的售價", "error");
    return;
  }

  try {
    const { product } = await api("/api/products", {
      method: "POST",
      body: { name, price },
    });
    state.products.push(product);
    form.reset();
    renderProductGrid();
    renderProductList();
    toast("商品已新增", "success");
  } catch (error) {
    if (error.status === 401) {
      showView("auth");
      return;
    }
    toast(error.message, "error");
  }
}

async function deleteProduct(product) {
  const confirmed = window.confirm(
    `確定要刪除「${product.name}」嗎？舊訂單紀錄不會受影響。`
  );
  if (!confirmed) return;

  try {
    await api(`/api/products/${product.id}`, { method: "DELETE" });
    state.products = state.products.filter((item) => item.id !== product.id);
    state.cart.delete(product.id);
    renderProductGrid();
    renderProductList();
    renderCart();
    toast("商品已刪除", "success");
  } catch (error) {
    if (error.status === 401) {
      showView("auth");
      return;
    }
    toast(error.message, "error");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore
  }
  state.user = null;
  state.shop = null;
  state.products = [];
  state.cart.clear();
  showView("auth");
}

function bindEvents() {
  $$(".tab[data-auth-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab[data-auth-tab]").forEach((item) => {
        item.classList.toggle("active", item === tab);
      });
      const isLogin = tab.dataset.authTab === "login";
      els.loginForm.classList.toggle("hidden", !isLogin);
      els.registerForm.classList.toggle("hidden", isLogin);
    });
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormError(form, "");
    setBusy(form, true);

    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: Object.fromEntries(new FormData(form)),
      });
      form.reset();
      applySession(data);
    } catch (error) {
      setFormError(form, error.message);
    } finally {
      setBusy(form, false);
    }
  });

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormError(form, "");
    setBusy(form, true);

    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: Object.fromEntries(new FormData(form)),
      });
      form.reset();
      applySession(data);
    } catch (error) {
      setFormError(form, error.message);
    } finally {
      setBusy(form, false);
    }
  });

  els.shopForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setFormError(form, "");

    if (!state.selectedTemplate) {
      setFormError(form, "請先選擇一個店鋪模板");
      return;
    }

    setBusy(form, true);

    try {
      const { shop } = await api("/api/shop", {
        method: "POST",
        body: {
          name: form.name.value.trim(),
          template: state.selectedTemplate,
        },
      });
      state.shop = shop;
      form.reset();
      toast("開店成功，歡迎使用 MyShop！", "success");
      await enterApp();
    } catch (error) {
      setFormError(form, error.message);
    } finally {
      setBusy(form, false);
    }
  });

  $$(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => switchPanel(button.dataset.panel));
  });

  els.logoutBtn.addEventListener("click", logout);
  els.setupLogout.addEventListener("click", logout);

  els.checkoutBtn.addEventListener("click", checkout);
  els.clearCart.addEventListener("click", () => {
    state.cart.clear();
    renderCart();
  });

  els.ordersQuery.addEventListener("click", loadOrders);
  els.reportQuery.addEventListener("click", loadReport);
  els.productForm.addEventListener("submit", createProduct);
}

async function init() {
  bindEvents();
  els.ordersDate.value = localDateString();
  els.reportDate.value = localDateString();

  await loadTemplates();

  try {
    const data = await api("/api/auth/me");
    applySession(data);
  } catch {
    showView("auth");
  }
}

init();
