import dotenv from 'dotenv';
import connectDB from './config/database.js';
import { findVenuesWithContext } from './agents/venueAgent.js';

dotenv.config({ path: './.env' });
await connectDB();
const res = await findVenuesWithContext({ city: 'Hyderabad', religion: 'Christian', eventType: 'Wedding', venuePreference: 'Church / Parish Hall', numGuests: 1000, budget: 1500000, eventDate: '2026-09-15', timeSlot: '10:00-14:00', limit: 10, strictCity: true });
console.log(JSON.stringify(res.venues.map(v => ({ id: v.vendor_id, name: v.vendor_name, city: v.city, avail: v.availability_status })), null, 2));
