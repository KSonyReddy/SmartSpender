import { getVendorsDataset } from '../datasets/vendorsDataset.js';
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
  return normalizeLower(vendor.class_type) === normalizeLower(classPreference);
}

function withCityExpansion(candidates, city) {
  const cityNorm = normalizeLower(city);
  if (!cityNorm) return candidates;

  const exact = candidates.filter((v) => normalizeLower(v.city) === cityNorm);
  if (exact.length >= 3) return exact;

  const nearby = (NEARBY_CITIES[normalizeText(city)] || []).map((c) => normalizeLower(c));
  return candidates.filter((v) => {
    const vendorCity = normalizeLower(v.city);
    return vendorCity === cityNorm || nearby.includes(vendorCity);
  });
}

function passesReligionFilter(details, religion, eventType) {
  const r = normalizeLower(religion);
  const e = normalizeLower(eventType);

  if (r === 'hindu') {
    return details.hindu_mandap === true || details.entrance_decor === true || details.stage_backdrop === true;
  }

  if (r === 'muslim') {
    return details.muslim_floral_arch === true || details.stage_backdrop === true || details.fabric_draping === true;
  }

  if (r === 'christian') {
    return details.christian_arch === true || details.aisle_runner === true || details.stage_backdrop === true;
  }

  return true;
}

function passesEventTypeFilter(details, eventType) {
  const e = normalizeLower(eventType);

  if (e === 'birthday' || e === 'kids birthday party') {
    return details.balloon_decor === true;
  }

  if (e === 'corporate event' || e === 'product launch' || e === 'award ceremony') {
    return details.stage_backdrop === true;
  }

  return true;
}

function buildReason(details, usedFallback) {
  const tags = [];
  if (details.hindu_mandap) tags.push('Hindu mandap setup');
  if (details.muslim_floral_arch) tags.push('Muslim floral arch');
  if (details.christian_arch || details.aisle_runner) tags.push('Christian aisle decor');

  const parts = [];
  if (usedFallback) {
    parts.push('Warning: no exact religion-specific decorators found; showing closest available options.');
  }

  parts.push(tags.length ? `${tags.join(' / ')}.` : 'Event decor setup available.');
  if (details.led_lighting) parts.push('LED lighting.');
  if (details.balloon_decor) parts.push('Balloon decor.');
  if (toNum(details.team_size) > 0) parts.push(`Team of ${toNum(details.team_size)} members.`);
  if (details.fabric_draping) parts.push('Fabric draping.');

  return parts.join(' ');
}

export async function findDecorators({
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
  const [{ vendors }, { slotsByVendorDate }] = await Promise.all([
    getVendorsDataset(),
    getAvailabilityDataset(),
  ]);

  const budgetNum = toNum(budget);
  const budgetCap = budgetNum > 0
    ? budgetNum * (1 + Math.max(0, toNum(allowBudgetExceedPercent, 0.2)))
    : Number.POSITIVE_INFINITY;

  const targetCat = 'Decoration';
  const allDecorators = vendors.filter((v) => {
    const vCat = normalizeLower(v.category);
    return vCat === targetCat.toLowerCase() || vCat.includes(targetCat.toLowerCase()) || targetCat.toLowerCase().includes(vCat);
  });

  let candidates = withCityExpansion(allDecorators, city)
    .filter((v) => classMatch(v, classPreference))
    .filter((v) => toNum(v.base_price) <= budgetCap);

  const withDetails = candidates.map((v) => ({
    vendor: v,
    details: parseCategoryDetails(v.category_details),
  }));

  const religionFiltered = withDetails.filter(({ details }) =>
    passesReligionFilter(details, religion, eventType),
  );

  const eventFiltered = religionFiltered.filter(({ details }) =>
    passesEventTypeFilter(details, eventType),
  );

  let finalPool = eventFiltered;
  let usedFallback = false;

  if (eventFiltered.length === 0) {
    const fallbackEventFiltered = withDetails.filter(({ details }) =>
      passesEventTypeFilter(details, eventType),
    );
    finalPool = fallbackEventFiltered;
    usedFallback = true;
  }

  if (finalPool.length === 0) {
    const statewidePool = allDecorators
      .filter((v) => classMatch(v, classPreference))
      .map((v) => ({
        vendor: v,
        details: parseCategoryDetails(v.category_details),
      }))
      .filter(({ details }) => passesReligionFilter(details, religion, eventType))
      .filter(({ details }) => passesEventTypeFilter(details, eventType));

    finalPool = statewidePool.length ? statewidePool : allDecorators.map((v) => ({
      vendor: v,
      details: parseCategoryDetails(v.category_details),
    }));
    usedFallback = true;
  }

  const rows = finalPool.map(({ vendor, details }) => {
    const slot = checkSlot(slotsByVendorDate, vendor.vendor_id, eventDate, timeSlot);
    const estimatedCost = calculateFinalPrice(
      vendor.base_price,
      slot.price_multiplier,
      numGuests,
      'Decoration',
    );

    return {
      ...vendor,
      category_details: details,
      availability_status: slot.available ? 'available' : 'unavailable',
      price_multiplier: toNum(slot.price_multiplier, 1),
      estimated_cost: estimatedCost,
      reason: buildReason(details, usedFallback),
    };
  });

  rows.sort((a, b) => toNum(b.rating) - toNum(a.rating));
  return rows.slice(0, 3);
}

export default {
  findDecorators,
};
