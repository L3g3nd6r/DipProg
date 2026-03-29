/**
 * Нормализация пользовательских запросов к ИИ: опечатки, жаргон, кириллица/латиница.
 */

/** Убирает BOM / zero-width — иначе «привет» с U+200B не матчится на ^…$ и уходит в подбор сборки. */
function stripChatInput(raw) {
  return String(raw || '')
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j - 1] + cost,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j] + 1
      );
    }
  }
  return matrix[b.length][a.length];
}

/** Целевые слова → допустимое расстояние Левенштейна (зависит от длины). */
const FUZZY_TARGETS = [
  'ryzen', 'intel', 'rtx', 'radeon', 'geforce', 'nvidia',
  'бюджет', 'сборка', 'собери', 'подбери', 'видеокарта', 'процессор', 'материнск',
  'оператив', 'накопител', 'блок', 'корпус', 'игров', 'офис', 'работа', 'стрим',
  'монтаж', 'рендер', 'школ', 'учеб', 'дешев', 'дорог', 'мощн', 'тих', 'компакт',
];

/**
 * Замены фраз и опечаток до токенизации (порядок важен: длинные раньше).
 */
const PHRASE_REPLACEMENTS = [
  [/р\s*т\s*х/gi, 'rtx'],
  [/р\s*х\s*(\d)/gi, 'rx $1'],
  [/г\s*т\s*х/gi, 'gtx'],
  [/жефорс|гефорс|джефорс/gi, 'geforce'],
  [/нвидиа|енвидиа/gi, 'nvidia'],
  [/радеон|рейдон/gi, 'radeon'],
  [/райзен|райзн|раизен|reishen|raizen/gi, 'ryzen'],
  [/интел|интэл|intell/gi, 'intel'],
  [/видяха|видюха|видеокартк|видюшка/gi, 'видеокарта'],
  [/процик|процесор|процессорр/gi, 'процессор'],
  [/бюджит|бюжет|бюджит/gi, 'бюджет'],
  [/рублей|рублях|руб\s/gi, 'руб '],
  [/тыщ|тысячъ/gi, 'тысяч'],
  [/сбокр|сборку|сборке(?!\w)/gi, 'сборка'],
  [/подбери\s*мне/gi, 'подбери'],
  [/скока|сколько\s*у\s*меня|сколько\s*есть/gi, 'бюджет'],
  [/не\s*больше|не\s*более|максимум/gi, 'до'],
  [/п\s*к(?!\w)/gi, 'пк'],
  [/w\s*i\s*n\s*d\s*o\s*w\s*s/gi, 'windows'],
];

/** «50к» «100к руб» */
function expandShortThousands(text) {
  return text.replace(/(\d+)\s*к(?![а-яёa-z])/gi, (_, n) => `${n}000`);
}

/** Только буквы — иначе «50000» превращалось в «500». */
function collapseRepeatedLetters(s) {
  return s.replace(/([a-zа-яё])\1{2,}/gi, '$1$1');
}

/**
 * Нормализует одно слово через словарь и нечёткое совпадение.
 */
function normalizeWord(word) {
  if (!word || word.length < 2) return word;
  const w = word.toLowerCase();
  if (/^\d+$/.test(w)) return w;

  const map = {
    ртх: 'rtx',
    гтх: 'gtx',
    ти: 'ti',
    супер: 'super',
  };
  if (map[w]) return map[w];

  for (const target of FUZZY_TARGETS) {
    if (w === target) return target;
    const maxDist = target.length <= 4 ? 1 : target.length <= 6 ? 2 : 2;
    if (levenshtein(w, target) <= maxDist) return target;
  }

  return w;
}

function tokenizeMessage(text) {
  return text.split(/[^a-zA-Zа-яА-ЯёЁ0-9]+/).filter(Boolean);
}

/**
 * Полная нормализация сообщения для парсеров и для подсказки модели.
 */
function normalizeUserMessage(raw) {
  const original = stripChatInput(raw);
  if (!original) return { normalized: '', original: '', corrections: [] };

  let s = original.replace(/\u00a0/g, ' ').replace(/ё/gi, 'е');
  const corrections = [];

  for (const [re, rep] of PHRASE_REPLACEMENTS) {
    const next = s.replace(re, rep);
    if (next !== s) corrections.push(`pattern:${re}`);
    s = next;
  }

  s = expandShortThousands(s);
  s = collapseRepeatedLetters(s);
  s = s.replace(/\s+/g, ' ').trim();

  const tokens = tokenizeMessage(s);
  const outTokens = tokens.map((t) => {
    const n = normalizeWord(t);
    if (n !== t.toLowerCase()) corrections.push(`${t}→${n}`);
    return n;
  });

  const normalized = outTokens.join(' ').replace(/\s+/g, ' ').trim();
  return { normalized, original, corrections };
}

/**
 * Бюджет: расширенные форматы (50к, 50 k, до ста тысяч — упрощённо).
 */
function parseBudgetRubAdvanced(userMessage, normalizedMsg) {
  const msg = `${userMessage} ${normalizedMsg || ''}`.trim();
  let budgetRub = 0;

  const dollarMatch = msg.match(/(\d[\d\s]*)\s*(?:долларов|dollars|\$|usd)/i);
  if (dollarMatch) {
    budgetRub = Math.min(800000, parseInt(dollarMatch[1].replace(/\s/g, ''), 10) * 100);
  }

  const rubMatch = msg.match(/(\d[\d\s]*)\s*(?:руб|р\.|рублей|₽|rub)/i);
  if (rubMatch) {
    budgetRub = Math.max(budgetRub, Math.min(800000, parseInt(rubMatch[1].replace(/\s/g, ''), 10)));
  }

  const kMatch = msg.match(/(\d{1,3})\s*к\b/i) || msg.match(/(\d{1,3})\s*k\b/i);
  if (kMatch && budgetRub === 0) {
    budgetRub = Math.min(800000, parseInt(kMatch[1], 10) * 1000);
  }

  if (budgetRub <= 0) {
    const m = msg.match(/(?:до|бюджет|максимум|не\s*более)\s*(\d[\d\s]{2,})/i);
    if (m) budgetRub = Math.min(800000, parseInt(m[1].replace(/\s/g, ''), 10));
  }

  if (budgetRub <= 0 && /(?:до|около|примерно)\s*(\d{4,})/i.test(msg)) {
    const m = msg.match(/(?:до|около|примерно)\s*(\d{4,})/i);
    if (m) budgetRub = Math.min(800000, parseInt(m[1], 10));
  }

  if (budgetRub <= 0 && /\b(\d{5,6})\b/.test(msg.replace(/\s/g, ''))) {
    const m = msg.match(/\b(\d{5,6})\b/);
    if (m) budgetRub = Math.min(800000, parseInt(m[1], 10));
  }

  return budgetRub;
}

/**
 * Извлечение чипа GPU с устойчивостью к опечаткам и пропуску «rtx».
 */
function extractGpuChipFuzzy(msg) {
  if (!msg || typeof msg !== 'string') return null;
  const s = msg.toLowerCase().replace(/\u00a0/g, ' ');

  const tiSuper = '(?:\\s*(?:ti|ти|t[iі]))?\\s*(?:super|супер)?';
  let m = s.match(/rtx\s*(\d{4})\s*ti\s*super/i) || s.match(new RegExp(`r{1,2}t{1,2}x?\\s*(\\d{3,4})${tiSuper}`, 'i'));
  if (m) {
    const full = m[0];
    const variant = full.includes('ti super') || full.includes('ти супер') ? 'tisuper'
      : /\bti\b|ти\b/.test(full) ? 'ti'
        : /super|супер/.test(full) ? 'super' : '';
    return { kind: 'nvidia', chip: m[1].replace(/^0+/, '') || m[1], variant };
  }

  m = s.match(/r{1,2}x{1,2}\s*(\d{3,4})/i);
  if (m) return { kind: 'amd', chip: m[1].replace(/^0+/, '') || m[1], variant: '' };

  const nvidiaCtx = /geforce|nvidia|нвидиа|видеокарт|видяха|rtx/i.test(s);
  const num3040 = s.match(/\b(30\d{2}|40\d{2}|50\d{2})\b/);
  if (nvidiaCtx && num3040) {
    return { kind: 'nvidia', chip: num3040[1], variant: /\bti\b|ти\b/.test(s) ? 'ti' : '' };
  }

  m = s.match(
    /\b(3050|3060|3070|3080|3090|4060|4060ti|4070|4080|4090|4050|5050|5060|5060ti|5070|5070ti|5080|5090)\b/i
  );
  if (m) {
    const raw = m[1];
    const variant = /ti$/i.test(raw) ? 'ti' : '';
    const chip = raw.replace(/ti$/i, '');
    return { kind: 'nvidia', chip, variant };
  }

  m = s.match(/\b(7600|7700|7800|7900)\s*(?:xt|xtx)?\b/i);
  if (m) {
    return { kind: 'amd', chip: m[1], variant: /xtx/i.test(s) ? 'xtx' : /xt/i.test(s) ? 'xt' : '' };
  }
  if (/radeon|радеон|\brx\s/i.test(s)) {
    const num = s.match(/\b(66\d{2}|67\d{2}|76\d{2}|77\d{2}|78\d{2}|79\d{2})\b/);
    if (num) return { kind: 'amd', chip: num[1], variant: /xtx/i.test(s) ? 'xtx' : /xt/i.test(s) ? 'xt' : '' };
  }

  return null;
}

function gpuCatalogEntryMatchesChipFuzzy(gpuName, chipInfo) {
  if (!chipInfo || !gpuName) return false;
  const n = gpuName.toLowerCase();
  const num = chipInfo.chip;
  if (chipInfo.kind === 'nvidia') {
    if (!/rtx|geforce|nvidia/i.test(n)) return false;
    const re = new RegExp(`rtx\\s*${num}\\b`, 'i');
    if (!re.test(n)) return false;
    if (chipInfo.variant === 'ti' && !/ti\b/i.test(n)) return false;
    if (chipInfo.variant === 'super' && !/super/i.test(n)) return false;
    if (chipInfo.variant === 'tisuper' && !/ti\s*super/i.test(n)) return false;
    return true;
  }
  if (chipInfo.kind === 'amd') {
    if (!/rx\s*\d|radeon/i.test(n)) return false;
    return n.includes(num);
  }
  return false;
}

/**
 * Строка для подбора GPU в каталоге (includes), устойчивая к формулировкам.
 */
function extractGpuSearchString(msg, chipInfo) {
  if (chipInfo && chipInfo.kind === 'nvidia') {
    return `rtx ${chipInfo.chip}`;
  }
  if (chipInfo && chipInfo.kind === 'amd') {
    return `rx ${chipInfo.chip}`;
  }
  const s = (msg || '').toLowerCase();
  const patterns = [
    /\brtx\s*\d{3,4}\s*ti\s*super\b/i,
    /\brtx\s*\d{3,4}\s*ti\b/i,
    /\brtx\s*\d{3,4}\b/i,
    /\brx\s*\d{4}\s*xtx\b/i,
    /\brx\s*\d{4}\s*xt\b/i,
    /\brx\s*\d{4}\b/i,
    /\b(30\d{2}|40\d{2}|50\d{2})\b/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * Предпочтение CPU: ryzen / intel + опционально номер линейки.
 */
function extractCpuPreferenceFuzzy(msg) {
  const s = (msg || '').toLowerCase();
  if (/ryzen|raizen|райзен|раизен/.test(s)) {
    const line = s.match(/ryzen\s*[579]|r\s*[579]\s*\d/i);
    if (line) return 'ryzen';
    return 'ryzen';
  }
  if (/intel|интел|core\s*i|кор\s*i/i.test(s)) {
    if (/i\s*9|i9|ай\s*9/.test(s)) return 'intel';
    if (/i\s*7|i7/.test(s)) return 'intel';
    if (/i\s*5|i5/.test(s)) return 'intel';
    if (/i\s*3|i3/.test(s)) return 'intel';
    return 'intel';
  }
  return null;
}

/**
 * Конкретная модель CPU из запроса: «райзен 5 5600», «r5 5600», «i5-12400».
 * needle — подстрока для сопоставления с name в каталоге (не путать 5500 и 5600).
 */
function extractCpuDetailHint(userMessage, normalized) {
  const scan = `${stripChatInput(normalized)} ${stripChatInput(userMessage)}`.toLowerCase().replace(/\s+/g, ' ').trim();

  let m = scan.match(/\bcore\s*i\s*[- ]?\s*([3579])\s*[- ]?\s*(\d{4})([a-z]{0,3})?\b/i);
  if (!m) m = scan.match(/\bi\s*[- ]?\s*([3579])\s*[- ]?\s*(\d{4})([a-z]{0,3})?\b/i);
  if (m) {
    const suf = (m[3] || '').toLowerCase();
    return { brand: 'intel', needle: `i${m[1]}-${m[2]}${suf}` };
  }

  m = scan.match(/\bryzen\s*([357579])\s*[- ]?\s*(\d{4})([a-z]{0,3})?\b/i);
  if (!m) m = scan.match(/\br\s*([357579])\s*[- ]?\s*(\d{4})([a-z]{0,3})?\b/i);
  if (m) {
    const suf = (m[3] || '').toLowerCase();
    return { brand: 'ryzen', needle: `${m[1]} ${m[2]}${suf}`.replace(/\s+/g, ' ').trim() };
  }

  let brand = null;
  if (/ryzen|raizen|rai?zen|райзен|раизен/.test(scan)) brand = 'ryzen';
  else if (/intel|интел|core\s*i|\bi\s*[3579]\b/.test(scan)) brand = 'intel';

  return { brand, needle: null };
}

/**
 * Приветствие и короткие фразы без запроса сборки.
 * Важно: приветствие проверяем по исходному сообщению — иначе «привет» + нормализованное «привет»
 * даёт «привет привет», и якорь ^...$ никогда не срабатывает.
 */
function isLikelyGreetingOnly(userMessage, normalized) {
  const u = stripChatInput(userMessage);
  const n = stripChatInput(normalized);
  const uLow = u.toLowerCase();
  const nLow = n.toLowerCase();
  /** Для поиска «сигналов сборки» достаточно одной копии, если текст совпал после нормализации. */
  const forBuildScan = !nLow || uLow === nLow ? uLow : `${uLow} ${nLow}`;

  if (forBuildScan.length < 2) return true;

  const buildSignals =
    /(сборк|собери|подбери|бюджет|руб|₽|rtx|r\s*t\s*x|ртх|rx\s*\d|ryzen|raizen|райзен|intel|интел|i\s*[3579]\b|geforce|видеокарт|видях|процесс|ddr\d|\d{4,}\s*р|\d{5,6}\b|пк\s*до|до\s*\d{4,}|игров|офисн|стрим|монтаж|рендер|\d{2}\s*к\b)/i.test(forBuildScan);

  if (buildSignals) return false;

  const greeting =
    /^(привет|приветик|здравствуй(те)?|хай|hello|hi|hey|здорово|йоу)[\s!.?]*$/i.test(uLow) ||
    /^добрый\s+(день|вечер|утро)[\s!.?]*$/i.test(uLow) ||
    /^доброе\s+утро[\s!.?]*$/i.test(uLow) ||
    /^(добрый|доброе)[\s!.?]*$/i.test(uLow) ||
    /^(что\s*ты\s*умеешь|что\s*умеешь|что\s*можешь|помоги\s*разобраться|как\s*тобой\s*пользоваться)[\s?.!]*$/i.test(uLow) ||
    /^(как\s*дела|как\s*ты|что\s*нового|как\s*настроение)[\s!.?]*$/i.test(uLow) ||
    /^(спасибо|спс|пасиба|благодарю|thanks|thank\s*you)[\s!.?]*$/i.test(uLow) ||
    /^(пока|до\s*свидания|увидимся|покеда)[\s!.?]*$/i.test(uLow) ||
    /^(ок(ей)?|окей|хорошо|ладно|понятно|понял|ясно|ага|угу)[\s!.?]*$/i.test(uLow);

  return greeting;
}

/**
 * Явные признаки запроса про ПК/железо. Короткие фразы без них не должны вызывать подбор сборки.
 */
function hasExplicitPcBuildIntent(userMessage, normalized) {
  const u = stripChatInput(userMessage).toLowerCase();
  const n = stripChatInput(normalized).toLowerCase();
  const scan = n && u !== n ? `${u} ${n}` : u;
  if (scan.length < 2) return false;

  return /(?:^|[\s,.;:!?])(?:сборк|собери|собрать|соберу|подбери|подбор|комплектующ|компьютер|компютер|десктоп)(?:$|[\s,.;:!?])|(?:^|\s)пк(?:$|[\s,.;:!?])|нужен\s+(?:пк|комп|компьютер|компютер)|нужна\s+сборк|хочу\s+(?:пк|комп|компьютер|компютер|собрать|сборк)|купить\s+(?:пк|комп|компьютер|компютер)|бюджет|рубл|₽|\bруб\.|до\s*\d|\d+\s*к\b|\d{4,}\s*(?:руб|р\.|₽)|rtx|r\s*t\s*x|ртх|gtx|гтх|\brx\s*\d|радеон|radeon|ryzen|райзен|raizen|intel|интел|\bi\s*[3579]\d{0,4}\b|core\s*i|geforce|nvidia|нвидиа|видеокарт|видях|процессор|\bпроц\b|материн|озу|оператив|ddr[345]|накопител|\bssd\b|\bhdd\b|nvme|блок\s*пит|\bбп\b|корпус|игров|офисн|\bофис|стрим|монтаж|рендер|потянет|fps|апгрейд|улучш|дешев|дёшев|дорог|мощн|\bтих\b|тихий|тихая|тихое|компакт|\b(?:30|40|50)\d{2}\b|\b(?:66|67|76|77|78|79)\d{2}\b|windows|виндовс|linux/i.test(
    scan
  );
}

/**
 * Определяет тип нагрузки/сценарий из сообщения.
 * Возвращает: '4k'|'1440p'|'streaming'|'video_edit'|'render'|'office'|'silent'|'compact'|'gaming'|null
 */
function extractWorkloadHint(msg) {
  const s = (msg || '').toLowerCase();
  if (/4к\b|4k\b|2160p|4к\s*uhd|ultra\s*hd|2160/i.test(s)) return '4k';
  if (/1440p|wqhd|1440|2к\b|2k\b|2560x1440/i.test(s)) return '1440p';
  if (/стрим|stream|twitch|\bобс\b|\bobs\b|стримить|стримлю|стриминг/i.test(s)) return 'streaming';
  if (/монтаж|premiere|davinci|after\s*effects|видеоред|видео.?монтаж/i.test(s)) return 'video_edit';
  if (/рендер|render|blender|3dsmax|cinema\s*4d|maya|3d\s*график/i.test(s)) return 'render';
  if (/офис|работ|учеб|школ|\b1с\b|\b1c\b|excel|word|zoom|документ|конторск/i.test(s)) return 'office';
  if (/тих|silent|бесшум/i.test(s)) return 'silent';
  if (/компакт|mini.?itx|miniitx|маленьк/i.test(s)) return 'compact';
  if (/игр|gaming|\bfps\b|фпс|кс\s*го|cs\s*2|warzone|cyberpunk|valorant|apex|dota|fortnite|ааа\s*игр/i.test(s)) return 'gaming';
  return null;
}

/**
 * Определяет намерение апгрейда существующей системы.
 */
function detectUpgradeIntent(msg) {
  return /апгрейд|upgrade|обновит|заменит|у\s+меня\s+есть|уже\s+есть|уже\s+имею|поменять\s+\w|пересборк/i.test(msg || '');
}

module.exports = {
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
  levenshtein,
  extractWorkloadHint,
  detectUpgradeIntent,
};
