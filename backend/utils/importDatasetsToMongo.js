import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DATASET_MAP = [
  { file: 'vendors_final.csv', collection: 'vendors_dataset' },
  { file: 'menus_final.csv', collection: 'menus_dataset' },
  { file: 'bookings_final.csv', collection: 'bookings_dataset' },
  { file: 'availability_final.csv', collection: 'availability_dataset' },
];

const DEFAULT_PER_VENDOR_CAP = {
  bookings_dataset: 50,
  availability_dataset: 50,
};

function getLimitForCollection(collection) {
  const arg = process.argv.find((a) => a.startsWith(`--limit-${collection}=`));
  if (!arg) return null;
  const value = Number(arg.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function shouldSkipCollection(collection) {
  return process.argv.includes(`--skip-${collection}`);
}

function getPerVendorCap(collection) {
  const exactArg = process.argv.find((a) => a.startsWith(`--max-per-vendor-${collection}=`));
  const shortName = collection.replace('_dataset', '');
  const shortArg = process.argv.find((a) => a.startsWith(`--max-per-vendor-${shortName}=`));
  const arg = exactArg || shortArg;

  if (arg) {
    const value = Number(arg.split('=')[1]);
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
  }

  return DEFAULT_PER_VENDOR_CAP[collection] || null;
}

function applyPerVendorCap(records, cap) {
  if (!Number.isFinite(cap) || cap <= 0) {
    return {
      records,
      removed: 0,
      vendorCount: 0,
    };
  }

  const counts = new Map();
  const kept = [];
  let removed = 0;

  for (const row of records) {
    const vendorId = String(row?.vendor_id || row?.vendorId || '').trim();
    if (!vendorId) {
      kept.push(row);
      continue;
    }

    const seen = counts.get(vendorId) || 0;
    if (seen >= cap) {
      removed += 1;
      continue;
    }

    counts.set(vendorId, seen + 1);
    kept.push(row);
  }

  return {
    records: kept,
    removed,
    vendorCount: counts.size,
  };
}

function resolveCSVPath(filename) {
  const candidates = [
    path.resolve(__dirname, '../../datasets', filename),
    path.resolve(__dirname, '../datasets', filename),
    path.resolve(process.cwd(), 'datasets', filename),
    path.resolve(process.cwd(), '../datasets', filename),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Cannot find ${filename}. Tried:\n${candidates.join('\n')}`);
}

function parseCsvRecords(csvText) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });
}

function normalizeVendorCoordinateFields(records) {
  return records.map((row) => {
    const out = { ...row };
    const lat = out.latitude ?? out.lat;
    const lon = out.longitude ?? out.lon ?? out.lng;
    if (lat != null && lat !== '') out.latitude = lat;
    if (lon != null && lon !== '') out.longitude = lon;
    delete out.lat;
    delete out.lon;
    delete out.lng;
    return out;
  });
}

async function importCollection(file, collection) {
  if (shouldSkipCollection(collection)) {
    console.log(`⏭️ Skipped ${collection} by flag.`);
    return { collection, inserted: 0, skipped: true };
  }

  const csvPath = resolveCSVPath(file);
  const csvText = await fs.promises.readFile(csvPath, 'utf8');
  const allRecords = parseCsvRecords(csvText);
  const perVendorCap = getPerVendorCap(collection);
  const capped = applyPerVendorCap(allRecords, perVendorCap);
  const limit = getLimitForCollection(collection);
  let records = limit ? capped.records.slice(0, limit) : capped.records;
  if (collection === 'vendors_dataset') {
    records = normalizeVendorCoordinateFields(records);
  }

  const coll = mongoose.connection.db.collection(collection);
  await coll.deleteMany({});

  if (!records.length) {
    console.log(`⚠️ ${collection}: CSV is empty, collection cleared.`);
    return { collection, inserted: 0 };
  }

  const batchSize = 2000;
  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    if (batch.length) {
      await coll.insertMany(batch, { ordered: false });
      inserted += batch.length;
    }
  }

  const capLabel = perVendorCap ? ` (per-vendor cap: ${perVendorCap})` : '';
  const limitLabel = limit ? ` (limited to ${limit})` : '';
  if (capped.removed > 0) {
    console.log(`ℹ️ ${collection}: removed ${capped.removed} excess rows after per-vendor capping across ${capped.vendorCount} vendors.`);
  }
  console.log(`✅ Imported ${inserted} documents into ${collection} from ${file}${capLabel}${limitLabel}`);
  return { collection, inserted };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set in backend/.env or root .env');
  }

  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  const results = [];
  for (const item of DATASET_MAP) {
    const result = await importCollection(item.file, item.collection);
    results.push(result);
  }

  console.log('\nImport Summary');
  results.forEach((r) => console.log(`${r.collection}: ${r.inserted}`));
}

main()
  .catch((err) => {
    console.error('❌ Import failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
  });
