const CATEGORY_PRICE_FLOORS = [
  { match: ['videographer', 'video'], floor: 12000 },
  { match: ['photographer', 'photo'], floor: 10000 },
  { match: ['decoration', 'decor'], floor: 15000 },
  { match: ['dj', 'band', 'nadaswaram'], floor: 8000 },
  { match: ['makeup', 'beauty'], floor: 7000 },
  { match: ['tent', 'shamiana', 'furniture'], floor: 12000 },
  { match: ['function hall', 'venue'], floor: 50000 },
  { match: ['florist', 'flowers'], floor: 5000 },
  { match: ['priest', 'pandit', 'maulvi', 'qazi', 'pastor', 'father'], floor: 3000 },
];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function getVendorPriceFloor(category = '') {
  const normalizedCategory = normalizeText(category);
  for (const rule of CATEGORY_PRICE_FLOORS) {
    if (rule.match.some((token) => normalizedCategory.includes(token))) {
      return rule.floor;
    }
  }
  return 0;
}

export function normalizeVendorBasePrice(basePrice, category = '') {
  const raw = toNum(basePrice);
  if (raw <= 0) return 0;
  const floor = getVendorPriceFloor(category);
  return floor > 0 ? Math.max(raw, floor) : raw;
}

export function buildMakeupEventPricing(basePrice = 0) {
  const wedding = Math.max(normalizeVendorBasePrice(basePrice, 'makeup artist'), 12000);
  return {
    birthday_simple: 3000,
    birthday_heavy: 6000,
    engagement: 8000,
    reception: 9000,
    wedding,
  };
}
