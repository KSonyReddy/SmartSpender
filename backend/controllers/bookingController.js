import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { Booking } from '../models/Booking.js';
import { VendorProfile } from '../models/VendorProfile.js';
import { getAvailabilityDataset } from '../datasets/availabilityDataset.js';

function normalizeDateOnly(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDayRange(dateLike) {
  const start = normalizeDateOnly(dateLike);
  if (!start) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function dateKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function overlap(a, b) {
  return minutesOf(a.start) < minutesOf(b.end) && minutesOf(b.start) < minutesOf(a.end);
}

function titleCaseStatus(statusLike) {
  const s = String(statusLike || '').trim().toLowerCase();
  if (!s) return 'Pending';
  if (s.includes('confirm') || s === 'booked') return 'Confirmed';
  if (s.includes('cancel')) return 'Cancelled';
  if (s.includes('complete')) return 'Completed';
  if (s.includes('pending')) return 'Pending';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseDatasetSlot(slotLike) {
  const raw = String(slotLike || '').trim();
  if (!raw) return null;
  const mm = raw.match(/(\d{1,2}:\d{2})/g);
  if (!mm || mm.length < 2) return null;
  return { start: mm[0], end: mm[1] };
}

function resolveDatasetPath(fileName) {
  const cwdDataset = path.resolve(process.cwd(), 'datasets', fileName);
  if (fs.existsSync(cwdDataset)) return cwdDataset;
  const parentDataset = path.resolve(process.cwd(), '..', 'datasets', fileName);
  if (fs.existsSync(parentDataset)) return parentDataset;
  return cwdDataset;
}

async function getDatasetBookingsForVendorRange(vendorDatasetId, startDate, endDateExclusive) {
  const vendorId = String(vendorDatasetId || '').trim();
  if (!vendorId || !startDate || !endDateExclusive) return [];

  const startKey = dateKey(startDate);
  const endKey = dateKey(endDateExclusive);
  if (!startKey || !endKey) return [];

  const normalizeRecord = (row) => {
    const eventDate = String(row?.event_date || '').slice(0, 10);
    if (!eventDate || eventDate < startKey || eventDate >= endKey) return null;
    const slot = parseDatasetSlot(row?.slot);
    return {
      bookingId: String(row?.booking_id || `DATASET-${vendorId}-${eventDate}-${row?.slot || ''}`),
      eventDate,
      eventType: String(row?.event_type || '').trim() || 'Event',
      status: titleCaseStatus(row?.status),
      guestCount: Number(row?.guests || 0) || 0,
      timeSlot: slot || { start: '06:00', end: '23:00' },
      customerName: 'Dataset Booking',
      source: 'dataset',
    };
  };

  try {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      const rows = await mongoose.connection.db
        .collection('bookings_dataset')
        .find(
          {
            vendor_id: vendorId,
            event_date: { $gte: startKey, $lt: endKey },
          },
          { projection: { _id: 0, event_date: 1, slot: 1, event_type: 1, status: 1, guests: 1, booking_id: 1 } }
        )
        .toArray();
      return rows.map(normalizeRecord).filter(Boolean);
    }
  } catch {
    // Fall back to CSV stream.
  }

  const csvPath = resolveDatasetPath('bookings_final.csv');
  if (!fs.existsSync(csvPath)) return [];

  const parser = parse({
    columns: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  });

  const matches = [];
  const stream = fs.createReadStream(csvPath);
  stream.pipe(parser);

  for await (const row of parser) {
    if (String(row?.vendor_id || '').trim() !== vendorId) continue;
    const normalized = normalizeRecord(row);
    if (normalized) matches.push(normalized);
  }
  return matches;
}

function buildDefaultSlots(workingStart = '09:00', workingEnd = '22:00') {
  const templates = [
    { start: '06:00', end: '12:00' },
    { start: '12:00', end: '18:00' },
    { start: '18:00', end: '23:00' },
  ];
  const ws = minutesOf(workingStart);
  const we = minutesOf(workingEnd);
  return templates.filter((s) => minutesOf(s.start) >= ws && minutesOf(s.end) <= we);
}

function ensureVendorSession(req, res) {
  if (!req.session?.vendorProfileId) {
    res.status(403).json({
      success: false,
      message: 'Vendor session is missing vendorProfileId',
    });
    return null;
  }
  return req.session.vendorProfileId;
}

function toObjectId(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

async function findBookingForVendor(vendorProfileId, bookingRef) {
  const vid = toObjectId(vendorProfileId);
  if (!vid) return null;
  const rid = String(bookingRef || '').trim();
  if (!rid) return null;
  const clauses = [{ vendorId: vid, bookingId: rid }];
  if (mongoose.Types.ObjectId.isValid(rid)) {
    clauses.push({ vendorId: vid, _id: new mongoose.Types.ObjectId(rid) });
  }
  return Booking.findOne({ $or: clauses });
}

export async function getVendorBookings(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const skip = (page - 1) * limit;

  const query = { vendorId: vendorProfileId };
  if (req.query.status) query.status = req.query.status;
  if (req.query.eventType) {
    const eventType = String(req.query.eventType).trim();
    if (eventType) query.eventType = { $regex: eventType, $options: 'i' };
  }

  if (req.query.startDate || req.query.endDate) {
    query.eventDate = {};
    if (req.query.startDate) {
      const start = new Date(req.query.startDate);
      start.setHours(0, 0, 0, 0);
      query.eventDate.$gte = start;
    }
    if (req.query.endDate) {
      const endExclusive = new Date(req.query.endDate);
      endExclusive.setHours(0, 0, 0, 0);
      endExclusive.setDate(endExclusive.getDate() + 1);
      query.eventDate.$lt = endExclusive;
    }
  }

  const useDatasetRangeMerge = Boolean(req.query.startDate || req.query.endDate);

  const [mongoFiltered, allVendorBookings, vendorProfile] = await Promise.all([
    Booking.find(query)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 }),
    Booking.find({ vendorId: vendorProfileId }).select('status finalPrice createdAt'),
    useDatasetRangeMerge
      ? VendorProfile.findById(vendorProfileId).select('vendorDatasetId').lean()
      : Promise.resolve(null),
  ]);

  const mergedFiltered = mongoFiltered.map((b) => {
    const plain = b.toObject ? b.toObject() : b;
    return { ...plain, source: 'mongo' };
  });

  if (useDatasetRangeMerge && vendorProfile?.vendorDatasetId) {
    const fallbackStart = new Date();
    fallbackStart.setHours(0, 0, 0, 0);
    const start = query.eventDate?.$gte || fallbackStart;

    const fallbackEnd = new Date(start);
    fallbackEnd.setDate(fallbackEnd.getDate() + 1);
    const endExclusive = query.eventDate?.$lt || fallbackEnd;

    const datasetRows = await getDatasetBookingsForVendorRange(vendorProfile.vendorDatasetId, start, endExclusive);
    const wantedStatus = String(req.query.status || '').trim().toLowerCase();
    const wantedEventType = String(req.query.eventType || '').trim().toLowerCase();

    const filteredDatasetRows = datasetRows.filter((d) => {
      if (wantedStatus && String(d.status || '').toLowerCase() !== wantedStatus) return false;
      if (wantedEventType && !String(d.eventType || '').toLowerCase().includes(wantedEventType)) return false;
      return true;
    });

    for (const d of filteredDatasetRows) {
      const dedupeKey = `${dateKey(d.eventDate)}|${d.timeSlot?.start || ''}|${d.timeSlot?.end || ''}|${String(d.eventType || '').toLowerCase()}`;
      const exists = mergedFiltered.some((x) => {
        const xKey = `${dateKey(x.eventDate)}|${x.timeSlot?.start || ''}|${x.timeSlot?.end || ''}|${String(x.eventType || '').toLowerCase()}`;
        return xKey === dedupeKey;
      });
      if (exists) continue;

      mergedFiltered.push({
        bookingId: d.bookingId,
        userId: { name: d.customerName || 'Dataset Booking', phone: '' },
        eventType: d.eventType || 'Event',
        eventDate: d.eventDate,
        timeSlot: d.timeSlot || { start: '--', end: '--' },
        guestCount: Number(d.guestCount || 0),
        finalPrice: 0,
        quotedPrice: 0,
        status: d.status || 'Confirmed',
        source: 'dataset',
        createdAt: d.eventDate,
      });
    }
  }

  mergedFiltered.sort((a, b) => {
    const aDate = new Date(a.eventDate || a.createdAt || 0).getTime();
    const bDate = new Date(b.eventDate || b.createdAt || 0).getTime();
    return bDate - aDate;
  });

  const total = mergedFiltered.length;
  const bookings = mergedFiltered.slice(skip, skip + limit);

  const summary = {
    total: mergedFiltered.length,
    confirmed: mergedFiltered.filter((b) => b.status === 'Confirmed').length,
    pending: mergedFiltered.filter((b) => b.status === 'Pending').length,
    cancelled: mergedFiltered.filter((b) => b.status === 'Cancelled').length,
    revenue: mergedFiltered
      .filter((b) => b.status === 'Confirmed' || b.status === 'Completed')
      .reduce((sum, b) => sum + (Number(b.finalPrice) || 0), 0),
  };

  const overallSummary = {
    total: allVendorBookings.length,
    confirmed: allVendorBookings.filter((b) => b.status === 'Confirmed').length,
    pending: allVendorBookings.filter((b) => b.status === 'Pending').length,
    cancelled: allVendorBookings.filter((b) => b.status === 'Cancelled').length,
    revenue: allVendorBookings
      .filter((b) => b.status === 'Confirmed' || b.status === 'Completed')
      .reduce((sum, b) => sum + (Number(b.finalPrice) || 0), 0),
  };

  return res.json({
    success: true,
    data: {
      bookings,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      summary,
      overallSummary,
    },
  });
}

export async function getVendorCalendar(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const now = new Date();
  const year = Number(req.query.year || now.getFullYear());
  const month = Number(req.query.month || now.getMonth() + 1);

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  const [bookings, vendorProfile] = await Promise.all([
    Booking.find({
      vendorId: vendorProfileId,
      eventDate: { $gte: monthStart, $lt: monthEnd },
    })
      .populate('userId', 'name')
      .select('bookingId userId eventType timeSlot status guestCount eventDate'),
    VendorProfile.findById(vendorProfileId).select('blackoutDates vendorDatasetId'),
  ]);
  const datasetBookings = await getDatasetBookingsForVendorRange(
    vendorProfile?.vendorDatasetId,
    monthStart,
    monthEnd
  );

  const grouped = {};
  for (const b of bookings) {
    const key = dateKey(b.eventDate);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      bookingId: b.bookingId,
      customerName: b.userId?.name || 'Unknown',
      eventType: b.eventType,
      timeSlot: b.timeSlot,
      status: b.status,
      guestCount: b.guestCount,
      source: 'mongo',
    });
  }

  for (const d of datasetBookings) {
    const key = d.eventDate;
    if (!grouped[key]) grouped[key] = [];
    const dedupeKey = `${d.timeSlot?.start || ''}-${d.timeSlot?.end || ''}-${String(d.status || '').toLowerCase()}`;
    const exists = grouped[key].some(
      (x) => `${x.timeSlot?.start || ''}-${x.timeSlot?.end || ''}-${String(x.status || '').toLowerCase()}` === dedupeKey
    );
    if (!exists) {
      grouped[key].push({
        bookingId: d.bookingId,
        customerName: d.customerName,
        eventType: d.eventType,
        timeSlot: d.timeSlot,
        status: d.status,
        guestCount: d.guestCount,
        source: d.source,
      });
    }
  }

  const blackoutDates = (vendorProfile?.blackoutDates || []).map((d) => dateKey(d));

  return res.json({
    success: true,
    data: {
      year,
      month,
      bookingsByDate: grouped,
      blackoutDates,
    },
  });
}

export async function confirmBooking(req, res) {
  const vendorProfileId = req.session?.vendorProfileId;
  if (!vendorProfileId) return res.status(401).json({ success: false, message: 'Not authenticated' });

  const booking = await Booking.findOne({
    $or: [{ _id: req.params.id }, { bookingId: req.params.id }],
    vendorId: vendorProfileId,
  });
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  // Vendor can provide their final confirmed price
  const confirmedPrice = Number(req.body?.confirmedPrice || req.body?.finalPrice || booking.quotedPrice || 0);

  booking.status = 'Confirmed';
  booking.confirmedAt = new Date();

  // Store vendor's confirmed price (may differ from user's budget input)
  if (confirmedPrice > 0) {
    booking.vendorConfirmedPrice = confirmedPrice;
    booking.finalPrice = confirmedPrice;
  }

  if (req.body?.vendorNotes) {
    booking.vendorNotes = String(req.body.vendorNotes).trim().slice(0, 2000);
  }

  await booking.save();

  return res.json({
    success: true,
    data: {
      booking: {
        bookingId: booking.bookingId,
        status: booking.status,
        confirmedAt: booking.confirmedAt,
        serviceCategory: booking.serviceCategory,
        allocatedBudget: booking.allocatedBudget,
        vendorConfirmedPrice: booking.vendorConfirmedPrice,
        finalPrice: booking.finalPrice,
      },
    },
    message: 'Booking confirmed successfully',
  });
}

export async function cancelBookingByVendor(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const bookingRef = req.params.bookingId || req.params.id;
  const { reason, refundAmount } = req.body || {};

  const booking = await findBookingForVendor(vendorProfileId, bookingRef);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found' });
  }

  const refund = Number(refundAmount) || 0;
  booking.status = 'Cancelled';
  booking.cancellation = {
    cancelledBy: 'vendor',
    reason: String(reason || ''),
    cancelledAt: new Date(),
    refundAmount: refund,
    refundStatus: refund > 0 ? 'Pending' : 'Not_Applicable',
  };

  await booking.save();

  return res.json({
    success: true,
    message: 'Booking cancelled',
    data: { booking },
  });
}

export async function addCustomerRecommendation(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const bookingRef = req.params.bookingId || req.params.id;
  const { vendorNotes, internalRating } = req.body || {};

  const booking = await findBookingForVendor(vendorProfileId, bookingRef);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found' });
  }

  booking.vendorNotes = String(vendorNotes || '');
  if (internalRating !== undefined && internalRating !== null && internalRating !== '') {
    booking.internalRating = Number(internalRating);
  }
  await booking.save();

  return res.json({
    success: true,
    message: 'Customer recommendation added',
    data: { booking },
  });
}

export async function getBookingThread(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const bookingRef = req.params.bookingId || req.params.id;
  const booking = await findBookingForVendor(vendorProfileId, bookingRef);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found' });
  }

  return res.json({
    success: true,
    data: {
      bookingId: booking.bookingId,
      eventBudget: Number(booking.eventBudget || 0),
      eventBudgetBreakdown: booking.eventBudgetBreakdown || null,
      messages: booking.threadMessages || [],
    },
  });
}

export async function postBookingThread(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const bookingRef = req.params.bookingId || req.params.id;
  const text = String(req.body?.message || '').trim();
  if (!text) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  const booking = await findBookingForVendor(vendorProfileId, bookingRef);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found' });
  }

  booking.threadMessages = booking.threadMessages || [];
  booking.threadMessages.push({ fromRole: 'vendor', body: text, createdAt: new Date() });
  await booking.save();

  return res.json({
    success: true,
    data: { messages: booking.threadMessages },
  });
}

export async function getTimeSlotAvailability(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ success: false, message: 'date query param is required (YYYY-MM-DD)' });
  }

  const vendorProfile = await VendorProfile.findById(vendorProfileId).select('vendorDatasetId blackoutDates workingHoursStart workingHoursEnd');
  const vendorDatasetId = vendorProfile?.vendorDatasetId || '';

  const dayRange = getDayRange(date);
  if (!dayRange) {
    return res.status(400).json({ success: false, message: 'Invalid date format' });
  }
  const { start, end } = dayRange;
  const bookings = await Booking.find({
    vendorId: vendorProfileId,
    status: 'Confirmed',
    eventDate: { $gte: start, $lt: end },
  }).select('bookingId timeSlot eventType');

  const bookedSlots = bookings
    .filter((b) => b.timeSlot?.start && b.timeSlot?.end)
    .map((b) => ({
      bookingId: b.bookingId,
      start: b.timeSlot.start,
      end: b.timeSlot.end,
      eventType: b.eventType,
      source: 'mongo',
    }));

  const datasetBookings = await getDatasetBookingsForVendorRange(vendorDatasetId, start, end);
  datasetBookings
    .filter((b) => b.status === 'Confirmed')
    .forEach((b) => {
      if (!b.timeSlot?.start || !b.timeSlot?.end) return;
      bookedSlots.push({
        bookingId: b.bookingId,
        start: b.timeSlot.start,
        end: b.timeSlot.end,
        eventType: b.eventType,
        source: 'dataset-booking',
      });
    });

  let datasetSlots = [];
  if (vendorDatasetId) {
    const { slotsByVendorDate } = await getAvailabilityDataset();
    const key = `${vendorDatasetId}__${date}`;
    datasetSlots = (slotsByVendorDate.get(key) || []).map((s) => ({
      start: s.start_time,
      end: s.end_time,
      status: s.status,
      source: 'dataset',
    }));
  }

  const dateOnly = normalizeDateOnly(date);
  const requestedKey = dateKey(dateOnly);
  const isBlackout = requestedKey
    ? (vendorProfile?.blackoutDates || []).some((d) => {
        const blackoutKey = dateKey(d);
        return blackoutKey && blackoutKey === requestedKey;
      })
    : false;

  const workStart = vendorProfile?.workingHoursStart || '06:00';
  const workEnd   = vendorProfile?.workingHoursEnd   || '22:00';

  const DEFAULT_SLOT_RANGES = [
    { start: '06:00', end: '12:00' },
    { start: '12:00', end: '18:00' },
    { start: '18:00', end: '22:00' },
  ];

  // Filter slots to working hours range (inclusive fallback: keep all 3)
  const activeSlots = DEFAULT_SLOT_RANGES.filter(s => s.start >= workStart || s.end <= workEnd);
  const slotsToUse  = activeSlots.length ? activeSlots : DEFAULT_SLOT_RANGES;

  const fallbackSlots = slotsToUse.map(s => ({
    start:  s.start,
    end:    s.end,
    status: isBlackout ? 'unavailable' : 'available',
    source: 'default',
  }));

  const effectiveSlots = datasetSlots.length > 0 ? datasetSlots : fallbackSlots;

  const bookedKeySet = new Set(bookedSlots.map((s) => `${s.start}-${s.end}`));
  const freeSlots = effectiveSlots
    .filter((s) => String(s.status || '').toLowerCase() === 'available')
    .filter((s) => !bookedKeySet.has(`${s.start}-${s.end}`))
    .filter((s) => !bookedSlots.some((b) => overlap({ start: s.start, end: s.end }, { start: b.start, end: b.end })))
    .map((s) => ({ start: s.start, end: s.end, source: s.source }));

  return res.json({
    success: true,
    data: {
      date,
      bookedSlots,
      freeSlots,
      datasetSlots: effectiveSlots,
      isBlackout,
    },
  });
}

export async function updateBlackoutDates(req, res) {
  const vendorProfileId = ensureVendorSession(req, res);
  if (!vendorProfileId) return;

  const { dates } = req.body || {};
  if (!Array.isArray(dates)) {
    return res.status(400).json({ success: false, message: 'dates must be an array' });
  }

  const blackoutDates = dates
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => normalizeDateOnly(d));

  const profile = await VendorProfile.findByIdAndUpdate(
    vendorProfileId,
    { blackoutDates },
    { new: true }
  ).select('blackoutDates');

  if (!profile) {
    return res.status(404).json({ success: false, message: 'Vendor profile not found' });
  }

  return res.json({
    success: true,
    message: 'Blackout dates updated',
    data: {
      blackoutDates: profile.blackoutDates,
    },
  });
}
