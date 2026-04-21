/**
 * ИИ-чат: ответ текстом или подбор сборок.
 *
 * Режимы:
 * 1) OPENAI_API_KEY — облачная модель (OpenAI или совместимый API: Groq, OpenRouter и т.д.).
 *    Каталог всё равно читается из вашей PostgreSQL; в облако уходит только текст промпта.
 * 2) Иначе — Ollama локально (до OLLAMA_TRY_MS мс).
 * 3) Иначе — умный ответ по каталогу без LLM.
 */

const {
  stripChatInput,
  normalizeUserMessage,
  parseBudgetRubAdvanced,
  extractGpuChipFuzzy,
  gpuCatalogEntryMatchesChipFuzzy,
  extractGpuSearchString,
  extractCpuPreferenceFuzzy,
  extractCpuDetailHint,
  isLikelyGreetingOnly,
  hasExplicitPcBuildIntent,
  extractWorkloadHint,
  detectUpgradeIntent,
} = require('./ai-normalize');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || '60000', 10);

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_TRY_MS = parseInt(process.env.OLLAMA_TRY_MS || '20000', 10);
const CATALOG_ITEMS_PER_CATEGORY = 18;

async function loadCatalogForAi(pool) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.price, c.specs, cat.slug as category_slug
     FROM components c
     JOIN component_categories cat ON cat.id = c.category_id
     ORDER BY cat.sort_order, c.name`
  );
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price) || 0,
    category_slug: r.category_slug,
    specs: typeof r.specs === 'object' ? r.specs : (r.specs ? JSON.parse(r.specs) : {}),
  }));
}

function formatCatalogForPrompt(rows) {
  const byCategory = {};
  for (const r of rows) {
    if (!byCategory[r.category_slug]) byCategory[r.category_slug] = [];
    const specHint = r.specs && (r.specs.socket || r.specs.ram_type || r.specs.power_w)
      ? ` [${[r.specs.socket, r.specs.ram_type, r.specs.power_w ? r.specs.power_w + 'W' : ''].filter(Boolean).join(', ')}]`
      : '';
    byCategory[r.category_slug].push({ id: r.id, name: r.name, price: r.price, specHint });
  }
  const lines = [];
  const order = ['processors', 'motherboard', 'ram', 'gpu', 'storage', 'psu', 'case'];
  const catNames = { processors: 'Процессоры', gpu: 'Видеокарты', ram: 'ОЗУ', motherboard: 'Материнские платы', storage: 'Накопители', psu: 'БП', case: 'Корпуса' };
  for (const slug of order) {
    const items = (byCategory[slug] || []).slice(0, CATALOG_ITEMS_PER_CATEGORY);
    if (items.length === 0) continue;
    lines.push(`${catNames[slug] || slug}:`);
    for (const it of items) lines.push(`  id ${it.id}: ${it.name} — ${it.price} руб.${it.specHint || ''}`);
  }
  return lines.join('\n');
}

/**
 * Умная фильтрация каталога для промпта: приоритизирует компоненты по бюджету и предпочтениям,
 * сохраняет все необходимые сокеты и типы RAM, удаляет явные дубли (вариант X → не берём >2 за бюджет).
 */
function buildSmartCatalogText(catalog, budgetRub, gpuPrefer, cpuHint, workload) {
  const CAT_LIMIT = 22;
  const by = byCategory(catalog);
  const catNames = { processors: 'Процессоры', gpu: 'Видеокарты', ram: 'ОЗУ', motherboard: 'Материнские платы', storage: 'Накопители', psu: 'БП', case: 'Корпуса' };
  const order = ['processors', 'motherboard', 'ram', 'gpu', 'storage', 'psu', 'case'];
  const lines = [];

  for (const slug of order) {
    let items = (by[slug] || []).slice();
    if (items.length === 0) continue;

    // Приоритизация
    if (slug === 'gpu' && gpuPrefer) {
      const pref = gpuPrefer.toLowerCase();
      items.sort((a, b) => {
        const aM = a.name.toLowerCase().includes(pref) ? 0 : 1;
        const bM = b.name.toLowerCase().includes(pref) ? 0 : 1;
        return aM !== bM ? aM - bM : b.price - a.price;
      });
    } else if (slug === 'gpu' && workload) {
      // Для тяжёлых задач тянем топ GPU вверх
      const heavyWork = ['4k', 'render', 'video_edit'];
      if (heavyWork.includes(workload)) items.sort((a, b) => b.price - a.price);
      else items.sort((a, b) => b.price - a.price);
    } else if (slug === 'processors' && cpuHint && cpuHint.brand) {
      items.sort((a, b) => {
        const aM = cpuMatchesHint(a, { brand: cpuHint.brand, needle: null }) ? 0 : 1;
        const bM = cpuMatchesHint(b, { brand: cpuHint.brand, needle: null }) ? 0 : 1;
        return aM !== bM ? aM - bM : b.price - a.price;
      });
    } else {
      items.sort((a, b) => b.price - a.price);
    }

    // Если бюджет известен — включаем сначала те, что вписываются
    let top = items;
    if (budgetRub > 0 && slug !== 'case') {
      const maxForSlot = budgetRub * 0.65;
      const inBudget = items.filter(i => i.price <= maxForSlot);
      const overBudget = items.filter(i => i.price > maxForSlot);
      // Гарантируем хотя бы 4 "сверх бюджета" для показа полного диапазона
      top = [...inBudget, ...overBudget.slice(0, 4)];
    }

    // Убираем дубли "(вариант N)" — оставляем не более 3 таких на категорию
    let variantCount = 0;
    const deduped = [];
    for (const item of top) {
      if (/вариант\s+\d/i.test(item.name)) {
        if (variantCount >= 2) continue;
        variantCount++;
      }
      deduped.push(item);
    }

    const final = deduped.slice(0, CAT_LIMIT);
    lines.push(`${catNames[slug] || slug}:`);
    for (const it of final) {
      const specHint = it.specs && (it.specs.socket || it.specs.ram_type || it.specs.power_w || it.specs.vram_gb)
        ? ` [${[it.specs.socket, it.specs.ram_type, it.specs.power_w ? it.specs.power_w + 'W' : '', it.specs.vram_gb ? it.specs.vram_gb + 'GB VRAM' : ''].filter(Boolean).join(', ')}]`
        : '';
      lines.push(`  id ${it.id}: ${it.name} — ${it.price} руб.${specHint}`);
    }
  }
  return lines.join('\n');
}

/** Собирает подсказку для подбора CPU: конкретная модель или только Ryzen/Intel. */
function buildCpuHint(effective, normalized) {
  const d = extractCpuDetailHint(effective, normalized || '');
  if (d.needle) return d;
  if (d.brand) return d;
  const broad = extractCpuPreferenceFuzzy(`${effective || ''} ${normalized || ''}`);
  return { brand: broad, needle: null };
}

function cpuMatchesHint(p, hint) {
  if (!hint || (!hint.brand && !hint.needle)) return true;
  const n = p.name.toLowerCase();
  if (hint.needle) {
    const needle = String(hint.needle).toLowerCase().trim();
    if (hint.brand === 'intel') {
      if (!n.includes('intel')) return false;
      return n.includes(needle) || n.includes(needle.replace(/-/g, ''));
    }
    if (hint.brand === 'ryzen') {
      if (!n.includes('ryzen')) return false;
      return n.includes(needle);
    }
    return n.includes(needle);
  }
  if (hint.brand === 'intel') return n.includes('intel');
  if (hint.brand === 'ryzen') return n.includes('ryzen');
  return true;
}

function orderProcessorsByCpuHint(processors, hint) {
  if (!hint || (!hint.needle && !hint.brand)) return processors.slice();
  const seen = new Set();
  const out = [];
  const add = (list) => {
    for (const p of list) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
  };
  if (hint.needle) {
    add(processors.filter((p) => cpuMatchesHint(p, hint)));
  }
  if (hint.needle && out.length === 0 && hint.brand) {
    add(processors.filter((p) => cpuMatchesHint(p, { brand: hint.brand, needle: null })));
  } else if (!hint.needle && hint.brand) {
    add(processors.filter((p) => cpuMatchesHint(p, { brand: hint.brand, needle: null })));
  }
  add(processors.filter((p) => !seen.has(p.id)));
  return out;
}

/** Группировка каталога по категориям */
function byCategory(catalog) {
  const out = {};
  for (const r of catalog) {
    if (!out[r.category_slug]) out[r.category_slug] = [];
    out[r.category_slug].push(r);
  }
  return out;
}

function mbRamTypeFromSpecs(mb) {
  if (!mb || !mb.specs) return null;
  return mb.specs.ram_type || mb.specs.memory_type || null;
}

/**
 * Строгая проверка набора id: ровно по одному CPU/MB/GPU/БП, есть ОЗУ, сокет, тип DDR, мощность БП.
 */
function verifyAiBuildSet(catalog, ids) {
  if (!ids || !Array.isArray(ids) || ids.length === 0) return false;
  const byId = {};
  for (const c of catalog) byId[c.id] = c;
  const bySlug = {};
  for (const id of ids) {
    const c = byId[id];
    if (!c) return false;
    if (!bySlug[c.category_slug]) bySlug[c.category_slug] = [];
    bySlug[c.category_slug].push(c);
  }
  const cpus = bySlug.processors || [];
  const mbs = bySlug.motherboard || [];
  const rams = bySlug.ram || [];
  const gpus = bySlug.gpu || [];
  const psus = bySlug.psu || [];
  if (cpus.length !== 1 || mbs.length !== 1 || gpus.length !== 1 || psus.length !== 1) return false;
  if (rams.length === 0 || rams.length > 4) return false;

  const cpu = cpus[0];
  const mb = mbs[0];
  const gpu = gpus[0];
  const psu = psus[0];

  const sockCpu = cpu.specs && cpu.specs.socket;
  const sockMb = mb.specs && mb.specs.socket;
  if (!sockCpu || !sockMb || String(sockCpu).trim().toUpperCase() !== String(sockMb).trim().toUpperCase()) return false;

  const needRam = String(mbRamTypeFromSpecs(mb) || 'DDR4').toUpperCase();
  for (const r of rams) {
    const t = r.specs && r.specs.type;
    if (!t || String(t).toUpperCase() !== needRam) return false;
  }

  const needW = estimatePsuWattage(gpu.name);
  const pw = parseInt(psu.specs && psu.specs.power_w, 10) || 0;
  if (pw < needW) return false;

  return true;
}

/**
 * Если модель или эвристики дали несовместимый набор — подменяем алгоритмическим подбором.
 */
function finalizeAiComponentIds(catalog, fixed, maxBudgetRub, gpuPrefer, cpuHint, userMessage) {
  if (!fixed || !fixed.ids || fixed.ids.length === 0) return null;
  if (verifyAiBuildSet(catalog, fixed.ids)) return fixed;
  const budget = maxBudgetRub != null && maxBudgetRub > 0 ? maxBudgetRub : 150000;
  const rep = pickCompatibleBuild(catalog, budget, gpuPrefer, cpuHint, userMessage);
  if (rep && verifyAiBuildSet(catalog, rep.ids)) return rep;
  return null;
}

/**
 * Грубая «ступень» GPU для сравнения баланса с CPU (короткие human-friendly плюсы/минусы).
 */
function gpuTierFromName(name) {
  const n = (name || '').toLowerCase();
  if (/5090|4090/.test(n)) return 10;
  if (/5080|4080/.test(n)) return 9;
  if (/5070\s*ti|4070\s*ti/.test(n)) return 8;
  if (/5070|4070/.test(n)) return 7;
  if (/5060\s*ti|4060\s*ti/.test(n)) return 6;
  if (/5060|4060|4050/.test(n)) return 5;
  if (/3050|1630|1650/.test(n)) return 4;
  return 5;
}

function cpuTierFromName(name) {
  const n = (name || '').toLowerCase();
  if (/threadripper|14900ks|7950x|13900ks/.test(n)) return 10;
  if (/7800x3d|7900x3d|9800x3d/.test(n)) return 9;
  if (/14700k|13700k|7700x|7600x/.test(n)) return 8;
  if (/5700x3d|5800x3d/.test(n)) return 8;
  if (/5600x3d/.test(n)) return 7;
  if (/5600|5600x|12400|13400|7500f|8600g/.test(n)) return 6;
  if (/5500|12100|13100|5300/.test(n)) return 5;
  if (/4100|3000g|3050e/.test(n)) return 4;
  return 6;
}

/**
 * Плюсы/минусы простым языком: сценарий, баланс CPU/GPU, шум БП, ОЗУ, диск.
 */
function buildProsCons(catalog, ids, workload) {
  const byId = {};
  for (const c of catalog) byId[c.id] = c;

  const cpu = ids.map((id) => byId[id]).find((c) => c && c.category_slug === 'processors');
  const gpu = ids.map((id) => byId[id]).find((c) => c && c.category_slug === 'gpu');
  const ram = ids.map((id) => byId[id]).find((c) => c && c.category_slug === 'ram');
  const psu = ids.map((id) => byId[id]).find((c) => c && c.category_slug === 'psu');
  const storage = ids.map((id) => byId[id]).find((c) => c && c.category_slug === 'storage');

  const pros = [];
  const cons = [];

  if (workload === 'render' || workload === 'video_edit') {
    pros.push('Склонность к рабочим задачам: рендер, монтаж, много потоков');
  } else if (workload === 'streaming') {
    pros.push('Подходит под стрим и параллельные задачи в фоне');
  } else if (workload === '4k') {
    pros.push('Расчёт на игры и картинку в 4K / высоких настройках');
  } else {
    pros.push('Универсально: игры, интернет, повседневные задачи');
  }

  if (cpu && gpu) {
    const gt = gpuTierFromName(gpu.name);
    const ct = cpuTierFromName(cpu.name);
    if (gt - ct >= 2) {
      cons.push('Процессор слабее видеокарты — в части игр упрётесь в CPU');
    } else if (ct - gt >= 2) {
      cons.push('Видеокарта слабее процессора — чаще упор в GPU, не максимум кадров');
    } else {
      pros.push('Проц и видеокарта в одном классе — меньше явных «узких мест»');
    }
  }

  if (cpu && String(cpu.name).toLowerCase().includes('x3d')) {
    pros.push('X3D-процессор — сильнее обычно именно в играх');
  }

  if (gpu) {
    const n = gpu.name.toLowerCase();
    if (/rtx\s*50|rtx\s*40/.test(n)) {
      pros.push('Современная GeForce — DLSS/кадрген в поддерживаемых играх');
    }
    const vram = gpu.specs && gpu.specs.vram_gb;
    if (vram && vram <= 8 && (workload === '4k' || workload === 'render')) {
      cons.push('Мало видеопамяти для 4K или тяжёлых сцен — снижайте текстуры');
    }
  }

  if (psu) {
    const eff = (psu.specs && psu.specs.efficiency) || '';
    if (/Titanium|Platinum/.test(eff)) {
      pros.push('Блок высокого класса — обычно тише и меньше греется');
    } else if (/Gold/.test(eff)) {
      pros.push('Нормальный «золотой» блок — адекватный шум и КПД');
    } else {
      pros.push('Блок простого класса — шум скорее средний, не «тишина»');
    }
  }

  if (ram) {
    const size = ram.specs && ram.specs.size_gb;
    if (size >= 32) {
      pros.push('Много ОЗУ — комфортно с кучей вкладок и тяжёлыми играми');
    } else if (size >= 16) {
      pros.push('16 ГБ — норм для игр; для тяжёлого монтажа может быть мало');
    } else {
      cons.push('Мало ОЗУ — лучше увеличить, если планируете игры и работу одновременно');
    }
  }

  if (storage) {
    const cap = storage.specs && storage.specs.capacity_gb;
    const iface = (storage.specs && storage.specs.interface) || '';
    if (/NVMe|PCIe/.test(iface)) {
      pros.push('Быстрый SSD — система и игры грузятся заметно быстрее');
    }
    if (cap != null && cap < 1000) {
      cons.push('Объём диска скромный — несколько крупных игр и место закончится');
    } else if (cap >= 2000) {
      pros.push('Запас по диску — библиотека игр без постоянной чистки');
    }
  }

  const dedupe = (arr) => [...new Set(arr.filter(Boolean))];
  let p = dedupe(pros).slice(0, 4);
  let c = dedupe(cons).slice(0, 3);
  if (p.length === 0) p.push('Совместимость компонентов проверена');
  return { pros: p, cons: c };
}

/**
 * Подбирает 3 варианта сборки: эконом (~55%), оптимал (~80%), максимум (100%).
 */
function generateThreeVariants(catalog, maxBudget, gpuPrefer, cpuHint, workload, userMsg) {
  const tiers = [
    { label: 'Бюджетная сборка', pct: 0.55, pros_tag: 'бюджетный вариант с разумным балансом' },
    { label: 'Оптимальная сборка', pct: 0.80, pros_tag: 'лучший баланс цены и производительности' },
    { label: 'Максимальная сборка', pct: 1.00, pros_tag: 'максимум за указанный бюджет' },
  ];
  const results = [];
  for (const tier of tiers) {
    const budget = Math.floor(maxBudget * tier.pct);
    if (budget < 25000) continue;
    const build = pickCompatibleBuild(catalog, budget, gpuPrefer, cpuHint, userMsg);
    if (!build) continue;
    const verified = finalizeAiComponentIds(catalog, build, budget, gpuPrefer, cpuHint, userMsg);
    if (!verified) continue;
    const pc = buildProsCons(catalog, verified.ids, workload);
    results.push({ ...tier, build: verified, pros: pc.pros, cons: pc.cons });
  }
  // Дедуплицируем (не возвращаем одинаковые наборы ids)
  const seen = new Set();
  return results.filter(r => {
    const key = r.build.ids.slice().sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Оценка рекомендуемой мощности БП по названию видеокарты (Вт) */
function estimatePsuWattage(gpuName) {
  if (!gpuName || typeof gpuName !== 'string') return 550;
  const n = gpuName.toLowerCase();
  if (/5090/.test(n)) return 1000;
  if (/4090|3090|7900\s*xtx|4080|5080/.test(n)) return 850;
  if (/3080|4070\s*ti|5070\s*ti|7900\s*xt/.test(n)) return 750;
  if (/3070|4060\s*ti|4070|5070|7800|7700\s*xt/.test(n)) return 650;
  if (/5060\s*ti|5060/.test(n)) return 600;
  return 550;
}

/**
 * Подбор совместимой сборки: под бюджет выбираем самые мощные/дорогие компоненты, чтобы сборка реально зависела от бюджета.
 * Порядок: CPU → MB (сокет) → RAM (тип) → GPU → storage → PSU (мощность) → case.
 * В каждой категории берём самый дорогой вариант, который влезает в оставшийся бюджет (с запасом на остальное).
 */
function pickCompatibleBuild(catalog, budgetRub, gpuPrefer, cpuHint, userMessage = null) {
  const chipInfo = userMessage ? getGpuChipFromMessage(userMessage) : null;
  if (chipInfo) {
    const gpuFirst = pickCompatibleBuildGpuFirst(catalog, budgetRub, chipInfo, cpuHint);
    if (gpuFirst) return gpuFirst;
  }

  const by = byCategory(catalog);
  const processors = (by.processors || []).sort((a, b) => b.price - a.price);
  const motherboards = (by.motherboard || []).sort((a, b) => b.price - a.price);
  const rams = (by.ram || []).sort((a, b) => b.price - a.price);
  const gpus = (by.gpu || []).sort((a, b) => b.price - a.price);
  const storages = (by.storage || []).sort((a, b) => b.price - a.price);
  const psus = (by.psu || []).sort((a, b) => b.price - a.price);
  const cases = (by.case || []).sort((a, b) => b.price - a.price);

  if (processors.length === 0 || motherboards.length === 0 || gpus.length === 0) return null;

  const min = (arr) => (arr.length > 0 ? Math.min(...arr.map((x) => x.price)) : 0);
  let remaining = budgetRub;

  const minMb = min(motherboards);
  const minRam = min(rams);
  const minGpu = min(gpus);
  const minStorage = min(storages);
  const minPsu = min(psus);
  const minCase = min(cases);
  const reserveAfterCpu = minMb + minRam + minGpu + minStorage + minPsu + minCase;

  let cpu = null;
  if (cpuHint && cpuHint.needle) {
    cpu = processors.find((p) => cpuMatchesHint(p, cpuHint) && p.price <= remaining - reserveAfterCpu);
  }
  if (!cpu && cpuHint && cpuHint.brand) {
    const brandOnly = { brand: cpuHint.brand, needle: null };
    cpu = processors.find((p) => cpuMatchesHint(p, brandOnly) && p.price <= remaining - reserveAfterCpu);
  }
  if (!cpu) {
    cpu = processors.find((p) => p.price <= remaining - reserveAfterCpu) || processors[processors.length - 1];
  }
  remaining -= cpu.price;

  const socket = cpu.specs && cpu.specs.socket ? cpu.specs.socket : null;
  const mbCandidates = socket
    ? motherboards.filter((m) => m.specs && m.specs.socket === socket)
    : motherboards;
  if (mbCandidates.length === 0) return null;
  const reserveAfterMb = minRam + minGpu + minStorage + minPsu + minCase;
  const mb = mbCandidates.find((m) => m.price <= remaining - reserveAfterMb) || mbCandidates[mbCandidates.length - 1];
  if (!mb) return null;
  remaining -= mb.price;

  const ramType = mbRamTypeFromSpecs(mb) || 'DDR4';
  const ramCandidates = rams.filter((r) => r.specs && r.specs.type === ramType);
  if (ramCandidates.length === 0) return null;
  const reserveAfterRam = minGpu + minStorage + minPsu + minCase;
  const ram = ramCandidates.find((r) => r.price <= remaining - reserveAfterRam) || ramCandidates[ramCandidates.length - 1];
  if (!ram) return null;
  remaining -= ram.price;

  let gpu = null;
  if (gpuPrefer) {
    gpu = gpus.find((g) => g.name.toLowerCase().includes(gpuPrefer.toLowerCase()) && g.price <= remaining - minStorage - minPsu - minCase);
  }
  if (!gpu) {
    gpu = gpus.find((g) => g.price <= remaining - minStorage - minPsu - minCase) || gpus[gpus.length - 1];
  }
  remaining -= gpu.price;

  const needPsuW = estimatePsuWattage(gpu.name);
  const psuCandidates = psus.filter((p) => {
    const w = p.specs && p.specs.power_w ? parseInt(p.specs.power_w, 10) : 0;
    return w >= needPsuW;
  });
  if (psuCandidates.length === 0) return null;

  const reserveAfterStorage = minPsu + minCase;
  const storage = storages.find((s) => s.price <= remaining - reserveAfterStorage) || (storages.length > 0 ? storages[storages.length - 1] : null);
  if (storage) remaining -= storage.price;

  const reserveAfterPsu = minCase;
  const psu = psuCandidates.find((p) => p.price <= remaining - reserveAfterPsu) || psuCandidates[psuCandidates.length - 1];
  remaining -= psu.price;

  const caseItem = cases.find((c) => c.price <= remaining) || (cases.length > 0 ? cases[cases.length - 1] : null);
  if (caseItem) remaining -= caseItem.price;

  const ids = [cpu.id, mb.id, gpu.id, ram.id];
  if (storage) ids.push(storage.id);
  ids.push(psu.id);
  if (caseItem) ids.push(caseItem.id);

  let total = cpu.price + mb.price + ram.price + gpu.price + psu.price + (storage ? storage.price : 0) + (caseItem ? caseItem.price : 0);

  // Добавляем второй стик ОЗУ если бюджет позволяет
  if (total + ram.price <= budgetRub) {
    ids.push(ram.id);
    total += ram.price;
  }

  if (total > budgetRub) {
    const sockNorm = (s) => (s ? String(s).trim().toUpperCase() : '');
    const sockPref = sockNorm(socket);
    const mbsForPref = sockPref
      ? motherboards.filter((m) => sockNorm(m.specs && m.specs.socket) === sockPref).sort((a, b) => a.price - b.price)
      : [];
    const mbsRest = motherboards
      .filter((m) => !sockPref || sockNorm(m.specs && m.specs.socket) !== sockPref)
      .sort((a, b) => a.price - b.price);
    const mbsOrdered = mbsForPref.length > 0 ? mbsForPref.concat(mbsRest) : motherboards.slice().sort((a, b) => a.price - b.price);

    for (const mbTry of mbsOrdered) {
      const sockMb = mbTry.specs && mbTry.specs.socket;
      if (!sockMb) continue;
      const rt = mbRamTypeFromSpecs(mbTry) || 'DDR4';
      const ramPool = rams.filter((r) => r.specs && r.specs.type === rt).sort((a, b) => a.price - b.price);
      const ramTry = ramPool[0];
      if (!ramTry) continue;

      let cpuCandidates = processors.filter(
        (p) =>
          p.specs &&
          sockNorm(p.specs.socket) === sockNorm(sockMb) &&
          p.price + mbTry.price + ramTry.price + minGpu + minStorage + minPsu + minCase <= budgetRub
      );
      if (cpuHint && (cpuHint.needle || cpuHint.brand)) {
        cpuCandidates = orderProcessorsByCpuHint(cpuCandidates, cpuHint);
      }
      const cpuTry = cpuCandidates.sort((a, b) => b.price - a.price)[0];
      if (!cpuTry) continue;

      let gpuCandidates = gpus.filter(
        (g) => cpuTry.price + mbTry.price + ramTry.price + g.price + minStorage + minPsu + minCase <= budgetRub
      );
      if (gpuPrefer) {
        const gp = gpuPrefer.toLowerCase();
        gpuCandidates = gpuCandidates
          .filter((g) => g.name.toLowerCase().includes(gp))
          .concat(gpuCandidates.filter((g) => !g.name.toLowerCase().includes(gp)));
      }
      const gpuTry = gpuCandidates.sort((a, b) => b.price - a.price)[0] || gpus[gpus.length - 1];

      const needW = estimatePsuWattage(gpuTry.name);
      const psuList = psus.filter((p) => (parseInt(p.specs && p.specs.power_w, 10) || 0) >= needW).sort((a, b) => a.price - b.price);
      const psuOk = psuList[0];
      if (!psuOk) continue;

      const storageOk =
        storages.find((s) => cpuTry.price + mbTry.price + ramTry.price + gpuTry.price + s.price + psuOk.price + minCase <= budgetRub) ||
        (storages.length > 0 ? storages[storages.length - 1] : null);
      const caseOk =
        cases.find(
          (c) =>
            cpuTry.price +
              mbTry.price +
              ramTry.price +
              gpuTry.price +
              (storageOk ? storageOk.price : 0) +
              psuOk.price +
              c.price <=
            budgetRub
        ) || (cases.length > 0 ? cases[cases.length - 1] : null);

      const total2 =
        cpuTry.price +
        mbTry.price +
        ramTry.price +
        gpuTry.price +
        (storageOk ? storageOk.price : 0) +
        psuOk.price +
        (caseOk ? caseOk.price : 0);
      if (total2 <= budgetRub) {
        const ids2 = [cpuTry.id, mbTry.id, gpuTry.id, ramTry.id];
        if (storageOk) ids2.push(storageOk.id);
        ids2.push(psuOk.id);
        if (caseOk) ids2.push(caseOk.id);
        return { ids: ids2, totalPrice: total2 };
      }
    }
    return null;
  }

  return { ids, totalPrice: total };
}

/**
 * Проверка и исправление набора компонентов: совместимость (сокет, тип ОЗУ, мощность БП) и бюджет.
 * Возвращает { ids, totalPrice } или null.
 */
function ensureCompatibleAndBudget(catalog, componentIds, maxBudgetRub) {
  if (!componentIds || componentIds.length === 0) return null;
  const byId = {};
  for (const c of catalog) byId[c.id] = c;
  const bySlug = {};
  for (const id of componentIds) {
    const c = byId[id];
    if (!c) return null;
    if (!bySlug[c.category_slug]) bySlug[c.category_slug] = [];
    bySlug[c.category_slug].push(c);
  }
  const cpu = (bySlug.processors || [])[0];
  const mb = (bySlug.motherboard || [])[0];
  const rams = bySlug.ram || [];
  const gpu = (bySlug.gpu || [])[0];
  const psu = (bySlug.psu || [])[0];

  let fixedIds = [...componentIds];
  const by = byCategory(catalog);

  if (cpu && cpu.specs && cpu.specs.socket) {
    const mbRow = fixedIds.map((id) => byId[id]).find((c) => c.category_slug === 'motherboard');
    if (mbRow && mbRow.specs && mbRow.specs.socket !== cpu.specs.socket) {
      const mbsOk = (by.motherboard || [])
        .filter((m) => m.specs && m.specs.socket === cpu.specs.socket)
        .sort((a, b) => a.price - b.price);
      const mbOk = mbsOk[0];
      if (mbOk) fixedIds = fixedIds.filter((id) => byId[id].category_slug !== 'motherboard').concat([mbOk.id]);
    }
  }

  const mbFixed = fixedIds.map((id) => byId[id]).find((c) => c.category_slug === 'motherboard');
  const ramType = mbRamTypeFromSpecs(mbFixed) || 'DDR4';
  const ramRows = fixedIds.map((id) => byId[id]).filter((c) => c.category_slug === 'ram');
  if (ramRows.length > 0) {
    const anyBad = ramRows.some((r) => !r.specs || !r.specs.type || r.specs.type !== ramType);
    if (anyBad) {
      const ramOk = (by.ram || [])
        .filter((r) => r.specs && r.specs.type === ramType)
        .sort((a, b) => a.price - b.price)[0];
      if (ramOk) fixedIds = fixedIds.filter((id) => byId[id].category_slug !== 'ram').concat([ramOk.id]);
    }
  }

  const gpuFixed = fixedIds.map((id) => byId[id]).find((c) => c.category_slug === 'gpu');
  const needPsuW = estimatePsuWattage(gpuFixed && gpuFixed.name);
  const psuFixed = fixedIds.map((id) => byId[id]).find((c) => c.category_slug === 'psu');
  const wCur = psuFixed ? (parseInt(psuFixed.specs && psuFixed.specs.power_w, 10) || 0) : 0;
  if (!psuFixed || wCur < needPsuW) {
    const psuOk = (by.psu || [])
      .filter((p) => (parseInt(p.specs && p.specs.power_w, 10) || 0) >= needPsuW)
      .sort((a, b) => a.price - b.price)[0];
    if (psuOk) fixedIds = fixedIds.filter((id) => byId[id].category_slug !== 'psu').concat([psuOk.id]);
  }

  let totalPrice = 0;
  for (const id of fixedIds) {
    const c = byId[id];
    if (c) totalPrice += c.price;
  }
  if (maxBudgetRub != null && maxBudgetRub > 0 && totalPrice > maxBudgetRub) return null;
  return { ids: fixedIds, totalPrice };
}

/**
 * Вызов облачной модели (OpenAI Chat Completions или любой совместимый endpoint).
 * @param {string} systemMsg — системная инструкция (роль + правила).
 * @param {string} userMsg   — текущий запрос пользователя (каталог + сообщение).
 * @param {Array}  history   — [{role:'user'|'assistant', content: string}, …] — до 8 предыдущих сообщений.
 */
async function callOpenAiCompatible(systemMsg, userMsg, history) {
  if (!OPENAI_API_KEY) return null;
  let timeoutId;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    };
    if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
    if (process.env.OPENROUTER_APP_NAME) headers['X-Title'] = process.env.OPENROUTER_APP_NAME;

    const messages = [{ role: 'system', content: systemMsg }];

    // Добавляем историю (последние 8 сообщений), усекая длинные
    if (Array.isArray(history) && history.length > 0) {
      const slice = history.slice(-8);
      for (const h of slice) {
        if ((h.role === 'user' || h.role === 'assistant') && h.content) {
          messages.push({ role: h.role, content: String(h.content).slice(0, 600) });
        }
      }
    }

    messages.push({ role: 'user', content: userMsg });

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.45,
        max_tokens: 3000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('OpenAI-compatible API error:', res.status, errText.slice(0, 500));
      return null;
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return typeof content === 'string' ? content : null;
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error('OpenAI-compatible request failed:', e.message || e);
    return null;
  }
}

async function callOllama(prompt) {
  let timeoutId;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), OLLAMA_TRY_MS);
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.4, num_predict: 800 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    return data.response || null;
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    return null;
  }
}

function extractJsonFromResponse(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const jsonBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const toParse = jsonBlock ? jsonBlock[1].trim() : trimmed;
  const start = toParse.indexOf('{');
  const end = toParse.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(toParse.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

/**
 * Системный промпт — роль ИИ и все правила подбора.
 * Не содержит каталога — он идёт в user message для экономии токенов.
 */
const AI_SYSTEM_PROMPT = `Ты — эксперт-консультант по сборке ПК в российском интернет-магазине. Отвечаешь только по-русски. Интерпретируй СМЫСЛ запроса, даже если пользователь пишет с опечатками, жаргоном или без пробелов.

Расшифровка жаргона: «ртх»=RTX, «видяха/видюха»=видеокарта, «проц»=процессор, «мать/матка»=материнская плата, «оперативка»=ОЗУ, «накоп»=накопитель, «к»=тысяч рублей (50к=50000).

РЕЖИМЫ ОТВЕТА — выбери один:
A) Текстовый ответ — приветствие, общий вопрос, сравнение, уточнение, «потянет ли X игру».
B) JSON — пользователь явно или по смыслу просит подобрать сборку / комплектующие.
C) JSON с "text" и "suggestions" одновременно — если прикреплена сборка пользователя: короткий обзор текстом + 2–3 альтернативы.

ФОРМАТ JSON (режим B/C, без markdown):
{"text":"необязательно: обзор, плюсы/минусы","suggestions":[{"name":"Название","description":"1–2 предложения","pros":["достоинство"],"cons":["недостаток или []"],"component_ids":[числа]}]}

ПРАВИЛА СОВМЕСТИМОСТИ (сервер проверяет каждый набор, при ошибке заменяет автоматически):
• Сокет CPU строго = сокету матери (LGA1700 ↔ LGA1700, LGA1851 ↔ LGA1851, AM4 ↔ AM4, AM5 ↔ AM5).
• Тип RAM (DDR4/DDR5) у платы и модулей — совпадает.
• Мощность БП ≥ нормы GPU: 5090→1000W, 4090/5080/4080→850W, 5070Ti/4070Ti/3080→750W, 5070/4070/3070→650W, 5060Ti/5060→600W, остальное→550W.
• Ровно один процессор, одна мат. плата, одна видеокарта, один или два модуля ОЗУ (при бюджете от 80к рекомендуй 2x), один или два накопителя (SSD + HDD при бюджете от 120к), один БП, один корпус.
• Используй ТОЛЬКО id из предоставленного каталога.

СЦЕНАРИИ ИСПОЛЬЗОВАНИЯ:
• Игры / gaming: приоритет GPU, CPU не должен быть узким местом.
• 4K гейминг: GPU ≥ RTX 4080 / RTX 5080 / RX 7900 XT, VRAM ≥ 16 ГБ.
• 1440p: GPU ≥ RTX 4070 / RTX 5070, VRAM ≥ 12 ГБ.
• Стриминг: CPU 12+ ядер + сильный GPU; рекомендуй Ryzen 9 или Core Ultra 9.
• Монтаж/рендер: CPU максимум ядер + 32 ГБ+ RAM + RTX/RX для аппаратного кодека.
• Офис: минимальный бюджет, встроенная графика или слабая дискретка.
• Тихий ПК: упомяни тихое охлаждение и эффективный БП в pros.
• Компактный: Mini-ITX или Micro-ATX, корпус небольшого форм-фактора.

КОЛИЧЕСТВО ВАРИАНТОВ:
• Если бюджет задан и ≥ 50 000 руб — предлагай 3 варианта: Бюджетная (~55%), Оптимальная (~80%), Топовая (100%).
• Если бюджет не задан или < 50 000 руб — один оптимальный вариант.

НЕ возвращай JSON на приветствия, «спасибо», «пока», «как дела», болтовню без запроса комплектующих.
1 USD ≈ 100 руб. «50к» = 50 000 руб. «полтос» ≈ 150 000 руб.`;

/** Вытаскивает «Итого: N руб.» из текста прикреплённой сборки. 0 если не нашли. */
function parseBuildSummaryTotalRub(summary) {
  if (!summary || typeof summary !== 'string') return 0;
  const m = summary.match(/Итого[:\s]+([\d\s\u00a0]+)/i);
  if (!m) return 0;
  const n = parseInt(m[1].replace(/[\s\u00a0]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Строит user-message для LLM: каталог + запрос пользователя + контекст.
 * Возвращает { systemMsg, userMsg } для OpenAI, а также строку для Ollama.
 */
function buildUnifiedPrompt(catalogText, userMessage, buildSummary, normContext, workload, isUpgrade) {
  const norm = normContext && normContext.normalized ? normContext.normalized : userMessage;
  const corrNote = normContext && normContext.corrections && normContext.corrections.length
    ? ` [авто-исправление: «${(normContext.original || userMessage).slice(0, 120)}»]`
    : '';

  const cpuH = buildCpuHint(normContext?.original || userMessage, normContext?.normalized || norm);
  const cpuLine = cpuH.needle
    ? `\n⚙️ Указан конкретный CPU: ${cpuH.brand === 'intel' ? 'Intel' : 'Ryzen'} — подстрока «${cpuH.needle}» (5600 ≠ 5500, не подменяй!).`
    : cpuH.brand
      ? `\n⚙️ Предпочтение CPU: ${cpuH.brand}.`
      : '';

  const workloadLine = workload
    ? `\n🎯 Сценарий: ${({
        gaming: 'Игровой ПК — приоритет GPU',
        '4k': '4K гейминг — GPU ≥ RTX 4080/5080, VRAM ≥ 16 ГБ',
        '1440p': '1440p — GPU ≥ RTX 4070/5070',
        streaming: 'Стриминг — CPU 12+ ядер + сильный GPU',
        video_edit: 'Монтаж видео — CPU 12+ ядер, 32 ГБ+ RAM',
        render: '3D рендеринг — максимум ядер, 32 ГБ+ RAM',
        office: 'Офис/учёба — минимальный бюджет',
        silent: 'Тихий ПК — эффективное охлаждение',
        compact: 'Компактный ПК — Mini/Micro-ATX',
      }[workload] || workload)}`
    : '';

  const upgradeNote = isUpgrade ? '\n🔄 Пользователь хочет апгрейд/замену части компонентов — учти это в ответе.' : '';

  // Если есть прикреплённая сборка — даём чёткую инструкцию: сначала обзор, потом альтернативы ±15%
  const totalRub = parseBuildSummaryTotalRub(buildSummary);
  let buildBlock = '';
  if (buildSummary && buildSummary.length > 0) {
    const lowBound = totalRub > 0 ? Math.round(totalRub * 0.85) : 0;
    const highBound = totalRub > 0 ? Math.round(totalRub * 1.15) : 0;
    const priceNote = totalRub > 0
      ? `\nОбщая стоимость прикреплённой сборки: ${totalRub.toLocaleString('ru-RU')} руб. Альтернативы предлагай в диапазоне ${lowBound.toLocaleString('ru-RU')}–${highBound.toLocaleString('ru-RU')} руб. (±15%).`
      : '';

    buildBlock =
      `\n📎 Прикреплённая сборка пользователя:\n${buildSummary}${priceNote}\n\n` +
      `ОСОБЫЕ ПРАВИЛА для прикреплённой сборки:\n` +
      `1) Обязательно верни поле "text" (1–3 коротких абзаца): кратко оцени эту сборку с учётом запроса пользователя и явно перечисли 2–3 плюса и 2–3 минуса этой КОНКРЕТНОЙ сборки (упомяни связки CPU/GPU, объём ОЗУ, тип накопителя, БП).\n` +
      `2) В том же ответе верни 2–3 альтернативы в поле "suggestions" из каталога по ID, каждая должна быть в пределах ±15% по общей стоимости от указанной и предлагать осмысленное улучшение по сравнению с прикреплённой сборкой (лучшее соотношение цена/производительность, более сбалансированные CPU/GPU, быстрее накопитель, запас по БП и т.п.).\n` +
      `3) Даже если пользователь задал вопрос в общей форме («что скажешь?», «норм?», «можно лучше?») — всё равно сделай и обзор, и альтернативы.\n` +
      `4) Если пользователь просит конкретное изменение (сменить GPU, добавить ОЗУ и т.п.) — учти это в альтернативах, оставаясь около той же суммы.\n`;
  }

  const userMsg =
    `Каталог (id, название, цена руб., [socket/RAM/VRAM/PSU подсказки]):\n${catalogText}\n` +
    `${buildBlock}` +
    `\nЗапрос: «${userMessage}»${corrNote}${cpuLine}${workloadLine}${upgradeNote}\n` +
    `Нормализованный текст: «${norm}»\n\nОтвет:`;

  return { systemMsg: AI_SYSTEM_PROMPT, userMsg };
}

/** Делегирует в модуль нормализации (устойчивость к опечаткам). */
function getGpuChipFromMessage(msg) {
  return extractGpuChipFuzzy(msg || '');
}

function gpuCatalogEntryMatchesChip(gpuName, chipInfo) {
  return gpuCatalogEntryMatchesChipFuzzy(gpuName, chipInfo);
}

/**
 * Подбор сборки вокруг конкретной видеокарты (сначала GPU, потом недорогой совместимый остаток).
 */
function pickCompatibleBuildGpuFirst(catalog, budgetRub, chipInfo, cpuHint) {
  const by = byCategory(catalog);
  const processors = orderProcessorsByCpuHint((by.processors || []).slice().sort((a, b) => a.price - b.price), cpuHint);
  const motherboards = (by.motherboard || []).slice();
  const rams = (by.ram || []).slice();
  const gpus = (by.gpu || []).filter((g) => gpuCatalogEntryMatchesChip(g.name, chipInfo)).sort((a, b) => a.price - b.price);
  const storages = (by.storage || []).slice().sort((a, b) => a.price - b.price);
  const psus = (by.psu || []).slice();
  const cases = (by.case || []).slice().sort((a, b) => a.price - b.price);

  if (gpus.length === 0 || processors.length === 0 || motherboards.length === 0) return null;

  const min = (arr) => (arr.length > 0 ? Math.min(...arr.map((x) => x.price)) : 0);

  for (const gpu of gpus) {
    const needPsuW = estimatePsuWattage(gpu.name);
    const psuList = psus.filter((p) => (parseInt(p.specs && p.specs.power_w, 10) || 0) >= needPsuW).sort((a, b) => a.price - b.price);
    if (psuList.length === 0) continue;
    const minStorage = min(storages);
    const minCase = min(cases);

    for (const cpu of processors) {
      const socket = cpu.specs && cpu.specs.socket ? cpu.specs.socket : null;
      const mbs = motherboards.filter((m) => m.specs && m.specs.socket === socket).sort((a, b) => a.price - b.price);
      for (const mb of mbs) {
        const ramType = mbRamTypeFromSpecs(mb) || 'DDR4';
        const ramCandidates = rams.filter((r) => r.specs && r.specs.type === ramType).sort((a, b) => a.price - b.price);
        for (const ram of ramCandidates) {
          for (const psu of psuList) {
            const storage = storages[0] || null;
            const caseItem = cases[0] || null;
            const total =
              cpu.price + mb.price + ram.price + gpu.price + psu.price + (storage ? storage.price : 0) + (caseItem ? caseItem.price : 0);
            if (total <= budgetRub) {
              const ids = [cpu.id, mb.id, ram.id, gpu.id];
              if (storage) ids.push(storage.id);
              ids.push(psu.id);
              if (caseItem) ids.push(caseItem.id);
              return { ids, totalPrice: total };
            }
          }
        }
      }
    }
  }
  return null;
}

function getGpuPreference(msg, normalized) {
  const primary = normalized && normalized.length >= 2 ? normalized : msg;
  const chip = extractGpuChipFuzzy(primary) || extractGpuChipFuzzy(msg || '');
  const fromNorm = extractGpuSearchString(primary, chip);
  if (fromNorm) return fromNorm.replace(/\s+/g, ' ').trim();
  const chip2 = extractGpuChipFuzzy(msg || '');
  const fromMsg = extractGpuSearchString(msg || '', chip2);
  if (fromMsg) return fromMsg.replace(/\s+/g, ' ').trim();
  const m = (primary || '').match(
    /\b(rtx\s*)?(3050|3060|3070|3080|3090|4050|4060|4070|4080|4090|5050|5060|5070|5080|5090|rx\s*7600|rx\s*7700|rx\s*7800|rx\s*7900)\b/i
  );
  if (m) return m[0].replace(/\s+/g, ' ').trim();
  const short = (primary || '').match(/\b(3050|3060|3070|3080|3090|4060|4070|4080|4090)\b/);
  return short ? short[1] : null;
}

function isGreetingOrCapabilityQuestion(userMessage, normalized) {
  return isLikelyGreetingOnly(userMessage, normalized || '');
}

function parseBudgetRub(userMessage, normalized) {
  const adv = parseBudgetRubAdvanced(userMessage, normalized);
  if (adv > 0) return adv;
  const msg = (userMessage || '').trim();
  let budgetRub = 0;
  const dollarMatch = msg.match(/(\d+)\s*(?:долларов|dollars|\$|usd)/i);
  if (dollarMatch) budgetRub = Math.min(500000, parseInt(dollarMatch[1], 10) * 100);
  const rubMatch = msg.match(/(\d+)\s*(?:руб|р\.|рублей|т\.?\s*р\.)/i);
  if (rubMatch) budgetRub = Math.min(500000, parseInt(rubMatch[1], 10));
  if (budgetRub <= 0 && /до\s*(\d{4,})|(\d{4,})\s*руб|бюджет\s*(\d{4,})/i.test(msg)) {
    const m = msg.match(/(\d{4,})/);
    if (m) budgetRub = Math.min(500000, parseInt(m[1], 10));
  }
  return budgetRub;
}

/**
 * Если пользователь не указал сумму в рублях, подбираем ориентир бюджета по классу GPU
 * (иначе для RTX 5080 дефолт 120k не собирается в плитку).
 */
function inferFallbackBudgetRub(userMessage, effective) {
  const chip = extractGpuChipFuzzy(effective) || extractGpuChipFuzzy(userMessage || '');
  if (!chip || chip.kind !== 'nvidia') return 120000;
  const n = parseInt(String(chip.chip).replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return 120000;
  if (n >= 5000 && n < 5100) return 280000;
  if (n >= 4080) return 260000;
  if (n >= 4070) return 200000;
  if (n >= 4060) return 150000;
  return 120000;
}

async function smartFallback(pool, userMessage, normPre, workload) {
  const norm = normPre || normalizeUserMessage(userMessage);
  const effective = norm.normalized.length >= 2 ? norm.normalized : (userMessage || '').trim();

  if (isGreetingOrCapabilityQuestion(userMessage, norm.normalized)) {
    return {
      text: 'Привет! Я подбираю сборки ПК из нашего каталога — можно писать с опечатками и жаргоном.\n\nПримеры запросов:\n• «Сборка для игр до 120к»\n• «RTX 5070 стриминг и работа»\n• «Тихий офисный пк 60000 руб»\n• «Монтаж видео до 200к, предпочитаю AMD»\n\nУкажите бюджет и задачи — подберу 3 варианта с объяснением.',
    };
  }

  const catalog = await loadCatalogForAi(pool);
  const budgetRub = parseBudgetRub(userMessage, norm.normalized);
  const cpuHint = buildCpuHint(effective, norm.normalized);
  const gpuPrefer = getGpuPreference(userMessage, norm.normalized);
  const wl = workload || extractWorkloadHint(`${userMessage} ${norm.normalized}`);
  const fallbackBudget = budgetRub > 0 ? budgetRub : inferFallbackBudgetRub(userMessage, effective);
  const budgetLabel = budgetRub > 0 ? budgetRub : fallbackBudget;

  // Несколько вариантов, если бюджет указан или выведен из модели GPU
  if (fallbackBudget >= 50000) {
    const variants = generateThreeVariants(catalog, fallbackBudget, gpuPrefer, cpuHint, wl, effective);
    if (variants.length > 0) {
      return {
        suggestions: variants.map(v => ({
          name: v.label,
          description: `${v.pros_tag.charAt(0).toUpperCase() + v.pros_tag.slice(1)}. Итого ≈ ${v.build.totalPrice.toLocaleString('ru-RU')} руб. из ${budgetLabel.toLocaleString('ru-RU')} руб.`,
          pros: v.pros,
          cons: v.cons,
          component_ids: v.build.ids,
        })),
      };
    }
  }

  // Один вариант
  let build = pickCompatibleBuild(catalog, fallbackBudget, gpuPrefer, cpuHint, effective);
  build = build ? finalizeAiComponentIds(catalog, build, fallbackBudget, gpuPrefer, cpuHint, effective) : null;
  if (!build || !build.ids.length) {
    return {
      text: 'Не удалось подобрать совместимую сборку в указанный бюджет. Попробуйте увеличить бюджет или упростить запрос.',
    };
  }
  const pc = buildProsCons(catalog, build.ids, wl);
  const names = catalog.filter(c => build.ids.includes(c.id)).map(c => c.name);
  return {
    suggestions: [{
      name: 'Оптимальная сборка',
      description: `${names.slice(0, 3).join(', ')}… Итого ≈ ${build.totalPrice.toLocaleString('ru-RU')} руб.`,
      pros: pc.pros,
      cons: pc.cons,
      component_ids: build.ids,
    }],
  };
}

const SHORT_MSG_NO_INTENT_MAX_LEN = 160;

/**
 * Главная точка входа ИИ-ответа.
 * @param {object} pool          — pg Pool
 * @param {string} userMessage   — сообщение пользователя
 * @param {string|null} buildSummary — прикреплённая сборка
 * @param {Array|null}  history  — история чата [{role, content}]
 */
async function getAiResponse(pool, userMessage, buildSummary = null, history = null) {
  const clean = stripChatInput(userMessage);
  const norm = normalizeUserMessage(clean);
  const effective = norm.normalized.length >= 2 ? norm.normalized : clean;
  const scanText = `${clean} ${norm.normalized}`;

  // Определяем контекст запроса
  const workload = extractWorkloadHint(scanText);
  const isUpgrade = detectUpgradeIntent(scanText);
  const hasAttachedBuild = !!(buildSummary && String(buildSummary).trim().length > 0);
  const attachedTotalRub = hasAttachedBuild ? parseBuildSummaryTotalRub(buildSummary) : 0;

  // Прикреплённая сборка меняет режим: даже на короткие/общие вопросы отвечаем обзором + альтернативами
  if (!hasAttachedBuild) {
    if (isGreetingOrCapabilityQuestion(clean, norm.normalized)) {
      return smartFallback(pool, clean, norm, workload);
    }

    if (clean.length <= SHORT_MSG_NO_INTENT_MAX_LEN && !hasExplicitPcBuildIntent(clean, norm.normalized)) {
      return {
        text: 'Опишите запрос про сборку — например:\n• «Игровой ПК до 100к с RTX 5070»\n• «Сборка для монтажа видео, бюджет 180 000»\n• «Тихий офисный компьютер до 60к»\nМожно писать с опечатками и по-русски.',
      };
    }
  }

  const catalog = await loadCatalogForAi(pool);
  const budgetRub = parseBudgetRub(clean, norm.normalized);
  // Если прикреплена сборка и пользователь не указал другой бюджет — берём её стоимость как целевую
  const effectiveBudget = budgetRub > 0 ? budgetRub : (attachedTotalRub > 0 ? attachedTotalRub : 0);
  const gpuPrefer = getGpuPreference(clean, norm.normalized);
  const cpuHint = buildCpuHint(effective, norm.normalized);

  // Умная фильтрация каталога для промпта (при прикреплённой сборке ориентируемся на её стоимость)
  const catalogText = buildSmartCatalogText(catalog, effectiveBudget, gpuPrefer, cpuHint, workload);
  const { systemMsg, userMsg } = buildUnifiedPrompt(catalogText, clean, buildSummary, norm, workload, isUpgrade);

  let raw = null;
  if (OPENAI_API_KEY) {
    raw = await callOpenAiCompatible(systemMsg, userMsg, history);
  }
  if (!raw) {
    // Для Ollama — объединяем в один prompt
    raw = await callOllama(`${systemMsg}\n\n${userMsg}`);
  }

  if (raw && typeof raw === 'string') {
    const trimmed = raw.trim();
    const parsed = extractJsonFromResponse(trimmed);
    if (parsed && parsed.suggestions && Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
      const validIds = new Set(catalog.map((c) => c.id));
      const fallbackBudget = effectiveBudget > 0 ? effectiveBudget : 130000;
      const chipInfo = getGpuChipFromMessage(effective) || getGpuChipFromMessage(clean);
      const parsedText = typeof parsed.text === 'string' ? parsed.text.trim() : '';

      // Если LLM вернул JSON со сборками, но запрос без явного намерения и нет прикреплённой сборки — игнорируем
      if (!hasAttachedBuild && clean.length <= 120 && !hasExplicitPcBuildIntent(clean, norm.normalized)) {
        return {
          text: 'Запрос выглядит как общение без подбора железа. Напишите бюджет, задачи или модель видеокарты — предложу сборки из каталога.',
        };
      }

      // Если бюджет известен и >= 50k — пробуем сгенерировать 3 варианта алгоритмически
      // Но не подменяем ответ LLM, если прикреплена сборка (обзор важнее стандартных трёх вариантов).
      if (!hasAttachedBuild && budgetRub >= 50000) {
        const variants = generateThreeVariants(catalog, budgetRub, gpuPrefer, cpuHint, workload, effective);
        if (variants.length >= 2) {
          return {
            suggestions: variants.map(v => ({
              name: v.label,
              description: `${v.pros_tag.charAt(0).toUpperCase() + v.pros_tag.slice(1)}. Итого ≈ ${v.build.totalPrice.toLocaleString('ru-RU')} руб.`,
              pros: v.pros,
              cons: v.cons,
              component_ids: v.build.ids,
            })),
          };
        }
      }

      // Обрабатываем ответ LLM — проверяем и чиним каждый набор ids
      const out = [];
      for (const s of parsed.suggestions.slice(0, 3)) {
        let fixed = null;

        // Сначала пытаемся использовать id из ответа LLM
        const rawIds = (s.component_ids || []).filter(id => validIds.has(id));
        if (rawIds.length >= 4) {
          fixed = ensureCompatibleAndBudget(catalog, rawIds, budgetRub > 0 ? budgetRub : null);
        }

        // Если ids LLM не прошли — алгоритмический подбор
        if (!fixed) {
          fixed = pickCompatibleBuild(catalog, fallbackBudget, gpuPrefer, cpuHint, effective);
          if (fixed) fixed = finalizeAiComponentIds(catalog, fixed, fallbackBudget, gpuPrefer, cpuHint, effective);
        }

        // Принудительно ставим нужный GPU если запросили конкретный
        if (fixed && chipInfo) {
          const gpuRow = fixed.ids.map(id => catalog.find(c => c.id === id)).find(c => c && c.category_slug === 'gpu');
          if (!gpuRow || !gpuCatalogEntryMatchesChip(gpuRow.name, chipInfo)) {
            const alt = pickCompatibleBuildGpuFirst(catalog, Math.max(fallbackBudget, budgetRub || 0), chipInfo, cpuHint);
            if (alt) fixed = alt;
          }
        }

        if (fixed) {
          fixed = finalizeAiComponentIds(catalog, fixed, budgetRub > 0 ? budgetRub : null, gpuPrefer, cpuHint, effective);
        }

        if (fixed) {
          // Генерируем реальные pros/cons из спеков, дополняем ответом LLM
          const pc = buildProsCons(catalog, fixed.ids, workload);
          const llmPros = Array.isArray(s.pros) && s.pros.length > 0 ? s.pros : [];
          const llmCons = Array.isArray(s.cons) && s.cons.length > 0 ? s.cons : [];
          const mergedPros = [...new Set([...pc.pros, ...llmPros])].slice(0, 6);
          const mergedCons = [...new Set([...pc.cons, ...llmCons])].slice(0, 4);

          const desc = (s.description || '').trim();
          const priceNote = fixed.totalPrice ? ` Итого ≈ ${fixed.totalPrice.toLocaleString('ru-RU')} руб.` : '';
          out.push({
            name: s.name || 'Сборка',
            description: desc ? (desc.endsWith('.') ? desc : desc + '.') + priceNote : priceNote.trim() || 'Совместимая сборка.',
            pros: mergedPros.length > 0 ? mergedPros : ['Совместимость проверена'],
            cons: mergedCons,
            component_ids: fixed.ids,
          });
        }
      }
      if (out.length > 0) {
        // Для прикреплённой сборки фильтруем альтернативы по диапазону ±15%, отсекая слишком дешёвые/дорогие
        let filtered = out;
        if (hasAttachedBuild && attachedTotalRub > 0) {
          const low = attachedTotalRub * 0.8;
          const high = attachedTotalRub * 1.2;
          const inRange = out.filter(o => {
            const total = (o.component_ids || []).reduce((acc, id) => {
              const c = catalog.find(cc => cc.id === id);
              return acc + (c ? (c.price || 0) : 0);
            }, 0);
            return total >= low && total <= high;
          });
          if (inRange.length > 0) filtered = inRange;
        }
        const result = { suggestions: filtered };
        if (parsedText) result.text = parsedText;
        return result;
      }
    }

    // Модель вернула простой текст без JSON — для запросов про сборку показываем плитки из каталога
    if (trimmed.length > 0) {
      if (hasAttachedBuild) {
        // Для прикреплённой сборки добавляем альтернативы из каталога
        const fb = await smartFallbackForAttachedBuild(pool, catalog, attachedTotalRub, gpuPrefer, cpuHint, workload, effective);
        return { text: trimmed, suggestions: fb.suggestions };
      }
      if (hasExplicitPcBuildIntent(clean, norm.normalized)) {
        return smartFallback(pool, clean, norm, workload);
      }
      return { text: trimmed };
    }
  }

  // LLM недоступна — собственный фолбэк
  if (hasAttachedBuild) {
    return smartFallbackForAttachedBuild(pool, catalog, attachedTotalRub, gpuPrefer, cpuHint, workload, effective);
  }
  return smartFallback(pool, clean, norm, workload);
}

/**
 * Фолбэк при прикреплённой сборке, когда LLM недоступна: краткий обзор текстом + 2–3 альтернативы ±15%.
 */
async function smartFallbackForAttachedBuild(pool, catalogParam, totalRub, gpuPrefer, cpuHint, workload, effectiveMsg) {
  const catalog = catalogParam || (await loadCatalogForAi(pool));
  const target = totalRub > 0 ? totalRub : 150000;

  const pcts = [0.88, 1.0, 1.12];
  const labels = ['Альтернатива дешевле', 'Альтернатива за ту же сумму', 'Альтернатива чуть дороже'];
  const suggestions = [];
  const seen = new Set();
  for (let i = 0; i < pcts.length; i++) {
    const budget = Math.round(target * pcts[i]);
    let built = pickCompatibleBuild(catalog, budget, gpuPrefer, cpuHint, effectiveMsg);
    built = built ? finalizeAiComponentIds(catalog, built, budget, gpuPrefer, cpuHint, effectiveMsg) : null;
    if (!built) continue;
    const key = built.ids.slice().sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const pc = buildProsCons(catalog, built.ids, workload);
    suggestions.push({
      name: labels[i],
      description: `Итого ≈ ${built.totalPrice.toLocaleString('ru-RU')} руб. (цель ≈ ${target.toLocaleString('ru-RU')} руб.)`,
      pros: pc.pros,
      cons: pc.cons,
      component_ids: built.ids,
    });
  }

  const reviewLines = [];
  reviewLines.push(totalRub > 0
    ? `Обзор прикреплённой сборки (≈ ${totalRub.toLocaleString('ru-RU')} руб.):`
    : 'Обзор прикреплённой сборки:');
  reviewLines.push('• Компоненты собраны в общий комплект — проверьте совместимость по сокету и типу ОЗУ.');
  reviewLines.push('• Ниже — альтернативы из каталога в пределах ±15% по цене: можно сравнить баланс и подобрать более подходящее.');
  const text = reviewLines.join('\n');

  if (suggestions.length === 0) {
    return { text: `${text}\n\nНе удалось подобрать альтернативы в этом диапазоне — попробуйте уточнить задачи (игры, монтаж, тихий ПК и т.п.).` };
  }
  return { text, suggestions };
}

/**
 * Подбор набора component id для готовых сценариев с главного экрана (тот же алгоритм, что и умный fallback ИИ).
 */
async function getPresetComponentIds(pool, preset) {
  const catalog = await loadCatalogForAi(pool);
  const p = String(preset || '').toLowerCase();
  let built = null;
  if (p === 'gaming') {
    built = pickCompatibleBuild(catalog, 120000, '4060', { brand: 'intel', needle: null }, 'gaming intel i7 rtx 4060');
  } else if (p === 'workstation') {
    built = pickCompatibleBuild(catalog, 180000, null, { brand: 'ryzen', needle: null }, 'ryzen 9 workstation 64gb ram');
  }
  if (!built || !built.ids || built.ids.length === 0) {
    built = pickCompatibleBuild(catalog, 150000, null, null, null);
  }
  return built && built.ids ? built.ids : [];
}

module.exports = { getAiResponse, loadCatalogForAi, getPresetComponentIds };
