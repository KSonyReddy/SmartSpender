import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import {
  getAvailabilityDataset,
  checkSlot,
  calculateFinalPrice,
} from '../datasets/availabilityDataset.js';
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

function toTitleCase(v) {
  const s = normalizeText(v);
  if (!s) return '';
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function normalizeNearbyMap(mapObj) {
  const out = {};
  for (const [k, arr] of Object.entries(mapObj)) {
    out[normalizeLower(k)] = (arr || []).map((x) => normalizeLower(x));
  }
  return out;
}

const NORMALIZED_NEARBY = normalizeNearbyMap(NEARBY_CITIES);

const VENUE_CATEGORY_SET = new Set(['function hall', 'marriage hall', 'banquet hall', 'kalyana mandapam', 'kalyana vedika', 'community hall', 'dharmashala', 'hotel hall', 'temple hall', 'church hall', 'parish hall', 'chapel hall', 'garden', 'resort', 'open ground', 'marriage garden', 'farmhouse', 'open terrace']);

/** Map code-side labels to DB categories */
const CATEGORY_VOCABULARY_MAP = {
  'venue': 'Function Hall',
  'function hall': 'Function Hall',
  'hall': 'Function Hall',
  'church / parish hall': 'Function Hall',
  'tent': 'Tent / Shamiana',
  'tent / shamiana': 'Tent / Shamiana',
  'shamiana': 'Tent / Shamiana'
};

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

const VENUE_CATEGORY_NAMES_BY_RELIGION = {
  hindu: ['kalyana vedika', 'kalyana mandapam', 'function hall', 'marriage hall',
    'community hall', 'dharmashala', 'banquet hall', 'hotel hall', 'temple hall'],
  muslim: ['banquet hall', 'community hall', 'open ground', 'marriage garden',
    'farmhouse', 'hotel hall', 'resort', 'open terrace', 'function hall', 'marriage hall'],
  christian: ['church hall', 'parish hall', 'banquet hall', 'chapel hall', 'hotel hall', 'garden', 'function hall', 'marriage hall'],
  jain: ['community hall', 'banquet hall', 'function hall', 'dharmashala', 'marriage hall', 'kalyana vedika', 'kalyana mandapam'],
  all: null, // no restriction
};

// Venue names that are BLOCKED for specific religions
const VENUE_NAME_BLOCKLIST_BY_RELIGION = {
  muslim: ['kalyana vedika', 'kalyana mandapam', 'mandapam', 'temple hall', 'dharmashala'],
  christian: ['kalyana vedika', 'kalyana mandapam', 'mandapam', 'temple hall'],
  jain: [], // Jain accepts most but requires veg kitchen check
  hindu: [], // No restrictions
};

async function cityCoordsFromName(name) {
  const key = normalizeLower(name);
  if (!key) return null;
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  const found = Object.entries(CITY_COORDS).find(([city]) => key.includes(city) || city.includes(key));
  if (found) return found[1];
  // Geocoding disabled: do not attempt external lookups
  return null;
}

async function enrichDistanceAndAddress(vendor, requestedPlace) {
  const from = await cityCoordsFromName(requestedPlace);
  const to = vendorCoordinates(vendor) || await cityCoordsFromName([vendor.area, vendor.city].filter(Boolean).join(', '));
  const fullAddress = [vendor.area, vendor.city].filter(Boolean).join(', ');
  if (!from || !to) {
    return {
      distance_km: null,
      distance_label: vendor.city && requestedPlace && normalizeLower(vendor.city) === normalizeLower(requestedPlace) ? 'In city' : '',
      full_address: fullAddress,
    };
  }
  const distanceKm = Math.max(0, Math.round(haversineKm(from, to)));
  if (!Number.isFinite(distanceKm)) {
    return {
      distance_km: null,
      distance_label: '',
      full_address: fullAddress,
    };
  }
  return {
    distance_km: distanceKm,
    distance_label: distanceLabel(distanceKm),
    full_address: fullAddress,
  };
}

function parseTravelRadius(raw) {
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw)) return { locations: raw.map((x) => normalizeLower(x)).filter(Boolean), radiusKm: null };
  if (typeof raw === 'number') return { locations: [], radiusKm: raw };
  if (typeof raw === 'object') {
    const locations = Array.isArray(raw.locations) ? raw.locations.map((x) => normalizeLower(x)).filter(Boolean) : [];
    const radiusKm = Number.isFinite(Number(raw.radiusKm)) ? Number(raw.radiusKm) : null;
    return { locations, radiusKm };
  }
  const s = String(raw).trim();
  if (!s) return null;

  try {
    const parsed = JSON.parse(s);
    return parseTravelRadius(parsed);
  } catch {
    // Continue with plain-string parsing.
  }

  const num = s.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (num) return { locations: [], radiusKm: parseFloat(num[1]) };

  const locations = s
    .split(/[|,;/]/)
    .map((x) => normalizeLower(x))
    .filter(Boolean);
  return { locations, radiusKm: null };
}

function vendorCanTravelToRequested(vendor, requestedPlace, resolvedCity, distanceKm = null) {
  const parsed = parseTravelRadius(vendor.travel_radius);
  if (!parsed) return true;

  const target = normalizeLower(requestedPlace);
  const resolved = normalizeLower(resolvedCity);

  if (parsed.locations.length > 0) {
    if (parsed.locations.includes(target) || parsed.locations.includes(resolved)) return true;
    return false;
  }

  if (parsed.radiusKm != null) {
    if (normalizeLower(vendor.city) === resolved) return true;
    if (!Number.isFinite(distanceKm)) return false;
    return distanceKm <= parsed.radiusKm;
  }

  return true;
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

function buildReason(vendor, details) {
  const bits = [];
  bits.push(`Capacity ${toNum(vendor.max_guests)} guests.`);
  if (details.ac_available) bits.push('AC.');
  if (details.generator_backup) bits.push('Generator backup.');
  if (toNum(details.parking_slots) > 0) bits.push(`Parking: ${toNum(details.parking_slots)} cars.`);
  if (details.prayer_room) bits.push('Prayer room.');
  if (details.bridal_room) bits.push('Bridal room.');
  return bits.join(' ');
}

function religionMatch(vendor, religion) {
  if (!religion) return true;
  const vendorReligion = normalizeLower(vendor.religion_served);
  const targetReligion = normalizeLower(religion);
  return vendorReligion === 'all' || vendorReligion === targetReligion;
}

function classMatch(vendor, classPreference) {
  if (!classPreference) return true;
  return normalizeLower(vendor.class_type) === normalizeClassPreference(classPreference);
}

function inGuestRange(vendor, numGuests, category = '') {
  const guests = toNum(numGuests);
  if (!guests) return true;
  const categoryNorm = normalizeLower(category);

  // Tent capacity is frequently under-reported in source data; avoid hard-blocking.
  if (categoryNorm.includes('tent') || categoryNorm.includes('shamiana')) {
    return true;
  }

  const maxGuests = toNum(vendor.max_guests);
  const capacity = toNum(vendor.capacity);
  const max = Math.max(maxGuests, capacity);
  const min = toNum(vendor.min_guests);

  // If max capacity is 0 or unrealistically low (e.g. < 5) for a venue,
  // we treat it as "unspecified" and allow it rather than blocking it,
  // especially if the user has 2000 guests.
  if (max === 0 || max < 5) return true;

  return max >= guests && min <= guests;
}

function inBudget(vendor, budget) {
  const b = toNum(budget);
  if (!b) return true;
  return toNum(vendor.base_price) <= b;
}

async function withCityExpansion(candidates, city, radiusKm = 30) {
  const requested = normalizeText(city);
  const requestedNorm = normalizeLower(city);
  if (!requestedNorm) {
    return {
      vendors: candidates,
      locationContext: {
        requestedPlace: requested,
        strategy: 'none',
        nearestCity: null,
        note: '',
      },
    };
  }

  const exact = candidates.filter((v) => normalizeLower(v.city) === requestedNorm);
  if (exact.length > 0) {
    return {
      vendors: exact,
      locationContext: {
        requestedPlace: requested,
        strategy: 'exact',
        nearestCity: toTitleCase(requested),
        note: '',
      },
    };
  }

  const partial = candidates.filter((v) => {
    const vc = normalizeLower(v.city);
    const va = normalizeLower(v.area);
    return vc.includes(requestedNorm) || requestedNorm.includes(vc) || va.includes(requestedNorm);
  });
  if (partial.length > 0) {
    const nearestCity = toTitleCase(partial[0].city || requested);
    return {
      vendors: partial,
      locationContext: {
        requestedPlace: requested,
        strategy: 'partial',
        nearestCity,
        note: `We couldn't find exact matches in ${requested} with the current filters, but here are nearby vendors in ${nearestCity} that can travel to your location:`,
      },
    };
  }

  // Coordinate-based radius search
  const from = await cityCoordsFromName(city);
  if (from) {
    const nearbyMatches = [];
    for (const v of candidates) {
      const to = vendorCoordinates(v) || await cityCoordsFromName([v.area, v.city].filter(Boolean).join(', '));
      if (!to) continue;
      const d = haversineKm(from, to);
      if (d <= radiusKm && vendorCanTravelToRequested(v, requested, v.city, d)) {
        nearbyMatches.push({ ...v, distance_km: d });
      }
    }

    if (nearbyMatches.length > 0) {
      nearbyMatches.sort((a, b) => a.distance_km - b.distance_km);
      const nearestCity = toTitleCase(nearbyMatches[0].city || requested);
      return {
        vendors: nearbyMatches,
        locationContext: {
          requestedPlace: requested,
          strategy: 'radius',
          nearestCity,
          note: `We found venues within ${radiusKm} km of ${requested}:`,
        },
      };
    }
  }

  const nearbyCities = NORMALIZED_NEARBY[requestedNorm]
    || (requestedNorm.includes('village') ? NORMALIZED_NEARBY.villages : []);

  const nearbyMatchesByName = candidates
    .filter((v) => nearbyCities.includes(normalizeLower(v.city)))
    .filter((v) => vendorCanTravelToRequested(v, requested, v.city));

  if (nearbyMatchesByName.length > 0) {
    const nearestCity = toTitleCase(nearbyMatchesByName[0].city || requested);
    return {
      vendors: nearbyMatchesByName,
      locationContext: {
        requestedPlace: requested,
        strategy: 'nearby',
        nearestCity,
        note: `We couldn't find exact matches in ${requested} with the current filters, but here are nearby vendors in ${nearestCity} that can travel to your location:`,
      },
    };
  }

  // Nothing matched — return empty list with clear note
  return {
    vendors: [],
    locationContext: {
      requestedPlace: requested,
      strategy: 'none',
      nearestCity: null,
      note: `We couldn't find matching function halls in ${requested} with the current filters.`,
    },
  };
}

function withStrictCityFilter(candidates, city) {
  const requested = normalizeText(city);
  const requestedNorm = normalizeLower(city);
  if (!requestedNorm) {
    return {
      vendors: candidates,
      locationContext: {
        requestedPlace: requested,
        strategy: 'none',
        nearestCity: null,
        note: '',
      },
    };
  }

  const exact = candidates.filter((v) => normalizeLower(v.city) === requestedNorm);
  if (exact.length > 0) {
    return {
      vendors: exact,
      locationContext: {
        requestedPlace: requested,
        strategy: 'exact',
        nearestCity: toTitleCase(requested),
        note: '',
      },
    };
  }

  return {
    vendors: [],
    locationContext: {
      requestedPlace: requested,
      strategy: 'none',
      nearestCity: null,
      note: `We couldn't find matching function halls in ${requested} with the current filters. Please change the location or type a different area/city manually.`,
    },
  };
}

function applyReligionSpecificLogic(vendor, religion, details) {
  const r = normalizeLower(religion);
  const vendorName = normalizeLower(vendor.vendor_name || '');
  const vendorCategory = normalizeLower(vendor.category || '');

  // CRITICAL: Block venues that are religion-incompatible by NAME or CATEGORY
  const blocklist = VENUE_NAME_BLOCKLIST_BY_RELIGION[r] || [];
  for (const blocked of blocklist) {
    if (vendorName.includes(blocked) || vendorCategory.includes(blocked)) {
      return { skip: true, preferenceScore: 0 };
    }
  }

  // Extra block for Christian/Muslim: exclude venues with specifically Hindu-associated names
  // But ALLOW if the vendor explicitly supports Christian/Muslim events or has religion_served = 'all'
  if (r === 'christian' || r === 'muslim') {
    const isExplicitlySupported = (vendor.religion_served === 'all' || vendor.religion_served === r);
    const hasReligiousEvents = Array.isArray(vendor.supported_events) && vendor.supported_events.some(ev => {
      const e = normalizeLower(ev);
      return e.includes('church') || e.includes('nikah') || e.includes('walima') || e.includes('baptism') || e.includes('christening');
    });

    if (!isExplicitlySupported && !hasReligiousEvents) {
      if (vendorName.includes('kakatiya') || vendorName.includes('satavahana')) {
        return { skip: true, preferenceScore: 0 };
      }
    }
  }

  const allowedVenueTypes = VENUE_CATEGORY_NAMES_BY_RELIGION[r];
  if (Array.isArray(allowedVenueTypes) && allowedVenueTypes.length > 0) {
    const hasAllowedType = allowedVenueTypes.some((name) => vendorName.includes(name) || vendorCategory.includes(name));
    if (!hasAllowedType) {
      return { skip: true, preferenceScore: 0 };
    }
  }

  // Muslim-specific blocks
  if (r === 'muslim') {
    if (details.veg_only_kitchen === true) return { skip: true, preferenceScore: 0 };
    // Additional block: if vendor name contains kalyana/mandapam
    if (/kalyana|mandapam|vedika/i.test(vendor.vendor_name || '')) {
      return { skip: true, preferenceScore: 0 };
    }
  }

  if (r === 'jain') {
    // Relaxed Jain check: if veg_only_kitchen is not explicitly false, allow it.
    if (details.veg_only_kitchen === false) {
      return { skip: true, preferenceScore: 0 };
    }
  }

  let preferenceScore = 0;
  const vendorReligion = normalizeLower(vendor.religion_served);
  if (vendorReligion === r) preferenceScore += 4;
  if (vendorReligion === 'all') preferenceScore += 1;

  // Keyword-based preference scoring
  if (r === 'muslim') {
    if (/masjid|madina|mecca|noor|islamic|halal/i.test(vendorName)) preferenceScore += 3;
    if (details.prayer_room === true) preferenceScore += 3;
    if (details.halal_kitchen === true) preferenceScore += 2;
    if (details.separate_entry === true) preferenceScore += 1;
    
    // Bonus for explicit support in supported_events
    const supported = vendor.supported_events;
    if (supported === 'all') {
      preferenceScore += 1;
    } else if (Array.isArray(supported)) {
      const muslimEvents = ['nikah', 'walima', 'aqiqah', 'bismillah', 'eid', 'iftar'];
      if (supported.some(ev => muslimEvents.includes(normalizeLower(ev)))) {
        preferenceScore += 2;
      }
    }
  }
  if (r === 'christian') {
    if (/church|parish|chapel|st\.|mary|joseph|grace|calvary/i.test(vendorName)) preferenceScore += 3;
    if (details.cross_display_allowed === true) preferenceScore += 2;
    if (details.outdoor_garden === true) preferenceScore += 1;

    // Bonus for explicit support in supported_events
    const supported = vendor.supported_events;
    if (supported === 'all') {
      preferenceScore += 1;
    } else if (Array.isArray(supported)) {
      const christianEvents = ['church wedding', 'baptism', 'christening', 'first communion', 'easter', 'christmas'];
      if (supported.some(ev => christianEvents.includes(normalizeLower(ev)))) {
        preferenceScore += 2;
      }
    }
  }
  if (r === 'hindu') {
    if (/kalyana|mandapam|vedika|temple|lord|shiva|vishnu|ganesha/i.test(vendorName)) preferenceScore += 2;
    if (details.pooja_room === true) preferenceScore += 2;
    if (details.mandap_space === true) preferenceScore += 1;
  }
  if (r === 'jain' && details.veg_only_kitchen === true) preferenceScore += 3;

  return { skip: false, preferenceScore };
}

function buildReligionVenueContext(religion, venues = []) {
  const r = normalizeLower(religion);
  if (!r || r === 'all') {
    return {
      religion: r || 'all',
      suitableVenueTypes: [],
      note: '',
    };
  }

  const allowedVenueTypes = VENUE_CATEGORY_NAMES_BY_RELIGION[r] || [];
  const matchedTypes = new Set();
  for (const venue of venues) {
    const vendorName = normalizeLower(venue.vendor_name || '');
    const vendorCategory = normalizeLower(venue.category || '');
    for (const allowed of allowedVenueTypes) {
      if (vendorName.includes(allowed) || vendorCategory.includes(allowed)) {
        matchedTypes.add(allowed);
      }
    }
  }

  const suitableVenueTypes = Array.from(matchedTypes);
  const ceremonyLabelByReligion = {
    muslim: 'Nikah/Walima ceremony',
    christian: 'Christian wedding ceremony',
    hindu: 'Hindu wedding ceremony',
    jain: 'Jain wedding ceremony',
  };
  const ceremonyLabel = ceremonyLabelByReligion[r] || `${toTitleCase(r)} ceremony`;
  const note = suitableVenueTypes.length > 0
    ? `These are ${suitableVenueTypes.join(', ')} venues, appropriate for a ${ceremonyLabel}.`
    : `These venues are filtered for ${ceremonyLabel} requirements.`;

  return {
    religion: r,
    suitableVenueTypes,
    note,
  };
}

async function findByCategory({
  category,
  city,
  religion,
  numGuests,
  budget,
  allowBudgetExceedPercent = 0.2,
  classPreference,
  eventDate,
  timeSlot,
  limit,
  strictCity = false,
  allowNearby = false,
  radiusKm = 30,
}) {
  const [{ vendors }, { slotsByVendorDate }] = await Promise.all([
    getVendorsDataset({ forceRefresh: true }),
    getAvailabilityDataset(),
  ]);

  const dbCategory = getDbCategory(category);
  const targetCatNorm = normalizeLower(dbCategory);

  const baseCategory = vendors.filter((v) => {
    const vCat = normalizeLower(v.category);
    const vName = normalizeLower(v.vendor_name);

    // Virtual category check for Church / Parish Hall
    if (normalizeLower(category) === 'church / parish hall') {
      return vCat === 'function hall' && (vName.includes('church') || vName.includes('parish') || vName.includes('chapel') || vName.includes('grace'));
    }

    const dbCategory = getDbCategory(category);
    const targetCatNorm = normalizeLower(dbCategory);
    // Flexible match: exact or contains
    return vCat === targetCatNorm || vCat.includes(targetCatNorm) || targetCatNorm.includes(vCat);
  });

  const budgetNum = toNum(budget);
  const budgetCap = budgetNum > 0
    ? budgetNum * (1 + Math.max(0, toNum(allowBudgetExceedPercent, 0.2)))
    : Number.POSITIVE_INFINITY;

  const baseFiltered = baseCategory.filter(
    (v) => inGuestRange(v, numGuests, category)
      && religionMatch(v, religion),
  );

  // Prefer in-budget venues, but if none exist, keep over-budget candidates
  // so users still see real options instead of a misleading "no venues" state.
  let filtered = baseFiltered.filter((v) => toNum(v.base_price) <= budgetCap);
  if (filtered.length === 0) {
    filtered = baseFiltered;
  }

  const cityExpansion = normalizeText(category) === 'Function Hall'
    ? (strictCity
        ? withStrictCityFilter(filtered, city)
        : (allowNearby ? await withCityExpansion(filtered, city, radiusKm) : withStrictCityFilter(filtered, city)))
    : { vendors: filtered, locationContext: { requestedPlace: normalizeText(city), strategy: 'none', nearestCity: null, note: '' } };
  filtered = cityExpansion.vendors;

  const requestedPlace = cityExpansion.locationContext?.requestedPlace || city;

  const enriched = [];
  for (const vendor of filtered) {
    const details = parseCategoryDetails(vendor.category_details);
    const religionLogic = applyReligionSpecificLogic(vendor, religion, details);
    if (religionLogic.skip) {
      // console.log(`Skipping ${vendor.vendor_name} for religion ${religion}`);
      continue;
    }
    const preferenceScore = religionLogic.preferenceScore || 0;

    const slot = checkSlot(
      slotsByVendorDate,
      vendor.vendor_id,
      eventDate,
      timeSlot,
    );

    const estimatedCost = calculateFinalPrice(
      vendor.base_price,
      slot.price_multiplier,
      numGuests,
      normalizeText(category) || 'Function Hall',
    );
    const distanceInfo = await enrichDistanceAndAddress(vendor, requestedPlace);
    if (!vendorCanTravelToRequested(vendor, requestedPlace, vendor.city, distanceInfo.distance_km)) continue;

    enriched.push({
      vendor_id: vendor.vendor_id,
      vendor_name: vendor.vendor_name,
      category: vendor.category,
      city: vendor.city,
      area: vendor.area,
      rating: toNum(vendor.rating),
      base_price: toNum(vendor.base_price),
      estimated_cost: estimatedCost,
      preferenceScore: preferenceScore,
      price_multiplier: toNum(slot.price_multiplier, 1),
      rating: toNum(vendor.rating),
      class_type: vendor.class_type,
      availability_status: slot.available ? 'available' : 'unavailable',
      distance_km: distanceInfo.distance_km,
      distance_label: distanceInfo.distance_label,
      full_address: distanceInfo.full_address,
      reason: buildReason(vendor, details),
      vendor_phone: vendor.vendor_phone || '',
      cancellation_policy: vendor.cancellation_policy || '',
      advance_payment_pct: toNum(vendor.advance_payment_pct),
      category_details: details,
      _classMatch: classMatch(vendor, classPreference) ? 1 : 0,
      _preferenceScore: religionLogic.preferenceScore,
      _costGap: Math.abs(estimatedCost - budgetNum),
    });
  }

  enriched.sort((a, b) => {
    if (b._classMatch !== a._classMatch) return b._classMatch - a._classMatch;
    if (b._preferenceScore !== a._preferenceScore) return b._preferenceScore - a._preferenceScore;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a._costGap - b._costGap;
  });

  return {
    rows: enriched.slice(0, limit).map(({ _classMatch, _preferenceScore, _costGap, ...row }) => row),
    locationContext: cityExpansion.locationContext,
  };
}

function isChristianPreferredVenueFlow(religion, eventType) {
  const r = normalizeLower(religion);
  if (r !== 'christian') return false;
  const ev = normalizeLower(eventType);
  return (
    !ev ||
    ev.includes('wedding') ||
    ev.includes('church wedding') ||
    ev.includes('christening') ||
    ev.includes('baptism') ||
    ev.includes('first communion') ||
    ev.includes('easter') ||
    ev.includes('carol')
  );
}

function isExplicitChurchPreference(venuePreference) {
  const preference = normalizeLower(venuePreference);
  return preference === 'church' || preference === 'church / parish hall';
}

export async function findVenuesWithContext({
  city,
  religion,
  eventType,
  venuePreference,
  numGuests,
  budget,
  classPreference,
  eventDate,
  timeSlot,
  limit = 3,
  strictCity = true,
  allowNearby = false,
  radiusKm = 30,
}) {
  const normalizedPreference = String(venuePreference || '').toLowerCase().trim();
  const preferredCategories = isExplicitChurchPreference(normalizedPreference)
    ? ['Church / Parish Hall']
    : isChristianPreferredVenueFlow(religion, eventType)
      ? ['Church / Parish Hall', 'Function Hall']
    : normalizedPreference === 'function_hall'
      ? ['Function Hall']
      : ['Function Hall'];

  let result = { rows: [], locationContext: { requestedPlace: normalizeText(city), strategy: 'none', nearestCity: null, note: '' } };
  for (const category of preferredCategories) {
    result = await findByCategory({
      category,
      city,
      religion,
      numGuests,
      budget,
      classPreference,
      eventDate,
      timeSlot,
      limit,
      strictCity,
      allowNearby,
      radiusKm,
    });
    if (result.rows.length > 0) break;
  }

  const religionContext = buildReligionVenueContext(religion, result.rows);

  return {
    venues: result.rows,
    locationContext: {
      ...result.locationContext,
      religionNote: religionContext.note,
    },
    religionContext,
  };
}

export async function findVenues({
  city,
  religion,
  venuePreference,
  numGuests,
  budget,
  classPreference,
  eventDate,
  timeSlot,
  limit = 3,
}) {
  const result = await findVenuesWithContext({
    city,
    religion,
    venuePreference,
    numGuests,
    budget,
    classPreference,
    eventDate,
    timeSlot,
    limit,
  });
  return result.venues;
}

export async function findTents({
  city,
  numGuests,
  budget,
  classPreference,
  eventDate,
  timeSlot,
}) {
  const result = await findByCategory({
    category: 'Tent / Shamiana',
    city,
    religion: null,
    numGuests,
    budget,
    classPreference,
    eventDate,
    timeSlot,
    limit: 2,
  });
  return result.rows;
}

export default {
  findVenues,
  findVenuesWithContext,
  findTents,
};
