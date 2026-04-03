/**
 * Простой фильтр ненормативной лексики для русского языка.
 * Заменяет нецензурные слова на *** в любом тексте.
 */

// Базовые корни нецензурных слов (только очевидные)
const PROFANITY_ROOTS = [
  'хуй', 'хуе', 'хуя', 'хуё', 'хую', 'ёб', 'еб', 'ёба', 'ебал', 'ебан',
  'пизд', 'пиzд', 'блядь', 'бляд', 'шлюх', 'ёбан', 'ёбну',
  'мудак', 'мудил', 'мудо', 'залуп', 'дрочи', 'дроч',
  'сука', 'суч', 'гандон', 'пидор', 'пидар', 'педик', 'педер',
  'ёп', 'ёпт', 'ёптвою', 'нахуй', 'похуй', 'захуй',
  'ёбаный', 'ёбаная', 'ёбаное', 'ёбаные',
  'пиздец', 'пиздит', 'пиздит',
  'блин', // не мат, но оставим для полноты
];

// Исключения — слова, содержащие корни, но не являющиеся матом
const WHITELIST = ['блинный', 'блины', 'блинчик', 'сукачёв', 'шлюпка'];

/**
 * Проверяет, содержит ли текст нецензурную лексику.
 */
function hasProfanity(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  if (WHITELIST.some((w) => lower.includes(w))) return false;
  return PROFANITY_ROOTS.some((root) => lower.includes(root));
}

/**
 * Заменяет нецензурные слова на ***.
 * Возвращает очищенную строку.
 */
function filterProfanity(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  for (const root of PROFANITY_ROOTS) {
    const regex = new RegExp(`\\S*${escapeRegex(root)}\\S*`, 'gi');
    result = result.replace(regex, (match) => {
      const lower = match.toLowerCase();
      if (WHITELIST.some((w) => lower === w)) return match;
      return '***';
    });
  }
  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { hasProfanity, filterProfanity };
