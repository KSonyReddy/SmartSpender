import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import { getMenusDataset, selectPackage } from '../datasets/menusDataset.js';
import {
  getAvailabilityDataset,
  checkSlot,
  calculateFinalPrice,
} from '../datasets/availabilityDataset.js';

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

const HINDU_RELIGIOUS_CEREMONIES = new Set([
  'wedding',
  'thread ceremony',
  'gruhapravesam',
  'puberty ceremony',
  '60th birthday',
  '80th birthday',
  '21st day',
]);

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

function withCityExpansion(candidates, city) {
  const cityNorm = normalizeLower(city);
  if (!cityNorm) return candidates;

  const exact = candidates.filter(v => normalizeLower(v.city) === cityNorm);
  if (exact.length >= 3) return exact;

  const nearby = (NEARBY_CITIES[normalizeText(city)] || []).map(c => normalizeLower(c));
  const nearbyResults = candidates.filter(v => {
    const vc = normalizeLower(v.city);
    return vc === cityNorm || nearby.includes(vc);
  });
  if (nearbyResults.length >= 3) return nearbyResults;

  // Caterers travel statewide — return ALL if insufficient local results
  // Sort by: exact city first, nearby second, rest third
  return candidates.sort((a, b) => {
    const aCity = normalizeLower(a.city);
    const bCity = normalizeLower(b.city);
    const aScore = aCity === cityNorm ? 0 : nearby.includes(aCity) ? 1 : 2;
    const bScore = bCity === cityNorm ? 0 : nearby.includes(bCity) ? 1 : 2;
    return aScore - bScore;
  });
}

function applyDietaryFilter(candidates, { religion, dietaryPreference }) {
  const rel = normalizeLower(religion);
  const diet = normalizeLower(dietaryPreference);

  if (diet === 'halal' || rel === 'muslim') {
    // For Muslim weddings, prioritize Halal meat vendors.
    const halal = candidates.filter((v) => v.is_halal === true);
    if (halal.length > 0) return halal;
    // If no explicit halal, allow generic vendors but keep non-halal meat filtered if possible
    return candidates.filter((v) => v.is_veg_only === true || v.is_halal === true);
  }

  const isVegOnlyRequest = (
    diet === 'vegetarian'
    || diet === 'veg'
    || diet === 'pure veg'
    || diet === 'pure veg only'
    || diet.includes('vegetarian')
    || diet.includes('pure veg')
    || diet.includes('veg only')
  );

  if (isVegOnlyRequest || rel === 'jain') {
    return candidates.filter((v) => v.is_veg_only === true);
  }

  return candidates;
}

function isHinduReligiousCase(religion, eventType) {
  if (normalizeLower(religion) !== 'hindu') return false;
  const ev = normalizeLower(eventType);
  if (!ev) return false;
  for (const marker of HINDU_RELIGIOUS_CEREMONIES) {
    if (ev.includes(marker)) return true;
  }
  return false;
}

function buildReason(vendor, menu, pkg) {
  const bits = [];
  bits.push(`Rs.${toNum(pkg.per_plate)}/plate - ${menu.cuisine_type || 'Multi-cuisine'}.`);
  if (pkg.description) bits.push(`${pkg.description}.`);
  bits.push(`Serves up to ${toNum(menu.max_order_guests)} guests.`);
  if (vendor.is_halal) bits.push('Halal certified.');
  if (vendor.is_veg_only) bits.push('Pure veg.');
  if (menu.tasting_available) bits.push('Tasting available.');
  return bits.join(' ');
}

function finalizeTopThree(sortedRows) {
  return sortedRows.slice(0, 3).map((row) => {
    const { _isVegOnly, ...out } = row;
    return out;
  });
}

export async function findCaterers({
  city,
  religion,
  dietaryPreference,
  numGuests,
  perPlateBudget,
  classPreference,
  eventDate,
  timeSlot,
  eventType,
}) {
  const [{ vendors }, { menusByVendorId }, { slotsByVendorDate }] = await Promise.all([
    getVendorsDataset(),
    getMenusDataset(),
    getAvailabilityDataset(),
  ]);

  const targetCat = 'Catering';
  let filtered = vendors.filter((v) => {
    const vCat = normalizeLower(v.category);
    return vCat === targetCat.toLowerCase() || vCat.includes(targetCat.toLowerCase()) || targetCat.toLowerCase().includes(vCat);
  });

  filtered = applyDietaryFilter(filtered, { religion, dietaryPreference });

  // Caterers in Telangana travel statewide; don't restrict by city.
  const cityExact = filtered.filter((v) => String(v.city || '').toLowerCase() === String(city || '').toLowerCase());
  const sortedPool = [...cityExact, ...filtered.filter((v) => String(v.city || '').toLowerCase() !== String(city || '').toLowerCase())];
  filtered = sortedPool;

  if (classPreference) {
    const strictClass = filtered.filter((v) => classMatch(v, classPreference));
    if (strictClass.length > 0) filtered = strictClass;
  }

  const guests = toNum(numGuests);
  const budget = toNum(perPlateBudget);
  const effectivePlateCap = Math.max(budget * 1.30, budget + 100);

  const beforePriceFilter = [...filtered];
  filtered = filtered.filter((v) => {
    const basePriceOk = toNum(v.base_price) <= effectivePlateCap || toNum(v.base_price) === 0;
    const platePrice = toNum(v.price_per_plate);
    return basePriceOk || platePrice === 0 || platePrice <= effectivePlateCap;
  });

  // If strict price cap removes all caterers, keep candidates and mark budget fit later.
  if (filtered.length === 0) {
    filtered = beforePriceFilter;
  }

  const rows = [];
  for (const vendor of filtered) {
    const menu = menusByVendorId.get(vendor.vendor_id);
    if (!menu) continue;

    const minOrder = toNum(menu.min_order_guests);
    const maxOrder = toNum(menu.max_order_guests);
    if (minOrder >= 10 && guests < minOrder) {
      continue;
    }
    if (maxOrder >= 10 && guests > maxOrder) {
      continue;
    }

    const pkg = selectPackage(menu, budget);
    const slot = checkSlot(slotsByVendorDate, vendor.vendor_id, eventDate, timeSlot);

    const totalCost = toNum(pkg.per_plate) * guests;
    const estimatedCost = calculateFinalPrice(
      pkg.per_plate,
      slot.price_multiplier,
      guests,
      'Catering',
    );

    rows.push({
      ...vendor,
      category_details: parseCategoryDetails(vendor.category_details),
      recommended_package: {
        name: pkg.name,
        per_plate: toNum(pkg.per_plate),
        items: Array.isArray(pkg.items) ? pkg.items : [],
        description: pkg.description || '',
      },
      total_cost: totalCost,
      menu_items: Array.isArray(pkg.items) ? pkg.items : [],
      estimated_cost: estimatedCost,
      availability_status: slot.available ? 'available' : 'unavailable',
      price_multiplier: toNum(slot.price_multiplier, 1),
      reason: buildReason(vendor, menu, pkg),
      _isVegOnly: vendor.is_veg_only === true,
    });
  }

  rows.sort((a, b) => toNum(b.rating) - toNum(a.rating));

  if (rows.length === 0) {
    const fallbackRows = filtered
      .slice()
      .sort((a, b) => toNum(b.rating) - toNum(a.rating) || toNum(a.base_price) - toNum(b.base_price))
      .slice(0, 3)
      .map((vendor) => ({
        ...vendor,
        category_details: parseCategoryDetails(vendor.category_details),
        recommended_package: {
          name: 'Fallback match',
          per_plate: Math.max(1, toNum(vendor.price_per_plate) || toNum(vendor.base_price) || budget),
          items: [],
          description: 'Statewide fallback when menu data is unavailable.',
        },
        total_cost: Math.max(1, toNum(vendor.price_per_plate) || toNum(vendor.base_price) || budget) * Math.max(1, guests || 1),
        menu_items: [],
        estimated_cost: Math.max(1, toNum(vendor.price_per_plate) || toNum(vendor.base_price) || budget) * Math.max(1, guests || 1),
        availability_status: 'unknown',
        price_multiplier: 1,
        reason: 'Statewide fallback match for catering vendors.',
        _isVegOnly: vendor.is_veg_only === true,
      }));

    return finalizeTopThree(fallbackRows);
  }

  if (isHinduReligiousCase(religion, eventType)) {
    const vegFirst = rows.filter((r) => r._isVegOnly);
    const nonVeg = rows.filter((r) => !r._isVegOnly);
    return finalizeTopThree([...vegFirst, ...nonVeg]);
  }

  return finalizeTopThree(rows);
}

export default {
  findCaterers,
};
