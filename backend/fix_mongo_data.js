import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.js';
import { buildMakeupEventPricing, normalizeVendorBasePrice } from './utils/vendorPricing.js';
import { VendorProfile } from './models/VendorProfile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

function normalizeCategoryName(category = '', businessType = '') {
  const text = String(category || businessType || '').toLowerCase();
  if (/vide|video/.test(text)) return 'Videographer';
  if (/photo/.test(text)) return 'Photographer';
  if (/decor|decora/.test(text)) return 'Decoration';
  if (/function hall|venue|mandap|hall/.test(text)) return 'Function Hall';
  if (/cater/.test(text)) return 'Catering';
  if (/dj|band|nadaswaram/.test(text)) return 'DJ / Music';
  if (/tent|shamiana|furniture/.test(text)) return 'Tent / Shamiana';
  if (/makeup|beauty/.test(text)) return 'Makeup Artist';
  if (/priest|pandit|maulvi|qazi|pastor|father/.test(text)) return 'Religious Officiant';
  return String(category || businessType || '').trim();
}

function normalizeBusinessType(category = '') {
  const text = String(category || '').toLowerCase();
  if (/function hall|venue|mandap|hall/.test(text)) return 'Venue';
  if (/cater/.test(text)) return 'Catering';
  if (/decor|decora/.test(text)) return 'Decoration';
  if (/photo/.test(text)) return 'Photography';
  if (/vide|video/.test(text)) return 'Photography';
  if (/dj|band|nadaswaram/.test(text)) return 'DJ_Music';
  if (/tent|shamiana|furniture/.test(text)) return 'Tent_Furniture';
  if (/makeup|beauty/.test(text)) return 'Other';
  if (/priest|pandit|maulvi|qazi|pastor|father/.test(text)) return 'Priest_Pandit';
  return 'Other';
}

function normalizeMenuPackages(menu = {}) {
  const out = { ...menu };
  const parsePackage = (value) => {
    if (value && typeof value === 'object') return { ...value };
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  };

  out.basic_package = {
    ...parsePackage(out.basic_package),
    per_plate: normalizeVendorBasePrice(parsePackage(out.basic_package).per_plate || 0, 'basic package'),
  };
  out.standard_package = {
    ...parsePackage(out.standard_package),
    per_plate: normalizeVendorBasePrice(parsePackage(out.standard_package).per_plate || 0, 'standard package'),
  };
  out.premium_package = {
    ...parsePackage(out.premium_package),
    per_plate: normalizeVendorBasePrice(parsePackage(out.premium_package).per_plate || 0, 'premium package'),
  };
  return out;
}

async function fixMongoData() {
  const mongoUri = process.env.MONGODB_URI || config.mongodb.uri;
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const vendorsCollection = db.collection('vendors_dataset');
  const menusCollection = db.collection('menus_dataset');

  console.log('--- Starting MongoDB Data Fixes ---');

  // 1. Fix religion_served based on keywords in name
  const religionFixes = [
    { regex: /masjid|madina|mecca|noor|islamic|halal/i, religion: 'muslim' },
    { regex: /church|parish|chapel|st\.|mary|joseph|grace|calvary/i, religion: 'christian' },
    { regex: /kalyana|mandapam|vedika|temple|lord|shiva|vishnu|ganesha/i, religion: 'hindu' },
  ];

  for (const fix of religionFixes) {
    const result = await vendorsCollection.updateMany(
      { 
        vendor_name: fix.regex,
        religion_served: { $in: ['all', '', null] }
      },
      { $set: { religion_served: fix.religion } }
    );
    console.log(`Updated ${result.modifiedCount} vendors to religion: ${fix.religion}`);
  }

  // 2. Normalize stored vendor profiles directly in MongoDB.
  const profiles = await VendorProfile.find({}).select('_id category businessType basePrice menuCard businessName vendorDatasetId').lean();
  let profileUpdates = 0;
  for (const profile of profiles) {
    const normalizedCategory = normalizeCategoryName(profile.category, profile.businessType);
    const normalizedBusinessType = normalizeBusinessType(normalizedCategory || profile.category || profile.businessType);
    const normalizedBasePrice = normalizeVendorBasePrice(profile.basePrice || 0, normalizedCategory || profile.businessType || '');
    const normalizedMenuCard = normalizeMenuPackages(profile.menuCard || null);
    const normalizedEventPricing = normalizedCategory === 'Makeup Artist'
      ? buildMakeupEventPricing(normalizedBasePrice || profile.basePrice || 0)
      : null;

    const patch = {};
    if (normalizedCategory && normalizedCategory !== profile.category) patch.category = normalizedCategory;
    if (normalizedBusinessType && normalizedBusinessType !== profile.businessType) patch.businessType = normalizedBusinessType;
    if (normalizedBasePrice !== Number(profile.basePrice || 0)) patch.basePrice = normalizedBasePrice;
    if (normalizedMenuCard && JSON.stringify(normalizedMenuCard) !== JSON.stringify(profile.menuCard || null)) patch.menuCard = normalizedMenuCard;
    if (normalizedEventPricing && JSON.stringify(normalizedEventPricing) !== JSON.stringify(profile.eventPricing || {})) patch.eventPricing = normalizedEventPricing;

    if (Object.keys(patch).length) {
      await VendorProfile.updateOne({ _id: profile._id }, { $set: patch });
      profileUpdates += 1;
    }
  }
  console.log(`Updated ${profileUpdates} vendor profile documents.`);

  // 3. Normalize the raw vendors dataset collection.
  const vendors = await vendorsCollection.find({}).toArray();
  let vendorUpdates = 0;
  for (const vendor of vendors) {
    const normalizedCategory = normalizeCategoryName(vendor.category, vendor.businessType);
    const normalizedBasePrice = normalizeVendorBasePrice(vendor.base_price || 0, normalizedCategory || vendor.category || '');
    const patch = {};
    if (normalizedCategory && normalizedCategory !== vendor.category) patch.category = normalizedCategory;
    if (normalizedBasePrice !== Number(vendor.base_price || 0)) patch.base_price = normalizedBasePrice;
    if (Object.keys(patch).length) {
      await vendorsCollection.updateOne({ _id: vendor._id }, { $set: patch });
      vendorUpdates += 1;
    }
  }
  console.log(`Updated ${vendorUpdates} vendors_dataset documents.`);

  // 4. Normalize the menus dataset collection, including package prices.
  const menus = await menusCollection.find({}).toArray();
  let menuUpdates = 0;
  for (const menu of menus) {
    const normalizedCategory = normalizeCategoryName(menu.category, menu.cuisine_type);
    const normalizedPerPlate = normalizeVendorBasePrice(menu.per_plate_base || 0, normalizedCategory || menu.category || '');
    const patch = {};
    if (normalizedCategory && normalizedCategory !== menu.category) patch.category = normalizedCategory;
    if (String(menu.per_plate_base || '') !== String(normalizedPerPlate || '')) patch.per_plate_base = normalizedPerPlate;

    const normalizedMenu = normalizeMenuPackages(menu);
    const currentBasic = typeof menu.basic_package === 'string' ? (() => { try { return JSON.parse(menu.basic_package); } catch { return null; } })() : menu.basic_package;
    const currentStandard = typeof menu.standard_package === 'string' ? (() => { try { return JSON.parse(menu.standard_package); } catch { return null; } })() : menu.standard_package;
    const currentPremium = typeof menu.premium_package === 'string' ? (() => { try { return JSON.parse(menu.premium_package); } catch { return null; } })() : menu.premium_package;
    if (JSON.stringify(normalizedMenu.basic_package || null) !== JSON.stringify(currentBasic || null)) patch.basic_package = normalizedMenu.basic_package;
    if (JSON.stringify(normalizedMenu.standard_package || null) !== JSON.stringify(currentStandard || null)) patch.standard_package = normalizedMenu.standard_package;
    if (JSON.stringify(normalizedMenu.premium_package || null) !== JSON.stringify(currentPremium || null)) patch.premium_package = normalizedMenu.premium_package;

    if (Object.keys(patch).length) {
      await menusCollection.updateOne({ _id: menu._id }, { $set: patch });
      menuUpdates += 1;
    }
  }
  console.log(`Updated ${menuUpdates} menus_dataset documents.`);

  console.log('--- MongoDB Data Fixes Completed ---');
  await mongoose.disconnect();
}

fixMongoData().catch(console.error);
