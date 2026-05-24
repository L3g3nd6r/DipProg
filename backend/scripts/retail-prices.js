/**
 * Точечные розничные цены (ориентир DNS / Citilink / Wildberries, ₽, 2025–2026).
 * Если название содержит ключ — подставляется фиксированная цена (округление до 100 ₽).
 */
const RETAIL_PRICE_BY_KEY = [
  ['Ryzen 5 5600', 10900],
  ['Ryzen 5 7600', 18900],
  ['Ryzen 7 7800X3D', 38900],
  ['Ryzen 9 9950X3D', 74900],
  ['Core i5-12400F', 13900],
  ['Core i5-14600K', 29900],
  ['Core i7-14700K', 39900],
  ['Core i9-14900K', 56900],
  ['RTX 4060', 31900],
  ['RTX 4060 Ti', 42900],
  ['RTX 4070 Super', 64900],
  ['RTX 4080 Super', 99900],
  ['RTX 4090', 189900],
  ['RTX 5060', 29900],
  ['RTX 5070', 52900],
  ['RTX 5070 Ti', 69900],
  ['RTX 5080', 109900],
  ['RTX 5090', 229900],
  ['RX 7600', 29900],
  ['RX 7800 XT', 58900],
  ['RX 7900 XTX', 94900],
  ['990 Pro 1TB', 11900],
  ['990 Pro 2TB', 19900],
  ['SN770 1TB', 7900],
  ['Kingston Fury 32GB DDR5', 10900],
  ['Corsair Vengeance 32GB DDR5', 11200],
  ['B650', 12900],
  ['B760', 11900],
  ['Z790', 21900],
  ['RM750e', 10900],
  ['RM850e', 12900],
  ['Focus GX-750', 11900],
  ['Focus GX-850', 13900],
];

function applyRetailPrice(productName, fallbackRub) {
  const name = String(productName || '');
  for (const [key, price] of RETAIL_PRICE_BY_KEY) {
    if (name.includes(key)) {
      return Math.max(100, Math.round(price / 100) * 100);
    }
  }
  return fallbackRub;
}

module.exports = { applyRetailPrice, RETAIL_PRICE_BY_KEY };
