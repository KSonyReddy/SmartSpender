import mongoose from 'mongoose';
import { readDatasetFromMongo } from './dbDatasetStore.js';
import { normalizeVendorBasePrice } from '../utils/vendorPricing.js';

let cache = null;

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v || '').trim().toLowerCase();
  if (!s) return false;
  return s === 'true' || s === '1' || s === 'yes';
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function toMaybeNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseSupportedEvents(raw) {
  if (Array.isArray(raw)) return raw;
  const s = String(raw || '').trim();
  if (!s || s.toLowerCase() === 'none') return [];
  if (s.toLowerCase() === 'all' || s.toLowerCase() === 'all_events') return 'all';
  // CSV uses JSON-like arrays: ["Wedding", "Reception", ...]
  try {
    if (s.startsWith('[')) return JSON.parse(s);
  } catch (e) {
    // fall through
  }
  return [];
}

function safeJsonParse(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}


export async function getVendorsDataset(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  if (cache && !forceRefresh) return cache;

  const mongoConnected = mongoose.connection.readyState === 1 && Boolean(mongoose.connection.db);
  if (!mongoConnected) {
    throw new Error('MongoDB is not connected. vendors_dataset is configured as Mongo-only.');
  }
  const records = await readDatasetFromMongo('vendors_dataset');
  if (!records) {
    throw new Error('vendors_dataset not found or empty in MongoDB. Import dataset to MongoDB and retry.');
  }

  const vendors = records.map((r) => {
    const supportedEvents = parseSupportedEvents(r.supported_events);
    return {
      vendor_id: String(r.vendor_id),
      vendor_name: String(r.vendor_name || ''),
      category: String(r.category || ''),
      city: String(r.city || ''),
      area: String(r.area || ''),
      latitude: toMaybeNum(r.latitude ?? r.lat),
      longitude: toMaybeNum(r.longitude ?? r.lon ?? r.lng),
      capacity: toNum(r.capacity),
      capacity_unit: String(r.capacity_unit || ''),
      base_price: normalizeVendorBasePrice(r.base_price, r.category),
      class_type: String(r.class_type || ''),
      specialization: String(r.specialization || ''),
      religion_served: String(r.religion_served || '').trim() || 'all',
      supported_events: supportedEvents,
      rating: toNum(r.rating),
      is_veg_only: toBool(r.is_veg_only),
      is_halal: toBool(r.is_halal),
      outdoor_available: toBool(r.outdoor_available),
      parking_capacity: toNum(r.parking_capacity),
      min_guests: toNum(r.min_guests),
      max_guests: toNum(r.max_guests),
      setup_time_hours: toNum(r.setup_time_hours),
      languages_spoken: safeJsonParse(r.languages_spoken) || [],
      payment_modes: safeJsonParse(r.payment_modes) || [],
      experience_years: toNum(r.experience_years),
      vendor_phone: String(r.vendor_phone || ''),
      advance_payment_pct: toNum(r.advance_payment_pct),
      free_cancel_before_days: toNum(r.free_cancel_before_days),
      last_minute_slots: toNum(r.last_minute_slots),
      cancellation_policy: String(r.cancellation_policy || ''),
      travel_radius: safeJsonParse(r.travel_radius) || String(r.travel_radius || '').trim(),
      category_details: safeJsonParse(r.category_details) || {},
    };
  });

  const vendorsById = new Map();
  const vendorsByEventType = new Map();
  const universalVendors = [];
  const supportedEventTypes = new Set();

  for (const v of vendors) {
    vendorsById.set(v.vendor_id, v);

    if (v.supported_events === 'all') {
      universalVendors.push(v);
      continue;
    }

    for (const ev of v.supported_events || []) {
      const key = String(ev);
      supportedEventTypes.add(key);
      if (!vendorsByEventType.has(key)) vendorsByEventType.set(key, []);
      vendorsByEventType.get(key).push(v);
    }
  }

  cache = {
    vendors,
    vendorsById,
    vendorsByEventType,
    universalVendors,
    supportedEventTypes: Array.from(supportedEventTypes),
  };

  console.log(`✅ Loaded ${vendors.length} vendors from MongoDB`);
  return cache;
}

export default getVendorsDataset;

