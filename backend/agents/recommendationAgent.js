import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import { getAvailabilityDataset } from '../datasets/availabilityDataset.js';
import { haversineKm, distanceLabel } from '../utils/geo.js';

function vendorCoordinates(vendor) {
  const lat = Number(vendor?.latitude ?? vendor?.lat);
  const lon = Number(vendor?.longitude ?? vendor?.lon ?? vendor?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

const NEARBY_CITIES = {
  'Hyderabad': ['Rangareddy', 'Medchal', 'Sangareddy'],
  'Rangareddy': ['Hyderabad', 'Mahbubnagar', 'Vikarabad'],
  'Warangal': ['Hanamkonda', 'Karimnagar', 'Nalgonda', 'Khammam'],
  'Karimnagar': ['Warangal', 'Nizamabad', 'Jagtial', 'Peddapalli'],
  'Nizamabad': ['Karimnagar', 'Medak', 'Kamareddy', 'Armoor'],
  'Khammam': ['Nalgonda', 'Warangal', 'Bhadradri'],
  'Nalgonda': ['Khammam', 'Hyderabad', 'Suryapet', 'Miryalaguda'],
  'Mahbubnagar': ['Hyderabad', 'Rangareddy', 'Wanaparthy', 'Gadwal'],
  'Medak': ['Hyderabad', 'Nizamabad', 'Sangareddy'],
  'Adilabad': ['Nirmal', 'Mancherial', 'Kumuram Bheem'],
  'Villages': ['Rangareddy', 'Karimnagar', 'Medak'],
};

const CITY_COORDS = {
  hyderabad: { lat: 17.3850, lon: 78.4867 },
  rangareddy: { lat: 17.2400, lon: 78.4000 },
  warangal: { lat: 17.9784, lon: 79.5941 },
  hanamkonda: { lat: 18.0070, lon: 79.5580 },
  karimnagar: { lat: 18.4386, lon: 79.1288 },
  nizamabad: { lat: 18.6725, lon: 78.0941 },
  khammam: { lat: 17.2473, lon: 80.1514 },
  nalgonda: { lat: 17.0575, lon: 79.2677 },
  mahbubnagar: { lat: 16.7448, lon: 77.9878 },
  medak: { lat: 18.0455, lon: 78.2602 },
  sangareddy: { lat: 17.6140, lon: 78.0816 },
  medchal: { lat: 17.6310, lon: 78.4816 },
};

function normalizeText(v) {
  return String(v || '').trim();
}

function normalizeLower(v) {
  return normalizeText(v).toLowerCase();
}

function toNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function cityCoordsFromName(name) {
  const target = normalizeLower(name);
  if (!target) return null;
  if (CITY_COORDS[target]) return CITY_COORDS[target];
  const matched = Object.entries(CITY_COORDS).find(([city]) => target.includes(city) || city.includes(target));
  return matched ? matched[1] : null;
}

async function userCoordsFromPlace(name) {
  // Only use local city table; external geocoding disabled
  return cityCoordsFromName(name);
}

function toIsoDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toDateOffset(isoDate, offsetDays) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + offsetDays);
  return toIsoDate(d);
}

function supportsEventType(vendor, eventType) {
  const target = normalizeLower(eventType);
  if (!target) return true;
  const sup = vendor.supported_events;
  if (sup === 'all') return true;
  const arr = Array.isArray(sup) ? sup : [];
  return arr.some((ev) => normalizeLower(ev) === target || normalizeLower(ev).includes(target) || target.includes(normalizeLower(ev)));
}

function supportsReligion(vendor, religion) {
  const r = normalizeLower(religion);
  if (!r || r === 'all') return true;
  const vr = normalizeLower(vendor.religion_served);
  if (!vr || vr === 'all') return true;
  return vr.includes(r);
}

function fitsGuestCount(vendor, guestCount) {
  const guests = toNum(guestCount, 0);
  if (!guests) return true;
  const min = toNum(vendor.min_guests, 0);
  const max = toNum(vendor.max_guests, 0);
  if (max > 0 && guests > max) return false;
  if (min > 0 && guests < min) return false;
  return true;
}

function fitsBudget(vendor, budget) {
  const b = toNum(budget, 0);
  if (!b) return true;
  return toNum(vendor.base_price, 0) <= b;
}

function getNearbyCities(city) {
  const key = Object.keys(NEARBY_CITIES).find((k) => normalizeLower(k) === normalizeLower(city));
  if (key) return NEARBY_CITIES[key];
  if (/village/i.test(String(city || ''))) return NEARBY_CITIES.Villages;
  return [];
}

function toAvailabilityStatus(slots) {
  if (!slots || slots.length === 0) return 'unknown';
  const anyOpen = slots.some((s) => normalizeLower(s.status) === 'available' || normalizeLower(s.status) === 'open' || normalizeLower(s.status) === 'free');
  return anyOpen ? 'available' : 'conflict';
}

function isSlotAvailable(slot) {
  const s = normalizeLower(slot?.status);
  return s === 'available' || s === 'open' || s === 'free';
}

function parseTravelRadiusKm(vendor) {
  const raw = vendor.travel_radius;
  if (raw == null || raw === '') return 25;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && Number.isFinite(Number(raw.radiusKm))) return Number(raw.radiusKm);
  const s = String(raw);
  const m = s.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (m) return Number(m[1]);
  return 25;
}

function nearbyCityHintLabel(requestedCity, vendorCity, vendor) {
  if (normalizeLower(requestedCity) === normalizeLower(vendorCity)) return 'In city';
  return `Nearby: ${Math.round(parseTravelRadiusKm(vendor))} km`;
}

function fallbackMeta(reasonCode, message, nextActions = []) {
  return { reason_code: reasonCode, message, next_actions: nextActions };
}

function slotLabel(startTime) {
  const h = parseInt(String(startTime || '0').split(':')[0], 10);
  if (Number.isNaN(h)) return 'Anytime';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

function getVendorDateSlots(slotsByVendorDate, vendorId, date) {
  const key = `${String(vendorId)}__${String(date)}`;
  return slotsByVendorDate.get(key) || [];
}

export async function findNearestAvailableVendors({ city, eventType, date, budget, guestCount, religion }) {
  const [{ vendors }, { slotsByVendorDate }] = await Promise.all([
    getVendorsDataset(),
    getAvailabilityDataset(),
  ]);

  const cityNorm = normalizeLower(city);

  const baseFiltered = vendors.filter((v) => {
    return supportsEventType(v, eventType)
      && supportsReligion(v, religion)
      && fitsGuestCount(v, guestCount)
      && fitsBudget(v, budget);
  });

  const inCity = baseFiltered.filter((v) => normalizeLower(v.city) === cityNorm);

  let candidates = [...inCity];
  if (inCity.length < 3) {
    const nearbySet = new Set(getNearbyCities(city).map((c) => normalizeLower(c)));
    const nearby = baseFiltered.filter((v) => nearbySet.has(normalizeLower(v.city)));
    candidates = [...inCity, ...nearby];
  }

  const unique = new Map(candidates.map((v) => [v.vendor_id, v]));

  const enriched = Array.from(unique.values()).map((vendor) => {
    const slots = getVendorDateSlots(slotsByVendorDate, vendor.vendor_id, date);
    return {
      vendor,
      distanceLabel: nearbyCityHintLabel(city, vendor.city, vendor),
      availabilityStatus: toAvailabilityStatus(slots),
      _rating: toNum(vendor.rating, 0),
      _price: toNum(vendor.base_price, 0),
    };
  });

  enriched.sort((a, b) => {
    if (a.availabilityStatus !== b.availabilityStatus) {
      if (a.availabilityStatus === 'available') return -1;
      if (b.availabilityStatus === 'available') return 1;
    }
    if (b._rating !== a._rating) return b._rating - a._rating;
    return a._price - b._price;
  });

  return enriched.slice(0, 5).map(({ _rating, _price, ...row }) => row);
}

export async function findAlternativeDates({ vendorId, preferredDate, rangedays = 14 }) {
  const [{ vendorsById }, { slotsByVendorDate }] = await Promise.all([
    getVendorsDataset(),
    getAvailabilityDataset(),
  ]);

  const vendor = vendorsById.get(String(vendorId));
  const basePrice = toNum(vendor?.base_price, 0);
  const out = [];

  for (let offset = -Math.abs(rangedays); offset <= Math.abs(rangedays); offset += 1) {
    if (offset === 0) continue;
    const d = toDateOffset(preferredDate, offset);
    if (!d) continue;

    const slots = getVendorDateSlots(slotsByVendorDate, vendorId, d);
    if (!slots.length) continue;

    const availableSlots = slots.filter((s) => normalizeLower(s.status) === 'available' || normalizeLower(s.status) === 'open' || normalizeLower(s.status) === 'free');
    if (!availableSlots.length) continue;

    const labels = Array.from(new Set(availableSlots.map((s) => slotLabel(s.start_time))));
    const minMultiplier = availableSlots.reduce((m, s) => Math.min(m, toNum(s.price_multiplier, 1)), Infinity);
    const priceOnDate = Math.round(basePrice * (Number.isFinite(minMultiplier) ? minMultiplier : 1));

    out.push({
      date: d,
      timeSlots: labels,
      priceOnDate,
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function findBudgetUpgradeOptions({ eventType, city, date, currentBudget, upgradePercent = 0.20 }) {
  const upgradedBudget = toNum(currentBudget) * (1 + toNum(upgradePercent, 0.20));
  const nearest = await findNearestAvailableVendors({
    city,
    eventType,
    date,
    budget: upgradedBudget,
    guestCount: null,
    religion: null,
  });

  const options = nearest
    .filter((row) => row.availabilityStatus === 'available')
    .filter((row) => toNum(row.vendor.base_price, 0) > toNum(currentBudget, 0) && toNum(row.vendor.base_price, 0) <= upgradedBudget)
    .map((row) => {
      const extra = Math.round(toNum(row.vendor.base_price, 0) - toNum(currentBudget, 0));
      const parking = toNum(row.vendor?.category_details?.parking_slots, toNum(row.vendor?.parking_capacity, 0));
      const rating = toNum(row.vendor.rating, 0).toFixed(1);
      return {
        vendor: row.vendor,
        extraAmount: extra,
        label: `₹${extra.toLocaleString('en-IN')} more gets you ${row.vendor.vendor_name} — rated ${rating}⭐ with ${parking} parking slots`,
      };
    });

  options.sort((a, b) => a.extraAmount - b.extraAmount);
  return options.slice(0, 5);
}

export function generateAlternativeMessage({ requestedCity, requestedDate, requestedBudget, alternatives }) {
  const nearest = alternatives?.nearestVendors || [];
  const altDates = alternatives?.alternativeDates || [];
  const upgrades = alternatives?.budgetUpgradeOptions || [];
  const familyCount = Number(alternatives?.familyContributors || 3);
  const eachShare = Math.ceil(toNum(requestedBudget, 0) / (familyCount > 0 ? familyCount : 1));

  const lines = [];
  lines.push(`Requested plan: ${requestedCity} on ${requestedDate} with budget ₹${toNum(requestedBudget, 0).toLocaleString('en-IN')}.`);

  if (nearest.length) {
    lines.push('Nearby vendor options:');
    nearest.forEach((r) => {
      lines.push(`- ${r.vendor.vendor_name} (${r.vendor.city}) • ${r.distanceLabel} • ${r.availabilityStatus}`);
    });
  }

  if (altDates.length) {
    lines.push('Alternative dates with free slots:');
    altDates.slice(0, 4).forEach((d) => {
      lines.push(`- ${d.date}: ${d.timeSlots.join(', ')} (Estimated ₹${toNum(d.priceOnDate, 0).toLocaleString('en-IN')})`);
    });
  }

  if (upgrades.length) {
    lines.push('Budget upgrade opportunities:');
    upgrades.slice(0, 3).forEach((u) => lines.push(`- ${u.label}`));
  }

  lines.push(`For a family of ${familyCount} contributing equally, each share is about ₹${eachShare.toLocaleString('en-IN')}.`);

  return lines.join('\n');
}

/**
 * Find vendors within a radius of a location by checking all nearby cities.
 * Uses NEARBY_CITIES map + distance scoring to simulate radius search.
 * Returns vendors sorted by "closeness" (cities in NEARBY_CITIES order = closer first).
 * 
 * @param {Object} params
 * @param {string} params.city - Requested city/village
 * @param {string} params.eventType - Type of event
 * @param {string} params.date - Event date YYYY-MM-DD
 * @param {number} params.budget - Max budget for this category
 * @param {number} params.guestCount - Number of guests
 * @param {string} params.religion - Religion preference
 * @param {number} params.radiusKm - Search radius in km (default 30)
 * @param {boolean} params.allowBudgetExceedPercent - Allow vendors up to X% over budget (default 0)
 * @returns {Promise<{vendors: Array, searchRadius: number, nearestCity: string|null}>}
 */
export async function findVendorsInRadius({
  city,
  eventType,
  date,
  budget,
  guestCount,
  religion,
  radiusKm = 30,
  allowBudgetExceedPercent = 0,
}) {
  try {
    const { vendors } = await getVendorsDataset();
    const { slotsByVendorDate } = await getAvailabilityDataset();
    const maxBudget = Number(budget || 0) * (1 + Number(allowBudgetExceedPercent || 0) / 100);
    const from = await userCoordsFromPlace(city);
    if (!from) {
      return {
        vendors: [],
        searchRadius: radiusKm,
        nearestCity: null,
        fallback: fallbackMeta(
          'location_unresolved',
          `Could not resolve coordinates for "${city}".`,
          ['confirm_location', 'share_landmark', 'change_city']
        ),
      };
    }
    let budgetFilteredCount = 0;
    let distanceFilteredCount = 0;
    let availabilityFilteredCount = 0;
    const results = [];
    for (const v of vendors) {
      const supported = v.supported_events;
      if (supported && supported !== 'all' && !String(supported).toLowerCase().includes(String(eventType || '').toLowerCase())) continue;
      if (v.base_price && maxBudget > 0 && Number(v.base_price) > maxBudget) {
        budgetFilteredCount += 1;
        continue;
      }
      if (v.max_guests && guestCount && Number(v.max_guests) < Number(guestCount)) continue;
      if (religion && religion !== 'all' && religion !== 'All') {
        const vr = String(v.religion_served || 'all').toLowerCase();
        if (vr !== 'all' && !vr.includes(String(religion).toLowerCase())) continue;
      }

      // Vendor coordinates come from dataset; never geocode per-vendor at runtime.
      const to = vendorCoordinates(v) || cityCoordsFromName(v.city);
      if (!to) continue;

      const rawDistance = haversineKm(from, to);
      if (!Number.isFinite(rawDistance)) continue;
      const distanceKm = Math.round(rawDistance);
      if (distanceKm > radiusKm) {
        distanceFilteredCount += 1;
        continue;
      }

      const key = `${v.vendor_id}__${date}`;
      const slots = slotsByVendorDate?.get(key) || [];
      const isAvailable = slots.length === 0 || slots.some((s) => isSlotAvailable(s));
      if (!isAvailable) {
        availabilityFilteredCount += 1;
        continue;
      }

      const overBudget = Number(v.base_price || 0) > Number(budget || 0);
      results.push({
        ...v,
        distance_km: distanceKm,
        distance_label: distanceLabel(distanceKm),
        travel_available: distanceKm > 2,
        over_budget: overBudget,
        budget_excess: overBudget ? Math.round(Number(v.base_price || 0) - Number(budget || 0)) : 0,
        availability_status: 'available',
      });
    }

    results.sort((a, b) => a.distance_km - b.distance_km || (b.rating || 0) - (a.rating || 0));

    const fallback = results.length
      ? null
      : (() => {
          if (distanceFilteredCount > 0) {
            return fallbackMeta(
              'no_vendor_within_radius',
              `No vendors found within ${radiusKm} km.`,
              ['expand_radius', 'change_city']
            );
          }
          if (budgetFilteredCount > 0) {
            return fallbackMeta(
              'budget_too_low',
              'Vendors exist, but none match the current budget.',
              ['increase_budget', 'change_category']
            );
          }
          if (availabilityFilteredCount > 0) {
            return fallbackMeta(
              'date_unavailable',
              'Vendors were found but unavailable for the selected date.',
              ['change_date', 'expand_radius']
            );
          }
          return fallbackMeta(
            'no_match_for_filters',
            'No vendors match the selected filters.',
            ['relax_filters', 'change_city']
          );
        })();

    return {
      vendors: results.slice(0, 8),
      searchRadius: radiusKm,
      nearestCity: results[0] ? String(results[0].city) : null,
      fallback,
    };
  } catch (err) {
    console.error('findVendorsInRadius error:', err.message);
    return {
      vendors: [],
      searchRadius: radiusKm,
      nearestCity: null,
      fallback: fallbackMeta(
        'search_failed',
        'Vendor radius search failed unexpectedly.',
        ['retry_automatically', 'change_city']
      ),
    };
  }
}

export default {
  findNearestAvailableVendors,
  findAlternativeDates,
  findBudgetUpgradeOptions,
  generateAlternativeMessage,
  findVendorsInRadius,
};
