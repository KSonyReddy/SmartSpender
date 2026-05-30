import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

async function checkV1001() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI not found');
    return;
  }
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const vendor = await db.collection('vendors_dataset').findOne({ vendor_id: 'V1001' });
  console.log('V1001 in MongoDB:', JSON.stringify(vendor, null, 2));
  await mongoose.disconnect();
}

checkV1001().catch(console.error);
