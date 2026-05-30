import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';
import { User } from '../models/User.js';
import { VendorProfile } from '../models/VendorProfile.js';
import { normalizeVendorBasePrice } from './vendorPricing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function normalizeString(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const s = normalizeString(value).toLowerCase();
  if (!s) return fallback;
  return s === 'true' || s === '1' || s === 'yes';
}

function parseJsonArray(raw) {
  const s = normalizeString(raw);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function mapBusinessType(category) {
  const c = normalizeString(category).toLowerCase();
  if (c.includes('function hall') || c.includes('venue')) return 'Venue';
  if (c.includes('catering')) return 'Catering';
  if (c.includes('decor')) return 'Decoration';
  if (c.includes('photo')) return 'Photography';
  if (c.includes('video')) return 'Photography';
  if (c.includes('dj') || c.includes('band') || c.includes('nadaswaram')) return 'DJ_Music';
  if (c.includes('priest') || c.includes('pandit') || c.includes('maulvi') || c.includes('qazi') || c.includes('pastor') || c.includes('father')) {
    return 'Priest_Pandit';
  }
  if (c.includes('tent') || c.includes('shamiana') || c.includes('furniture')) return 'Tent_Furniture';
  if (c.includes('transport')) return 'Transportation';
  if (c.includes('invitation') || c.includes('cards')) return 'Invitation_Cards';
  return 'Other';
}

function mapReligion(religion) {
  const r = normalizeString(religion).toLowerCase();
  if (!r || r === 'all' || r === 'any') return 'All';
  if (r.includes('hindu')) return 'Hindu';
  if (r.includes('muslim') || r.includes('islam')) return 'Muslim';
  if (r.includes('christian')) return 'Christian';
  if (r.includes('jain')) return 'Jain';
  return 'All';
}

function toEmail(vendorId) {
  const clean = normalizeString(vendorId).toLowerCase().replace(/\s+/g, '_');
  return `vendor_${clean}@eventbudget.app`;
}

function resolveCSVPath(filename) {
  // Try paths relative to this script file's location
  const candidates = [
    path.resolve(__dirname, '../../datasets', filename),
    path.resolve(__dirname, '../datasets', filename),
    path.resolve(process.cwd(), 'datasets', filename),
    path.resolve(process.cwd(), '../datasets', filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(
    `Cannot find ${filename}. Tried:\n${candidates.join('\n')}\n` +
    'Make sure datasets/ folder is present at the project root.'
  );
}

function parseLimitFromArgs() {
  const arg = process.argv.find((a) => /^--limit=\d+$/i.test(String(a)));
  if (!arg) return null;
  const n = parseInt(arg.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function seedVendorsProgrammatic() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set in backend/.env');
  }

  const csvPath = resolveCSVPath('vendors_final.csv');
  const csvText = await fs.promises.readFile(csvPath, 'utf8');
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });

  const uniqueByVendorId = new Map();
  for (const row of rows) {
    const vendorId = normalizeString(row.vendor_id);
    if (!vendorId) continue;
    if (!uniqueByVendorId.has(vendorId)) uniqueByVendorId.set(vendorId, row);
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  const credentials = [];
  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  const limit = parseLimitFromArgs();
  const rowsToProcess = Array.from(uniqueByVendorId.values());
  const limitedRows = limit ? rowsToProcess.slice(0, limit) : rowsToProcess;

  for (const row of limitedRows) {
    const vendorId = normalizeString(row.vendor_id);
    const vendorName = normalizeString(row.vendor_name) || vendorId;
    const email = toEmail(vendorId);
    const tempPassword = `Vendor@${vendorId}`;

    try {
      const existingUser = await User.findOne({ email }).lean();
      if (existingUser) {
        skipped += 1;
        console.log(`⏭️ Skipped: ${vendorName} (already exists)`);
        continue;
      }

      const user = await User.create({
        name: vendorName,
        email,
        password: tempPassword,
        role: 'vendor',
        vendorDatasetId: vendorId,
      });

      const vendorProfile = await VendorProfile.create({
        vendorDatasetId: vendorId,
        businessName: vendorName,
        ownerName: vendorName,
        email,
        phone: normalizeString(row.vendor_phone) || 'NA',
        whatsappNumber: normalizeString(row.vendor_phone) || '',
        businessType: mapBusinessType(row.category),
        category: normalizeString(row.category),
        city: normalizeString(row.city) || 'Unknown',
        area: normalizeString(row.area) || 'Unknown',
        minGuests: toNumber(row.min_guests, 0),
        maxGuests: toNumber(row.max_guests, 500),
        basePrice: normalizeVendorBasePrice(row.base_price, row.category),
        religionServed: mapReligion(row.religion_served),
        supportedEventTypes: parseJsonArray(row.supported_events),
        servesVeg: toBool(row.veg_only, toBool(row.is_veg_only, true)),
        servesNonVeg: toBool(row.serves_nonveg, !toBool(row.veg_only, toBool(row.is_veg_only, false))),
        rating: toNumber(row.rating, 0),
        linkedUserId: user._id,
        loginCredentials: {
          username: email,
          tempPassword,
          passwordChanged: false,
        },
      });

      credentials.push({
        vendorId,
        vendorName,
        email,
        tempPassword,
        city: vendorProfile.city,
        category: vendorProfile.category,
      });

      seeded += 1;
      console.log(`✅ Seeded: ${vendorName}`);
    } catch (err) {
      failed += 1;
      console.error(`❌ Failed: ${vendorName} - ${err.message}`);
    }
  }

  const outPath = path.resolve(__dirname, '..', '..', 'vendor_credentials.json');
  await fs.promises.writeFile(outPath, JSON.stringify(credentials, null, 2), 'utf8');

  console.log('');
  console.log('Seeding Summary');
  console.log(`Total seeded: ${seeded}`);
  console.log(`Total skipped: ${skipped}`);
  console.log(`Total failed: ${failed}`);

  const summary = {
    limitApplied: limit,
    totalSeeded: seeded,
    totalSkipped: skipped,
    totalFailed: failed,
    credentials,
    credentialsFile: outPath,
  };

  return summary;
}

async function runAsScript() {
  try {
    const summary = await seedVendorsProgrammatic();
    console.log('');
    console.log('Programmatic Summary');
    console.log(`Total seeded: ${summary.totalSeeded}`);
    console.log(`Total skipped: ${summary.totalSkipped}`);
    console.log(`Total failed: ${summary.totalFailed}`);
  } catch (err) {
    console.error('❌ Vendor seeding failed:', err.message);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch {
        // ignore
      }
    }
  }
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === __filename
  : false;

if (isDirectRun) {
  runAsScript();
}
