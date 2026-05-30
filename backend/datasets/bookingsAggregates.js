import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { getVendorsDataset } from './vendorsDataset.js';
import { readDatasetFromMongo } from './dbDatasetStore.js';

let cache = null;

function extractNumber(v) {
  const m = String(v || '').match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function toBool(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'true' || s === '1';
}

function isConfirmed(status) {
  const s = String(status || '').trim().toLowerCase();
  return s.includes('confirm') && !s.includes('cancel');
}

function resolveDatasetPath(fileName) {
  const cwdDataset = path.resolve(process.cwd(), 'datasets', fileName);
  if (fs.existsSync(cwdDataset)) return cwdDataset;

  const parentDataset = path.resolve(process.cwd(), '..', 'datasets', fileName);
  if (fs.existsSync(parentDataset)) return parentDataset;

  return cwdDataset;
}

export async function getBookingsAggregates() {
  if (cache) return cache;

  const { vendorsById } = await getVendorsDataset();

  const aggregatesByVendor = {};
  let processed = 0;
  const mongoRecords = await readDatasetFromMongo('bookings_dataset');

  const processRecord = (record) => {
    processed++;
    const vendorId = String(record.vendor_id || '').trim();
    if (!vendorId) return;

    const vendor = vendorsById.get(vendorId);
    if (!vendor) return;

    const status = String(record.status || '');
    const confirmed = isConfirmed(status);

    const guests = extractNumber(record.guests) || 0;
    const discountPct = extractNumber(record.discount_pct) || 0;

    const capacityScale =
      vendor.capacity && vendor.capacity > 0 && guests > 0 ? guests / vendor.capacity : 1;

    // Estimated revenue uses base_price scaled by guest/capacity ratio.
    const revenueEstimate =
      (vendor.base_price || 0) * capacityScale * (1 - discountPct / 100);

    if (!aggregatesByVendor[vendorId]) {
      aggregatesByVendor[vendorId] = {
        vendor_id: vendorId,
        totalBookings: 0,
        confirmedBookings: 0,
        eventsAttended: {},
        feedbackNotes: [],
      };
    }

    const agg = aggregatesByVendor[vendorId];
    agg.totalBookings += 1;
    if (confirmed) agg.confirmedBookings += 1;

    const eventType = String(record.event_type || '').trim() || 'Unknown';
    if (!agg.eventsAttended[eventType]) {
      agg.eventsAttended[eventType] = {
        event_type: eventType,
        total: 0,
        confirmed: 0,
      };
    }
    agg.eventsAttended[eventType].total += 1;
    if (confirmed) agg.eventsAttended[eventType].confirmed += 1;

    // Store “feedback notes” from special requirements (dataset-driven notes).
    const note = String(record.special_requirements || '').trim();
    if (note) {
      agg.feedbackNotes.push({
        event_date: record.event_date,
        booking_date: record.booking_date,
        event_type: eventType,
        status: status || 'unknown',
        note,
      });
      // Keep memory bounded.
      if (agg.feedbackNotes.length > 8) agg.feedbackNotes.shift();
    } else if (agg.feedbackNotes.length < 8 && processed % 2000 === 0) {
      // Occasionally keep placeholder notes so the UI isn't empty.
      agg.feedbackNotes.push({
        event_date: record.event_date,
        booking_date: record.booking_date,
        event_type: eventType,
        status: status || 'unknown',
        note: confirmed ? 'Confirmed booking (dataset record).' : 'Cancelled booking (dataset record).',
      });
    }
  };

  if (mongoRecords) {
    mongoRecords.forEach(processRecord);
    cache = aggregatesByVendor;
    console.log(`✅ Loaded booking aggregates from MongoDB for ${Object.keys(cache).length} vendors (rows processed: ${processed})`);
    return cache;
  }

  const bookingsPath = resolveDatasetPath('bookings_final.csv');
  const parser = parse({
    columns: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  });

  const stream = fs.createReadStream(bookingsPath);
  stream.pipe(parser);

  for await (const record of parser) {
    processRecord(record);
  }

  cache = aggregatesByVendor;
  console.log(`✅ Loaded booking aggregates from CSV for ${Object.keys(cache).length} vendors (rows processed: ${processed})`);
  return cache;
}

export default getBookingsAggregates;

