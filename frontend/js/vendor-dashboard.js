const BASE = 'http://localhost:5002';
const API = `${BASE}/api`;

const state = {
  user: null,
  vendorProfile: null,
  bookings: [],
  bookingSummary: null,
  bookingPage: 1,
  bookingLimit: 15,
  bookingTotalPages: 1,
  filters: {
    status: '',
    startDate: '',
    endDate: '',
    eventType: '',
  },
  selectedCancelBookingId: null,
  calendar: {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    selectedDate: null,
    bookingsByDate: {},
    blackoutDates: [],
  },
  availabilityWeekStart: null,
  availabilityCache: {},
  chart: null,
  threadBookingId: null,
  threadPollTimer: null,
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  return `₹${Number(v || 0).toLocaleString('en-IN')}`;
}

function getBookingServiceCategory(booking) {
  return String(booking?.serviceCategory || booking?.vendorCategory || state.vendorProfile?.category || '').trim();
}

function getServiceAllocation(breakdown, category) {
  if (!breakdown || !category) return '';
  const catLower = String(category).toLowerCase();
  const keyMap = {
    venue: 'venue',
    catering: 'catering',
    decoration: 'decoration',
    photography: 'photography',
    videography: 'videography',
    dj: 'dj',
  };
  const matchKey = Object.keys(keyMap).find((k) => catLower.includes(k));
  const amount = matchKey ? Number(breakdown[keyMap[matchKey]] || 0) : 0;
  return amount > 0 ? fmtMoney(amount) : '';
}

function showLoader(show) {
  document.getElementById('globalLoader').classList.toggle('hidden', !show);
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function toDateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'status-pending';
  if (s === 'confirmed') return 'status-confirmed';
  if (s === 'cancelled') return 'status-cancelled';
  if (s === 'completed') return 'status-completed';
  return 'status-other';
}

function overlap(rangeA, rangeB) {
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm || '0:0').split(':').map(Number);
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const a0 = toMin(rangeA.start);
  const a1 = toMin(rangeA.end);
  const b0 = toMin(rangeB.start);
  const b1 = toMin(rangeB.end);
  return a0 < b1 && b0 < a1;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    window.location.href = './login.html';
    throw new Error('Session expired');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || 'Request failed');
  }
  return json;
}

function switchSection(section) {
  document.querySelectorAll('.section').forEach((el) => {
    el.classList.toggle('active', el.id === `${section}Section`);
  });
  document.querySelectorAll('.nav-link').forEach((el) => {
    el.classList.toggle('active', el.dataset.section === section);
  });
  const titleMap = {
    overview: 'Dashboard Overview',
    bookings: 'Bookings',
    calendar: 'Calendar View',
    availability: 'Availability / Slots',
    profile: 'My Profile',
    menu: 'My Menu Card',
    reviews: 'Customer Reviews',
  };
  document.getElementById('sectionTitle').textContent = titleMap[section] || 'Vendor Dashboard';
  if (section === 'menu') loadMenuCard();
}

async function loadAuthProfile() {
  const json = await apiFetch('/auth/profile');
  const user = json.data?.user;
  if (!user || user.role !== 'vendor') {
    window.location.href = './ai-dashboard.html';
    return null;
  }
  state.user = user;
  return user;
}

async function loadVendorProfile() {
  try {
    const json = await apiFetch('/vendor/profile');
    state.vendorProfile = json.data?.vendorProfile || {};
  } catch (e) {
    state.vendorProfile = {
      vendorName: state.user?.name || 'Vendor',
      city: '',
      category: '',
      isVerified: false,
    };
    showToast('Could not fetch full vendor profile, showing basic details.', 'error');
  }

  // Show dataset info banner for new vendors without dataset link
  const p = state.vendorProfile;
  const menuNavBtn = document.getElementById('menuNavBtn');
  const profile = state.vendorProfile;
  const isCaterer = /caterer|catering|food|meals/i.test(profile?.category || profile?.businessType || '');
  if (menuNavBtn) menuNavBtn.style.display = isCaterer ? 'flex' : 'none';
  if (p.isNewVendor) {
    const banner = document.createElement('div');
    banner.className = 'dataset-banner';
    banner.innerHTML = `
      <span>ℹ️</span>
      <span>Your account is new and not yet linked to our vendor database. 
      Your availability starts as all-available. Bookings you receive will show here.
      Contact admin to link your existing vendor profile for historical data.</span>
    `;
    // Insert before the first section
    const firstSection = document.querySelector('.section.active');
    if (firstSection) firstSection.insertBefore(banner, firstSection.firstChild);
  }

  const name = p.businessName || p.vendorName || state.user?.name || 'Vendor';
  document.getElementById('welcomeTitle').textContent = `Hello, ${name}`;
  document.getElementById('welcomeSub').textContent = `${p.city || '—'} • ${p.category || '—'}`;
  document.getElementById('vendorChip').textContent = `${name} (${state.user?.email || ''})`;

  const badge = document.getElementById('verifyBadge');
  if (p.isVerified) {
    badge.style.display = 'inline-flex';
    badge.textContent = 'Verified';
    badge.classList.add('verified');
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
    badge.classList.remove('verified');
  }

  document.getElementById('profileBusinessName').value = name;
  document.getElementById('profileEmail').value = state.user?.email || '';
  document.getElementById('profilePhone').value = p.phone || '';
  document.getElementById('profileWhatsapp').value = p.whatsappNumber || '';
  document.getElementById('profileBasePrice').value = p.basePrice || 0;
  document.getElementById('profilePricingUnit').value = p.pricingUnit || 'per_event';
  document.getElementById('profileWorkingStart').value = p.workingHoursStart || '09:00';
  document.getElementById('profileWorkingEnd').value = p.workingHoursEnd || '22:00';
  document.getElementById('profileAmenities').value = (p.amenities || []).join(', ');
  document.getElementById('profileDescription').value = p.description || '';

  renderReviews();
  await loadPortfolioImages();
}

async function loadPortfolioImages() {
  const images = state.vendorProfile?.portfolioImages || [];
  const captions = state.vendorProfile?.portfolioCaption || [];
  const grid = document.getElementById('portfolioGrid');
  if (!grid) return;
  grid.innerHTML = images.length === 0
    ? '<p style="color:#9ca3af;font-size:0.85rem">No portfolio images yet.</p>'
    : images.map((src, i) => `
        <div class="portfolio-thumb">
          <img src="${escapeHtml(src)}" alt="Work sample ${i + 1}" loading="lazy">
          <button class="delete-btn" onclick="deletePortfolioImage(${i})" title="Remove">✕</button>
          <div class="caption">${escapeHtml(captions[i] || '')}</div>
        </div>`).join('');
}

async function deletePortfolioImage(index) {
  if (!confirm('Remove this photo?')) return;
  await apiFetch(`/vendor/portfolio/${index}`, { method: 'DELETE' });
  state.vendorProfile.portfolioImages = state.vendorProfile.portfolioImages || [];
  state.vendorProfile.portfolioCaption = state.vendorProfile.portfolioCaption || [];
  state.vendorProfile.portfolioImages.splice(index, 1);
  state.vendorProfile.portfolioCaption.splice(index, 1);
  await loadPortfolioImages();
}

window.deletePortfolioImage = deletePortfolioImage;

function normalizeMenuPackage(pkg = {}) {
  const rawItems = Array.isArray(pkg.items)
    ? pkg.items
    : String(pkg.items || pkg.menu_items || '').split('\n');

  return {
    per_plate: Number(pkg.per_plate || pkg.price_per_plate || pkg.price || 0) || 0,
    description: String(pkg.description || pkg.notes || '').trim(),
    items: rawItems.map((item) => String(item || '').trim()).filter(Boolean),
  };
}

function normalizeMenuCard(menu = {}, profile = {}) {
  // Helper to safely parse JSON strings from database
  function parsePackageIfString(pkg) {
    if (typeof pkg === 'string') {
      try {
        return JSON.parse(pkg);
      } catch (e) {
        return {};
      }
    }
    return pkg || {};
  }

  const packagesFromLegacy = menu.packages
    ? {
        economy: normalizeMenuPackage(menu.packages.economy || menu.packages.basic || menu.packages.basic_package || {}),
        standard: normalizeMenuPackage(menu.packages.standard || menu.packages.standard_package || {}),
        premium: normalizeMenuPackage(menu.packages.premium || menu.packages.premium_package || {}),
      }
    : {
        economy: normalizeMenuPackage(parsePackageIfString(menu.basic_package || menu.economy_package)),
        standard: normalizeMenuPackage(parsePackageIfString(menu.standard_package)),
        premium: normalizeMenuPackage(parsePackageIfString(menu.premium_package)),
      };

  const baseCandidates = [
    menu.per_plate_base,
    menu.basePrice,
    menu.base_price,
    profile.basePrice,
    packagesFromLegacy.standard.per_plate,
    packagesFromLegacy.economy.per_plate,
    packagesFromLegacy.premium.per_plate,
  ];

  const totalItemsCandidates = [
    menu.total_items,
    menu.totalItems,
    menu.total_menu_items,
    profile.menuCard?.total_items,
    packagesFromLegacy.economy.items.length,
    packagesFromLegacy.standard.items.length,
    packagesFromLegacy.premium.items.length,
  ];

  const per_plate_base = baseCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0;
  const total_items = totalItemsCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0;

  return {
    ...menu,
    vendor_name: menu.vendor_name || profile.businessName || profile.vendorName || '',
    vendor_city: menu.vendor_city || profile.city || '',
    category: menu.category || profile.category || profile.businessType || '',
    city: menu.city || profile.city || '',
    area: menu.area || profile.area || '',
    per_plate_base,
    total_items,
    packages: packagesFromLegacy,
  };
}

function renderMenuLoadStatus(menu, sourceLabel = 'database') {
  const base = Number(menu?.per_plate_base || 0);
  const economyCount = Array.isArray(menu?.packages?.economy?.items) ? menu.packages.economy.items.length : 0;
  const standardCount = Array.isArray(menu?.packages?.standard?.items) ? menu.packages.standard.items.length : 0;
  const premiumCount = Array.isArray(menu?.packages?.premium?.items) ? menu.packages.premium.items.length : 0;

  return [
    `Menu loaded from ${sourceLabel}.`,
    base > 0 ? `Base: ₹${base.toLocaleString('en-IN')}` : 'Base price not set',
    `Packages: ${economyCount}/${standardCount}/${premiumCount} items`,
  ].join(' ');
}

async function loadMenuCard() {
  try {
    const json = await apiFetch('/vendor/menu');
    const profile = state.vendorProfile || {};
    const rawMenu = json.data?.menu;
    if (!rawMenu) {
      document.getElementById('menuBasePrice').value = profile.basePrice || '';
      document.getElementById('menuTotalItems').value = '';
      document.getElementById('menuEconomyPrice').value = profile.basePrice || '';
      document.getElementById('menuStandardPrice').value = profile.basePrice || '';
      document.getElementById('menuPremiumPrice').value = profile.basePrice || '';
      document.getElementById('menuEconomyDesc').value = profile.description || '';
      document.getElementById('menuStandardDesc').value = profile.description || '';
      document.getElementById('menuPremiumDesc').value = profile.description || '';
      document.getElementById('menuSaveStatus').textContent = 'Loaded menu details from your vendor profile. Save once to create the menu card in MongoDB.';
      return;
    }

    const menu = normalizeMenuCard(rawMenu, profile);

    const pkg = (name) => menu.packages?.[name] || {};

    document.getElementById('menuBasePrice').value = menu.per_plate_base || '';
    document.getElementById('menuTotalItems').value = menu.total_items || '';

    document.getElementById('menuEconomyPrice').value = pkg('economy').per_plate || '';
    document.getElementById('menuEconomyDesc').value  = pkg('economy').description || '';
    document.getElementById('menuEconomyItems').value = (pkg('economy').items || []).join('\n');

    document.getElementById('menuStandardPrice').value = pkg('standard').per_plate || '';
    document.getElementById('menuStandardDesc').value  = pkg('standard').description || '';
    document.getElementById('menuStandardItems').value = (pkg('standard').items || []).join('\n');

    document.getElementById('menuPremiumPrice').value = pkg('premium').per_plate || '';
    document.getElementById('menuPremiumDesc').value  = pkg('premium').description || '';
    document.getElementById('menuPremiumItems').value = (pkg('premium').items || []).join('\n');

    document.getElementById('menuSaveStatus').innerHTML = escapeHtml(renderMenuLoadStatus(menu));
  } catch (e) {
    document.getElementById('menuSaveStatus').textContent = `Could not load menu: ${e.message || 'Unknown error'}`;
  }
}

async function loadBookings(page = state.bookingPage) {
  state.bookingPage = page;
  const q = new URLSearchParams({ page: String(page), limit: String(state.bookingLimit) });
  if (state.filters.status) q.set('status', state.filters.status);
  if (state.filters.startDate) q.set('startDate', state.filters.startDate);
  if (state.filters.endDate) q.set('endDate', state.filters.endDate);
  if (state.filters.eventType) q.set('eventType', state.filters.eventType);

  const json = await apiFetch(`/vendor/bookings?${q.toString()}`);
  const data = json.data || {};
  state.bookings = data.bookings || [];
  state.bookingSummary = data.summary || {};
  state.overallSummary = data.overallSummary || state.bookingSummary || {};
  state.bookingTotalPages = data.totalPages || 1;

  document.getElementById('pendingBadge').textContent = String(state.bookingSummary.pending || 0);

  renderStats();
  renderRecentBookings();
  renderBookingsTable();
  renderBookingsPagination();
  renderReviews();
}

function renderStats() {
  const profile = state.vendorProfile || {};
  const overall = state.overallSummary || {};

  const totalToShow = Math.max(Number(overall.total || 0), Number(profile.totalBookings || 0), 0);
  const confirmedToShow = Math.max(Number(overall.confirmed || 0), Number(profile.confirmedBookings || 0), 0);
  const pendingToShow = Math.max(Number(overall.pending || 0), 0);

  document.getElementById('statTotal').textContent = totalToShow;
  document.getElementById('statConfirmed').textContent = confirmedToShow;
  document.getElementById('statPending').textContent = pendingToShow;

  // Update pending badge in sidebar
  document.getElementById('pendingBadge').textContent = pendingToShow;

}

function actionButtonsHtml(booking) {
  if (String(booking?.source || '').toLowerCase() === 'dataset') {
    return '<span class="muted">Read-only (dataset)</span>';
  }
  const mongoId = booking._id != null ? String(booking._id) : '';
  const id = mongoId || String(booking.bookingId || '');
  const price = Number(booking.finalPrice || booking.quotedPrice || 0);
  return `
    <div class="action-group">
      <button class="btn btn-ok" data-action="confirm" data-id="${id}" data-price="${price}">Confirm</button>
      <button class="btn btn-danger" data-action="cancel" data-id="${id}">Cancel</button>
      <button class="btn btn-light" data-action="chat" data-id="${id}">Chat</button>
      <button class="btn btn-light" data-action="view" data-id="${id}">View</button>
    </div>
  `;
}

function renderRecentBookings() {
  const body = document.getElementById('recentBookingsBody');
  const rows = [...(state.bookings || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 5);
  body.innerHTML = rows.length
    ? rows
        .map((b) => {
          const serviceCategory = getBookingServiceCategory(b);
          const serviceAllocation = getServiceAllocation(b.eventBudgetBreakdown, serviceCategory);
          return `
          <tr>
            <td>${toDateKey(b.eventDate)}</td>
            <td>${b.userId?.name || '—'}</td>
            <td>${b.eventType || '—'}</td>
            <td>
              <div>${b.guestCount || 0}</div>
                  <!-- Customer total event budget removed from vendor view -->
              ${Number(b.allocatedBudget || 0) > 0 ? `
                <div class="booking-detail-row">
                  <span class="booking-detail-label">🎯 Allocated for Your Service (${escapeHtml(b.serviceCategory || serviceCategory || 'your category')})</span>
                  <span class="booking-detail-value" style="color:#1e40af;font-weight:700;">
                    ${fmtMoney(b.allocatedBudget)}
                  </span>
                </div>` : (serviceAllocation ? `
                <div class="booking-meta-item">
                  <span class="meta-sub" title="Budget allocated for this service">
                    (${serviceAllocation} allocated for ${escapeHtml(serviceCategory || 'your service')})
                  </span>
                </div>` : '')}
            </td>
            <td><span class="status-chip ${statusClass(b.status)}">${b.status}</span></td>
            <td>${actionButtonsHtml(b)}</td>
          </tr>
        `;
        })
        .join('')
    : '<tr><td colspan="6">No bookings found</td></tr>';
}

function renderBookingsTable() {
  const body = document.getElementById('bookingsBody');
  body.innerHTML = state.bookings.length
    ? state.bookings
        .map((b) => {
          const serviceCategory = getBookingServiceCategory(b);
          const serviceAllocation = getServiceAllocation(b.eventBudgetBreakdown, serviceCategory);
          return `
          <tr>
            <td>${b.bookingId || b._id}</td>
            <td>${b.userId?.name || '—'}</td>
            <td>${b.userId?.phone || '—'}</td>
            <td>${b.eventType || '—'}</td>
            <td>${toDateKey(b.eventDate)}</td>
            <td>${b.timeSlot?.start || '--'} - ${b.timeSlot?.end || '--'}</td>
            <td>
              <div>${b.guestCount || 0}</div>

              <!-- Customer total event budget removed from vendor view -->

              ${Number(b.allocatedBudget || 0) > 0 ? `
                <div class="booking-detail-row">
                  <span class="booking-detail-label">🎯 Allocated for Your Service (${escapeHtml(b.serviceCategory || serviceCategory || 'your category')})</span>
                  <span class="booking-detail-value" style="color:#1e40af;font-weight:700;">
                    ${fmtMoney(b.allocatedBudget)}
                  </span>
                </div>` : (serviceAllocation ? `
                <div class="booking-meta-item">
                  <span class="meta-sub" title="Budget allocated for this service">
                    (${serviceAllocation} allocated for ${escapeHtml(serviceCategory || 'your service')})
                  </span>
                </div>` : '')}
            </td>
            <td>${fmtMoney(b.finalPrice || b.quotedPrice || 0)}</td>
            <td><span class="status-chip ${statusClass(b.status)}">${b.status}</span></td>
            <td>${actionButtonsHtml(b)}</td>
          </tr>
        `;
        })
        .join('')
    : '<tr><td colspan="10">No bookings found</td></tr>';
}

function renderBookingsPagination() {
  const root = document.getElementById('bookingsPagination');
  const pages = state.bookingTotalPages;
  if (pages <= 1) {
    root.innerHTML = '';
    return;
  }

  const btns = [];
  for (let p = 1; p <= pages; p += 1) {
    btns.push(`<button class="${p === state.bookingPage ? 'active' : ''}" data-page="${p}">${p}</button>`);
  }
  root.innerHTML = btns.join('');
}

async function confirmBooking(bookingId) {
  const booking = state.bookings.find((b) => String(b._id || '') === String(bookingId) || String(b.bookingId || '') === String(bookingId));
  const suggestedPrice = Number(booking?.quotedPrice || booking?.allocatedBudget || 0);

  const confirmedPriceStr = window.prompt(
    `Confirm booking ${booking?.bookingId || bookingId}?\n\n`
    + `Customer allocated: ₹${suggestedPrice.toLocaleString('en-IN')}\n`
    + 'Enter YOUR confirmed price (press Cancel to abort):',
    String(suggestedPrice)
  );

  if (confirmedPriceStr === null) return;

  const confirmedPrice = Number(String(confirmedPriceStr).replace(/[^0-9.]/g, ''));
  if (!confirmedPrice || confirmedPrice < 0) {
    showToast('Please enter a valid price', 'error');
    return;
  }

  showLoader(true);
  try {
    await apiFetch(`/vendor/bookings/${encodeURIComponent(bookingId)}/confirm`, {
      method: 'PUT',
      body: JSON.stringify({ confirmedPrice, finalPrice: confirmedPrice }),
    });

    showToast(`✅ Booking confirmed! Your price: ₹${confirmedPrice.toLocaleString('en-IN')}`);
    await loadBookings();
  } catch (err) {
    showToast(err.message || 'Failed to confirm booking', 'error');
  } finally {
    showLoader(false);
  }
}

function openCancelModal(id) {
  state.selectedCancelBookingId = id;
  document.getElementById('cancelReason').value = '';
  document.getElementById('cancelRefundAmount').value = '';
  document.getElementById('cancelModal').classList.remove('hidden');
}

function closeCancelModal() {
  document.getElementById('cancelModal').classList.add('hidden');
  state.selectedCancelBookingId = null;
}

async function submitCancelModal() {
  if (!state.selectedCancelBookingId) return;
  const reason = document.getElementById('cancelReason').value.trim();
  const refundAmount = Number(document.getElementById('cancelRefundAmount').value || 0);

  await apiFetch(`/vendor/bookings/${encodeURIComponent(state.selectedCancelBookingId)}/cancel`, {
    method: 'PUT',
    body: JSON.stringify({ reason, refundAmount }),
  });
  showToast('Booking cancelled', 'success');
  closeCancelModal();
  await loadBookings(state.bookingPage);
  await loadCalendar();
  await renderAvailabilityWeek();
}

function viewBookingDetails(id) {
  const b = state.bookings.find((x) => String(x._id || '') === String(id) || String(x.bookingId || '') === String(id));
  if (!b) return;
  showToast(`${b.bookingId || id} • ${b.eventType} • ${toDateKey(b.eventDate)}`, 'success');
}

function closeThreadModal() {
  document.getElementById('threadModal').classList.add('hidden');
  if (state.threadPollTimer) clearInterval(state.threadPollTimer);
  state.threadPollTimer = null;
  state.threadBookingId = null;
}

function renderThreadMessages(messages) {
  const root = document.getElementById('threadMessages');
  root.innerHTML = messages.length
    ? messages
        .map((m) => {
          const cls = m.fromRole === 'vendor' ? 'vendor' : 'user';
          const when = m.createdAt ? new Date(m.createdAt).toLocaleString('en-IN') : '';
          const imgHtml = m.imageUrl
            ? `<img src="${m.imageUrl}" alt="attachment" style="max-width:100%;max-height:200px;border-radius:8px;margin-top:6px;display:block;" loading="lazy">`
            : '';
          return `<div class="thread-bubble ${cls}">
      <div>${escapeHtml(m.body)}${imgHtml}</div>
      <div class="thread-meta">${cls} · ${when}</div>
    </div>`;
        })
        .join('')
    : '<div class="thread-meta">No messages yet. Introduce yourself and confirm practical details (menu, décor, load-in time).</div>';
  root.scrollTop = root.scrollHeight;
}

async function loadBookingThread() {
  if (!state.threadBookingId) return;
  const json = await apiFetch(`/vendor/bookings/${encodeURIComponent(state.threadBookingId)}/thread`);
  const bookingId = json.data?.bookingId || '';
  const sub = document.getElementById('threadModalSub');
  if (sub) {
    sub.innerHTML = `Booking ${escapeHtml(bookingId || state.threadBookingId)} · coordinates with your customer (not the AI planner).`;
  }
  renderThreadMessages(json.data?.messages || []);
}

document.getElementById('threadImageInput')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file || !state.threadBookingId) return;
  const fd = new FormData();
  fd.append('image', file);
  try {
    const res = await fetch(`${API}/vendor/bookings/${encodeURIComponent(state.threadBookingId)}/thread/image`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    renderThreadMessages(json.data?.messages || []);
    showToast('Image sent', 'success');
  } catch (err) {
    showToast(err.message || 'Image upload failed', 'error');
  }
  e.target.value = '';
});

function openThreadModal(bookingKey) {
  const key = String(bookingKey || '').trim();
  if (!key) return;
  state.threadBookingId = key;
  document.getElementById('threadModal').classList.remove('hidden');
  loadBookingThread().catch((e) => showToast(e.message, 'error'));
  if (state.threadPollTimer) clearInterval(state.threadPollTimer);
  state.threadPollTimer = setInterval(() => {
    loadBookingThread().catch(() => {});
  }, 15000);
}

async function sendBookingThreadMessage() {
  const ta = document.getElementById('threadInput');
  const text = String(ta.value || '').trim();
  if (!text || !state.threadBookingId) return;
  await apiFetch(`/vendor/bookings/${encodeURIComponent(state.threadBookingId)}/thread`, {
    method: 'POST',
    body: JSON.stringify({ message: text }),
  });
  ta.value = '';
  await loadBookingThread();
  showToast('Message sent', 'success');
}

function renderCalendarGrid() {
  const grid = document.getElementById('calendarGrid');
  const { year, month, bookingsByDate, blackoutDates } = state.calendar;

  const label = new Date(year, month - 1, 1).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
  document.getElementById('calendarMonthLabel').textContent = label;

  const first = new Date(year, month - 1, 1);
  const firstDay = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const headers = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cells = headers.map((h) => `<div class="calendar-cell" style="min-height:auto;font-weight:700;cursor:default;">${h}</div>`);

  for (let i = 0; i < firstDay; i += 1) {
    cells.push('<div class="calendar-cell" style="opacity:0.3"></div>');
  }

  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entries = bookingsByDate[key] || [];
    const hasConfirmed = entries.some((e) => e.status === 'Confirmed');
    const hasPending = entries.some((e) => e.status === 'Pending');
    const hasCancelled = entries.some((e) => e.status === 'Cancelled');
    const isBlackout = blackoutDates.includes(key);

    cells.push(`
      <div class="calendar-cell" data-date="${key}">
        <div class="day-num">${d}</div>
        <div class="calendar-dots">
          ${hasConfirmed ? '<span class="dot dot-green"></span>' : ''}
          ${hasPending ? '<span class="dot dot-yellow"></span>' : ''}
          ${hasCancelled ? '<span class="dot dot-red"></span>' : ''}
          ${isBlackout ? '<span class="dot dot-gray"></span>' : ''}
        </div>
      </div>
    `);
  }

  grid.innerHTML = cells.join('');
}

function renderDayPanel(dateKey) {
  const entries = state.calendar.bookingsByDate[dateKey] || [];
  document.getElementById('selectedDateLabel').textContent = dateKey;
  const list = document.getElementById('dayBookingsList');
  list.innerHTML = entries.length
    ? entries
        .map((b) => `
          <div class="mini-booking">
            <div><strong>${b.customerName}</strong> • ${b.eventType}</div>
            <div>${b.timeSlot?.start || '--'} - ${b.timeSlot?.end || '--'} • ${b.guestCount || 0} guests</div>
            <div><span class="status-chip ${statusClass(b.status)}">${b.status}</span></div>
          </div>
        `)
        .join('')
    : '<div class="mini-booking">No bookings for this day.</div>';

  const markBtn = document.getElementById('markUnavailableBtn');
  if (markBtn) {
    const hasActiveBooking = entries.some((b) => ['Pending', 'Confirmed'].includes(String(b.status || '')));
    markBtn.disabled = hasActiveBooking;
    markBtn.title = hasActiveBooking ? 'Cannot mark unavailable: date has active bookings' : '';
  }
}

async function loadCalendar() {
  const { year, month } = state.calendar;
  const json = await apiFetch(`/vendor/calendar?year=${year}&month=${month}`);
  state.calendar.bookingsByDate = json.data?.bookingsByDate || {};
  state.calendar.blackoutDates = json.data?.blackoutDates || [];
  renderCalendarGrid();
}

async function markUnavailableSelectedDate() {
  if (!state.calendar.selectedDate) {
    showToast('Select a date first', 'error');
    return;
  }

  const dayBookings = state.calendar.bookingsByDate[state.calendar.selectedDate] || [];
  const hasActiveBooking = dayBookings.some((b) => ['Pending', 'Confirmed'].includes(String(b.status || '')));
  if (hasActiveBooking) {
    showToast('This date already has active bookings. Please choose another date.', 'error');
    return;
  }

  const merged = Array.from(new Set([...(state.calendar.blackoutDates || []), state.calendar.selectedDate]));
  await apiFetch('/vendor/blackout-dates', {
    method: 'PUT',
    body: JSON.stringify({ dates: merged }),
  });
  showToast('Date marked as unavailable', 'success');
  await loadCalendar();
  await renderAvailabilityWeek();
}

function getWeekStart(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function fetchDayAvailability(dateKey) {
  if (state.availabilityCache[dateKey]) return state.availabilityCache[dateKey];
  const json = await apiFetch(`/vendor/availability?date=${dateKey}`);
  state.availabilityCache[dateKey] = json.data || { bookedSlots: [], freeSlots: [] };
  return state.availabilityCache[dateKey];
}

async function renderAvailabilityWeek() {
  const root = document.getElementById('availabilityGrid');
  const start = state.availabilityWeekStart || getWeekStart(new Date());
  state.availabilityWeekStart = start;

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  const weekEnd = new Date(days[6]);
  document.getElementById('weekLabel').textContent = `${toDateKey(days[0])} to ${toDateKey(weekEnd)}`;

  const slotDefs = [
    { label: 'Morning (6AM-12PM)', range: { start: '06:00', end: '12:00' } },
    { label: 'Afternoon (12PM-6PM)', range: { start: '12:00', end: '18:00' } },
    { label: 'Evening (6PM-11PM)', range: { start: '18:00', end: '23:00' } },
  ];

  const blackoutSet = new Set(state.calendar.blackoutDates || []);

  const dayCards = [];
  for (const d of days) {
    const key = toDateKey(d);
    const dayData = await fetchDayAvailability(key);
    const isBlackout = blackoutSet.has(key);

    const slotsHtml = slotDefs
      .map((s) => {
        if (isBlackout) {
          return `<div class="slot blackout" data-info="${key} • ${s.label} • Blackout">${s.label}</div>`;
        }
        const booked = (dayData.bookedSlots || []).find((b) => overlap(s.range, { start: b.start, end: b.end }));
        if (booked) {
          return `<div class="slot booked" data-info="${key} • ${s.label} • ${booked.eventType || 'Booked'}">${s.label}</div>`;
        }
        const free = (dayData.freeSlots || []).some((f) => overlap(s.range, { start: f.start, end: f.end }));
        if (free) {
          return `<div class="slot available" data-info="${key} • ${s.label} • Available">${s.label}</div>`;
        }
        return `<div class="slot booked" data-info="${key} • ${s.label} • Unavailable">${s.label}</div>`;
      })
      .join('');

    dayCards.push(`
      <div class="avail-day">
        <h4>${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</h4>
        ${slotsHtml}
      </div>
    `);
  }

  root.innerHTML = dayCards.join('');
}

function renderReviews() {
  const reviewsList = document.getElementById('reviewsList');
  const notesList = document.getElementById('internalNotesList');

  const reviews = state.vendorProfile?.customerRecommendations || [];
  reviewsList.innerHTML = reviews.length
    ? reviews
        .map((r) => `
          <div class="review-item">
            <div class="review-meta">${r.customerName || 'Customer'} • ${r.eventType || 'Event'} • ${r.eventDate ? toDateKey(r.eventDate) : '—'}</div>
            <div>${'⭐'.repeat(Number(r.rating || 0))}</div>
            <div>${r.comment || ''}</div>
          </div>
        `)
        .join('')
    : '<div class="review-item">No customer recommendations yet.</div>';

  const noteBookings = state.bookings.filter((b) => b.vendorNotes);
  notesList.innerHTML = noteBookings.length
    ? noteBookings
        .map((b) => `
          <div class="review-item">
            <div class="review-meta">${b.bookingId} • ${b.eventType} • ${toDateKey(b.eventDate)}</div>
            <div>${b.vendorNotes}</div>
            <div>Internal Rating: ${b.internalRating || '—'}</div>
          </div>
        `)
        .join('')
    : '<div class="review-item">No internal booking notes yet.</div>';
}

function renderEarnings() {
  const earnThisMonthEl = document.getElementById('earnThisMonth');
  const earnLastMonthEl = document.getElementById('earnLastMonth');
  const earnTotalEl = document.getElementById('earnTotal');
  const chartRoot = document.getElementById('earningsChart');
  const body = document.getElementById('earningsBody');
  if (!earnThisMonthEl || !earnLastMonthEl || !earnTotalEl || !chartRoot || !body) return;

  const confirmed = state.bookings.filter((b) => ['Confirmed', 'Completed'].includes(b.status));
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  const monthRevenue = confirmed
    .filter((b) => {
      const d = new Date(b.eventDate);
      return d.getMonth() === month && d.getFullYear() === year;
    })
    .reduce((s, b) => s + Number(b.finalPrice || 0), 0);

  const lastMonthRevenue = confirmed
    .filter((b) => {
      const d = new Date(b.eventDate);
      const lm = new Date(year, month - 1, 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    })
    .reduce((s, b) => s + Number(b.finalPrice || 0), 0);

  const totalOverall = confirmed.reduce((s, b) => s + Number(b.finalPrice || 0), 0);

  // Note: these values are from finalPrice set on confirmed bookings — not system-calculated profit.
  earnThisMonthEl.textContent = fmtMoney(monthRevenue);
  earnLastMonthEl.textContent = fmtMoney(lastMonthRevenue);
  earnTotalEl.textContent = fmtMoney(totalOverall);

  const byMonth = {};
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(year, month - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = 0;
  }
  for (const b of state.bookings) {
    const d = new Date(b.eventDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (Object.prototype.hasOwnProperty.call(byMonth, key)) {
      byMonth[key] += 1;
    }
  }

  const labels = Object.keys(byMonth);
  const values = Object.values(byMonth);
  const maxValue = Math.max(...values, 1);
  chartRoot.innerHTML = labels.map((label, index) => {
    const value = values[index] || 0;
    const heightPct = Math.max(8, Math.round((value / maxValue) * 100));
    return `
      <div class="earnings-bar-item">
        <div class="earnings-bar-track">
          <div class="earnings-bar-fill" style="height:${heightPct}%;"></div>
        </div>
        <div class="earnings-bar-label">${label.slice(5)}</div>
        <div class="earnings-bar-value">${value}</div>
      </div>
    `;
  }).join('');
  state.chart = null;

  body.innerHTML = confirmed.length
    ? confirmed
        .map((b) => `
          <tr>
            <td>${toDateKey(b.eventDate)}</td>
            <td>${b.eventType}</td>
            <td>${b.userId?.name || '—'}</td>
            <td>${fmtMoney(b.finalPrice || 0)}</td>
            <td>${b.paymentStatus || 'Pending'}</td>
          </tr>
        `)
        .join('')
    : '<tr><td colspan="5">No earnings data yet.</td></tr>';
}

async function saveProfile(e) {
  e.preventDefault();
  const payload = {
    phone: document.getElementById('profilePhone').value.trim(),
    whatsappNumber: document.getElementById('profileWhatsapp').value.trim(),
    basePrice: Number(document.getElementById('profileBasePrice').value || 0),
    pricingUnit: document.getElementById('profilePricingUnit').value,
    workingHoursStart: document.getElementById('profileWorkingStart').value,
    workingHoursEnd: document.getElementById('profileWorkingEnd').value,
    amenities: document
      .getElementById('profileAmenities')
      .value.split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    description: document.getElementById('profileDescription').value.trim(),
  };

  await apiFetch('/vendor/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  showToast('Profile updated', 'success');
}

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  window.location.href = './login.html';
}

function bindEvents() {
  document.querySelectorAll('.nav-link[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchSection(btn.dataset.section);
      document.getElementById('sidebar').classList.remove('open');
    });
  });

  document.getElementById('hamburgerBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await logout();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  document.getElementById('applyFiltersBtn').addEventListener('click', async () => {
    state.filters.status = document.getElementById('filterStatus').value;
    state.filters.startDate = document.getElementById('filterStartDate').value;
    state.filters.endDate = document.getElementById('filterEndDate').value;
    state.filters.eventType = document.getElementById('filterEventType').value.trim();
    try {
      showLoader(true);
      await loadBookings(1);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('bookingsPagination').addEventListener('click', async (e) => {
    const page = e.target?.dataset?.page;
    if (!page) return;
    try {
      showLoader(true);
      await loadBookings(Number(page));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.addEventListener('click', async (e) => {
    const action = e.target?.dataset?.action;
    const id = e.target?.dataset?.id;
    if (!action || !id) return;

    try {
      if (action === 'confirm') {
        await confirmBooking(id);
        return;
      }
      showLoader(true);
      if (action === 'cancel') openCancelModal(id);
      if (action === 'chat') openThreadModal(id);
      if (action === 'view') viewBookingDetails(id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('cancelModalClose').addEventListener('click', closeCancelModal);
  document.getElementById('threadModalClose').addEventListener('click', closeThreadModal);
  document.getElementById('threadSendBtn').addEventListener('click', async () => {
    try {
      showLoader(true);
      await sendBookingThreadMessage();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      showLoader(false);
    }
  });
  document.getElementById('cancelModalSubmit').addEventListener('click', async () => {
    try {
      showLoader(true);
      await submitCancelModal();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('prevMonthBtn').addEventListener('click', async () => {
    state.calendar.month -= 1;
    if (state.calendar.month < 1) {
      state.calendar.month = 12;
      state.calendar.year -= 1;
    }
    try {
      showLoader(true);
      await loadCalendar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('nextMonthBtn').addEventListener('click', async () => {
    state.calendar.month += 1;
    if (state.calendar.month > 12) {
      state.calendar.month = 1;
      state.calendar.year += 1;
    }
    try {
      showLoader(true);
      await loadCalendar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('calendarGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.calendar-cell[data-date]');
    if (!cell) return;
    state.calendar.selectedDate = cell.dataset.date;
    renderDayPanel(state.calendar.selectedDate);
  });

  document.getElementById('markUnavailableBtn').addEventListener('click', async () => {
    try {
      showLoader(true);
      await markUnavailableSelectedDate();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('prevWeekBtn').addEventListener('click', async () => {
    const d = new Date(state.availabilityWeekStart);
    d.setDate(d.getDate() - 7);
    state.availabilityWeekStart = d;
    try {
      showLoader(true);
      await renderAvailabilityWeek();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('nextWeekBtn').addEventListener('click', async () => {
    const d = new Date(state.availabilityWeekStart);
    d.setDate(d.getDate() + 7);
    state.availabilityWeekStart = d;
    try {
      showLoader(true);
      await renderAvailabilityWeek();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('availabilityGrid').addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (!slot) return;
    showToast(slot.dataset.info || 'Slot details', 'success');
  });

  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    try {
      showLoader(true);
      await saveProfile(e);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      showLoader(false);
    }
  });

  document.getElementById('portfolioFileInput')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const status = document.getElementById('portfolioUploadStatus');
    if (status) status.textContent = 'Uploading...';
    const formData = new FormData();
    files.forEach((f) => formData.append('images', f));
    try {
      const res = await fetch(`${API}/vendor/portfolio`, {
        method: 'POST', credentials: 'include', body: formData,
      });
      const json = await res.json();
      if (json.success) {
        state.vendorProfile = state.vendorProfile || {};
        state.vendorProfile.portfolioImages = json.data?.portfolioImages || [];
        // Refresh profile so captions and any server-normalized fields stay in sync.
        try {
          const latestProfile = await apiFetch('/vendor/profile');
          state.vendorProfile = latestProfile.data?.vendorProfile || state.vendorProfile;
        } catch {
          // Best-effort refresh.
        }
        await loadPortfolioImages();
        if (status) status.textContent = '✅ Uploaded!';
      } else {
        if (status) status.textContent = '❌ Upload failed';
      }
    } catch (err) {
      if (status) status.textContent = '❌ Error uploading';
    }
    setTimeout(() => {
      if (status) status.textContent = '';
    }, 3000);
    e.target.value = '';
  });

  document.getElementById('saveMenuBtn')?.addEventListener('click', async () => {
    const parseItems = (id) => document.getElementById(id)?.value?.split('\n').map(s => s.trim()).filter(Boolean) || [];
    const payload = {
      per_plate_base: Number(document.getElementById('menuBasePrice')?.value || 0),
      total_items: Number(document.getElementById('menuTotalItems')?.value || 0),
      packages: {
        economy: {
          per_plate: Number(document.getElementById('menuEconomyPrice')?.value || 0),
          description: document.getElementById('menuEconomyDesc')?.value?.trim() || '',
          items: parseItems('menuEconomyItems'),
        },
        standard: {
          per_plate: Number(document.getElementById('menuStandardPrice')?.value || 0),
          description: document.getElementById('menuStandardDesc')?.value?.trim() || '',
          items: parseItems('menuStandardItems'),
        },
        premium: {
          per_plate: Number(document.getElementById('menuPremiumPrice')?.value || 0),
          description: document.getElementById('menuPremiumDesc')?.value?.trim() || '',
          items: parseItems('menuPremiumItems'),
        },
      },
    };

    try {
      await apiFetch('/vendor/menu', { method: 'PUT', body: JSON.stringify(payload) });
      document.getElementById('menuSaveStatus').textContent = '✅ Menu saved successfully!';
      setTimeout(() => { document.getElementById('menuSaveStatus').textContent = ''; }, 3000);
      showToast('Menu card updated', 'success');
    } catch (err) {
      document.getElementById('menuSaveStatus').textContent = '❌ ' + (err.message || 'Save failed');
    }
  });
}

async function init() {
  try {
    showLoader(true);
    await loadAuthProfile();
    await loadVendorProfile();
    await loadBookings(1);
    await loadCalendar();
    state.availabilityWeekStart = getWeekStart(new Date());
    await renderAvailabilityWeek();
    bindEvents();
    switchSection('overview');
  } catch (err) {
    showToast(err.message || 'Failed to initialize dashboard', 'error');
  } finally {
    showLoader(false);
  }
}

document.addEventListener('DOMContentLoaded', init);
