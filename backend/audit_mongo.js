import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

async function auditMongo() {
  const mongoUri = process.env.MONGODB_URI;
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const vendors = await db.collection('vendors_dataset').find({}).toArray();

  const invalidCapacities = vendors.filter(v => {
    const cap = parseInt(v.max_guests || v.capacity);
    return cap > 0 && cap < 5 && !['Photographer', 'Videographer', 'Makeup Artist', 'DJ', 'Band / Nadaswaram', 'Florist', 'Priest / Pandit', 'Maulvi / Qazi', 'Pastor / Father'].includes(v.category);
  });

  console.log('Vendors with suspiciously low capacity (<5) in non-crew categories:');
  invalidCapacities.forEach(v => {
    console.log(`- [${v.vendor_id}] ${v.vendor_name} (${v.category}): ${v.max_guests || v.capacity}`);
  });

  const categories = [...new Set(vendors.map(v => v.category))];
  console.log('\nCategories in MongoDB:', categories);

  await mongoose.disconnect();
}

auditMongo().catch(console.error);
