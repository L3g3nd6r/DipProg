/**
 * Наполнение БД категориями и комплектующими (~50+ на категорию).
 * Базовые цены в коде — ориентир прошлых сезонов; при вставке умножаются на коэффициент
 * (актуализация под розницу ~2026 Q1, округление до 100 ₽). Запуск: npm run seed
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dipproj',
});

/** Коэффициент к базовым ценам в generateComponents (инфляция / курс, без внешнего API). */
const SEED_PRICE_FACTOR = 1.07

function seedPriceRub(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(100, Math.round((x * SEED_PRICE_FACTOR) / 100) * 100)
}

const CATEGORIES = [
  { name: 'Процессоры', slug: 'processors', sort_order: 1, max_per_build: 1 },
  { name: 'Видеокарты', slug: 'gpu', sort_order: 2, max_per_build: 2 },
  { name: 'Оперативная память', slug: 'ram', sort_order: 3, max_per_build: 4 },
  { name: 'Материнские платы', slug: 'motherboard', sort_order: 4, max_per_build: 1 },
  { name: 'Накопители', slug: 'storage', sort_order: 5, max_per_build: 4 },
  { name: 'Блоки питания', slug: 'psu', sort_order: 6, max_per_build: 1 },
  { name: 'Корпуса', slug: 'case', sort_order: 7, max_per_build: 1 },
];

async function seed() {
  const client = await pool.connect();
  try {
    const slugs = CATEGORIES.map((c) => c.slug);
    await client.query(
      `DELETE FROM components WHERE category_id IN (SELECT id FROM component_categories WHERE slug = ANY($1::text[]))`,
      [slugs]
    );
    console.log('Очищены старые комплектующие по категориям сидера.');
    for (const cat of CATEGORIES) {
      const r = await client.query(
        'INSERT INTO component_categories (name, slug, sort_order, max_per_build) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO UPDATE SET name = $1, sort_order = $3, max_per_build = $4 RETURNING id',
        [cat.name, cat.slug, cat.sort_order, cat.max_per_build != null ? cat.max_per_build : 1]
      );
      const categoryId = r.rows[0].id;
      const components = generateComponents(cat.slug, categoryId);
      for (const c of components) {
        await client.query(
          `INSERT INTO components (category_id, name, description, price, specs)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (category_id, name) DO UPDATE SET
             description = EXCLUDED.description,
             price = EXCLUDED.price,
             specs = EXCLUDED.specs,
             updated_at = CURRENT_TIMESTAMP`,
          [c.category_id, c.name, c.description || null, seedPriceRub(c.price), c.specs ? JSON.stringify(c.specs) : null]
        );
      }
      console.log(`Категория "${cat.name}": ${components.length} позиций.`);
    }
    console.log('Seed завершён.');
  } finally {
    client.release();
    await pool.end();
  }
}

function genPrice(min, max) {
  return Math.round((min + Math.random() * (max - min)) / 100) * 100;
}

function enrichCpuSpecs(p) {
  const name = p.name;
  const isF = /\b\d{3,4}F\b/i.test(name);
  const isK = /\d{4,5}K(B|F)?\b/.test(name);
  const isX3D = name.includes('X3D');
  const ryzenG = name.includes('Ryzen') && /\d{4}G\b/.test(name);
  let tdp = 65;
  if (isX3D) tdp = 120;
  else if (name.includes('9950X') && !name.includes('X3D')) tdp = 170;
  else if (name.includes('9900X')) tdp = 120;
  else if (name.includes('9800X3D')) tdp = 120;
  else if (name.includes('9700X') || name.includes('9600X')) tdp = 105;
  else if (name.includes('Ultra 9')) tdp = 125;
  else if (name.includes('Ultra 7')) tdp = 125;
  else if (name.includes('Ultra 5') && (name.includes('K') || name.includes('245'))) tdp = 125;
  else if (name.includes('Ultra 5')) tdp = 65;
  else if (name.includes('i9') || name.includes('7950') || name.includes('7900X3D')) tdp = name.includes('KF') ? 125 : 125;
  else if (name.includes('i7') || name.includes('7900X') || name.includes('7700X')) tdp = 105;
  else if (isK && name.includes('Intel') && !name.includes('Ultra')) tdp = 125;
  else if (name.includes('5800X') || name.includes('5700X')) tdp = 105;
  let cache = 24;
  if (isX3D) cache = name.includes('7800') || name.includes('9800') ? 96 : name.includes('7950') || name.includes('9950') ? 128 : 96;
  else if (name.includes('Ultra 9')) cache = 36;
  else if (name.includes('Ultra 7')) cache = 30;
  else if (name.includes('Ultra 5')) cache = 24;
  else if (name.includes('i9')) cache = 36;
  else if (name.includes('i7')) cache = 30;
  else if (name.includes('i5')) cache = 24;
  else if (name.includes('i3')) cache = 12;
  else if (name.includes('Ryzen 9')) cache = 64;
  else if (name.includes('Ryzen 7')) cache = 32;
  else if (name.includes('Ryzen 5')) cache = 32;
  let boost = 4.4;
  if (name.includes('9950X3D')) boost = 5.7;
  else if (name.includes('9950X')) boost = 5.7;
  else if (name.includes('9900X')) boost = 5.6;
  else if (name.includes('9800X3D')) boost = 5.2;
  else if (name.includes('9700X')) boost = 5.5;
  else if (name.includes('9600X')) boost = 5.4;
  else if (name.includes('Ultra 9')) boost = 5.7;
  else if (name.includes('Ultra 7')) boost = 5.5;
  else if (name.includes('Ultra 5') && name.includes('K')) boost = 5.3;
  else if (name.includes('Ultra 5')) boost = 4.8;
  else if (name.includes('14900K')) boost = 6.0;
  else if (name.includes('13900K') || name.includes('7950X')) boost = 5.7;
  else if (name.includes('7800X3D')) boost = 5.0;
  else if (name.includes('5800X3D')) boost = 4.5;
  else if (name.includes('i7')) boost = 5.2;
  else if (name.includes('i5') && isK) boost = 5.1;
  const base = Math.max(2.4, boost - 0.8);
  let igpu = 'есть (зависит от модели)';
  if (isF) igpu = 'нет';
  else if (ryzenG) igpu = 'AMD Radeon Graphics';
  else if (name.includes('Ryzen')) igpu = 'нет';
  else if (name.includes('Intel')) igpu = name.includes('Ultra') ? 'Intel Xe (кроме F)' : 'Intel UHD / Arc (по модели)';
  const pcie =
    p.socket === 'AM5' || p.socket === 'LGA1851' || name.match(/1[34]\d{3}/) ? 'PCIe 5.0' : 'PCIe 4.0';
  const nm =
    p.socket === 'AM5' ? 5 : p.socket === 'AM4' ? 7 : p.socket === 'LGA1851' ? 3 : name.includes('14') ? 7 : 10;
  return {
    cores: p.cores,
    threads: p.threads,
    socket: p.socket,
    base_clock_ghz: Math.round(base * 100) / 100,
    boost_clock_ghz: Math.round(boost * 100) / 100,
    tdp_w: tdp,
    cache_l3_mb: cache,
    lithography_nm: nm,
    pcie_cpu_version: pcie,
    integrated_gpu: igpu,
  };
}

function enrichGpuSpecs(p) {
  const name = p.name;
  const n = name.toLowerCase();
  let tdp = 170;
  let recPsu = 650;
  let len = 300;
  let rt = 'нет';
  let upscaling = '—';
  if (n.includes('rtx')) {
    rt = 'NVIDIA RT ядра';
    upscaling = 'NVIDIA DLSS 2/3 (зависит от игры)';
  }
  if (n.includes('radeon') || n.includes('rx ')) {
    rt = 'AMD Ray Accelerator';
    upscaling = 'AMD FSR 2/3';
  }
  if (n.includes('5090')) { tdp = 575; recPsu = 1000; len = 357; }
  else if (n.includes('5080')) { tdp = 360; recPsu = 850; len = 330; }
  else if (n.includes('5050')) { tdp = 130; recPsu = 500; len = 222; }
  else if (n.includes('5070 ti')) { tdp = 300; recPsu = 750; len = 302; }
  else if (n.includes('5070')) { tdp = 220; recPsu = 650; len = 272; }
  else if (n.includes('5060 ti')) { tdp = 180; recPsu = 600; len = 245; }
  else if (n.includes('5060')) { tdp = 150; recPsu = 550; len = 235; }
  else if (n.includes('4090')) { tdp = 450; recPsu = 850; len = 340; }
  else if (n.includes('4080') && n.includes('super')) { tdp = 320; recPsu = 750; len = 330; }
  else if (n.includes('4080')) { tdp = 320; recPsu = 750; len = 325; }
  else if (n.includes('4070 ti')) { tdp = 285; recPsu = 750; len = 305; }
  else if (n.includes('4070')) { tdp = 200; recPsu = 650; len = 245; }
  else if (n.includes('4060 ti')) { tdp = 160; recPsu = 550; len = 242; }
  else if (n.includes('4060')) { tdp = 115; recPsu = 550; len = 235; }
  else if (n.includes('4050')) { tdp = 115; recPsu = 450; len = 220; }
  else if (n.includes('3080 ti') || n.includes('3090')) { tdp = 350; recPsu = 750; len = 320; }
  else if (n.includes('3080')) { tdp = 320; recPsu = 750; len = 305; }
  else if (n.includes('3070')) { tdp = 220; recPsu = 650; len = 300; }
  else if (n.includes('3060 ti')) { tdp = 200; recPsu = 600; len = 242; }
  else if (n.includes('3060') || n.includes('3050')) { tdp = 170; recPsu = 550; len = 235; }
  else if (n.includes('7900 xtx')) { tdp = 355; recPsu = 850; len = 340; }
  else if (n.includes('7900')) { tdp = 315; recPsu = 750; len = 320; }
  else if (n.includes('7800 xt')) { tdp = 263; recPsu = 700; len = 305; }
  else if (n.includes('7700 xt')) { tdp = 245; recPsu = 650; len = 280; }
  else if (n.includes('7600')) { tdp = 165; recPsu = 550; len = 230; }
  else if (n.includes('6700')) { tdp = 230; recPsu = 650; len = 268; }
  else if (n.includes('6600')) { tdp = 132; recPsu = 500; len = 235; }
  const bus = /\brtx\s*50\d{2}/i.test(n) ? 'PCIe 5.0 x16' : 'PCIe 4.0 x16';
  return {
    vram_gb: p.vram,
    memory_bus_bit: p.vram >= 12 && !n.includes('4060 ti 8') ? 192 : 128,
    tdp_w: tdp,
    recommended_psu_w: recPsu,
    pcie_interface: bus,
    length_mm_typical: len,
    ray_tracing: rt,
    upscaling,
  };
}

function enrichMbSpecs(p) {
  const ch = p.chipset;
  let m2 = 2;
  let sata = 4;
  let oc = 'нет';
  let pcieMain = 'PCIe 4.0 x16 для GPU';
  if (ch.startsWith('H610')) { m2 = 1; pcieMain = 'PCIe 4.0 x16'; }
  if (ch.startsWith('B660') || ch.startsWith('B760')) { m2 = 2; oc = 'разгон RAM / частично'; }
  if (ch.startsWith('Z790') || ch.startsWith('X670')) { m2 = 3; oc = 'CPU + RAM'; pcieMain = 'PCIe 5.0 x16 (зависит от CPU)'; }
  if (ch.startsWith('B650')) { m2 = 2; oc = 'RAM (EXPO)'; pcieMain = 'PCIe 4.0/5.0 x16'; }
  if (ch.startsWith('B550')) { m2 = 2; oc = 'RAM + CPU (частично)'; }
  if (ch.startsWith('B860') || ch.startsWith('B850')) { m2 = 2; oc = 'RAM (XMP/EXPO)'; pcieMain = 'PCIe 5.0 x16 для GPU'; }
  if (ch.startsWith('Z890')) { m2 = 3; oc = 'CPU + RAM'; pcieMain = 'PCIe 5.0 x16'; }
  if (ch.startsWith('X870')) { m2 = 3; oc = 'CPU + RAM (EXPO)'; pcieMain = 'PCIe 5.0 x16'; }
  return {
    chipset: p.chipset,
    form_factor: p.form,
    socket: p.socket,
    ram_type: p.ram,
    m2_slots: m2,
    sata_ports: sata,
    pcie_gpu_slot: pcieMain,
    wifi_bluetooth: p.name.includes('WiFi') ? 'встроено (по спецификации платы)' : 'нет / опционально',
    overclocking: oc,
  };
}

function enrichNvmeSpec(p) {
  const name = p.name;
  let read = 3500;
  let write = 2500;
  let gen = 'PCIe 3.0 x4';
  if (name.includes('990 Pro')) { read = 7450; write = 6900; gen = 'PCIe 4.0 x4'; }
  else if (name.includes('980') && !name.includes('970')) { read = 5000; write = 3900; gen = 'PCIe 3.0/4.0 x4'; }
  else if (name.includes('SN770') || name.includes('P5 Plus')) { read = 5150; write = 4850; gen = 'PCIe 4.0 x4'; }
  else if (name.includes('SN580') || name.includes('P3 Plus')) { read = 4150; write = 3500; gen = 'PCIe 4.0 x4'; }
  else if (name.includes('970 EVO')) { read = 3500; write = 3300; gen = 'PCIe 3.0 x4'; }
  return {
    capacity_gb: p.cap,
    type: 'SSD NVMe',
    interface: gen,
    read_seq_mb_s: read,
    write_seq_mb_s: write,
    form_factor: 'M.2 2280',
    nand_type: 'TLC / QLC (см. ревизию)',
  };
}

function enrichSataSsdSpec(p) {
  return {
    capacity_gb: p.cap,
    type: 'SSD SATA',
    interface: 'SATA 6 Гбит/с',
    read_seq_mb_s: 550,
    write_seq_mb_s: 520,
    form_factor: '2.5"',
  };
}

function enrichHddSpec(p) {
  return {
    capacity_gb: p.cap,
    type: 'HDD',
    interface: 'SATA 6 Гбит/с',
    rpm: 7200,
    cache_mb: p.cap >= 4000 ? 256 : 64,
  };
}

function enrichPsuSpec(p) {
  const modular = p.watt >= 750 ? 'полумодульная / полная' : p.watt >= 650 ? 'полумодульная' : 'немодульная';
  return {
    power_w: p.watt,
    efficiency_cert: p.eff,
    modular_cables: modular,
    protection: 'OVP, UVP, OPP, SCP, OTP (по модели)',
    twelve_v_output: 'DC-DC, тип шины ±12V по серии',
    pcie_gpu_connectors: p.watt >= 850 ? '2×8-pin+ или 12VHPWR (см. комплект)' : p.watt >= 650 ? '2×8-pin' : '1–2×8-pin',
  };
}

function enrichCaseSpec(c) {
  const gpuMax = c.form === 'Mini-ITX' ? 330 : c.form === 'Micro-ATX' ? 360 : 410;
  return {
    form_factor: c.form,
    motherboard_support: c.form === 'Full-Tower' ? 'E-ATX / ATX' : c.form === 'Mini-ITX' ? 'Mini-ITX' : c.form === 'Micro-ATX' ? 'Micro-ATX, Mini-ITX' : 'ATX, Micro-ATX',
    max_gpu_length_mm: gpuMax,
    cpu_cooler_max_height_mm: c.form === 'Mini-ITX' ? 155 : 165,
    psu_support: 'ATX',
    fans_included: c.price >= 9000 ? '2–3×120mm' : '1×120mm / без (см. комплект)',
    radiator_front_mm: c.form === 'Full-Tower' ? 420 : 360,
  };
}

function generateComponents(slug, categoryId) {
  const list = [];
  if (slug === 'processors') {
    const items = [
      { name: 'Intel Core i3-12100F', price: 7990, cores: 4, threads: 8, socket: 'LGA1700' },
      { name: 'Intel Core i3-12100', price: 8990, cores: 4, threads: 8, socket: 'LGA1700' },
      { name: 'Intel Core i3-13100F', price: 9490, cores: 4, threads: 8, socket: 'LGA1700' },
      { name: 'Intel Core i3-13100', price: 10490, cores: 4, threads: 8, socket: 'LGA1700' },
      { name: 'Intel Core i3-14100F', price: 9990, cores: 4, threads: 8, socket: 'LGA1700' },
      { name: 'Intel Core i5-12400F', price: 12990, cores: 6, threads: 12, socket: 'LGA1700' },
      { name: 'Intel Core i5-12400', price: 13990, cores: 6, threads: 12, socket: 'LGA1700' },
      { name: 'Intel Core i5-12500', price: 15990, cores: 6, threads: 12, socket: 'LGA1700' },
      { name: 'Intel Core i5-13400F', price: 15990, cores: 10, threads: 16, socket: 'LGA1700' },
      { name: 'Intel Core i5-13400', price: 17490, cores: 10, threads: 16, socket: 'LGA1700' },
      { name: 'Intel Core i5-13500', price: 18990, cores: 14, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i5-13600K', price: 24990, cores: 14, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i5-13600KF', price: 22990, cores: 14, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i5-14400F', price: 16990, cores: 10, threads: 16, socket: 'LGA1700' },
      { name: 'Intel Core i5-14500', price: 19990, cores: 14, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i5-14600K', price: 27990, cores: 14, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i5-14600KF', price: 25990, cores: 14, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i7-12700F', price: 22990, cores: 12, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i7-12700', price: 24990, cores: 12, threads: 20, socket: 'LGA1700' },
      { name: 'Intel Core i7-13700F', price: 28990, cores: 16, threads: 24, socket: 'LGA1700' },
      { name: 'Intel Core i7-13700', price: 30990, cores: 16, threads: 24, socket: 'LGA1700' },
      { name: 'Intel Core i7-13700K', price: 32990, cores: 16, threads: 24, socket: 'LGA1700' },
      { name: 'Intel Core i7-13700KF', price: 30990, cores: 16, threads: 24, socket: 'LGA1700' },
      { name: 'Intel Core i7-14700F', price: 32990, cores: 20, threads: 28, socket: 'LGA1700' },
      { name: 'Intel Core i7-14700K', price: 37990, cores: 20, threads: 28, socket: 'LGA1700' },
      { name: 'Intel Core i7-14700KF', price: 35990, cores: 20, threads: 28, socket: 'LGA1700' },
      { name: 'Intel Core i9-13900F', price: 42990, cores: 24, threads: 32, socket: 'LGA1700' },
      { name: 'Intel Core i9-13900K', price: 47990, cores: 24, threads: 32, socket: 'LGA1700' },
      { name: 'Intel Core i9-13900KF', price: 44990, cores: 24, threads: 32, socket: 'LGA1700' },
      { name: 'Intel Core i9-14900K', price: 54990, cores: 24, threads: 32, socket: 'LGA1700' },
      { name: 'Intel Core i9-14900KF', price: 51990, cores: 24, threads: 32, socket: 'LGA1700' },
      { name: 'AMD Ryzen 5 5500', price: 6990, cores: 6, threads: 12, socket: 'AM4' },
      { name: 'AMD Ryzen 5 5600', price: 9990, cores: 6, threads: 12, socket: 'AM4' },
      { name: 'AMD Ryzen 5 5600X', price: 11990, cores: 6, threads: 12, socket: 'AM4' },
      { name: 'AMD Ryzen 5 5600G', price: 10990, cores: 6, threads: 12, socket: 'AM4' },
      { name: 'AMD Ryzen 7 5700X', price: 14990, cores: 8, threads: 16, socket: 'AM4' },
      { name: 'AMD Ryzen 7 5700G', price: 13990, cores: 8, threads: 16, socket: 'AM4' },
      { name: 'AMD Ryzen 7 5800X', price: 16990, cores: 8, threads: 16, socket: 'AM4' },
      { name: 'AMD Ryzen 7 5800X3D', price: 24990, cores: 8, threads: 16, socket: 'AM4' },
      { name: 'AMD Ryzen 9 5900X', price: 22990, cores: 12, threads: 24, socket: 'AM4' },
      { name: 'AMD Ryzen 9 5950X', price: 39990, cores: 16, threads: 32, socket: 'AM4' },
      { name: 'AMD Ryzen 5 7500F', price: 14990, cores: 6, threads: 12, socket: 'AM5' },
      { name: 'AMD Ryzen 5 7600', price: 16990, cores: 6, threads: 12, socket: 'AM5' },
      { name: 'AMD Ryzen 5 7600X', price: 18990, cores: 6, threads: 12, socket: 'AM5' },
      { name: 'AMD Ryzen 7 7700', price: 21990, cores: 8, threads: 16, socket: 'AM5' },
      { name: 'AMD Ryzen 7 7700X', price: 24990, cores: 8, threads: 16, socket: 'AM5' },
      { name: 'AMD Ryzen 7 7800X3D', price: 34990, cores: 8, threads: 16, socket: 'AM5' },
      { name: 'AMD Ryzen 9 7900', price: 32990, cores: 12, threads: 24, socket: 'AM5' },
      { name: 'AMD Ryzen 9 7900X', price: 37990, cores: 12, threads: 24, socket: 'AM5' },
      { name: 'AMD Ryzen 9 7900X3D', price: 44990, cores: 12, threads: 24, socket: 'AM5' },
      { name: 'AMD Ryzen 9 7950X', price: 47990, cores: 16, threads: 32, socket: 'AM5' },
      { name: 'AMD Ryzen 9 7950X3D', price: 54990, cores: 16, threads: 32, socket: 'AM5' },
      { name: 'Intel Core Ultra 5 225F', price: 15990, cores: 10, threads: 10, socket: 'LGA1851' },
      { name: 'Intel Core Ultra 5 245K', price: 22990, cores: 14, threads: 20, socket: 'LGA1851' },
      { name: 'Intel Core Ultra 7 265KF', price: 32990, cores: 20, threads: 28, socket: 'LGA1851' },
      { name: 'Intel Core Ultra 7 265K', price: 34990, cores: 20, threads: 28, socket: 'LGA1851' },
      { name: 'Intel Core Ultra 9 285K', price: 54990, cores: 24, threads: 32, socket: 'LGA1851' },
      { name: 'AMD Ryzen 5 9600X', price: 22990, cores: 6, threads: 12, socket: 'AM5' },
      { name: 'AMD Ryzen 7 9700X', price: 32990, cores: 8, threads: 16, socket: 'AM5' },
      { name: 'AMD Ryzen 7 9800X3D', price: 45990, cores: 8, threads: 16, socket: 'AM5' },
      { name: 'AMD Ryzen 9 9900X', price: 46990, cores: 12, threads: 24, socket: 'AM5' },
      { name: 'AMD Ryzen 9 9950X', price: 59990, cores: 16, threads: 32, socket: 'AM5' },
      { name: 'AMD Ryzen 9 9950X3D', price: 69990, cores: 16, threads: 32, socket: 'AM5' },
    ];
    items.forEach((p) => list.push({
      category_id: categoryId,
      name: p.name,
      description: `Процессор ${p.name}`,
      price: p.price,
      specs: enrichCpuSpecs(p),
    }));
  } else if (slug === 'gpu') {
    const cards = [
      { name: 'ASUS GeForce RTX 3050 Dual', price: 24990, vram: 8 }, { name: 'MSI GeForce RTX 3050 Ventus', price: 23990, vram: 8 }, { name: 'Gigabyte GeForce RTX 3060 Eagle', price: 26990, vram: 12 }, { name: 'ASUS GeForce RTX 3060 Dual', price: 27990, vram: 12 },
      { name: 'MSI GeForce RTX 3060 Ventus', price: 25990, vram: 12 }, { name: 'Palit GeForce RTX 3060 Dual', price: 24990, vram: 12 }, { name: 'ASUS GeForce RTX 3060 Ti Dual', price: 34990, vram: 8 }, { name: 'MSI GeForce RTX 3060 Ti Ventus', price: 33990, vram: 8 },
      { name: 'Gigabyte GeForce RTX 3070 Gaming', price: 41990, vram: 8 }, { name: 'ASUS GeForce RTX 3070 Dual', price: 42990, vram: 8 }, { name: 'MSI GeForce RTX 3070 Ti Ventus', price: 46990, vram: 8 }, { name: 'Gigabyte GeForce RTX 3080 Gaming', price: 55990, vram: 10 },
      { name: 'ASUS GeForce RTX 3080 TUF', price: 57990, vram: 10 }, { name: 'MSI GeForce RTX 3080 Ti Ventus', price: 74990, vram: 12 }, { name: 'ASUS GeForce RTX 3090 TUF', price: 94990, vram: 24 },
      { name: 'ASUS GeForce RTX 4060 Dual', price: 29990, vram: 8 }, { name: 'MSI GeForce RTX 4060 Ventus', price: 28990, vram: 8 }, { name: 'Gigabyte GeForce RTX 4060 WindForce', price: 27990, vram: 8 }, { name: 'Palit GeForce RTX 4060 Dual', price: 26990, vram: 8 },
      { name: 'KFA2 GeForce RTX 4060', price: 27590, vram: 8 }, { name: 'Inno3D GeForce RTX 4060 Twin', price: 27190, vram: 8 }, { name: 'ASUS GeForce RTX 4060 Ti Dual', price: 39990, vram: 8 }, { name: 'MSI GeForce RTX 4060 Ti Ventus', price: 37990, vram: 8 },
      { name: 'Gigabyte GeForce RTX 4060 Ti Gaming', price: 41990, vram: 8 }, { name: 'ASUS GeForce RTX 4060 Ti 16GB Dual', price: 46990, vram: 16 }, { name: 'MSI GeForce RTX 4060 Ti 16GB Ventus', price: 44990, vram: 16 },
      { name: 'ASUS GeForce RTX 4070 Dual', price: 52990, vram: 12 }, { name: 'MSI GeForce RTX 4070 Ventus', price: 49990, vram: 12 }, { name: 'Gigabyte GeForce RTX 4070 WindForce', price: 51990, vram: 12 }, { name: 'ASUS GeForce RTX 4070 Super Dual', price: 62990, vram: 12 },
      { name: 'MSI GeForce RTX 4070 Super Ventus', price: 59990, vram: 12 }, { name: 'Gigabyte GeForce RTX 4070 Super Gaming', price: 61990, vram: 12 }, { name: 'ASUS GeForce RTX 4070 Ti TUF', price: 73990, vram: 12 },
      { name: 'MSI GeForce RTX 4070 Ti Super Ventus', price: 82990, vram: 16 }, { name: 'ASUS GeForce RTX 4080 Super Dual', price: 94990, vram: 16 }, { name: 'MSI GeForce RTX 4080 Super Gaming', price: 91990, vram: 16 },
      { name: 'ASUS GeForce RTX 4090 TUF', price: 179990, vram: 24 }, { name: 'MSI GeForce RTX 4090 Gaming', price: 169990, vram: 24 }, { name: 'Gigabyte GeForce RTX 4090 Gaming', price: 174990, vram: 24 },
      { name: 'MSI GeForce RTX 4050 Ventus 2X', price: 21990, vram: 6 }, { name: 'Gigabyte GeForce RTX 4050 Eagle', price: 21490, vram: 6 }, { name: 'ASUS GeForce RTX 4050 Dual', price: 22490, vram: 6 },
      { name: 'MSI GeForce RTX 4070 Ti Gaming X', price: 67990, vram: 12 }, { name: 'Gigabyte GeForce RTX 4070 Ti AORUS', price: 71990, vram: 12 },
      { name: 'ASUS GeForce RTX 4080 ROG Strix', price: 109990, vram: 16 }, { name: 'MSI GeForce RTX 4080 Suprim', price: 104990, vram: 16 }, { name: 'Gigabyte GeForce RTX 4080 AORUS Master', price: 106990, vram: 16 },
      { name: 'MSI GeForce RTX 5050 Ventus 2X', price: 19990, vram: 8 }, { name: 'Gigabyte GeForce RTX 5050 WindForce', price: 19490, vram: 8 }, { name: 'ASUS GeForce RTX 5050 Dual', price: 20490, vram: 8 },
      { name: 'MSI GeForce RTX 5060 Ventus 2X', price: 27990, vram: 8 }, { name: 'Gigabyte GeForce RTX 5060 WindForce', price: 26990, vram: 8 }, { name: 'ASUS GeForce RTX 5060 Dual', price: 28990, vram: 8 },
      { name: 'ASUS GeForce RTX 5060 Ti Dual', price: 36990, vram: 8 }, { name: 'MSI GeForce RTX 5060 Ti Ventus', price: 35990, vram: 8 }, { name: 'Gigabyte GeForce RTX 5060 Ti Gaming 16G', price: 41990, vram: 16 },
      { name: 'ASUS GeForce RTX 5070 Prime', price: 46990, vram: 12 }, { name: 'MSI GeForce RTX 5070 Ventus 3X', price: 44990, vram: 12 }, { name: 'Gigabyte GeForce RTX 5070 Gaming', price: 45990, vram: 12 },
      { name: 'MSI GeForce RTX 5070 Ti Ventus 3X', price: 62990, vram: 16 }, { name: 'ASUS GeForce RTX 5070 Ti TUF', price: 65990, vram: 16 }, { name: 'Gigabyte GeForce RTX 5070 Ti AORUS', price: 68990, vram: 16 },
      { name: 'ASUS GeForce RTX 5080 Prime', price: 99990, vram: 16 }, { name: 'MSI GeForce RTX 5080 Suprim', price: 104990, vram: 16 }, { name: 'Gigabyte GeForce RTX 5080 AORUS Master', price: 107990, vram: 16 },
      { name: 'ASUS GeForce RTX 5090 ROG Astral', price: 224990, vram: 32 }, { name: 'MSI GeForce RTX 5090 Suprim Liquid', price: 229990, vram: 32 }, { name: 'Gigabyte GeForce RTX 5090 AORUS Xtreme', price: 219990, vram: 32 },
      { name: 'Sapphire Radeon RX 6600 Pulse', price: 24990, vram: 8 }, { name: 'PowerColor Radeon RX 6650 XT Fighter', price: 29990, vram: 8 }, { name: 'Sapphire Radeon RX 6700 XT Pulse', price: 36990, vram: 12 },
      { name: 'Sapphire Radeon RX 7600 Pulse', price: 27990, vram: 8 }, { name: 'PowerColor Radeon RX 7600 Fighter', price: 26990, vram: 8 }, { name: 'ASRock Radeon RX 7600 Challenger', price: 27590, vram: 8 },
      { name: 'Sapphire Radeon RX 7700 XT Pulse', price: 44990, vram: 12 }, { name: 'PowerColor Radeon RX 7800 XT Red Devil', price: 54990, vram: 16 }, { name: 'Sapphire Radeon RX 7800 XT Nitro', price: 56990, vram: 16 },
      { name: 'Sapphire Radeon RX 7900 GRE Pulse', price: 61990, vram: 16 }, { name: 'PowerColor Radeon RX 7900 XT Red Devil', price: 79990, vram: 20 }, { name: 'Sapphire Radeon RX 7900 XTX Nitro', price: 89990, vram: 24 },
      { name: 'XFX Radeon RX 7900 XTX Speedster', price: 87990, vram: 24 },
    ];
    cards.forEach((p) => list.push({
      category_id: categoryId,
      name: p.name,
      description: `Видеокарта ${p.name}`,
      price: p.price,
      specs: enrichGpuSpecs(p),
    }));
  } else if (slug === 'ram') {
    const vendors = ['Kingston', 'Corsair', 'G.Skill', 'Crucial', 'Team Group', 'Patriot', 'ADATA', 'Samsung', 'GeIL', 'Lexar'];
    const ddr4Specs = [
      { size: 8, speed: 3200, price: 1990 }, { size: 8, speed: 3600, price: 2290 },
      { size: 16, speed: 3200, price: 3490 }, { size: 16, speed: 3600, price: 3990 }, { size: 16, speed: 4000, price: 4490 },
      { size: 32, speed: 3200, price: 6490 }, { size: 32, speed: 3600, price: 7490 }, { size: 32, speed: 4000, price: 8490 },
      { size: 64, speed: 3200, price: 12990 }, { size: 64, speed: 3600, price: 14990 },
    ];
    ddr4Specs.forEach((s, i) => {
      for (let v = 0; v < 5; v++) {
        list.push({
          category_id: categoryId,
          name: `${vendors[(i + v) % vendors.length]} DDR4 ${s.size}GB ${s.speed} MHz`,
          description: `ОЗУ DDR4 ${s.size} ГБ ${s.speed} МГц`,
          price: s.price + v * 100,
          specs: {
            size_gb: s.size,
            speed_mhz: s.speed,
            type: 'DDR4',
            cas_latency: s.speed >= 3600 ? 'CL16–18 (зависит от набора)' : 'CL16 (типично)',
            voltage: '1.35 В (XMP)',
            form_factor: 'DIMM 288-pin',
            channel_mode: 'рекомендуется 2 модуля для dual-channel',
          },
        });
      }
    });
    const ddr5Specs = [
      { size: 16, speed: 4800, price: 4990 }, { size: 16, speed: 5200, price: 5490 }, { size: 16, speed: 5600, price: 5990 }, { size: 16, speed: 6000, price: 6490 },
      { size: 32, speed: 5200, price: 8990 }, { size: 32, speed: 5600, price: 9990 }, { size: 32, speed: 6000, price: 10990 }, { size: 32, speed: 6400, price: 11990 },
      { size: 64, speed: 5600, price: 19990 }, { size: 64, speed: 6000, price: 21990 },
    ];
    ddr5Specs.forEach((s, i) => {
      for (let v = 0; v < 5; v++) {
        list.push({
          category_id: categoryId,
          name: `${vendors[(i + v + 2) % vendors.length]} DDR5 ${s.size}GB ${s.speed} MHz`,
          description: `ОЗУ DDR5 ${s.size} ГБ ${s.speed} МГц`,
          price: s.price + v * 150,
          specs: {
            size_gb: s.size,
            speed_mhz: s.speed,
            type: 'DDR5',
            cas_latency: s.speed >= 6000 ? 'CL30–40 (EXPO/XMP)' : 'CL36–40 (типично)',
            voltage: '1.25–1.35 В (профиль)',
            form_factor: 'DIMM 288-pin',
            channel_mode: 'рекомендуется 2 модуля; AM5 — проверить EXPO',
          },
        });
      }
    });
  } else if (slug === 'motherboard') {
    const boards = [
      { name: 'ASUS Prime H610M-K', price: 5990, chipset: 'H610', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'Gigabyte H610M S2H', price: 5490, chipset: 'H610', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'MSI H610M-B', price: 5790, chipset: 'H610', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'ASRock H610M-HVS', price: 5290, chipset: 'H610', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'ASUS Prime B660M-K', price: 7990, chipset: 'B660', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'Gigabyte B660M DS3H', price: 8490, chipset: 'B660', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'MSI Pro B760M-A WiFi', price: 10990, chipset: 'B760', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR5' },
      { name: 'Gigabyte B760M DS3H', price: 9990, chipset: 'B760', socket: 'LGA1700', form: 'Micro-ATX', ram: 'DDR5' },
      { name: 'ASUS TUF Gaming B760-Plus', price: 14990, chipset: 'B760', socket: 'LGA1700', form: 'ATX', ram: 'DDR5' },
      { name: 'MSI MAG B760 Tomahawk', price: 15990, chipset: 'B760', socket: 'LGA1700', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS ROG Strix B760-F', price: 19990, chipset: 'B760', socket: 'LGA1700', form: 'ATX', ram: 'DDR5' },
      { name: 'MSI MAG Z790 Tomahawk', price: 24990, chipset: 'Z790', socket: 'LGA1700', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS ROG Strix Z790-E', price: 34990, chipset: 'Z790', socket: 'LGA1700', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS ROG Maximus Z790 Hero', price: 44990, chipset: 'Z790', socket: 'LGA1700', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS Prime B550M-K', price: 6990, chipset: 'B550', socket: 'AM4', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'MSI B550M Pro-VDH', price: 8490, chipset: 'B550', socket: 'AM4', form: 'Micro-ATX', ram: 'DDR4' },
      { name: 'Gigabyte B550 Aorus Elite', price: 11990, chipset: 'B550', socket: 'AM4', form: 'ATX', ram: 'DDR4' },
      { name: 'ASUS TUF Gaming B550-Plus', price: 12990, chipset: 'B550', socket: 'AM4', form: 'ATX', ram: 'DDR4' },
      { name: 'MSI MAG B550 Tomahawk', price: 13990, chipset: 'B550', socket: 'AM4', form: 'ATX', ram: 'DDR4' },
      { name: 'ASUS ROG Strix B550-F', price: 15990, chipset: 'B550', socket: 'AM4', form: 'ATX', ram: 'DDR4' },
      { name: 'ASRock B650M Pro RS', price: 12990, chipset: 'B650', socket: 'AM5', form: 'Micro-ATX', ram: 'DDR5' },
      { name: 'Gigabyte B650 Gaming X', price: 14990, chipset: 'B650', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS TUF Gaming B650-Plus', price: 15990, chipset: 'B650', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'MSI MAG B650 Tomahawk', price: 18990, chipset: 'B650', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS ROG Strix B650E-F', price: 22990, chipset: 'B650', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'Gigabyte X670 Gaming X', price: 24990, chipset: 'X670', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS TUF Gaming X670E-Plus', price: 27990, chipset: 'X670', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS ROG Strix X670E-E', price: 34990, chipset: 'X670', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'MSI MAG X670E Tomahawk', price: 29990, chipset: 'X670', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS Prime B860M-K', price: 11990, chipset: 'B860', socket: 'LGA1851', form: 'Micro-ATX', ram: 'DDR5' },
      { name: 'Gigabyte B860M DS3H', price: 12490, chipset: 'B860', socket: 'LGA1851', form: 'Micro-ATX', ram: 'DDR5' },
      { name: 'MSI PRO B860M-A WiFi', price: 13990, chipset: 'B860', socket: 'LGA1851', form: 'Micro-ATX', ram: 'DDR5' },
      { name: 'ASUS TUF Gaming B860-Plus', price: 17990, chipset: 'B860', socket: 'LGA1851', form: 'ATX', ram: 'DDR5' },
      { name: 'MSI MAG Z890 Tomahawk WiFi', price: 28990, chipset: 'Z890', socket: 'LGA1851', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS ROG Strix Z890-E Gaming WiFi', price: 42990, chipset: 'Z890', socket: 'LGA1851', form: 'ATX', ram: 'DDR5' },
      { name: 'Gigabyte B850 AORUS Elite WiFi7', price: 21990, chipset: 'B850', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'MSI MAG B850 Tomahawk', price: 19990, chipset: 'B850', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS TUF Gaming B850-Plus', price: 20990, chipset: 'B850', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'Gigabyte X870 AORUS Elite WiFi7', price: 27990, chipset: 'X870', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'ASUS ROG Strix X870E-E', price: 39990, chipset: 'X870', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
      { name: 'MSI MPG X870E Carbon WiFi', price: 42990, chipset: 'X870', socket: 'AM5', form: 'ATX', ram: 'DDR5' },
    ];
    boards.forEach((p) => list.push({
      category_id: categoryId,
      name: p.name,
      description: `Мат. плата ${p.chipset}`,
      price: p.price,
      specs: enrichMbSpecs(p),
    }));
    while (list.length < 55) {
      const b = boards[list.length % boards.length];
      list.push({
        category_id: categoryId,
        name: `${b.name} (вариант ${Math.floor(list.length / boards.length) + 1})`,
        description: `Мат. плата ${b.chipset}`,
        price: b.price + (list.length % 5) * 200,
        specs: enrichMbSpecs(b),
      });
    }
  } else if (slug === 'storage') {
    const nvme = [
      { name: 'Samsung 970 EVO Plus', cap: 250, price: 2990 }, { name: 'Samsung 970 EVO Plus', cap: 500, price: 4490 }, { name: 'Samsung 980', cap: 500, price: 3990 }, { name: 'Samsung 980', cap: 1000, price: 6490 },
      { name: 'Samsung 990 Pro', cap: 1000, price: 8990 }, { name: 'Samsung 990 Pro', cap: 2000, price: 15990 }, { name: 'WD Black SN770', cap: 500, price: 4290 }, { name: 'WD Black SN770', cap: 1000, price: 6990 },
      { name: 'WD Blue SN580', cap: 500, price: 4290 }, { name: 'WD Blue SN580', cap: 1000, price: 5990 }, { name: 'Kingston NV2', cap: 500, price: 3490 }, { name: 'Kingston NV2', cap: 1000, price: 5490 },
      { name: 'Crucial P3', cap: 500, price: 3790 }, { name: 'Crucial P3', cap: 1000, price: 5490 }, { name: 'Crucial P3 Plus', cap: 1000, price: 5790 }, { name: 'Crucial P5 Plus', cap: 1000, price: 7490 }, { name: 'Crucial P5 Plus', cap: 2000, price: 12990 },
      { name: 'Team Group MP33', cap: 512, price: 3290 }, { name: 'Team Group MP34', cap: 1000, price: 5290 }, { name: 'ADATA XPG S50', cap: 1000, price: 6490 }, { name: 'Patriot P310', cap: 960, price: 4990 },
    ];
    nvme.forEach((p) => list.push({
      category_id: categoryId,
      name: `${p.name} ${p.cap}GB NVMe`,
      description: `Накопитель ${p.cap} ГБ`,
      price: p.price,
      specs: enrichNvmeSpec(p),
    }));
    const sata = [
      { name: 'Kingston A400', cap: 480, price: 2990 }, { name: 'Crucial BX500', cap: 500, price: 3290 }, { name: 'WD Blue', cap: 1000, price: 4990 }, { name: 'Samsung 870 EVO', cap: 500, price: 4490 }, { name: 'Samsung 870 EVO', cap: 1000, price: 7490 },
    ];
    sata.forEach((p) => list.push({
      category_id: categoryId,
      name: `${p.name} ${p.cap}GB SATA`,
      description: `SSD SATA ${p.cap} ГБ`,
      price: p.price,
      specs: enrichSataSsdSpec(p),
    }));
    const hdd = [
      { name: 'WD Blue', cap: 1000, price: 3990 }, { name: 'WD Blue', cap: 2000, price: 5490 }, { name: 'WD Blue', cap: 4000, price: 8990 }, { name: 'Seagate Barracuda', cap: 1000, price: 3790 }, { name: 'Seagate Barracuda', cap: 2000, price: 4990 }, { name: 'Seagate Barracuda', cap: 4000, price: 8490 }, { name: 'Toshiba P300', cap: 2000, price: 4790 },
    ];
    hdd.forEach((p) => list.push({
      category_id: categoryId,
      name: `${p.name} ${p.cap}GB HDD`,
      description: `HDD ${p.cap} ГБ`,
      price: p.price,
      specs: enrichHddSpec(p),
    }));
    while (list.length < 55) {
      const n = nvme[list.length % nvme.length];
      list.push({
        category_id: categoryId,
        name: `${n.name} ${n.cap}GB NVMe (${list.length})`,
        description: `Накопитель ${n.cap} ГБ`,
        price: n.price + (list.length % 3) * 100,
        specs: enrichNvmeSpec(n),
      });
    }
  } else if (slug === 'psu') {
    const psuList = [
      { name: 'Be Quiet! System Power 10 450W', watt: 450, eff: '80+ Bronze', price: 3990 }, { name: 'Be Quiet! Pure Power 11 550W', watt: 550, eff: '80+ Gold', price: 6490 }, { name: 'Be Quiet! Straight Power 11 750W', watt: 750, eff: '80+ Gold', price: 10990 }, { name: 'Be Quiet! Dark Power 12 850W', watt: 850, eff: '80+ Titanium', price: 15990 },
      { name: 'Corsair CV450 450W', watt: 450, eff: '80+ Bronze', price: 3790 }, { name: 'Corsair CV550 550W', watt: 550, eff: '80+ Bronze', price: 4490 }, { name: 'Corsair RM650 650W', watt: 650, eff: '80+ Gold', price: 7990 }, { name: 'Corsair RM750e 750W', watt: 750, eff: '80+ Gold', price: 8990 }, { name: 'Corsair RM850x 850W', watt: 850, eff: '80+ Gold', price: 12990 }, { name: 'Corsair HX1000 1000W', watt: 1000, eff: '80+ Platinum', price: 17990 },
      { name: 'Chieftec GPA-500S 500W', watt: 500, eff: '80+ Bronze', price: 3290 }, { name: 'Chieftec Proton 750W', watt: 750, eff: '80+ Bronze', price: 5990 }, { name: 'Deepcool PF500 500W', watt: 500, eff: '80+ Bronze', price: 3490 }, { name: 'Deepcool DQ750 750W', watt: 750, eff: '80+ Gold', price: 7990 },
      { name: 'FSP Hydro K 600W', watt: 600, eff: '80+ Bronze', price: 4490 }, { name: 'Seasonic Focus GX-650 650W', watt: 650, eff: '80+ Gold', price: 8490 }, { name: 'Seasonic Focus GX-750 750W', watt: 750, eff: '80+ Gold', price: 9490 }, { name: 'Seasonic Prime TX-1000 1000W', watt: 1000, eff: '80+ Titanium', price: 19990 },
      { name: 'Thermaltake Smart 500W', watt: 500, eff: '80+', price: 3190 }, { name: 'Thermaltake Toughpower 750W', watt: 750, eff: '80+ Gold', price: 8990 }, { name: 'Cooler Master MWE 550 550W', watt: 550, eff: '80+ Bronze', price: 4290 }, { name: 'Cooler Master MWE 750 750W', watt: 750, eff: '80+ Gold', price: 7490 },
      { name: 'NZXT C550 550W', watt: 550, eff: '80+ Bronze', price: 4990 }, { name: 'NZXT C750 750W', watt: 750, eff: '80+ Gold', price: 8490 }, { name: 'EVGA 600 W1 600W', watt: 600, eff: '80+', price: 3990 }, { name: 'EVGA 750 G5 750W', watt: 750, eff: '80+ Gold', price: 8990 },
    ];
    psuList.forEach((p) => list.push({
      category_id: categoryId,
      name: p.name,
      description: `БП ${p.watt} Вт`,
      price: p.price,
      specs: enrichPsuSpec(p),
    }));
    while (list.length < 55) {
      const p = psuList[list.length % psuList.length];
      list.push({
        category_id: categoryId,
        name: `${p.name} (вариант ${Math.floor(list.length / psuList.length) + 1})`,
        description: `БП ${p.watt} Вт`,
        price: p.price + (list.length % 5) * 200,
        specs: enrichPsuSpec(p),
      });
    }
  } else if (slug === 'case') {
    const cases = [
      { name: 'Deepcool CC560', price: 3490, form: 'Midi-Tower' }, { name: 'Zalman S2', price: 2990, form: 'Midi-Tower' }, { name: 'AeroCool Cylon', price: 3990, form: 'Midi-Tower' }, { name: 'Cougar MX330-G', price: 4290, form: 'Midi-Tower' },
      { name: 'Deepcool Matrexx 55', price: 4990, form: 'Midi-Tower' }, { name: 'Fractal Design Focus G', price: 5490, form: 'Midi-Tower' }, { name: 'NZXT H510', price: 6990, form: 'Midi-Tower' }, { name: 'be quiet! Pure Base 500', price: 7990, form: 'Midi-Tower' },
      { name: 'Fractal Design Pop Air', price: 8490, form: 'Midi-Tower' }, { name: 'Lian Li O11 Dynamic', price: 12990, form: 'Midi-Tower' }, { name: 'Fractal Design Torrent', price: 14990, form: 'Full-Tower' }, { name: 'Cooler Master H500P', price: 11990, form: 'Midi-Tower' },
      { name: 'Deepcool Macube 110', price: 3990, form: 'Micro-ATX' }, { name: 'Fractal Design Define 7 Mini', price: 8990, form: 'Micro-ATX' }, { name: 'Cooler Master NR200P', price: 7490, form: 'Mini-ITX' },
      { name: 'Cougar Archon', price: 4590, form: 'Midi-Tower' }, { name: 'Zalman i3', price: 3490, form: 'Midi-Tower' }, { name: 'Deepcool CK560', price: 5990, form: 'Midi-Tower' }, { name: 'Lian Li Lancool 215', price: 7990, form: 'Midi-Tower' },
      { name: 'NZXT H7 Flow', price: 9990, form: 'Midi-Tower' }, { name: 'Corsair 4000D', price: 8490, form: 'Midi-Tower' }, { name: 'Phanteks Eclipse P400', price: 6490, form: 'Midi-Tower' }, { name: 'be quiet! Silent Base 802', price: 12990, form: 'Midi-Tower' },
    ];
    cases.forEach((c) => list.push({
      category_id: categoryId,
      name: `${c.name}`,
      description: `Корпус ${c.form}`,
      price: c.price,
      specs: enrichCaseSpec(c),
    }));
    const moreBrands = ['Deepcool', 'Zalman', 'Cougar', 'AeroCool', 'Fractal Design', 'NZXT', 'Cooler Master', 'Corsair', 'Lian Li', 'Phanteks'];
    while (list.length < 55) {
      const base = cases[list.length % cases.length];
      list.push({
        category_id: categoryId,
        name: `${moreBrands[list.length % moreBrands.length]} ${base.form} ${3500 + list.length * 80}`,
        description: `Корпус ${base.form}`,
        price: base.price + (list.length % 4) * 300,
        specs: enrichCaseSpec({ ...base, price: base.price + (list.length % 4) * 300 }),
      });
    }
  }
  return list;
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
