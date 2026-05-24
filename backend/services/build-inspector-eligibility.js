/**
 * Проверка, достаточно ли полна сборка для осмысленного отчёта ИИ-инспектора.
 * Одна видеокарта или 1–2 позиции дают «случайный» ответ — не анализируем.
 */

const REQUIRED_SLUGS = ['processors', 'motherboard', 'ram'];
const MIN_COMPONENT_COUNT = 4;

const SLUG_LABELS = {
  processors: 'процессор',
  motherboard: 'материнская плата',
  ram: 'ОЗУ',
  gpu: 'видеокарта',
  storage: 'накопитель',
  psu: 'блок питания',
  case: 'корпус',
};

/**
 * @param {string[]} categorySlugs — slug категорий в сборке
 * @param {number} [componentCount] — число позиций (если не передано — по длине slugs)
 * @returns {{ ok: boolean, error?: string }}
 */
function checkBuildInspectorEligibility(categorySlugs, componentCount) {
  const slugs = [...new Set(
    (Array.isArray(categorySlugs) ? categorySlugs : [])
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean),
  )];
  const count = Number.isFinite(componentCount) && componentCount > 0
    ? componentCount
    : slugs.length;

  if (count < 1) {
    return {
      ok: false,
      error: 'Сборка пустая. Добавьте комплектующие, затем запустите ИИ-инспектор.',
    };
  }

  if (count < MIN_COMPONENT_COUNT) {
    return {
      ok: false,
      error:
        `В сборке только ${count} ${pluralComponents(count)}. ` +
        `ИИ-инспектор нужен минимум ${MIN_COMPONENT_COUNT} позиции: процессор, материнская плата, ОЗУ и ещё детали (накопитель, БП, корпус или видеокарта).`,
    };
  }

  if (slugs.length === 1) {
    const only = SLUG_LABELS[slugs[0]] || slugs[0];
    return {
      ok: false,
      error:
        `В сборке только ${only}. ИИ-инспектор не анализирует неполные конфигурации — добавьте процессор, материнскую плату, ОЗУ и другие комплектующие.`,
    };
  }

  const missing = REQUIRED_SLUGS.filter((slug) => !slugs.includes(slug));
  if (missing.length > 0) {
    const names = missing.map((s) => SLUG_LABELS[s] || s).join(', ');
    return {
      ok: false,
      error:
        `Для анализа не хватает: ${names}. ` +
        'Без связки CPU + матплата + ОЗУ отчёт (FPS, узкое место) будет неточным.',
    };
  }

  return { ok: true };
}

function pluralComponents(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'комплектующее';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'комплектующих';
  return 'комплектующих';
}

module.exports = { checkBuildInspectorEligibility, REQUIRED_SLUGS, MIN_COMPONENT_COUNT };
