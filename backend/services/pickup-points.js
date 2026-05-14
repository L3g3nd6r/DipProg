/**
 * Точки выдачи (примерные «Почта России») и расчёт стоимости доставки.
 *
 * Сборщик находится в Альметьевске — это «нулевая» точка для расчёта.
 * Если выбранная точка — в Альметьевске → фиксированная цена 400 ₽.
 * Иначе берётся расстояние по большому кругу (Haversine) от центра Альметьевска
 * до точки и считается 500 ₽ за каждые начатые 10 км.
 */

const ASSEMBLER_BASE = { lat: 54.9024, lng: 52.2974, city: 'Альметьевск' }
const SAME_CITY_FEE_RUB = 400
const PER_10KM_RUB = 500

/** id точек — короткие и стабильные, чтобы сохранять их в orders. */
const POINTS = [
  { id: 'alm-lenina-12',     name: 'Почта России — Альметьевск, Ленина 12',     address: 'г. Альметьевск, ул. Ленина, 12',         city: 'Альметьевск',       lat: 54.9020, lng: 52.2970 },
  { id: 'alm-mayakovskogo',  name: 'Почта России — Альметьевск, Маяковского 89', address: 'г. Альметьевск, ул. Маяковского, 89',     city: 'Альметьевск',       lat: 54.9095, lng: 52.3155 },
  { id: 'alm-shevchenko-72', name: 'Почта России — Альметьевск, Шевченко 72',    address: 'г. Альметьевск, ул. Шевченко, 72',        city: 'Альметьевск',       lat: 54.8985, lng: 52.2825 },
  { id: 'bug-gogolya-64',    name: 'Почта России — Бугульма, Гоголя 64',         address: 'г. Бугульма, ул. Гоголя, 64',             city: 'Бугульма',          lat: 54.5413, lng: 52.7986 },
  { id: 'len-chaikovskogo',  name: 'Почта России — Лениногорск, Чайковского 10', address: 'г. Лениногорск, ул. Чайковского, 10',     city: 'Лениногорск',       lat: 54.6076, lng: 52.4517 },
  { id: 'zai-nikitina-1',    name: 'Почта России — Заинск, Никитина 1',          address: 'г. Заинск, ул. Никитина, 1',              city: 'Заинск',            lat: 55.3043, lng: 52.0044 },
  { id: 'nch-mira-38',       name: 'Почта России — Набережные Челны, пр. Мира 38', address: 'г. Набережные Челны, пр. Мира, 38',     city: 'Набережные Челны',  lat: 55.7426, lng: 52.4112 },
  { id: 'nk-mendeleeva-17',  name: 'Почта России — Нижнекамск, Менделеева 17',    address: 'г. Нижнекамск, ул. Менделеева, 17',       city: 'Нижнекамск',        lat: 55.6361, lng: 51.8214 },
  { id: 'kzn-kremlevskaya-8',name: 'Почта России — Казань, Кремлёвская 8',        address: 'г. Казань, ул. Кремлёвская, 8',           city: 'Казань',            lat: 55.7963, lng: 49.1064 },
  { id: 'ufa-lenina-28',     name: 'Почта России — Уфа, Ленина 28',               address: 'г. Уфа, ул. Ленина, 28',                  city: 'Уфа',               lat: 54.7388, lng: 55.9721 },
]

function normalizeCity(s) {
  return String(s || '').trim().toLowerCase()
}

function haversineKm(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sLat = Math.sin(dLat / 2)
  const sLng = Math.sin(dLng / 2)
  const aa = sLat * sLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng
  return 2 * R * Math.asin(Math.sqrt(aa))
}

function findPointById(id) {
  if (!id) return null
  const found = POINTS.find((p) => p.id === id)
  return found || null
}

function listPoints() {
  return POINTS.map((p) => ({ ...p }))
}

/**
 * Возвращает { fee, distance_km } для конкретной точки выдачи.
 * fee — целое число рублей, distance_km — до десятых.
 */
function computeDeliveryFee(point) {
  if (!point) return { fee: 0, distance_km: 0 }
  if (normalizeCity(point.city) === normalizeCity(ASSEMBLER_BASE.city)) {
    return { fee: SAME_CITY_FEE_RUB, distance_km: 0 }
  }
  const km = haversineKm(ASSEMBLER_BASE, point)
  const fee = Math.ceil(km / 10) * PER_10KM_RUB
  return { fee, distance_km: Math.round(km * 10) / 10 }
}

module.exports = {
  ASSEMBLER_BASE,
  SAME_CITY_FEE_RUB,
  PER_10KM_RUB,
  listPoints,
  findPointById,
  computeDeliveryFee,
}
