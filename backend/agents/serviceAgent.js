import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import {
  getAvailabilityDataset,
  checkSlot,
  calculateFinalPrice,
} from '../datasets/availabilityDataset.js';
// Geocoding removed: do not import external geocoding utilities

const NEARBY_CITIES = {
  Hyderabad: ['Rangareddy'],
  Warangal: ['Karimnagar', 'Nalgonda'],
  Karimnagar: ['Warangal', 'Nizamabad'],
  Nizamabad: ['Karimnagar', 'Medak'],
  Khammam: ['Nalgonda', 'Warangal'],
  Nalgonda: ['Khammam', 'Hyderabad'],
  Mahbubnagar: ['Hyderabad', 'Rangareddy'],
  Rangareddy: ['Hyderabad'],
  Villages: ['Rangareddy', 'Karimnagar'],
};

const DJ_BLOCKED_EVENTS = new Set([
  'thread ceremony (upanayanam)',
  'baby shower (namakaranam)',
  '21st day (naamakaranam)',
  'cradle ceremony',
  'puberty ceremony',
  'aqiqah (birth ceremony)',
  'circumcision (bismillah)',
  'baptism',
  'first communion',
  'easter celebration',
]);

const BAND_ALLOWED_EVENTS = new Set([
  'wedding',
  'gruhapravesam',
  'thread ceremony (upanayanam)',
  'puberty ceremony',
  '60th birthday (sashtipoorthi)',
  '80th birthday (sadabhishekam)',
  'engagement',
  'reception',
]);

function eventMatchesAny(eventType, allowedEvents) {
  const ev = normalizeLower(eventType);
  if (!ev) return false;
  for (const item of allowedEvents) {
    const marker = normalizeLower(item);
    if (!marker) continue;
    if (ev === marker || ev.includes(marker) || marker.includes(ev)) return true;
  }
  return false;
}

const MAULVI_ALLOWED_EVENTS = new Set([
  'nikah (wedding)',
  'walima (reception)',
  'aqiqah (birth ceremony)',
  'circumcision (bismillah)',
  'eid celebration',
  'iftar party',
  'mangni (engagement)',
]);

const PASTOR_ALLOWED_EVENTS = new Set([
  'church wedding',
  'baptism',
  'christening',
  'first communion',
  'easter celebration',
  'carol singing night',
]);

const RELIGIOUS_CATEGORIES = new Set(['Priest / Pandit', 'Maulvi / Qazi', 'Pastor / Father']);
const VENUE_CATEGORY_SET = new Set(['function hall', 'venue', 'church', 'parish hall', 'chapel']);
const CHURCH_VENUE_CATEGORY_SET = new Set(['church', 'parish hall', 'chapel']);

/** Map code-side labels or alternate names to DB categories */
const CATEGORY_VOCABULARY_MAP = {
  'photography': 'Photographer',
  'photographer': 'Photographer',
  'videography': 'Videographer',
  'videographer': 'Videographer',
  'dresses / makeup': 'Makeup Artist',
  'makeup artist': 'Makeup Artist',
  'makeup': 'Makeup Artist',
  'dresses': 'Makeup Artist',
  'band': 'Band / Nadaswaram',
  'nadaswaram': 'Band / Nadaswaram',
  'band / nadaswaram': 'Band / Nadaswaram',
  'tent': 'Tent / Shamiana',
  'shamiana': 'Tent / Shamiana',
  'tent / shamiana': 'Tent / Shamiana',
  'catering equipment rental': 'Catering Equipment Rental',
  'equipment rental': 'Catering Equipment Rental',
  'florist': 'Florist',
  'decoration': 'Decoration',
  'catering': 'Catering',
  'function hall': 'Function Hall',
  'dj': 'DJ',
  'priest / pandit': 'Priest / Pandit',
  'maulvi / qazi': 'Maulvi / Qazi',
  'pastor / father': 'Pastor / Father',
};

/** Categories where capacity means "crews/teams" or "events per day", NOT "guests" */
const CREW_BASED_CATEGORIES = new Set([
  'Photographer',
  'Videographer',
  'Makeup Artist',
  'Florist',
  'Priest / Pandit',
  'Maulvi / Qazi',
  'Pastor / Father',
  'DJ',
  'Band / Nadaswaram',
]);

function getDbCategory(requestedCategory) {
  const norm = normalizeLower(requestedCategory);
  return CATEGORY_VOCABULARY_MAP[norm] || requestedCategory;
}

const CITY_COORDS = {
  hyderabad: { lat: 17.385, lon: 78.4867 },
  rangareddy: { lat: 17.24, lon: 78.4 },
  warangal: { lat: 17.9784, lon: 79.5941 },
  karimnagar: { lat: 18.4386, lon: 79.1288 },
  nizamabad: { lat: 18.6725, lon: 78.0941 },
  khammam: { lat: 17.2473, lon: 80.1514 },
  nalgonda: { lat: 17.0575, lon: 79.2677 },
  mahbubnagar: { lat: 16.7448, lon: 77.9878 },
  medak: { lat: 18.0455, lon: 78.2602 },
};

function toNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(v) {
  return String(v || '').trim();
}

function normalizeLower(v) {
  return normalizeText(v).toLowerCase();
}

function normalizeClassPreference(classPreference) {
  const value = normalizeLower(classPreference);
  if (value === 'economy') return 'budget';
  if (value === 'standard') return 'mid';
  return value;
}

function parseCategoryDetails(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = normalizeText(raw);
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function classMatch(vendor, classPreference) {
  if (!classPreference) return true;
  return normalizeLower(vendor.class_type) === normalizeClassPreference(classPreference);
}

async function withCityExpansion(candidates, city, radiusKm = 50) {
  const cityNorm = normalizeLower(city);
  if (!cityNorm) return candidates;

  const exact = candidates.filter((v) => normalizeLower(v.city) === cityNorm);
  if (exact.length >= 3) return exact;

  const partial = candidates.filter((v) => {
    const vc = normalizeLower(v.city);
    const va = normalizeLower(v.area);
    return vc.includes(cityNorm) || cityNorm.includes(vc) || va.includes(cityNorm);
  });
  if (partial.length >= 3) return partial;

  // Coordinate-based radius search for services
  const from = await cityCoordsFromName(city);
  if (from) {
    const nearbyMatches = [];
    for (const v of candidates) {
      const to = await cityCoordsFromName(v.city);
      if (!to) continue;
      const d = haversineKm(from, to);
      if (d <= radiusKm) {
        nearbyMatches.push({ ...v, _distanceKm: d, _locationPriority: 1 });
      }
    }
    if (nearbyMatches.length > 0) {
      nearbyMatches.sort((a, b) => a._distanceKm - b._distanceKm);
      return nearbyMatches;
    }
  }

  const nearby = (NEARBY_CITIES[normalizeText(city)] || []).map((c) => normalizeLower(c));
  const expanded = candidates.filter((v) => {
    const vc = normalizeLower(v.city);
    return vc === cityNorm || nearby.includes(vc);
  });
  return expanded.length ? expanded : candidates;
}

function applyCategoryGuardrails(category, religion, eventType) {
  const cat = normalizeText(category);
  const rel = normalizeLower(religion);
  const ev = normalizeLower(eventType);

  // Maulvi is ONLY for specific Muslim events — not generic 'wedding'
  if (cat === 'Maulvi / Qazi') {
    const isMuslimEvent = rel === 'muslim' || ev.includes('nikah') || ev.includes('walima')
      || ev.includes('aqiqah') || ev.includes('mangni');
    if (!isMuslimEvent) return { blocked: true, reason: 'Maulvi/Qazi only for Muslim ceremonies.' };
  }

  // Pastor/Father only for Christian events
  if (cat === 'Pastor / Father') {
    const isChristianEvent = rel === 'christian' || ev.includes('church')
      || ev.includes('baptism') || ev.includes('christening');
    if (!isChristianEvent) return { blocked: true, reason: 'Pastor/Father only for Christian ceremonies.' };
  }

  // Priest/Pandit blocked for Muslim AND Christian events
  if (cat === 'Priest / Pandit') {
    if (rel === 'muslim' || rel === 'christian') {
      return { blocked: true, reason: 'Priest/Pandit not applicable for this religion.' };
    }
  }

  // DJ is blocked for Friday prayers, Ramadan, and religious Muslim events
  if (cat === 'DJ') {
    const muslimReligiousEvents = ['eid celebration', 'iftar party', 'friday prayers', 'jumuah', 'ramadan'];
    if (rel === 'muslim' && muslimReligiousEvents.some((e) => ev.includes(e))) {
      return { blocked: true, reason: 'DJ not appropriate for this Muslim religious event.' };
    }
  }

  // Nadaswaram/Band — ONLY for Hindu events, not Muslim or Christian
  if (cat === 'Band / Nadaswaram') {
    if (rel === 'muslim' || rel === 'christian') {
      return { blocked: true, reason: 'Band/Nadaswaram is a Hindu ceremony tradition.' };
    }
  }

  if (cat === 'DJ' && DJ_BLOCKED_EVENTS.has(ev)) {
    return { blocked: true, reason: 'DJ not suitable for this event type.' };
  }

  if (cat === 'Band / Nadaswaram') {
    const religionAllowed = rel === 'hindu' || rel === 'all' || rel === '';
    const eventAllowed = eventMatchesAny(ev, BAND_ALLOWED_EVENTS);
    if (!(religionAllowed && eventAllowed)) {
      return { blocked: true, reason: 'Band / Nadaswaram is limited to supported Hindu ceremonies.' };
    }
  }

  if (cat === 'Priest / Pandit' && rel !== 'hindu' && rel !== 'jain' && rel !== 'all') {
    return { blocked: true, reason: 'Priest / Pandit applies only for supported Hindu, Jain, or all-religion events.' };
  }

  if (cat === 'Maulvi / Qazi') {
    if (!(rel === 'muslim' && eventMatchesAny(ev, MAULVI_ALLOWED_EVENTS))) {
      return { blocked: true, reason: 'Maulvi / Qazi applies only for supported Muslim events.' };
    }
  }

  if (cat === 'Pastor / Father') {
    if (!(rel === 'christian' && eventMatchesAny(ev, PASTOR_ALLOWED_EVENTS))) {
      return { blocked: true, reason: 'Pastor / Father applies only for supported Christian events.' };
    }
  }

  return { blocked: false };
}

function applyCategoryRules(vendor, category, religion, eventType, details) {
  const cat = normalizeText(category);
  const ev = normalizeLower(eventType);
  const rel = normalizeLower(religion);

  if (cat === 'DJ' && ev === 'kids birthday party' && toNum(vendor.capacity) > 500) {
    return { pass: false, preferenceScore: 0 };
  }

  if (cat === 'Maulvi / Qazi' && ev === 'nikah (wedding)' && details.nikahnama_provided !== true) {
    return { pass: false, preferenceScore: 0 };
  }

  if (cat === 'Pastor / Father' && ev === 'church wedding' && details.wedding_certificate !== true) {
    return { pass: false, preferenceScore: 0 };
  }

  let preferenceScore = 0;

  if (cat === 'Priest / Pandit' && ev === 'wedding' && details.vedic_trained === true) {
    preferenceScore += 2;
  }

  if (cat === 'Florist') {
    if (rel === 'hindu') {
      if (details.mango_leaves_toran === true) preferenceScore += 1;
      if (details.banana_stem_pillar === true) preferenceScore += 1;
    }
    if (rel === 'muslim' && details.muslim_decor === true) preferenceScore += 2;
    if (rel === 'christian' && details.christian_decor === true) preferenceScore += 2;
  }

  const isWeddingLike = ev === 'wedding' || ev === 'nikah (wedding)' || ev === 'church wedding';
  if (cat === 'Photographer' && isWeddingLike && details.drone_photography === true) {
    preferenceScore += 2;
  }
  if (cat === 'Videographer' && isWeddingLike && details.drone_video === true) {
    preferenceScore += 2;
  }

  return { pass: true, preferenceScore };
}

function buildReason(category, details) {
  const cat = normalizeText(category);
  const bits = [];

  if (cat === 'Priest / Pandit') {
    if (details.vedic_trained) bits.push('Vedic trained.');
    if (details.own_samagri === true) bits.push('Own samagri included.');
  }

  if (cat === 'Maulvi / Qazi' && details.nikahnama_provided === true) {
    bits.push('Nikahnama provided.');
  }

  if (cat === 'Pastor / Father' && details.wedding_certificate === true) {
    bits.push('Wedding certificate support available.');
  }

  if (cat === 'Photographer' || cat === 'Videographer') {
    if (toNum(details.delivery_days) > 0) bits.push(`Delivery in about ${toNum(details.delivery_days)} days.`);
    if (cat === 'Photographer' && details.drone_photography) bits.push('Drone photography available.');
    if (cat === 'Videographer' && details.drone_video) bits.push('Drone video available.');
  }

  if (cat === 'Florist') {
    if (details.mango_leaves_toran) bits.push('Mango leaves toran available.');
    if (details.banana_stem_pillar) bits.push('Banana stem pillar setup available.');
    if (details.muslim_decor) bits.push('Muslim decor style available.');
    if (details.christian_decor) bits.push('Christian decor style available.');
  }

  return bits.join(' ').trim();
}

async function cityCoordsFromName(name) {
  const key = normalizeLower(name);
  if (!key) return null;
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  const found = Object.entries(CITY_COORDS).find(([city]) => key.includes(city) || city.includes(key));
  if (found) return found[1];
  // Geocoding disabled: no external lookups
  return null;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
}

async function enrichDistanceAndAddress(vendor, requestedPlace) {
  const from = await cityCoordsFromName(requestedPlace);
  const to = await cityCoordsFromName(vendor.city);
  const fullAddress = [vendor.area, vendor.city].filter(Boolean).join(', ');
  if (!from || !to) {
    return {
      distance_km: null,
      distance_label: vendor.city && requestedPlace && normalizeLower(vendor.city) === normalizeLower(requestedPlace) ? 'In city' : '',
      full_address: fullAddress,
    };
  }
  const distanceKm = Math.max(0, Math.round(haversineKm(from, to)));
  return {
    distance_km: distanceKm,
    distance_label: distanceKm <= 2 ? 'In city' : `${distanceKm} km away`,
    full_address: fullAddress,
  };
}

function venueCategoryFilterForRequest(vendor, requestedCategoryNorm) {
  const vendorCatNorm = normalizeLower(vendor.category);
  if (CHURCH_VENUE_CATEGORY_SET.has(requestedCategoryNorm)) {
    return CHURCH_VENUE_CATEGORY_SET.has(vendorCatNorm);
  }
  if (requestedCategoryNorm === 'function hall') {
    return vendorCatNorm === 'function hall';
  }
  if (requestedCategoryNorm === 'venue') {
    return VENUE_CATEGORY_SET.has(vendorCatNorm);
  }
  return vendorCatNorm === requestedCategoryNorm;
}

export async function findByCategory({
  category,
  city,
  religion,
  eventType,
  numGuests,
  budget,
  allowBudgetExceedPercent = 0.2,
  classPreference,
  eventDate,
  timeSlot,
}) {
  const guard = applyCategoryGuardrails(category, religion, eventType);
  if (guard.blocked) {
    console.log(`[serviceAgent] ${category} blocked for ${religion}/${eventType}: ${guard.reason}`);
    return [];
  }

  const [{ vendors }, { slotsByVendorDate }] = await Promise.all([
    getVendorsDataset(),
    getAvailabilityDataset(),
  ]);

  const budgetNum = toNum(budget);
  const budgetCap = budgetNum > 0
    ? budgetNum * (1 + Math.max(0, toNum(allowBudgetExceedPercent, 0.25)))
    : Number.POSITIVE_INFINITY;

  const dbCategory = getDbCategory(category);
  const cityNorm = normalizeLower(city);
  const guests = toNum(numGuests);

  // Step 1: Filter by category, class, religion, and capacity
  const allCategoryVendors = vendors
    .filter((v) => {
      const vCat = normalizeLower(v.category);
      const targetCat = normalizeLower(dbCategory);
      return vCat === targetCat || vCat.includes(targetCat) || targetCat.includes(vCat);
    })
    .filter((v) => {
      // Capacity check: Only for non-crew categories (Halls, Catering, Tents)
      if (CREW_BASED_CATEGORIES.has(dbCategory)) return true;
      if (!guests) return true;
      const max = toNum(v.max_guests);
      const min = toNum(v.min_guests);
      // If capacity is 0 or not set, assume it's fine (data issue)
      if (max === 0) return true;
      return guests <= max && guests >= min;
    });

  const relNorm = normalizeLower(religion);
  const byReligion = allCategoryVendors.filter((v) => {
    const rs = normalizeLower(v.religion_served || '');
    if (!rs || rs === 'all') return true;
    if (!relNorm || relNorm === 'all') return true;
    return rs === relNorm || rs.includes(relNorm);
  });

  if (!byReligion.length) {
    console.log(`[serviceAgent] No vendors at all for category: ${category}`);
    return [];
  }

  // Step 2: Try with budget constraint
  const inBudgetVendors = byReligion.filter((v) => toNum(v.base_price) <= budgetCap);

  // Step 3: If no in-budget vendors, use all vendors (show with over-budget tag)
  const pool = inBudgetVendors.length > 0 ? inBudgetVendors : byReligion;

  // Step 4: Location Expansion (Async)
  const expandedPool = await withCityExpansion(pool, city, 50);

  // Step 5: Process and enrich
  const processed = [];
  for (const vendor of expandedPool) {
    const details = parseCategoryDetails(vendor.category_details);
    const ruleResult = applyCategoryRules(vendor, category, religion, eventType, details);
    if (!ruleResult.pass) continue;

    const slot = checkSlot(slotsByVendorDate, vendor.vendor_id, eventDate, timeSlot);
    const estimatedCost = calculateFinalPrice(
      vendor.base_price,
      slot.price_multiplier,
      guests,
      dbCategory,
    );
    const distanceInfo = await enrichDistanceAndAddress(vendor, city);
    const isNearby = vendor._locationPriority === 1;
    const isStatewide = vendor._locationPriority === 2 || (!isNearby && normalizeLower(vendor.city) !== cityNorm);
    const budgetTag = budgetNum > 0
      ? (estimatedCost <= budgetNum
          ? 'in_budget'
          : estimatedCost <= budgetCap
            ? 'slightly_above_budget'
            : 'above_budget')
      : 'unknown';

    processed.push({
      ...vendor,
      category_details: details,
      availability_status: slot.available ? 'available' : 'unavailable',
      price_multiplier: toNum(slot.price_multiplier, 1),
      estimated_cost: estimatedCost,
      budget_fit_tag: budgetTag,
      budget_delta: Math.max(0, estimatedCost - budgetNum),
      distance_km: distanceInfo.distance_km,
      distance_label: isNearby
        ? 'Nearby (~30-50 km, can travel)'
        : isStatewide
          ? 'Travels to your location'
          : 'In city',
      full_address: distanceInfo.full_address,
      reason: buildReason(category, details),
      _preferenceScore: ruleResult.preferenceScore,
      _classMatch: classMatch(vendor, classPreference) ? 1 : 0,
      is_nearby: isNearby,
      is_statewide: isStatewide,
    });
  }

  processed.sort((a, b) => {
    if (b._classMatch !== a._classMatch) return b._classMatch - a._classMatch;
    if (b._preferenceScore !== a._preferenceScore) return b._preferenceScore - a._preferenceScore;
    if (a.budget_fit_tag !== b.budget_fit_tag) {
      const order = { in_budget: 0, slightly_above_budget: 1, above_budget: 2, unknown: 3 };
      return (order[a.budget_fit_tag] ?? 9) - (order[b.budget_fit_tag] ?? 9);
    }
    return (Number(b.rating) || 0) - (Number(a.rating) || 0);
  });

  // CRITICAL: Never return 0 results if we have any processed vendors.
  const isReligious = RELIGIOUS_CATEGORIES.has(dbCategory);
  const returnLimit = isReligious ? 2 : 3;

  return processed
    .slice(0, returnLimit)
    .map(({ _preferenceScore, _locationPriority, _classMatch, ...row }) => row);
}

export default {
  findByCategory,
};
