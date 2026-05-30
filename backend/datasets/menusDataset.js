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

function toNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonParse(raw, fallback) {
  if (raw && typeof raw === 'object') return raw;
  const s = String(raw || '').trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function normalizePackage(name, pkg) {
  const p = pkg && typeof pkg === 'object' ? pkg : {};
  return {
    name,
    per_plate: toNum(p.per_plate, 0),
    items: Array.isArray(p.items) ? p.items : [],
    description: String(p.description || '').trim(),
  };
}

export async function getMenusDataset() {
  if (cache) return cache;

  const mongoConnected = mongoose.connection.readyState === 1 && Boolean(mongoose.connection.db);
  if (!mongoConnected) {
    throw new Error('MongoDB is not connected. menus_dataset is configured as Mongo-only.');
  }

  let records = await readDatasetFromMongo('menus_dataset');
  if (!records) {
    throw new Error('menus_dataset not found or empty in MongoDB. Import dataset to MongoDB and retry.');
  }

  const menusByVendorId = new Map();

  for (const r of records) {
    const vendorId = String(r.vendor_id || r.vendorId || '').trim();
    if (!vendorId) continue;

    const menu = {
      vendor_id: vendorId,
      per_plate_base: normalizeVendorBasePrice(r.per_plate_base, r.cuisine_type || r.category || ''),
      price_factor: toNum(r.price_factor, 1),
      is_veg_only: toBool(r.is_veg_only),
      is_halal: toBool(r.is_halal),
      total_items: toNum(r.total_items),
      item_prices: safeJsonParse(r.item_prices, {}),
      basic_package: safeJsonParse(r.basic_package, {}),
      standard_package: safeJsonParse(r.standard_package, {}),
      premium_package: safeJsonParse(r.premium_package, {}),
      min_order_guests: toNum(r.min_order_guests),
      max_order_guests: toNum(r.max_order_guests),
      tasting_available: toBool(r.tasting_available),
      home_delivery: toBool(r.home_delivery),
      home_delivery_min_plates: toNum(r.home_delivery_min_plates),
      advance_order_days: toNum(r.advance_order_days),
      cuisine_type: String(r.cuisine_type || '').trim(),
      suitable_for_religions: String(r.suitable_for_religions || '').trim(),
    };

    menusByVendorId.set(vendorId, menu);
  }

  cache = { menusByVendorId };
  console.log(`✅ Loaded ${menusByVendorId.size} menus from MongoDB`);
  return cache;
}

export function selectPackage(menu, per_plate_budget) {
  const budget = toNum(per_plate_budget);
  const premium = normalizePackage('premium_package', menu?.premium_package);
  const standard = normalizePackage('standard_package', menu?.standard_package);
  const basic = normalizePackage('basic_package', menu?.basic_package);

  premium.per_plate = normalizeVendorBasePrice(premium.per_plate, 'premium package');
  standard.per_plate = normalizeVendorBasePrice(standard.per_plate, 'standard package');
  basic.per_plate = normalizeVendorBasePrice(basic.per_plate, 'basic package');

  if (budget >= premium.per_plate) return premium;
  if (budget >= standard.per_plate) return standard;
  return basic;
}

export default getMenusDataset;
