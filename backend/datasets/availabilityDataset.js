import mongoose from 'mongoose';
import { readDatasetFromMongo } from './dbDatasetStore.js';

let cache = null;

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v || '').trim().toLowerCase();
  if (!s) return false;
  return s === 'true' || s === '1' || s === 'yes';
}

function toNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function toKey(vendor_id, date) {
  return `${String(vendor_id || '').trim()}__${String(date || '').trim()}`;
}

function parseTimeSlot(time_slot) {
  const parts = String(time_slot || '')
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length !== 2) return null;
  return { start: parts[0], end: parts[1] };
}

function isAvailableStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'available' || s === 'open' || s === 'free' || s === 'true' || s === '1';
}

function roundToNearest100(value) {
  return Math.round(toNum(value) / 100) * 100;
}

export async function getAvailabilityDataset() {
  if (cache) return cache;

  const mongoConnected = mongoose.connection.readyState === 1 && Boolean(mongoose.connection.db);
  if (!mongoConnected) {
    throw new Error('MongoDB is not connected. availability_dataset is configured as Mongo-only.');
  }

  let records = await readDatasetFromMongo('availability_dataset');
  if (!records) {
    throw new Error('availability_dataset not found or empty in MongoDB. Import dataset to MongoDB and retry.');
  }

  const slotsByVendorDate = new Map();

  for (const r of records) {
    const key = toKey(r.vendor_id, r.date);
    if (!key || key === '__') continue;

    const slot = {
      start_time: String(r.start_time || '').trim(),
      end_time: String(r.end_time || '').trim(),
      status: String(r.status || '').trim(),
      price_multiplier: toNum(r.price_multiplier, 1),
      is_wedding_season: toBool(r.is_wedding_season),
      is_weekend: toBool(r.is_weekend),
      day_of_week: String(r.day_of_week || '').trim(),
    };

    if (!slotsByVendorDate.has(key)) slotsByVendorDate.set(key, []);
    slotsByVendorDate.get(key).push(slot);
  }

  cache = { slotsByVendorDate };
  console.log(`✅ Loaded availability slots for ${slotsByVendorDate.size} vendor-date keys from MongoDB`);
  return cache;
}

export function checkSlot(slotsByVendorDate, vendor_id, date, time_slot) {
  const parsed = parseTimeSlot(time_slot);
  if (!parsed) {
    return { available: true, price_multiplier: 1.0, is_wedding_season: false };
  }

  const key = toKey(vendor_id, date);
  const slots = slotsByVendorDate.get(key) || [];

  const matched = slots.find(
    (slot) => String(slot.start_time).trim() === parsed.start && String(slot.end_time).trim() === parsed.end,
  );

  if (!matched) {
    return { available: true, price_multiplier: 1.0, is_wedding_season: false };
  }

  return {
    available: isAvailableStatus(matched.status),
    price_multiplier: toNum(matched.price_multiplier, 1.0),
    is_wedding_season: toBool(matched.is_wedding_season),
  };
}

export function calculateFinalPrice(base_price, price_multiplier, num_guests, category) {
  const flatFeeCategories = new Set([
    'Priest / Pandit',
    'Maulvi / Qazi',
    'Pastor / Father',
    'Band / Nadaswaram',
  ]);

  if (flatFeeCategories.has(String(category || '').trim())) {
    return toNum(base_price);
  }

  const base = toNum(base_price);
  const multiplier = toNum(price_multiplier, 1);

  if (String(category || '').trim() === 'Catering') {
    const guests = toNum(num_guests);
    return roundToNearest100(base * multiplier * guests);
  }

  return roundToNearest100(base * multiplier);
}

export default getAvailabilityDataset;
