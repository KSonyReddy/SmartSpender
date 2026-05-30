import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
// Geocoding has been removed from the project. This script is disabled.
console.error('Geocoding disabled: enrichVendorCoordinates script is inactive.');
process.exit(0);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  const coll = mongoose.connection.db.collection('vendors_dataset');

  const docs = await coll.find({}, {
    projection: {
      _id: 1,
      vendor_name: 1,
      city: 1,
      area: 1,
      latitude: 1,
      longitude: 1,
      lat: 1,
      lon: 1,
      lng: 1,
    },
  }).toArray();

  let updated = 0;
  let skipped = 0;
  const bulk = [];

  for (const doc of docs) {
    const existingLat = toNum(doc.latitude ?? doc.lat);
    const existingLon = toNum(doc.longitude ?? doc.lon ?? doc.lng);
    if (existingLat != null && existingLon != null) {
      skipped += 1;
      continue;
    }

    const query = [doc.area, doc.city].filter(Boolean).join(', ');
    if (!query) {
      skipped += 1;
      continue;
    }

    const coords = await geocodePlace(query);
    if (!coords) {
      skipped += 1;
      continue;
    }

    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            latitude: coords.lat,
            longitude: coords.lon,
          },
          $unset: {
            lat: '',
            lon: '',
            lng: '',
          },
        },
      },
    });

    if (bulk.length >= 250) {
      const res = await coll.bulkWrite(bulk, { ordered: false });
      updated += res.modifiedCount || 0;
      bulk.length = 0;
    }
  }

  if (bulk.length) {
    const res = await coll.bulkWrite(bulk, { ordered: false });
    updated += res.modifiedCount || 0;
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}, Total: ${docs.length}`);
}

main()
  .catch((err) => {
    console.error('Coordinate enrichment failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
  });
