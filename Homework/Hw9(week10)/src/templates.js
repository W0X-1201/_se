export const templates = {
  bubble_tea: {
    key: "bubble_tea",
    label: "珍珠奶茶",
    emoji: "🧋",
    description: "手搖飲料店，適合快速點單與外帶。",
    products: [
      { name: "經典珍珠奶茶", price: 65 },
      { name: "黑糖珍珠鮮奶", price: 75 },
      { name: "冬瓜檸檬", price: 55 },
      { name: "四季春青茶", price: 40 },
      { name: "紅茶拿鐵", price: 60 },
      { name: "芋圓奶茶", price: 70 },
    ],
  },
  barber: {
    key: "barber",
    label: "理髮",
    emoji: "💈",
    description: "男士理髮與造型服務，以服務項目計價。",
    products: [
      { name: "男士剪髮", price: 400 },
      { name: "洗加剪", price: 550 },
      { name: "兒童剪髮", price: 300 },
      { name: "染髮", price: 1200 },
      { name: "燙髮", price: 1500 },
      { name: "頭皮護理", price: 600 },
    ],
  },
  grocery: {
    key: "grocery",
    label: "雜貨",
    emoji: "🛒",
    description: "日常雜貨與民生用品，適合社區小店。",
    products: [
      { name: "雞蛋（10 入）", price: 60 },
      { name: "白米（1 公斤）", price: 55 },
      { name: "沙拉油", price: 85 },
      { name: "醬油", price: 45 },
      { name: "衛生紙（6 包）", price: 120 },
      { name: "洗衣精", price: 99 },
    ],
  },
  coffee: {
    key: "coffee",
    label: "咖啡",
    emoji: "☕",
    description: "精品咖啡與輕食，營造溫暖的日常。",
    products: [
      { name: "美式咖啡", price: 55 },
      { name: "拿鐵", price: 70 },
      { name: "卡布奇諾", price: 70 },
      { name: "手沖單品", price: 120 },
      { name: "冰滴咖啡", price: 130 },
      { name: "可頌", price: 65 },
    ],
  },
};

export function getTemplate(key) {
  return templates[key] || null;
}

export function listTemplates() {
  return Object.values(templates).map((template) => ({
    key: template.key,
    label: template.label,
    emoji: template.emoji,
    description: template.description,
    products: template.products,
  }));
}
