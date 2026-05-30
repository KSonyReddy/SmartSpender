const BASE_URL = 'http://localhost:5002';
const API_BASE = `${BASE_URL}/api`;
const TIMEOUT_MS = 30000;
const MAP_ENABLED = false;

const BASE_SERVICE_OPTIONS = ['Function Hall', 'Catering', 'Decoration', 'Photography', 'Videography', 'DJ', 'Florist', 'Dresses / Makeup', 'Band', 'Tent'];
const RELIGION_OPTIONS = ['Hindu', 'Muslim', 'Christian', 'Jain', 'All Religions'];
const QUALITY_OPTIONS = ['Economy', 'Standard', 'Premium'];
const EVENT_TYPE_OPTIONS = ['Wedding', 'Reception', 'Engagement', 'Birthday', 'Naming Ceremony', 'Thread Ceremony', 'Other'];
const CITY_OPTIONS = ['Hyderabad', 'Warangal', 'Karimnagar', 'Nizamabad', 'Khammam', 'Nalgonda', 'Other'];

let googleMap = null;
let mapMarkers = [];

const WELCOME_MESSAGE = `Namaste! 🙏 I'm your Smart Spender — think of me as your calm, organised coordinator for Telanga
events.

We'll lock in your basics (type, place, date, guests, budget, services) and then match vendors realistically. You can change budget or details anytime — real events shift, and that's normal.

Type your message to continue.`;

const state = {
  messages: [],
  historyGroups: [],
  selectedHistoryId: null,
  activeConversationId: null,
  lastUserMessage: '',
  lastEventPlan: null,
  vendorThread: {
    open: false,
    bookingRef: null,
    messages: [],
    pollTimer: null,
  },
  summary: {
    eventType: null,
    date: null,
    location: null,
    guests: null,
    budget: null,
    religion: null,
    requirements: null,
  },
  typing: false,
  historyRefreshTimer: null,
  bookingRefreshTimer: null,
  currentUserProfile: null,
  vendorDetailsMap: new Map(),
  selectedVendors: {},
  userBookings: [],
  bookingsRequestInFlight: null,
  bookingsRateLimitedUntil: 0,
  bookingsLastLoadedAt: 0,
  panelLayout: {
    leftHidden: false,
    leftEnlarged: false,
    rightHidden: false,
    rightEnlarged: false,
    leftWidth: 250,
    rightWidth: 300,
  },
};

const el = {
  historyList: document.getElementById('historyList'),
  plansDrawer: document.getElementById('plansDrawer'),
  plansList: document.getElementById('plansList'),
  messages: document.getElementById('messages'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  statusLine: document.getElementById('statusLine'),
  regenerateBtn: document.getElementById('regenerateBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  myPlansBtn: document.getElementById('myPlansBtn'),
  savePlanBtn: document.getElementById('savePlanBtn'),
  toggleLeftPanelBtn: document.getElementById('toggleLeftPanelBtn'),
  enlargeLeftPanelBtn: document.getElementById('enlargeLeftPanelBtn'),
  toggleRightPanelBtn: document.getElementById('toggleRightPanelBtn'),
  enlargeRightPanelBtn: document.getElementById('enlargeRightPanelBtn'),
  toggleSummaryBtn: document.getElementById('toggleSummaryBtn'),
  rightPanel: document.getElementById('rightPanel'),
  leftPanel: document.getElementById('leftPanel'),
  leftResizeHandle: document.getElementById('leftResizeHandle'),
  rightResizeHandle: document.getElementById('rightResizeHandle'),
  tabHistoryBtn: document.getElementById('tabHistoryBtn'),
  tabChatBtn: document.getElementById('tabChatBtn'),
  tabSummaryBtn: document.getElementById('tabSummaryBtn'),
  sumEventType: document.getElementById('sumEventType'),
  sumDate: document.getElementById('sumDate'),
  sumLocation: document.getElementById('sumLocation'),
  sumGuests: document.getElementById('sumGuests'),
  sumPlannedBudget: document.getElementById('sumPlannedBudget'),
  sumAfterBookingBudget: document.getElementById('sumAfterBookingBudget'),
  sumBudgetNote: document.getElementById('sumBudgetNote'),
  sumReligion: document.getElementById('sumReligion'),
  sumRequirements: document.getElementById('sumRequirements'),
  changeBudgetBtn: document.getElementById('changeBudgetBtn'),
  summaryBudgetEditor: document.getElementById('summaryBudgetEditor'),
  summaryBudgetInput: document.getElementById('summaryBudgetInput'),
  applyBudgetBtn: document.getElementById('applyBudgetBtn'),
  cancelBudgetBtn: document.getElementById('cancelBudgetBtn'),
  budgetChart: document.getElementById('budgetChart'),
  budgetBar: document.getElementById('budgetBar'),
  budgetLegend: document.getElementById('budgetLegend'),
  mapSection: document.getElementById('mapSection'),
  vendorMap: document.getElementById('vendorMap'),
  closeMapBtn: document.getElementById('closeMapBtn'),
  showMapBtn: document.getElementById('showMapBtn'),
  refreshBookingsBtn: document.getElementById('refreshBookingsBtn'),
  userBookingsList: document.getElementById('userBookingsList'),
};

window.initGoogleMaps = function() {
  if (!MAP_ENABLED) return;
  console.log('Google Maps API loaded successfully');
  // Map will be initialized when user clicks "Show Vendor Map"
  if (window.google && window.google.maps) {
    console.log('✅ Google Maps ready');
  } else {
    console.warn('⚠️ Google Maps library not available');
  }
};

window.gmap_error = function(error) {
  if (!MAP_ENABLED) return;
  console.error('❌ Google Maps API Error:', error);
  const mapSection = document.getElementById('mapSection');
  if (mapSection) {
    mapSection.innerHTML = `
      <div style="padding:12px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; color:#7f1d1d;">
        <strong>Map unavailable</strong>
        <p style="font-size:12px; margin:4px 0 0 0;">Google Maps API is not activated. Please contact support or view vendor details below.</p>
      </div>
    `;
  }
};

function toDateLabel(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getReligiousServiceOptionLabel(religion) {
  const r = String(religion || '').toLowerCase();
  if (r === 'christian') return '⛪ Father / Pastor';
  if (r === 'muslim') return '🕌 Maulvi / Qazi';
  if (r === 'hindu') return '🙏 Priest / Pandit';
  if (r === 'jain') return '🙏 Jain Priest';
  return 'Religious Officiant';
}

function getServiceOptionsForReligion(religion) {
  const r = String(religion || '').toLowerCase();

  // Keep a single venue label so it always maps cleanly to Mongo vendor category data.
  const venueOptions = ['Function Hall'];

  const nonVenue = BASE_SERVICE_OPTIONS.filter((x) => x !== 'Function Hall');
  const religiousLabel = getReligiousServiceOptionLabel(religion);

  // Band / Nadaswaram is Hindu-tradition specific.
  let filteredNonVenue = nonVenue;
  if (r === 'muslim') {
    filteredNonVenue = nonVenue.filter((x) => !/^Band/i.test(x));
  }

  return [...venueOptions, ...filteredNonVenue, religiousLabel];
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderAiText(content) {
  const raw = String(content || '');
  if (window.marked) return marked.parse(raw);

  // Fallback when markdown library is unavailable.
  const plain = raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ');

  return escapeHtml(plain).replace(/\n/g, '<br>');
}

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

function normalizeMenuPayload(menu = {}, vendorName = '') {
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

  const packages = menu.packages
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
    packages.standard.per_plate,
    packages.economy.per_plate,
    packages.premium.per_plate,
  ];
  const totalItemsCandidates = [
    menu.total_items,
    menu.totalItems,
    menu.total_menu_items,
    packages.economy.items.length,
    packages.standard.items.length,
    packages.premium.items.length,
  ];

  const perPlateBase = baseCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0;
  const totalItems = totalItemsCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0;

  return {
    vendor_name: menu.vendor_name || vendorName || 'Vendor',
    vendor_city: menu.vendor_city || menu.city || '',
    category: menu.category || '',
    per_plate_base: perPlateBase,
    total_items: totalItems,
    packages,
    description: String(menu.description || '').trim(),
    city: menu.city || '',
    area: menu.area || '',
  };
}

function buildMenuBubbleLines(menu, vendorName) {
  const displayName = menu.vendor_name || vendorName || 'Vendor';
  const city = [menu.vendor_city, menu.area].filter(Boolean).join(', ');
  const lines = [`🍽️ **${displayName}** — Menu`];

  const basePrice = Number(menu.per_plate_base || 0);
  const packageItemCountForBasePrice = [menu.packages?.economy, menu.packages?.standard, menu.packages?.premium]
    .map((pkg) => ({
      perPlate: Number(pkg?.per_plate || 0),
      count: Array.isArray(pkg?.items) ? pkg.items.length : 0,
    }))
    .find((pkg) => pkg.perPlate > 0 && pkg.perPlate === basePrice && pkg.count > 0)?.count || 0;

  const headerItemsCount = packageItemCountForBasePrice || Number(menu.total_items || 0);

  const metaBits = [city, menu.category, basePrice ? `₹${basePrice.toLocaleString('en-IN')} / plate` : '', headerItemsCount ? `${headerItemsCount} items` : '']
    .filter(Boolean);
  if (metaBits.length) {
    lines.push(metaBits.join('  ·  '));
  }

  if (menu.description) {
    lines.push('', `_${menu.description}_`);
  }

  const packageRows = [
    ['Economy', menu.packages?.economy],
    ['Standard', menu.packages?.standard],
    ['Premium', menu.packages?.premium],
  ];

  packageRows.forEach(([label, pkg]) => {
    if (!pkg) return;
    const hasContent = pkg.per_plate > 0 || pkg.description || (pkg.items && pkg.items.length);
    if (!hasContent) return;
    const packageLine = [`**${label} Package**`];
    if (pkg.per_plate > 0) packageLine.push(`₹${Number(pkg.per_plate).toLocaleString('en-IN')}/plate`);
    if (pkg.description) packageLine.push(pkg.description);
    lines.push('', packageLine.join(' — '));
    if (Array.isArray(pkg.items) && pkg.items.length) {
      lines.push(pkg.items.slice(0, 10).map((item) => `• ${item}`).join('\n'));
    }
  });

  if (!lines.some((line) => /Package/i.test(line))) {
    lines.push('', '_Menu details are available, but package-level items are not set yet._');
  }

  return lines;
}

function fmtINR(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 'Not set';
  return `₹${n.toLocaleString('en-IN')}`;
}

function setStatus(text = '') {
  el.statusLine.textContent = text;
}

function showToast(message, type = 'success') {
  const prefix = type === 'error' ? 'Error: ' : '';
  setStatus(`${prefix}${String(message || '')}`);
}

function syncPanelLayoutButtons() {
  if (el.toggleLeftPanelBtn) el.toggleLeftPanelBtn.textContent = state.panelLayout.leftHidden ? '☰' : '◀';
  if (el.enlargeLeftPanelBtn) el.enlargeLeftPanelBtn.textContent = state.panelLayout.leftEnlarged ? '↔' : '↔';
  if (el.toggleRightPanelBtn) el.toggleRightPanelBtn.textContent = state.panelLayout.rightHidden ? '☰' : '▶';
  if (el.enlargeRightPanelBtn) el.enlargeRightPanelBtn.textContent = state.panelLayout.rightEnlarged ? '↔' : '↔';
  if (el.toggleSummaryBtn && el.rightPanel) {
    el.toggleSummaryBtn.textContent = el.rightPanel.classList.contains('collapsed') ? '◀' : '▶';
  }
}

function syncResizeHandleVisibility() {
  if (el.leftResizeHandle) el.leftResizeHandle.style.display = state.panelLayout.leftHidden ? 'none' : '';
  if (el.rightResizeHandle) el.rightResizeHandle.style.display = state.panelLayout.rightHidden ? 'none' : '';
}

function applyPanelState(panelEl, hidden, enlarged, width, defaultWidth, enlargedWidth, enlargedClass = 'enlarged') {
  if (!panelEl) return;
  panelEl.classList.toggle('hidden', !!hidden);
  panelEl.classList.toggle(enlargedClass, !!enlarged && !hidden);
  if (hidden) {
    panelEl.style.width = '0px';
    panelEl.style.flexBasis = '0px';
    panelEl.style.minWidth = '0px';
    return;
  }

  const targetWidth = Number(width || 0) || (enlarged ? enlargedWidth : defaultWidth);
  panelEl.style.width = `${targetWidth}px`;
  panelEl.style.flexBasis = `${targetWidth}px`;
  panelEl.style.minWidth = `${targetWidth}px`;
}

function setLeftPanelHidden(hidden) {
  state.panelLayout.leftHidden = !!hidden;
  if (hidden) state.panelLayout.leftEnlarged = false;
  applyPanelState(el.leftPanel, state.panelLayout.leftHidden, state.panelLayout.leftEnlarged, state.panelLayout.leftWidth, 250, 340);
  syncResizeHandleVisibility();
  syncPanelLayoutButtons();
}

function setLeftPanelEnlarged(enlarged) {
  state.panelLayout.leftEnlarged = !!enlarged;
  if (enlarged) state.panelLayout.leftHidden = false;
  state.panelLayout.leftWidth = enlarged ? 340 : 250;
  applyPanelState(el.leftPanel, state.panelLayout.leftHidden, state.panelLayout.leftEnlarged, state.panelLayout.leftWidth, 250, 340);
  syncResizeHandleVisibility();
  syncPanelLayoutButtons();
}

function setRightPanelHidden(hidden) {
  state.panelLayout.rightHidden = !!hidden;
  if (hidden) state.panelLayout.rightEnlarged = false;
  applyPanelState(el.rightPanel, state.panelLayout.rightHidden, state.panelLayout.rightEnlarged, state.panelLayout.rightWidth, 300, 360);
  syncResizeHandleVisibility();
  syncPanelLayoutButtons();
}

function setRightPanelEnlarged(enlarged) {
  state.panelLayout.rightEnlarged = !!enlarged;
  if (enlarged) state.panelLayout.rightHidden = false;
  state.panelLayout.rightWidth = enlarged ? 360 : 300;
  applyPanelState(el.rightPanel, state.panelLayout.rightHidden, state.panelLayout.rightEnlarged, state.panelLayout.rightWidth, 300, 360);
  syncResizeHandleVisibility();
  syncPanelLayoutButtons();
}

function setLeftPanelWidth(width) {
  const nextWidth = Math.max(190, Math.min(420, Math.round(width)));
  state.panelLayout.leftHidden = false;
  state.panelLayout.leftEnlarged = false;
  state.panelLayout.leftWidth = nextWidth;
  applyPanelState(el.leftPanel, false, false, nextWidth, 250, 340);
  syncResizeHandleVisibility();
  syncPanelLayoutButtons();
}

function setRightPanelWidth(width) {
  const maxWidth = Math.max(260, Math.min(460, Math.round(width)));
  state.panelLayout.rightHidden = false;
  state.panelLayout.rightEnlarged = false;
  state.panelLayout.rightWidth = maxWidth;
  applyPanelState(el.rightPanel, false, false, maxWidth, 300, 360);
  syncResizeHandleVisibility();
  syncPanelLayoutButtons();
}

function setupPanelDragResize(handleEl, side) {
  if (!handleEl) return;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const onMove = (event) => {
    if (!dragging) return;
    const delta = event.clientX - startX;
    if (side === 'left') {
      setLeftPanelWidth(startWidth + delta);
    } else {
      setRightPanelWidth(startWidth - delta);
    }
  };

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    handleEl.classList.remove('active');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
  };

  handleEl.addEventListener('pointerdown', (event) => {
    const panelEl = side === 'left' ? el.leftPanel : el.rightPanel;
    if (!panelEl || panelEl.classList.contains('hidden')) return;
    dragging = true;
    startX = event.clientX;
    startWidth = panelEl.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    handleEl.classList.add('active');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    event.preventDefault();
  });
}

function autoResizeInput() {
  el.chatInput.style.height = 'auto';
  el.chatInput.style.height = `${Math.min(el.chatInput.scrollHeight, 140)}px`;
}

function scrollToBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

function redirectToLogin() {
  window.location.href = './login.html';
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
      signal: controller.signal,
    });

    if (res.status === 401) {
      redirectToLogin();
      throw new Error('Session expired');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || 'Request failed');
      err.status = res.status;
      throw err;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Network timeout after 30 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function renderTyping(show) {
  state.typing = show;
  const existing = document.getElementById('typingIndicator');
  if (!show) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const wrap = document.createElement('div');
  wrap.id = 'typingIndicator';
  wrap.className = 'msg ai';
  wrap.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  el.messages.appendChild(wrap);
  scrollToBottom();
}

function normalizeServiceFilterKey(value) {
  const s = String(value || '').toLowerCase().trim();
  if (!s) return 'other';
  if (s.includes('hall') || s.includes('venue') || s.includes('church') || s.includes('farmhouse') || s.includes('resort') || s.includes('banquet') || s.includes('garden') || s === 'venue') return 'venue';
  if (s.includes('cater') || s === 'catering') return 'catering';
  if (s.includes('decor') || s === 'decoration') return 'decoration';
  if (s.includes('photo') || s === 'photography') return 'photography';
  if (s.includes('video') || s === 'videography') return 'videography';
  if (s.includes('dj') || s.includes('music') || s === 'dj') return 'dj';
  if (s.includes('florist') || s.includes('flower') || s === 'florist') return 'florist';
  if (s.includes('dress') || s.includes('makeup') || s.includes('stylist') || s === 'dresses') return 'dresses';
  if (s.includes('priest') || s.includes('religious') || s.includes('pandit') || s.includes('maulvi') || s.includes('qazi') || s.includes('pastor') || s.includes('father') || s === 'priest') return 'priest';
  if (s.includes('band') || s.includes('nadaswaram') || s === 'band') return 'band';
  if (s.includes('tent') || s.includes('shamiana') || s === 'tent') return 'tent';
  return s;
}

const CATEGORY_TO_SERVICE_KEY = {
  caterer: 'catering',
  catering: 'catering',
  food: 'catering',
  'function hall': 'venue',
  'kalyana vedika': 'venue',
  banquet: 'venue',
  resort: 'venue',
  farmhouse: 'venue',
  'marriage garden': 'venue',
  'open ground': 'venue',
  hall: 'venue',
  venue: 'venue',
  church: 'venue',
  decor: 'decoration',
  decoration: 'decoration',
  photographer: 'photography',
  photography: 'photography',
  videographer: 'videography',
  videography: 'videography',
  dj: 'dj',
  music: 'dj',
  florist: 'florist',
  flower: 'florist',
  dress: 'dresses',
  makeup: 'dresses',
  stylist: 'dresses',
  priest: 'priest',
  pandit: 'priest',
  maulvi: 'priest',
  pastor: 'priest',
  qazi: 'priest',
  father: 'priest',
  band: 'band',
  nadaswaram: 'band',
  tent: 'tent',
  shamiana: 'tent',
};

function resolveServiceCategoryKey(value) {
  const raw = String(value || '').toLowerCase().trim();
  const normalized = normalizeServiceFilterKey(raw);

  if (CATEGORY_TO_SERVICE_KEY[raw]) return CATEGORY_TO_SERVICE_KEY[raw];
  if (CATEGORY_TO_SERVICE_KEY[normalized]) return CATEGORY_TO_SERVICE_KEY[normalized];

  const rawMatch = Object.keys(CATEGORY_TO_SERVICE_KEY).find((k) => raw.includes(k));
  if (rawMatch) return CATEGORY_TO_SERVICE_KEY[rawMatch];

  const normalizedMatch = Object.keys(CATEGORY_TO_SERVICE_KEY).find((k) => normalized.includes(k));
  if (normalizedMatch) return CATEGORY_TO_SERVICE_KEY[normalizedMatch];

  return normalized;
}

function getBookingBudgetContext(vendorId, vendorName) {
  const vendorDetails = state.vendorDetailsMap?.get(vendorId) || state.vendorDetailsMap?.get(vendorName) || null;
  const selected = state.selectedVendors || {};
  const selectedEntry = selected[String(vendorId || '').trim()] || selected[String(vendorName || '').trim()] || null;
  const categoryLabel = String(vendorDetails?.category || vendorDetails?.businessType || selectedEntry?.serviceCategory || vendorName || '').trim();
  const serviceKey = resolveServiceCategoryKey(categoryLabel);
  const breakdown = state.lastEventPlan?.budget_breakdown || {};
  const serviceBudget = Number(breakdown?.[serviceKey] || 0)
    || Number(vendorDetails?.estimated_cost || vendorDetails?.base_price || selectedEntry?.estimated_cost || selectedEntry?.base_price || 0)
    || 0;
  const eventBudget = Number(String(state.summary?.budget || '').replace(/[^\d.]/g, '')) || Number(state.lastEventPlan?.budget_breakdown?.total || state.lastEventPlan?.total_estimated_cost || 0) || 0;

  return {
    vendorDetails,
    serviceKey,
    serviceBudget,
    eventBudget,
  };
}

function getSelectedServicesForPlan(plan) {
  return plan?.selectedServices
    || plan?.selected_services
    || plan?.ai_context?.services
    || plan?.ai_context?.selected_services
    || [];
}

function renderCategoryFilterButtons(selectedServices) {
  if (!selectedServices || selectedServices.length === 0) return '';

  const uniqueServices = [...new Map(
    selectedServices.map((service) => [
      resolveServiceCategoryKey(service),
      String(service || '').trim(),
    ])
  ).entries()];

  return `
    <div class="vendor-filter-panel" style="margin-bottom:12px;padding:10px;background:#f8fafc;border-radius:8px;">
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:8px;">🔍 Filter vendors by category:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        <button class="category-filter-btn active" data-category="all"
          style="padding:6px 12px;border:1.5px solid #e5e7eb;background:#fff;border-radius:6px;cursor:pointer;font-size:0.85rem;transition:all 0.2s;">
          All (${uniqueServices.length})
        </button>
        ${uniqueServices.map(([key, label]) => `
          <button class="category-filter-btn" data-category="${escapeHtml(key)}"
            style="padding:6px 12px;border:1.5px solid #e5e7eb;background:#fff;border-radius:6px;cursor:pointer;font-size:0.85rem;transition:all 0.2s;">
            ${escapeHtml(label)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderVendorCards(vendors = []) {
  if (!Array.isArray(vendors) || vendors.length === 0) return '';

  // Get selected services from the last event plan
  const selectedServices = state.lastEventPlan?.selectedServices
    || state.lastEventPlan?.selected_services
    || state.lastEventPlan?.ai_context?.services
    || state.lastEventPlan?.ai_context?.selected_services
    || [];

  // If we have selected services, filter vendors to match only those categories
  let filteredVendors = vendors;
  if (Array.isArray(selectedServices) && selectedServices.length > 0) {
    const normalizedServices = selectedServices.map((s) => String(s).toLowerCase().trim());

    filteredVendors = vendors.filter((vendor) => {
      const vendorCategory = String(vendor.category || '').toLowerCase().trim();

      return normalizedServices.some((service) => {
        if (service.includes('hall') || service.includes('venue') || service === 'venue') {
          return vendorCategory.includes('hall') || vendorCategory.includes('venue') || vendorCategory.includes('church');
        }
        if (service.includes('cater') || service === 'catering') {
          return vendorCategory.includes('cater');
        }
        if (service.includes('decor') || service === 'decoration') {
          return vendorCategory.includes('decor');
        }
        if (service.includes('photo') || service === 'photography') {
          return vendorCategory.includes('photo');
        }
        if (service.includes('video') || service === 'videography') {
          return vendorCategory.includes('video');
        }
        if (service.includes('dj') || service === 'dj') {
          return vendorCategory.includes('dj') || vendorCategory.includes('music');
        }
        if (service.includes('florist') || service.includes('flower') || service === 'florist') {
          return vendorCategory.includes('florist') || vendorCategory.includes('flower');
        }
        if (service.includes('dress') || service.includes('makeup') || service === 'dresses') {
          return vendorCategory.includes('dress') || vendorCategory.includes('makeup') || vendorCategory.includes('stylist');
        }
        if (service.includes('priest') || service.includes('religious') || service === 'priest') {
          return vendorCategory.includes('priest') || vendorCategory.includes('pandit')
            || vendorCategory.includes('maulvi') || vendorCategory.includes('pastor') || vendorCategory.includes('father') || vendorCategory.includes('qazi');
        }
        if (service.includes('band') || service === 'band') {
          return vendorCategory.includes('band') || vendorCategory.includes('nadaswaram');
        }
        if (service.includes('tent') || service === 'tent') {
          return vendorCategory.includes('tent') || vendorCategory.includes('shamiana');
        }

        return vendorCategory.includes(service) || service.includes(vendorCategory);
      });
    });
  }

  const seenVendorIds = new Set();
  const uniqueVendors = filteredVendors.filter((v) => {
    const id = String(v.vendor_id || v.vendor_name || '').toLowerCase().trim();
    if (!id || seenVendorIds.has(id)) return false;
    seenVendorIds.add(id);
    return true;
  });

  if (!uniqueVendors.length) return '';
  state.vendorDetailsMap = state.vendorDetailsMap || new Map();

  const budgetBreakdown = state.lastEventPlan?.budget_breakdown || {};
  const SERVICE_LABELS = {
    venue: 'Function Hall',
    catering: 'Catering',
    decoration: 'Decoration',
    photography: 'Photography',
    videography: 'Videography',
    dj: 'DJ',
    florist: 'Florist',
    dresses: 'Dresses / Makeup',
    priest: 'Religious Officiant',
    band: 'Band',
    tent: 'Tent / Shamiana',
    other: 'Service',
  };

  const isHardOverBudget = (vendor) => {
    const fitTag = String(vendor?.budget_fit_tag || '').toLowerCase();
    if (fitTag !== 'above_budget') return false;
    const serviceKey = resolveServiceCategoryKey(vendor?.category || 'other');
    const serviceBudget = Number(budgetBreakdown?.[serviceKey] || 0);
    const delta = Number(vendor?.budget_delta || 0);
    if (!(serviceBudget > 0)) return false;
    return delta > serviceBudget * 0.2;
  };

  // Group by category
  const grouped = new Map();
  for (const v of uniqueVendors) {
    const cat = String(v.category || 'Other').trim();
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push(v);
    const lookupId = String(v.vendor_id || v.vendor_name || '').trim();
    if (lookupId) state.vendorDetailsMap.set(lookupId, v);
  }

  const singleCard = (v) => {
    const rating = Number(v.rating || 0);
    const stars  = '⭐'.repeat(Math.min(5, Math.round(rating)));
    const price  = v.estimated_cost || v.base_price || 0;
    const loc    = [v.city, v.area].filter(Boolean).join(', ') || 'Telangana';
    const phone  = v.phone || v.contact_number || v.vendor_phone || '';
    const isNearby = v.distance_label && v.distance_label !== 'In city';
    const isCatering = /caterer|catering|food/i.test(v.category || '');
    const amenities = Array.isArray(v.amenities)
      ? v.amenities.slice(0, 4).map(a => `<span class="vendor-tag">${escapeHtml(a)}</span>`).join('')
      : '';

    let statusHtml = '';
    if (v.availability_status === 'available')
      statusHtml = '<span class="vs-badge vs-ok">✅ Available</span>';
    else if (v.availability_status === 'booked')
      statusHtml = '<span class="vs-badge vs-bad">⛔ Booked</span>';
    else
      statusHtml = '<span class="vs-badge vs-warn">⚠️ Check</span>';

    const budgetTag = v.budget_fit_tag === 'in_budget'
      ? '<span class="vs-badge vs-ok">In Budget</span>'
      : v.budget_fit_tag === 'slightly_above_budget'
        ? `<span class="vs-badge vs-warn">+₹${Number(v.budget_delta||0).toLocaleString('en-IN')} over</span>`
        : '';

    const imageBtn = '';

    const menuBtn = isCatering
      ? `<button class="vendor-btn" type="button"
           onclick="window.openVendorMenu('${escapeHtml(v.vendor_id || v.vendor_name)}','${escapeHtml(v.vendor_name || '')}')">
           🍽️ Menu
         </button>`
      : '';

      const cardCategory = resolveServiceCategoryKey(v.category || 'other');
      const vendorIdKey = String(v.vendor_id || '').trim();
      const vendorNameKey = String(v.vendor_name || '').trim();
      const existingBooking = state.userBookings?.find((b) =>
        b.vendorDatasetId === v.vendor_id
        || String(b.vendorDatasetId || '') === String(v.vendor_id || '')
        || String(b.vendorId?._id || '') === String(v.vendor_id || '')
      );
      const isSelected = !!(
        (vendorIdKey && state.selectedVendors?.[vendorIdKey])
        || (vendorNameKey && state.selectedVendors?.[vendorNameKey])
      );
      const selectedBadgeHtml = isSelected
        ? '<div class="vendor-accepted-badge" style="position:absolute;top:8px;left:8px;background:#16a34a;color:#fff;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;z-index:2;">✅ Selected</div>'
        : '';
      const bookingStatusChipHtml = existingBooking
        ? `<span class="booking-status-chip status-${escapeHtml(String(existingBooking.status || 'Pending').toLowerCase())}">
             ${String(existingBooking.status || '') === 'Confirmed'
               ? '✅ Confirmed'
               : String(existingBooking.status || '') === 'Pending'
                 ? '⏳ Pending Confirmation'
                 : escapeHtml(String(existingBooking.status || 'Booked'))}
           </span>`
        : '';
      return `
      <div class="vendor-card ${v.budget_fit_tag === 'in_budget' ? 'vendor-card-inbudget' : ''} ${isSelected ? 'vendor-card-selected' : ''}" data-category="${escapeHtml(cardCategory)}" style="${isSelected ? 'border:2px solid #16a34a;background:#f0fdf4;position:relative;' : ''}">
        ${selectedBadgeHtml}
        ${isNearby ? `<div class="vendor-card-badge">${v.is_nearby === true ? '🚗 Nearby vendor' : `🚗 ${escapeHtml(v.distance_label || 'Travels')}`}</div>` : ''}
        <div class="vendor-card-header">
          <div class="vendor-card-name">${escapeHtml(v.vendor_name || 'Vendor')}</div>
          <div class="vendor-card-category">${escapeHtml(v.category || '')} · ${escapeHtml(loc)}</div>
          ${bookingStatusChipHtml}
        </div>
        <div class="vendor-meta-row">
          ${stars} <span style="font-size:0.78rem;color:#6b7280;">${rating.toFixed(1)}/5</span>
          ${statusHtml} ${budgetTag}
        </div>
        ${price ? `<div class="vendor-price">₹${Number(price).toLocaleString('en-IN')}</div>` : ''}
        ${phone ? `<div class="vendor-contact">📞 <strong>${escapeHtml(phone)}</strong></div>` : ''}
        
        ${amenities ? `<div class="vendor-amenities">${amenities}</div>` : ''}
        <div class="vendor-actions">
          ${menuBtn}
          ${imageBtn}
          <button class="vendor-btn" type="button"
            onclick="window.showVendorDetail('${escapeHtml(v.vendor_id || v.vendor_name)}','${escapeHtml(v.vendor_name || '')}')">
            👁️ View Details
          </button>
          <button class="vendor-btn" type="button"
            onclick="window.handleVendorSelect('${escapeHtml(v.vendor_id || v.vendor_name)}','${escapeHtml(v.vendor_name || '')}')">
            ✓ Select
          </button>
          <button class="vendor-btn vendor-btn-primary" type="button"
            onclick="window.openBookingModal('${escapeHtml(v.vendor_id || v.vendor_name)}','${escapeHtml(v.vendor_name || '')}')">
            📅 Book
          </button>
        </div>
      </div>
    `;
  };

  const sections = Array.from(grouped.entries()).map(([cat, catVendors]) => {
    const visibleVendors = catVendors.filter((v) => !isHardOverBudget(v));
    const serviceKey = resolveServiceCategoryKey(cat);
    const serviceLabel = SERVICE_LABELS[serviceKey] || cat || 'Service';
    if (!visibleVendors.length) {
      return `
    <div class="vendor-category-section">
      <div class="vendor-category-label">${escapeHtml(cat)} (0)</div>
      <div class="vendor-cards-row">
        <div class="vendor-empty-state" style="padding:12px;border:1px dashed #cbd5e1;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:0.9rem;">
          No vendors found within your budget for ${escapeHtml(serviceLabel)}. Try increasing budget or relaxing filters.
        </div>
      </div>
    </div>
  `;
    }
    return `
    <div class="vendor-category-section">
      <div class="vendor-category-label">${escapeHtml(cat)} (${visibleVendors.length})</div>
      <div class="vendor-cards-row">
        ${visibleVendors.map(singleCard).join('')}
      </div>
    </div>
  `;
  }).join('');

  return `<div class="vendor-cards-grouped">${sections}</div>`;
}

window.handleVendorSelect = function(vendorId, vendorName) {
  state.selectedVendors = state.selectedVendors || {};
  const key = String(vendorId || vendorName || '').trim();
  if (key) {
    state.selectedVendors[key] = {
      vendorId: String(vendorId || '').trim(),
      vendorName: String(vendorName || '').trim(),
      timestamp: Date.now(),
    };
  }

  renderMessages();
  setStatus(`Added ${vendorName} to shortlist.`);

  // Pre-fill booking modal
  if (el.chatInput) {
    el.chatInput.value = '';
    el.chatInput.focus();
  }
};

window.openBookingModal = function(vendorId, vendorName) {
  const modal = document.getElementById('bookingModal');
  if (!modal) {
    console.error('Booking modal not found');
    return;
  }
  
  const backdrop = document.getElementById('bookingBackdrop');
  if (backdrop) backdrop.style.display = 'block';
  modal.style.display = 'block';
  
  // Store vendor info for booking
  modal.dataset.vendorId = vendorId;
  modal.dataset.vendorName = vendorName;
  const vendorDetails = state.vendorDetailsMap?.get(vendorId) || state.vendorDetailsMap?.get(vendorName) || null;
  const vendorArea = [vendorDetails?.area, vendorDetails?.city].filter(Boolean).join(', ');
  modal.dataset.vendorArea = vendorArea;
  const budgetContext = getBookingBudgetContext(vendorId, vendorName);
  modal.dataset.serviceKey = budgetContext.serviceKey;
  modal.dataset.serviceBudget = String(budgetContext.serviceBudget || 0);
  modal.dataset.eventBudget = String(budgetContext.eventBudget || 0);
  
  // Update modal header
  const vendorTitle = modal.querySelector('.booking-vendor-name');
  if (vendorTitle) vendorTitle.textContent = vendorArea ? `${vendorName} — ${vendorArea}` : vendorName;
  const statusDiv = modal.querySelector('.booking-vendor-status');
  if (statusDiv) statusDiv.textContent = vendorArea ? `⏳ Pending confirmation from vendor in ${vendorArea}` : '⏳ Pending confirmation from vendor';
  
  // Populate event date if available
  const dateField = modal.querySelector('#bookingEventDate');
  if (dateField && state.summary.date) {
    dateField.value = state.summary.date.split('T')[0];
  }
  
  // Populate guests if available
  const guestsField = modal.querySelector('#bookingGuests');
  const budgetField = modal.querySelector('#bookingBudget');
  const budgetLabel = modal.querySelector('label[for="bookingBudget"]');
  if (budgetLabel) budgetLabel.textContent = 'Your Service Budget / Category Budget (₹) *';
  const budgetNote = modal.querySelector('#bookingBudgetNote');
  if (budgetNote) {
    budgetNote.textContent = 'This is the selected service/category budget. Your full event budget is shown in the summary, not here.';
  }
  if (budgetField) {
    const serviceDigits = String(budgetContext.serviceBudget || '').replace(/[^\d]/g, '');
    budgetField.value = serviceDigits || '';
    budgetField.placeholder = 'Category budget, not total event budget';
  }

  // Auto-fill profile details if available
  const nameField = modal.querySelector('#bookingName');
  const emailField = modal.querySelector('#bookingEmail');
  const phoneField = modal.querySelector('#bookingPhone');
  const locationField = modal.querySelector('#bookingLocation');
  const profile = state.currentUserProfile || {};
  if (nameField && !nameField.value) nameField.value = profile.name || '';
  if (emailField && !emailField.value) emailField.value = profile.email || '';
  if (phoneField && !phoneField.value) phoneField.value = profile.phone || '';
  if (locationField && !locationField.value) locationField.value = state.summary.location || vendorArea || '';

  if (guestsField && state.summary.guests) {
    guestsField.value = state.summary.guests;
  }
  
  // Focus on first field
  const firstInput = modal.querySelector('input[type="text"], input[type="email"], input[type="date"], textarea');
  if (firstInput) firstInput.focus();
};

function getLatestSelectedVendor() {
  const selected = state.selectedVendors || {};
  const entries = Object.values(selected).filter(Boolean);
  if (!entries.length) return null;
  entries.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  return entries[0] || null;
}

function openLatestSelectedVendorBooking() {
  const latest = getLatestSelectedVendor();
  if (!latest) {
    setStatus('Select a vendor card first, then click Book Now to open the booking form.');
    return;
  }
  window.openBookingModal(latest.vendorId || latest.vendorName, latest.vendorName || latest.vendorId || 'Vendor');
}

window.openVendorMenu = async function(vendorId, vendorName) {
  const normalizedVendorId = String(vendorId || '').trim();
  const normalizedVendorName = String(vendorName || '').trim();
  if (normalizedVendorId || normalizedVendorName) {
    const key = normalizedVendorId || normalizedVendorName;
    state.selectedVendors = state.selectedVendors || {};
    state.selectedVendors[key] = {
      vendorId: normalizedVendorId,
      vendorName: normalizedVendorName,
      timestamp: Date.now(),
    };
  }

  // Show menu in a message bubble
  const loadingMsg = addMessage('ai', `⏳ Loading menu for **${vendorName}**...`, null, null, []);
  try {
    const data = await apiFetch(`/ai/vendor-menu/${encodeURIComponent(vendorId)}`, { method: 'GET' });
    const menu = normalizeMenuPayload(data.data?.menu || {}, vendorName);
    if (!menu) {
      removeMessageById(loadingMsg?.id);
      addMessage('ai',
        `🍽️ **${vendorName}** — Menu Details\n\n` +
        `Contact this vendor directly to get their current menu card and pricing.\n\n` +
        `📞 ${escapeHtml(state.vendorDetailsMap?.get(vendorId)?.phone || 'See vendor details')}`,
        null, null, ['📅 Book Now', '💬 Ask in Chat']
      );
      return;
    }

    const lines = buildMenuBubbleLines(menu, vendorName);

    // Remove the loading message and add real menu
    removeMessageById(loadingMsg?.id);
    addMessage('ai', lines.join('\n'), null, null,
      ['📅 Book']
    );
  } catch (err) {
    removeMessageById(loadingMsg?.id);
    addMessage('ai', `Could not load menu for ${vendorName}. Contact them directly.`);
  }
};

window.closeBookingModal = function() {
  const modal = document.getElementById('bookingModal');
  const backdrop = document.getElementById('bookingBackdrop');
  if (modal) modal.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
};

function renderVendorPortfolioInModal(portfolioImages = [], portfolioCaption = [], vendorName = 'Vendor') {
  const container = document.getElementById('vendorPortfolioContainer');
  const title = document.getElementById('vendorDetailTitle');
  const subtitle = document.getElementById('vendorDetailSubtitle');
  if (!container) return;

  if (title) title.textContent = `${vendorName} Portfolio`;
  if (subtitle) {
    subtitle.textContent = Array.isArray(portfolioImages) && portfolioImages.length
      ? `Showing ${portfolioImages.length} work sample${portfolioImages.length > 1 ? 's' : ''}`
      : 'Work samples from this vendor';
  }

  if (!Array.isArray(portfolioImages) || !portfolioImages.length) {
    container.innerHTML = '<div class="vendor-detail-empty">This vendor has not uploaded portfolio images yet.</div>';
    return;
  }

  container.innerHTML = `
    <div class="portfolio-grid">
      ${portfolioImages.map((src, idx) => {
        const caption = Array.isArray(portfolioCaption) ? String(portfolioCaption[idx] || '') : '';
        const fallbackCaption = caption || `Portfolio image ${idx + 1}`;
        return `
          <div class="portfolio-card" onclick="window.openPortfolioLightbox('${escapeHtml(src)}')">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(fallbackCaption)}" loading="lazy" />
            <div class="portfolio-caption">${escapeHtml(caption || 'Tap to enlarge')}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

window.openPortfolioLightbox = function(imageSrc) {
  const lightbox = document.getElementById('portfolioLightbox');
  const lightboxImage = document.getElementById('portfolioLightboxImage');
  if (!lightbox || !lightboxImage || !imageSrc) return;
  lightboxImage.src = imageSrc;
  lightbox.style.display = 'flex';
};

window.closePortfolioLightbox = function() {
  const lightbox = document.getElementById('portfolioLightbox');
  const lightboxImage = document.getElementById('portfolioLightboxImage');
  if (lightbox) lightbox.style.display = 'none';
  if (lightboxImage) lightboxImage.src = '';
};

window.closeVendorDetailModal = function() {
  const modal = document.getElementById('vendorDetailModal');
  const backdrop = document.getElementById('vendorDetailBackdrop');
  if (modal) modal.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
};

window.showVendorDetail = async function(vendorId, vendorName) {
  const modal = document.getElementById('vendorDetailModal');
  const backdrop = document.getElementById('vendorDetailBackdrop');
  const normalizedId = String(vendorId || '').trim();
  const normalizedName = String(vendorName || 'Vendor').trim() || 'Vendor';
  if (!modal || !backdrop || !normalizedId) return;

  backdrop.style.display = 'block';
  modal.style.display = 'flex';
  renderVendorPortfolioInModal([], [], normalizedName);
  const container = document.getElementById('vendorPortfolioContainer');
  if (container) {
    container.innerHTML = '<div class="vendor-detail-empty">Loading portfolio...</div>';
  }

  try {
    let data;
    try {
      data = await apiFetch(`/vendors/${encodeURIComponent(normalizedId)}/portfolio`, { method: 'GET' });
    } catch (err) {
      // Backward-compatible fallback for older singular route mounts.
      data = await apiFetch(`/vendor/${encodeURIComponent(normalizedId)}/portfolio`, { method: 'GET' });
    }
    const payload = data?.data || {};
    const images = Array.isArray(payload.portfolioImages) ? payload.portfolioImages : [];
    const captions = Array.isArray(payload.portfolioCaption) ? payload.portfolioCaption : [];
    const displayName = payload.businessName || normalizedName;
    renderVendorPortfolioInModal(images, captions, displayName);
    const subtitle = document.getElementById('vendorDetailSubtitle');
    if (subtitle) {
      const location = [payload.area, payload.city].filter(Boolean).join(', ');
      const desc = String(payload.description || '').trim();
      subtitle.textContent = desc || location || 'Work samples from this vendor';
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="vendor-detail-empty">Could not load portfolio right now. ${escapeHtml(err.message || 'Please try again.')}</div>`;
    }
  }
};

function extractPlanVendors(eventPlan) {
  if (!eventPlan || typeof eventPlan !== 'object') return [];

  const selectedServices = eventPlan.selectedServices
    || eventPlan.selected_services
    || eventPlan.ai_context?.services
    || eventPlan.ai_context?.selected_services
    || [];

  // Map services to vendor property names
  const serviceToVendorMap = {
    'Function Hall': 'venue',
    'venue': 'venue',
    'Catering': 'catering',
    'catering': 'catering',
    'Decoration': 'decoration',
    'decoration': 'decoration',
    'Photography': 'photographer',
    'photography': 'photographer',
    'Videography': 'videographer',
    'videography': 'videographer',
    'DJ': 'dj',
    'dj': 'dj',
    'Florist': 'florist',
    'florist': 'florist',
    'Dresses / Makeup': 'dresses_vendor',
    'dresses': 'dresses_vendor',
    'makeup': 'dresses_vendor',
    'Priest': 'religious_vendor',
    'priest': 'religious_vendor',
    'Band': 'band',
    'band': 'band',
    'Tent': 'tent',
    'tent': 'tent',
  };

  // Build list of vendor property names to include based on selected services
  const includedVendorProps = new Set();

  selectedServices.forEach(service => {
    const normalized = String(service).toLowerCase().trim();
    Object.entries(serviceToVendorMap).forEach(([key, prop]) => {
      if (key.toLowerCase().includes(normalized) || normalized.includes(key.toLowerCase())) {
        includedVendorProps.add(prop);
      }
    });
  });

  // If no services selected, include all (backward compatibility)
  if (includedVendorProps.size === 0) {
    includedVendorProps.add('venue', 'catering', 'decoration', 'photographer',
      'videographer', 'dj', 'florist', 'dresses_vendor',
      'band', 'religious_vendor', 'tent');
  }

  // Extract only vendors for selected services
  const primaries = [];
  includedVendorProps.forEach(prop => {
    if (eventPlan[prop]) primaries.push(eventPlan[prop]);
  });

  // Extract alternatives for selected services only
  const alternatives = [];
  includedVendorProps.forEach(prop => {
    const altProp = `${prop}_alternatives`;
    if (Array.isArray(eventPlan[altProp])) {
      alternatives.push(...eventPlan[altProp].slice(0, 2));
    }
  });

  const seen = new Set();
  const result = [];
  for (const v of [...primaries, ...alternatives]) {
    const key = v.vendor_id || v.vendor_name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }

  return result;
}

function extractAlternativeServiceVendorsFromPlan(eventPlan) {
  const list = Array.isArray(eventPlan?.alternatives_block?.otherServiceVendors)
    ? eventPlan.alternatives_block.otherServiceVendors
    : [];

  return list.map((item, idx) => {
    const serviceLabel = String(item?.service || item?.category || 'service').trim();
    const serviceKey = resolveServiceCategoryKey(serviceLabel);
    return {
      vendor_id: item?.vendor_id || `alt-${idx}-${String(item?.vendor_name || 'vendor').toLowerCase().replace(/\s+/g, '-')}`,
      vendor_name: String(item?.vendor_name || 'Vendor').trim(),
      category: serviceLabel,
      city: String(item?.city || '').trim(),
      area: String(item?.area || '').trim(),
      rating: Number(item?.rating || 0),
      estimated_cost: Number(item?.estimated_cost || 0),
      availability_status: String(item?.availability_status || 'unknown'),
      services: serviceKey,
    };
  });
}

function extractVendorsFromText(content) {
  const text = String(content || '');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('• '));

  if (!lines.length) return [];

  const vendors = lines.map((line, idx) => {
    const normalizedLine = line.replace(/^•\s*/, '- ').replace(/^[-]\s*/, '- ');

    const fullMatch = normalizedLine.match(/^-\s*(.+?)\s*\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*(.*)$/);
    if (fullMatch) {
      const [, vendorName, category, city, tail] = fullMatch;
      const ratingMatch = tail.match(/⭐\s*(\d+(?:\.\d+)?)/);
      const priceMatch = tail.match(/₹\s*([\d,]+)/);
      return {
        vendor_id: `text-${idx}-${vendorName.replace(/\s+/g, '-').toLowerCase()}`,
        vendor_name: vendorName.trim(),
        category: category.trim(),
        city: city.trim(),
        area: '',
        rating: ratingMatch ? Number(ratingMatch[1]) : 0,
        estimated_cost: priceMatch ? Number(String(priceMatch[1]).replace(/,/g, '')) : 0,
        availability_status: 'unknown',
        services: category.trim(),
      };
    }

    // Matches: "• decoration: Decoration Centre 18, Nalgonda (₹62,000)"
    const altMatch = normalizedLine.match(/^-\s*([^:]+):\s*(.+?)(?:,\s*([^()]+?))?\s*\(₹\s*([\d,]+)\)\s*$/i);
    if (altMatch) {
      const [, category, vendorName, city, amount] = altMatch;
      return {
        vendor_id: `text-alt-${idx}-${String(vendorName || '').replace(/\s+/g, '-').toLowerCase()}`,
        vendor_name: String(vendorName || '').trim() || `Vendor ${idx + 1}`,
        category: String(category || 'Service Provider').trim(),
        city: String(city || '').trim(),
        area: '',
        rating: 0,
        estimated_cost: Number(String(amount || '0').replace(/,/g, '')) || 0,
        availability_status: 'unknown',
        services: resolveServiceCategoryKey(category),
      };
    }

    // Matches: "• Decoration: Saritha Decor & Events (₹31,000)"
    const simpleAltMatch = normalizedLine.match(/^-\s*([^:]+):\s*(.+?)\s*\(₹\s*([\d,]+)\)\s*$/i);
    if (simpleAltMatch) {
      const [, category, vendorName, amount] = simpleAltMatch;
      return {
        vendor_id: `text-alt-${idx}-${String(vendorName || '').replace(/\s+/g, '-').toLowerCase()}`,
        vendor_name: String(vendorName || '').trim() || `Vendor ${idx + 1}`,
        category: String(category || 'Service Provider').trim(),
        city: '',
        area: '',
        rating: 0,
        estimated_cost: Number(String(amount || '0').replace(/,/g, '')) || 0,
        availability_status: 'unknown',
        services: resolveServiceCategoryKey(category),
      };
    }

    const fallback = normalizedLine.match(/^-\s*(.+)$/);
    return {
      vendor_id: `text-${idx}`,
      vendor_name: fallback ? fallback[1].trim() : `Vendor ${idx + 1}`,
      category: 'Service Provider',
      city: '',
      area: '',
      rating: 0,
      estimated_cost: 0,
      availability_status: 'unknown',
      services: 'Event services',
    };
  }).filter((vendor) => {
    const hasAmount = Number(vendor?.estimated_cost || 0) > 0;
    const hasVendorLikeName = String(vendor?.vendor_name || '').length > 2;
    return hasAmount && hasVendorLikeName;
  });

  return vendors.slice(0, 12);
}

function getInteractiveSelectorType(message) {
  if (!message || message.role !== 'ai') return null;
  if (message.eventPlan) return null;
  const lower = String(message.content || '').toLowerCase();
  const hasAlternativesBlock = Boolean(message.eventPlan?.alternatives_block);

  // Never render service pickers under venue-alternative prompts.
  if (
    lower.includes('smart alternatives found')
    || lower.includes("we don't have function halls")
  ) {
    return null;
  }

  // If alternatives are being shown, keep this step focused on resolving alternatives first.
  if (hasAlternativesBlock) {
    if (
      lower.includes('function hall')
      || lower.includes('function halls')
      || lower.includes('30 km')
      || lower.includes('change the date, increase the venue budget, or change the location')
      || lower.includes('smart alternatives')
    ) {
      return null;
    }
  }

  if (lower.includes('what type of event are you planning') || lower.includes('kaunsa event') || lower.includes('ye event')) {
    return 'eventType';
  }
  if (lower.includes('which city or area should the event be in') || lower.includes('city or area') || lower.includes('city/area')) {
    return 'city';
  }
  if (
    lower.includes('which vendors should i include in the budget')
    || lower.includes('which **vendors** should i include in the budget')
    || lower.includes('budget mein kaun se vendors')
    || lower.includes('budget lo ye vendors')
    || (lower.includes('you selected:') && (lower.includes('add or remove') || lower.includes('anything else')))
    || (lower.includes('aapne select kiya:') && lower.includes('add/remove'))
    || (lower.includes('meeru select chesindi:') && lower.includes('add/remove'))
    || lower.includes('updated selection:')
  ) {
    return 'services';
  }
  if (
    lower.includes('which religion should the services follow')
    ||
    lower.includes('which **religion**')
    || lower.includes('services follow')
    || lower.includes('religion ke hisab')
    || lower.includes('ye religion prakaram')
  ) {
    return null;
  }
  if (
    lower.includes('what quality level do you prefer')
    ||
    lower.includes('preference for quality')
    || lower.includes('quality preference')
    || lower.includes('quality kya')
    || lower.includes('quality preference enti')
  ) {
    return 'quality';
  }
  if (
    lower.includes('please change the date, increase the venue budget, or change the location')
    || lower.includes('no function hall found')
    || lower.includes('function halls are available')
    || lower.includes('function halls exist')
    || lower.includes('show 30 km range')
  ) {
    return null;
  }
  if (
    lower.includes('any special requirements')
    || lower.includes('special requirements')
    || lower.includes('requirements?')
    || lower.includes('koi **special requirements**')
  ) {
    return 'requirements';
  }
  if (
    lower.includes('what is the event date')
    || lower.includes('event ki **date**')
    || lower.includes('event **date** enti')
    || lower.includes('date?')
  ) {
    return 'date';
  }
  if (
    lower.includes('how many guests')
    || lower.includes('kitne **guests**')
    || lower.includes('entha mandi **guests**')
  ) {
    return 'guests';
  }
  if (
    lower.includes('total budget for vendor')
    || lower.includes('vendor services?')
    || lower.includes('total budget')
    || lower.includes('kitna hai? (₹)')
  ) {
    return 'budget';
  }
  return null;
}

function renderInteractiveSelector(type, message) {
  if (!type) return '';
  if (type === 'eventType' || type === 'city') {
    const options = (type === 'eventType' ? EVENT_TYPE_OPTIONS : CITY_OPTIONS).map((opt) => `
      <label class="service-select-item">
        <input type="checkbox" value="${escapeHtml(opt)}" />
        <span>${escapeHtml(opt)}</span>
      </label>
    `).join('');
    const title = type === 'eventType' ? 'Select event type' : 'Select city/area';
    const placeholder = type === 'eventType' ? 'Type event type manually' : 'Type city/area manually';
    return `
      <div class="service-select-box" data-selector-type="${escapeHtml(type)}">
        <div class="service-select-title">${escapeHtml(title)}</div>
        <div class="service-select-grid">${options}</div>
        <input
          type="text"
          data-selector-other-input="true"
          placeholder="${escapeHtml(placeholder)}"
          style="margin-top:8px; width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:8px;"
        />
        <div class="service-select-actions">
          <button class="btn small primary" type="button" data-selector-submit="send">Send Selection</button>
        </div>
      </div>
    `;
  }

  const lower = String(message.content || '').toLowerCase();
  if (type === 'services') {
    const serviceOptions = getServiceOptionsForReligion(state.summary?.religion || state.lastEventPlan?.religion || 'all');
    const selected = new Set();
    const selectedBlock = String(message.content || '').match(/(?:you selected|aapne select kiya|meeru select chesindi)\s*:\s*\*\*(.+?)\*\*/i);
    if (selectedBlock) {
      selectedBlock[1]
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .forEach((label) => {
          const found = serviceOptions.find((opt) => opt.toLowerCase() === label || label.includes(opt.toLowerCase()));
          if (found) selected.add(found);
        });
    }

    const options = serviceOptions.map((opt) => {
      const checked = selected.has(opt) ? 'checked' : '';
      return `
        <label class="service-select-item">
          <input type="checkbox" value="${escapeHtml(opt)}" ${checked} />
          <span>${escapeHtml(opt)}</span>
        </label>
      `;
    }).join('');

    return `
      <div class="service-select-box" data-selector-type="services">
        <div class="service-select-title">Select one or more vendor services</div>
        <div class="service-select-grid">${options}</div>
        <div class="service-select-actions">
          <button class="btn small primary" type="button" data-selector-submit="send">Send Selection</button>
        </div>
      </div>
    `;
  }

  if (type === 'religion' || type === 'quality') {
    const options = (type === 'religion' ? RELIGION_OPTIONS : QUALITY_OPTIONS).map((opt) => {
      const checked = '';
      return `
        <label class="service-select-item">
          <input type="radio" name="${escapeHtml(type)}-options" value="${escapeHtml(opt)}" ${checked} />
          <span>${escapeHtml(opt)}</span>
        </label>
      `;
    }).join('');

    const title = type === 'religion'
      ? 'Select religion preference'
      : 'Select quality preference';
    const ctaLabel = type === 'religion' ? 'Confirm Religion' : 'Confirm Quality';

    return `
      <div class="service-select-box" data-selector-type="${escapeHtml(type)}">
        <div class="service-select-title">${escapeHtml(title)}</div>
        <div class="service-select-grid">${options}</div>
        <div class="service-select-actions">
          <button class="btn small primary" type="button" data-selector-submit="send">${escapeHtml(ctaLabel)}</button>
        </div>
      </div>
    `;
  }

  if (type === 'requirements') {
    const requirementOptions = [
      'No Special Requirements',
      'Pure Veg Only',
      'Halal Food',
      'Jain Meal',
      'Live Counters',
      'Baraat Route Timing',
      'Parking Count',
      'Generator + UPS',
      'Wheelchair / Elderly Access',
      'Separate Green Rooms',
      'Sound Curfew',
      'Outdoor Rain Backup',
    ];
    const options = requirementOptions.map((opt) => `
      <label class="service-select-item">
        <input type="checkbox" value="${escapeHtml(opt)}" />
        <span>${escapeHtml(opt)}</span>
      </label>
    `).join('');
    return `
      <div class="service-select-box" data-selector-type="requirements">
        <div class="service-select-title">Any special requirements?</div>
        <div class="service-select-grid">${options}</div>
        <input
          type="text"
          data-selector-other-input="true"
          placeholder="Type anything else (optional)"
          style="margin-top:8px; width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:8px;"
        />
        <div class="service-select-actions">
          <button class="btn small primary" type="button" data-selector-submit="send">Send Selection</button>
        </div>
      </div>
    `;
  }

  if (type === 'date') {
    const today = new Date();
    const minDate = new Date(today);
    minDate.setDate(today.getDate() + 7);
    const minStr = minDate.toISOString().slice(0, 10);
    const suggestions = [];
    for (let m = 1; m <= 6; m++) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + m);
      d.setDate(15);
      suggestions.push(d.toISOString().slice(0, 10));
    }
    return `
      <div class="service-select-box" data-selector-type="date">
        <div class="service-select-title">📅 Pick your event date</div>
        <input type="date" id="eventDatePicker" min="${escapeHtml(minStr)}"
          style="padding:10px;border:1.5px solid #f97316;border-radius:10px;font-size:0.95rem;width:100%;max-width:220px;cursor:pointer;margin-bottom:10px;">
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${suggestions.map(d => `<button type="button" class="chip" data-chip="${d}" style="font-size:0.78rem;padding:4px 10px;">${d}</button>`).join('')}
        </div>
        <div class="service-select-actions">
          <button class="btn small primary" type="button" data-selector-submit="date">Confirm Date</button>
        </div>
      </div>
    `;
  }

  if (type === 'guests') {
    const presets = [50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000];
    return `
      <div class="service-select-box" data-selector-type="guests">
        <div class="service-select-title">👥 How many guests?</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <input type="range" id="guestSlider" min="20" max="5000" step="10" value="200"
            style="flex:1;accent-color:#f97316;"
            oninput="document.getElementById('guestCount').textContent=this.value">
          <strong id="guestCount" style="min-width:50px;color:#1e1b4b;font-size:1rem;">200</strong>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${presets.map(n => `<button type="button" class="chip" data-chip="${n} guests" style="font-size:0.78rem;padding:4px 10px;">${n}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <input type="number" id="guestsManualInput" placeholder="Or type exact number (max: 5000)"
            min="20" max="5000" step="10"
            style="flex:1;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:0.9rem;">
        </div>
        <div class="service-select-actions">
          <button class="btn small primary" type="button" data-selector-submit="guests">Confirm Guests</button>
        </div>
      </div>
    `;
  }

  if (type === 'budget') {
    const presets = [
      { label: '₹1 Lakh', value: 100000 },
      { label: '₹2 Lakhs', value: 200000 },
      { label: '₹3 Lakhs', value: 300000 },
      { label: '₹5 Lakhs', value: 500000 },
      { label: '₹7 Lakhs', value: 700000 },
      { label: '₹10 Lakhs', value: 1000000 },
      { label: '₹15 Lakhs', value: 1500000 },
      { label: '₹20 Lakhs+', value: 2000000 },
    ];
    return `
      <div class="service-select-box" data-selector-type="budget">
        <div class="service-select-title">💰 Total vendor budget (₹)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${presets.map(p => `<button type="button" class="chip" data-chip="${p.value}" style="font-size:0.8rem;padding:5px 12px;">${p.label}</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <input type="number" id="budgetManualInput" placeholder="Or type amount e.g. 450000"
            min="10000" step="5000"
            style="flex:1;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:0.9rem;">
        </div>
        <div class="service-select-actions">
          <button class="btn small primary" type="button" data-selector-submit="budget">Set Budget</button>
        </div>
      </div>
    `;
  }

  return '';
}

function promptCityChangeOptions(context = 'event') {
  const cityChips = ['Hyderabad', 'Warangal', 'Karimnagar', 'Nizamabad', 'Khammam', 'Nalgonda', 'Other (Type manually)'];
  const contextText = String(context || '').trim();
  const title = contextText
    ? `Please choose a new city/area for ${contextText}:`
    : 'Please choose a new city/area:';

  addMessage('ai', title, null, null, cityChips);
  el.chatInput.value = '';
  el.chatInput.placeholder = 'Or type your city/area manually...';
  el.chatInput.focus();
  setStatus('Choose a city chip or type city/area and press Send.');
}

window.promptCityChangeOptions = promptCityChangeOptions;

async function hydrateVendorCardsFromSearch(vendors = []) {
  const hydrated = await Promise.all(vendors.map(async (vendor) => {
    if (!vendor?.vendor_name) return vendor;
    try {
      const query = new URLSearchParams();
      if (vendor.vendor_id) query.set('vendorId', String(vendor.vendor_id));
      query.set('vendorName', vendor.vendor_name);
      if (vendor.city) query.set('city', vendor.city);
      if (vendor.category) query.set('category', vendor.category);
      query.set('limit', '5');

      const res = await fetch(`${API_BASE}/vendor/search?${query.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) return vendor;

      const data = await res.json();
      const list = Array.isArray(data?.data?.vendors) ? data.data.vendors : [];
      const match = list.find((v) => String(v.vendor_id || '') === String(vendor.vendor_id || ''))
        || list.find((v) => String(v.vendor_name || '').toLowerCase() === String(vendor.vendor_name || '').toLowerCase())
        || list[0];
      if (!match) return vendor;

      return {
        ...vendor,
        ...match,
        email: match.email || vendor.email || '',
        vendor_phone: match.vendor_phone || vendor.vendor_phone || '',
      };
    } catch {
      return vendor;
    }
  }));

  return hydrated;
}

function initVendorMap(vendors = []) {
  const mapDiv = document.getElementById('vendorMap');
  if (!mapDiv || !window.google) return;

  const center = { lat: 17.3850, lng: 78.4867 };

  if (!googleMap) {
    googleMap = new google.maps.Map(mapDiv, {
      zoom: 10,
      center,
      mapTypeControl: false,
      streetViewControl: false,
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }
      ],
    });
  }

  mapMarkers.forEach(m => m.setMap(null));
  mapMarkers = [];

  const bounds = new google.maps.LatLngBounds();
  const cityCoords = {
    'Hyderabad':   { lat: 17.3850, lng: 78.4867 },
    'Warangal':    { lat: 17.9784, lng: 79.5941 },
    'Karimnagar':  { lat: 18.4386, lng: 79.1288 },
    'Nizamabad':   { lat: 18.6725, lng: 78.0941 },
    'Khammam':     { lat: 17.2473, lng: 80.1514 },
    'Nalgonda':    { lat: 17.0575, lng: 79.2677 },
    'Mahbubnagar': { lat: 16.7448, lng: 77.9878 },
    'Rangareddy':  { lat: 17.2400, lng: 78.4000 },
  };

  vendors.slice(0, 12).forEach((vendor) => {
    const cityKey = Object.keys(cityCoords).find(k =>
      String(vendor.city || '').toLowerCase().includes(k.toLowerCase())
    );
    if (!cityKey) return;

    const base = cityCoords[cityKey];
    const pos = {
      lat: base.lat + (Math.random() - 0.5) * 0.04,
      lng: base.lng + (Math.random() - 0.5) * 0.04,
    };

    const marker = new google.maps.Marker({
      position: pos,
      map: googleMap,
      title: vendor.vendor_name,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
          <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="16" cy="38" rx="6" ry="2" fill="rgba(0,0,0,0.15)"/>
            <path d="M16 0C9 0 4 5.8 4 13c0 8 12 25 12 25S28 21 28 13C28 5.8 23 0 16 0z" fill="#f97316"/>
            <circle cx="16" cy="13" r="6" fill="white"/>
          </svg>`),
        scaledSize: new google.maps.Size(28, 36),
        anchor: new google.maps.Point(14, 36),
      },
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="font-family:DM Sans,sans-serif; padding:4px; min-width:160px;">
          <strong style="color:#1e1b4b">${vendor.vendor_name}</strong>
          <div style="font-size:12px; color:#6b7280">${vendor.category}</div>
          <div style="font-size:12px; color:#f97316; font-weight:600; margin-top:4px;">
            ⭐${Number(vendor.rating||0).toFixed(1)} · ${vendor.city}
          </div>
          ${vendor.estimated_cost ? `<div style="font-size:12px;">₹${Number(vendor.estimated_cost).toLocaleString('en-IN')}</div>` : ''}
        </div>
      `,
    });

    marker.addListener('click', () => infoWindow.open(googleMap, marker));
    mapMarkers.push(marker);
    bounds.extend(pos);
  });

  if (mapMarkers.length > 0) googleMap.fitBounds(bounds);
}

el.showMapBtn?.addEventListener('click', () => {
  if (!MAP_ENABLED) return;
  const section = document.getElementById('mapSection');
  if (section) {
    section.style.display = 'block';
    if (el.showMapBtn) el.showMapBtn.style.display = 'none';
    const lastAiMsg = [...state.messages].reverse().find((m) => m.role === 'ai');
    if (lastAiMsg) {
      const vendorsFromPlan = extractPlanVendors(lastAiMsg.eventPlan);
      const vendors = vendorsFromPlan.length ? vendorsFromPlan : extractVendorsFromText(lastAiMsg.content);
      if (vendors.length) setTimeout(() => initVendorMap(vendors), 100);
    }
  }
});

el.closeMapBtn?.addEventListener('click', () => {
  if (!MAP_ENABLED) return;
  const section = document.getElementById('mapSection');
  if (section) section.style.display = 'none';
});

function addMessage(role, content, usage = null, eventPlan = null, chips = [], vendorCards = []) {
  const msg = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    usage,
    timestamp: new Date().toISOString(),
    eventPlan,
    chips: chips || [],
    vendorCards: vendorCards || [],
    generatedImage: null,
  };
  state.messages.push(msg);
  renderMessages();
  return msg;
}

function removeMessageById(messageId) {
  if (!messageId) return;
  const idx = state.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) return;
  state.messages.splice(idx, 1);
  renderMessages();
}

function scheduleHistoryRefresh(delayMs = 1200) {
  if (state.historyRefreshTimer) clearTimeout(state.historyRefreshTimer);
  state.historyRefreshTimer = setTimeout(async () => {
    try {
      await loadHistory();
    } catch {
      // Silent refresh failure should not interrupt active chat.
    }
  }, delayMs);
}

function mapNextActionsToChips(nextActions = []) {
  const actionMap = {
    provide_place: 'Share city/area',
    share_coordinates: 'Share coordinates',
    confirm_location: 'Confirm location',
    share_landmark: 'Share nearest landmark',
    expand_radius: 'Expand radius',
    change_city: 'Change city/area',
    increase_budget: 'Increase budget by 10%',
    change_category: 'Change vendor category',
    change_date: 'Change event date',
    relax_filters: 'Relax filters',
    retry_automatically: 'Try again',
  };
  const chips = [];
  nextActions.forEach((action) => {
    const chip = actionMap[String(action || '').trim()];
    if (chip && !chips.includes(chip)) chips.push(chip);
  });
  return chips;
}

function chipsFromFallback(fallback) {
  const reasonCode = String(fallback?.reason_code || '').trim();
  const nextActions = Array.isArray(fallback?.next_actions) ? fallback.next_actions : [];
  const fromActions = mapNextActionsToChips(nextActions);
  if (fromActions.length) return fromActions;

  if (reasonCode === 'location_unresolved') return ['Confirm location', 'Share nearest landmark', 'Change city/area'];
  if (reasonCode === 'location_missing') return ['Share city/area', 'Share coordinates'];
  if (reasonCode === 'no_vendor_within_radius') return ['Show other service vendors', 'Change city/area'];
  if (reasonCode === 'budget_too_low') return ['Increase budget by 10%', 'Change vendor category'];
  if (reasonCode === 'date_unavailable') return ['Change event date', 'Show other service vendors', 'Change city/area'];
  if (reasonCode === 'no_match_for_filters') return ['Relax filters', 'Show other service vendors', 'Change city/area'];
  if (reasonCode === 'search_failed') return ['Try again', 'Change city/area'];
  return [];
}

function generateChipsFromResponse(text, eventPlan, fallback = null) {
  const t = String(text || '').toLowerCase();

  // Venue-unavailable guidance: keep actions focused on nearby/date/location changes.
  if (
    t.includes('no function hall found')
    || t.includes("we don't have function halls")
    || t.includes('can i show halls within')
  ) {
    return ['Change event date', 'Change city/area', 'Show other service vendors'];
  }

  // Venue block scenarios — highest priority chips
  if (t.includes('function halls in') && t.includes("don't have")) {
    return ['Change city/area', 'Show other service vendors'];
  }
  if (t.includes('fully booked on') || (t.includes('booked on') && t.includes('function hall'))) {
    return ['Check ±1 week dates', 'Change event date', 'Change city/area'];
  }
  if (t.includes('venue budget needs adjustment') || t.includes('venue allocation')) {
    return ['Increase total budget', 'Change city/area', 'Reduce services'];
  }
  if (t.includes('all') && t.includes('function hall') && t.includes('booked on')) {
    return ['Change event date', 'Change city/area', 'Increase total budget'];
  }
  if (t.includes('increase') && t.includes('budget') && t.includes('venue')) {
    return ['3 Lakhs', '5 Lakhs', '7 Lakhs', '10 Lakhs', 'Change city/area'];
  }
  if (t.includes('no vendors found within') && t.includes('km')) {
    return ['Change city/area', 'Start New Plan'];
  }

  const fallbackChips = chipsFromFallback(fallback);
  if (fallbackChips.length) return fallbackChips;

  // Step 0 — event type
  if (t.includes('what type of event') || t.includes('kaunsa event') || t.includes('ye event')) {
    return ['Wedding / Pelli', 'Reception', 'Engagement', 'Birthday', 'Naming Ceremony', 'Thread Ceremony'];
  }

  // Step 1, 3 and 5 should be typed by user (location, guests, budget)
  if (
    t.includes('city or area') || t.includes('city ya area') || t.includes('city/area')
    || t.includes('which city or area')
    || (t.includes('guests') && (t.includes('expected') || t.includes('kitne') || t.includes('entha mandi')))
    || t.includes('total budget') || (t.includes('budget') && t.includes('vendor services'))
  ) {
    if (t.includes('city or area') || t.includes('which city or area') || t.includes('city ya area') || t.includes('city/area')) {
      return ['Hyderabad', 'Warangal', 'Karimnagar', 'Nizamabad', 'Khammam', 'Nalgonda', 'Other (Type manually)'];
    }
    return [];
  }

  // Step 4 — religion (only when the assistant explicitly asks about religion preference)
  if (
    t.includes('which religion')
    || t.includes('which **religion**')
    || t.includes('which religion should')
    || t.includes('which religion should the services')
    || t.includes('which religion should the services follow')
    || t.includes('services follow')
    || t.includes('religion ke hisab')
    || t.includes('ye religion prakaram')
  ) {
    return ['Hindu', 'Muslim', 'Christian', 'Jain', 'All Religions'];
  }

  // Step 6 — service selection
  if (t.includes('vendors') && (t.includes('include') || t.includes('select') || t.includes('budget mein'))) {
    // Avoid false positives from final plan text like "Selected services" + "No vendors found".
    if (eventPlan || t.includes('selected services:') || t.includes('venue not yet confirmed')) {
      return [];
    }
    const r = String(state.summary?.religion || eventPlan?.religion || 'all').toLowerCase();
    const venueOptions = r === 'christian' ? ['Church / Parish Hall', 'Function Hall'] : ['Function Hall'];
    const relLabel = getReligiousServiceOptionLabel(state.summary?.religion || eventPlan?.religion || 'all');
    return [...venueOptions, 'Catering', 'Decoration', 'Photography', 'Videography', 'DJ', 'Florist', 'Dresses / Makeup', relLabel, 'Band', 'Tent', 'Continue'];
  }

  // Step 7 — quality preference
  if (t.includes('quality') || t.includes('economy') || t.includes('preference')) {
    return ['Economy (Affordable)', 'Standard (Balanced)', 'Premium (Top Rated)'];
  }

  // Step 8 — special requirements
  if (t.includes('special requirements') || t.includes('requirements') || t.includes('requirements')) {
    return ['No Special Requirements', 'Pure Veg Only', 'Halal Food', 'Need Parking + Generator', 'AC Venue Required'];
  }

  // Nearby city approval (disabled auto-expand; prefer manual location change)
  if (t.includes('30 km') || t.includes('nearby') || t.includes('search') && t.includes('km')) {
    return ['Change city/area', 'Start New Plan'];
  }

  // Budget exceeded
  if (t.includes('exceed') || t.includes('slightly higher') || t.includes('₹') && t.includes('more')) {
    return ['Yes, show those vendors too', 'No, keep within my budget', 'Increase budget by 10%'];
  }

  // Alternatives offered (only when explicit option text is present)
  if (
    t.includes('option a:')
    || t.includes('option b:')
    || t.includes('option c:')
    || t.includes('alternative dates available')
    || t.includes('if you increase budget slightly')
  ) {
    return ['Show Option A', 'Show Option B', 'Show Option C', 'Stick with original'];
  }

  // Plan complete — chips mirror what veteran coordinators repeat to every client
  if (eventPlan || t.includes('event plan ready') || t.includes('total estimate')) {
    const chips = [
      'Pre-booking checklist',
      'Compare vendor quotes',
      'Customization help',
      'Weather backup tips',
      'Guest count / last-minute tips',
      'Open Vendor Threads',
      'Adjust Budget',
      'Save This Plan',
      'Start New Plan',
    ];
    if (MAP_ENABLED) chips.splice(5, 0, 'Show Vendor Map');
    return chips;
  }

  // Restart/continue
  if (t.includes('restart') || t.includes('new event')) {
    return ['Start New Plan', 'View Saved Plans'];
  }

  return [];
}

function renderAlternativesBlock(block) {
  if (!block) return '';
  const parts = [];
  const noteText = String(block.locationNote || '').toLowerCase();

  if (block.locationNote) {
    parts.push(`
      <div class="alt-option">
        <span class="alt-option-icon">📍</span>
        <span class="alt-option-text">${escapeHtml(block.locationNote)}</span>
      </div>`);

    if (
      noteText.includes("don't have function halls")
      || noteText.includes('no function hall found')
      || noteText.includes('venue')
    ) {
      const otherServiceVendors = Array.isArray(block.otherServiceVendors)
        ? block.otherServiceVendors
        : [];

      if (otherServiceVendors.length > 0) {
        parts.push(`
          <div class="alt-option">
            <span class="alt-option-icon">🧩</span>
            <span class="alt-option-text"><strong>Function hall is pending. You can shortlist these other service vendors now:</strong></span>
          </div>`);

        otherServiceVendors.slice(0, 6).forEach((item) => {
          const service = String(item?.service || 'service');
          const vendorName = String(item?.vendor_name || 'Vendor');
          const city = String(item?.city || '').trim();
          const amount = Number(item?.estimated_cost || 0);
          const amountText = amount > 0 ? `₹${amount.toLocaleString('en-IN')}` : 'Price on request';
          parts.push(`
            <div class="alt-option">
              <span class="alt-option-icon">•</span>
              <span class="alt-option-text"><strong>${escapeHtml(service)}</strong>: ${escapeHtml(vendorName)}${city ? `, ${escapeHtml(city)}` : ''} (${escapeHtml(amountText)})</span>
            </div>`);
        });
      } else {
        parts.push(`
          <div class="alt-option" onclick="sendMessage('show other service vendors')" role="button" tabindex="0">
            <span class="alt-option-icon">🧩</span>
            <span class="alt-option-text"><strong>Show other service vendors</strong> while function hall stays pending</span>
            <span class="alt-option-action">Open</span>
          </div>`);
      }

      parts.push(`
        <div class="alt-option" onclick="promptCityChangeOptions('function hall search')" role="button" tabindex="0">
          <span class="alt-option-icon">↩️</span>
          <span class="alt-option-text">Change city / area for function hall search</span>
          <span class="alt-option-action">Open</span>
        </div>`);
    }
  }

  if (block.dateOptions?.length) {
    block.dateOptions.forEach(opt => {
      parts.push(`
        <div class="alt-option" onclick="sendMessage('Show vendors available on ${opt.date}')">
          <span class="alt-option-icon">🗓️</span>
          <span class="alt-option-text"><strong>${opt.date}</strong> — ${opt.availableCount} venues available on this date</span>
          <span class="alt-option-action">Select</span>
        </div>`);
    });
  }

  if (block.budgetOptions?.length) {
    block.budgetOptions.forEach(opt => {
      const vendorId = opt.vendor?.vendor_id || '';
      const vendorName = opt.vendor?.vendor_name || '';
      const extraAmt = opt.extraRequired || 0;
      // Pass vendor_id and name so backend knows exactly which vendor to switch to
      const upgradeMsg = vendorId
        ? `upgrade venue to ${vendorName} (vendor_id:${vendorId}) extra:${extraAmt}`
        : 'Yes show vendors with slightly higher budget';
      parts.push(`
        <div class="alt-option" onclick="sendMessage(${JSON.stringify(upgradeMsg)})" role="button" tabindex="0">
          <span class="alt-option-icon">💡</span>
          <span class="alt-option-text">${escapeHtml(opt.message)}</span>
          <span class="alt-option-action">Explore</span>
        </div>`);
    });
  }

  if (block.radiusVendors?.length) {
    parts.push(`
      <div class="alt-option" onclick="sendMessage('show other service vendors')">
        <span class="alt-option-icon">🧩</span>
        <span class="alt-option-text"><strong>Show other service vendors</strong> while venue stays pending</span>
        <span class="alt-option-action">Open</span>
      </div>`);
  }

  if (!parts.length) return '';

  return `
    <div class="alt-block">
      <div class="alt-block-title">💡 Smart Alternatives Found</div>
      ${parts.join('')}
    </div>`;
}

function renderSelectedServicesBadges(selectedServices) {
  if (!selectedServices || selectedServices.length === 0) return '';

  return `
    <div style="margin-top:12px;margin-bottom:12px;">
      <div style="font-size:0.85rem;color:#64748b;margin-bottom:6px;">✅ Services included in your plan:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${selectedServices.map(service => `
          <span style="background:#f0fdf4;color:#16a34a;padding:4px 10px;border-radius:6px;font-size:0.8rem;font-weight:600;border:1px solid #86efac;">
            ${escapeHtml(service)}
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

function renderAiTextWithOverBudgetAlert(content) {
  const raw = String(content || '');
  const marker = '⚠️ Over Budget';
  const markerIndex = raw.indexOf(marker);

  if (markerIndex < 0) {
    return renderAiText(raw);
  }

  const before = raw.slice(0, markerIndex).trim();
  const alertBlock = raw.slice(markerIndex).trim();
  const beforeHtml = before ? renderAiText(before) : '';
  const alertHtml = escapeHtml(alertBlock).replace(/\n/g, '<br>');

  return `${beforeHtml}${beforeHtml ? '<br>' : ''}<div class="budget-alert-overbudget">${alertHtml}</div>`;
}

function renderMessages() {
  el.messages.innerHTML = '';

  state.messages.forEach((m, idx) => {
    const node = document.createElement('article');
    node.className = `msg ${m.role === 'user' ? 'user' : 'ai'}`;

    const safeMd = m.role === 'ai'
      ? renderAiTextWithOverBudgetAlert(m.content)
      : escapeHtml(m.content || '').replace(/\n/g, '<br>');

    const vendors = m.role === 'ai'
      ? (() => {
          const dedupe = (items = []) => {
            const seen = new Set();
            return items.filter((v) => {
              const key = String(v?.vendor_id || v?.vendor_name || '').toLowerCase().trim();
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          };

          const fromMessage = Array.isArray(m.vendorCards) ? m.vendorCards : [];
          const fromPlan = extractPlanVendors(m.eventPlan);
          const fromAlternatives = extractAlternativeServiceVendorsFromPlan(m.eventPlan);
          const fromText = extractVendorsFromText(m.content);
          return dedupe([...fromMessage, ...fromPlan, ...fromAlternatives, ...fromText]);
        })()
      : [];

    const isLatestMessage = idx === state.messages.length - 1;
    const selectorType = m.role === 'ai' && isLatestMessage ? getInteractiveSelectorType(m) : null;
    const selectedServicesForFilters = getSelectedServicesForPlan(m.eventPlan);
    const categoryFilterHtml = m.role === 'ai' && vendors.length && selectedServicesForFilters.length
      ? renderCategoryFilterButtons(selectedServicesForFilters)
      : '';
    const chipsHtml = !selectorType && m.chips && m.chips.length
      ? `<div class="chips-row">${m.chips.map((c) =>
          `<button class="chip" type="button" data-chip="${escapeHtml(c)}">${escapeHtml(c)}</button>`
        ).join('')}</div>`
      : '';

    const serviceSelectorHtml = selectorType ? renderInteractiveSelector(selectorType, m) : '';

    node.innerHTML = `
      <div class="bubble">
        ${m.role === 'ai' ? '<span class="ai-avatar">🤖</span>' : ''}
        <div>${safeMd}</div>
        ${m.eventPlan ? renderSelectedServicesBadges(
          m.eventPlan.selectedServices
          || m.eventPlan.selected_services
          || m.eventPlan.ai_context?.services
          || m.eventPlan.ai_context?.selected_services
          || []
        ) : ''}
        ${m.generatedImage ? `
          <div class="generated-image-card">
            <img src="${escapeHtml(m.generatedImage)}" alt="Generated event reference image" loading="lazy" />
            <div class="generated-image-meta">AI concept image for vendor discussion and customization.</div>
          </div>
        ` : ''}
        ${categoryFilterHtml}
        ${vendors.length ? renderVendorCards(vendors) : ''}
        ${m.eventPlan?.alternatives_block ? renderAlternativesBlock(m.eventPlan.alternatives_block) : ''}
        ${serviceSelectorHtml}
        ${chipsHtml}
      </div>
      <div class="meta">
        <span>${toDateLabel(m.timestamp)}</span>
        ${m.role === 'ai' && m.usage ? `<span>tokens: ${m.usage.total_tokens || '-'} (p:${m.usage.prompt_tokens || '-'} / c:${m.usage.completion_tokens || '-'})</span>` : ''}
      </div>
      ${m.role === 'ai' ? `<div class="msg-actions"><button class="btn small" data-copy="${m.id}" type="button">Copy</button></div>` : ''}
    `;

    el.messages.appendChild(node);

    node.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const val = String(chip.dataset.chip || '').trim();
        const lower = val.toLowerCase();
        const normalizedVal = val.toLowerCase().replace(/^[^a-z0-9]+/i, '').trim();
        const updateSelectionUiAndSend = (payload) => {
          if (!payload) return;
          sendMessage(payload);
        };
        if (!val) return;

        // Normalize all 30km/nearby venue approval chips to a single canonical text
        if (
          /yes.*search.*30\s*km|search.*30\s*km|show.*nearby.*venues?.*30|yes.*show.*nearby/i.test(val) ||
          /show.*30\s*km\s*radius|30\s*km\s*range|within\s*30\s*km/i.test(val)
        ) {
          // Instead of auto-expanding search, prompt user to change location manually
          el.chatInput.value = '';
          el.chatInput.placeholder = 'Type your new city or area...';
          el.chatInput.focus();
          setStatus('Type the new city/area and press Send.');
          return;
        }

        // Change city/area
        if (/^change\s*city\/?area$/i.test(val) || /^change.*location$/i.test(val)) {
          promptCityChangeOptions('function hall search');
          return;
        }

        if (/^(hindu|muslim|christian|jain|all religions)$/i.test(val)) {
          state.summary.religion = val;
          renderSummary();
          updateSelectionUiAndSend(val);
          return;
        }
        if (/^(economy|standard|premium)(\s*\(.*\))?$/i.test(val)) {
          const quality = val.match(/^(economy|standard|premium)/i)?.[1] || val;
          state.summary.quality = quality;
          renderSummary();
          updateSelectionUiAndSend(quality);
          return;
        }
        if (/adjust budget/i.test(val)) {
          const existingDigits = String(state.summary.budget || '').replace(/[^\d]/g, '');
          el.chatInput.value = existingDigits ? `My new budget is ₹${existingDigits}` : 'My new budget is ₹';
          el.chatInput.focus();
          setStatus('Update budget and press Send.');
          return;
        }
        if (/^start new plan$/i.test(val)) {
          sendMessage('restart');
          return;
        }
        if (/^confirm location$/i.test(val)) {
          el.chatInput.value = 'My location is ';
          el.chatInput.focus();
          setStatus('Add city/area and press Send.');
          return;
        }
        if (/^share nearest landmark$/i.test(val)) {
          el.chatInput.value = 'Nearest landmark is ';
          el.chatInput.focus();
          setStatus('Add a landmark and press Send.');
          return;
        }
        if (/^share city\/area$/i.test(val)) {
          el.chatInput.value = '';
          el.chatInput.focus();
          setStatus('Type city/area and press Send.');
          return;
        }
        if (/^share coordinates$/i.test(val)) {
          el.chatInput.value = 'My coordinates are ';
          el.chatInput.focus();
          setStatus('Add latitude, longitude and press Send.');
          return;
        }
        if (/^expand radius$/i.test(val)) {
          sendMessage('yes');
          return;
        }
        if (/^increase budget by 10%$/i.test(val)) {
          const currentDigits = String(state.summary.budget || '').replace(/[^\d]/g, '');
          if (currentDigits) {
            const bump = Math.round(Number(currentDigits) * 1.1);
            sendMessage(`My new budget is ₹${bump}`);
          } else {
            el.chatInput.value = 'My new budget is ₹';
            el.chatInput.focus();
            setStatus('Enter budget and press Send.');
          }
          return;
        }
        if (/^change event date$/i.test(val)) {
          el.chatInput.value = 'Change event date to ';
          el.chatInput.focus();
          setStatus('Use YYYY-MM-DD format and press Send.');
          return;
        }
        if (/^relax filters$/i.test(val)) {
          sendMessage('show more options with relaxed filters');
          return;
        }
        if (/^try again$/i.test(val)) {
          sendMessage(state.lastUserMessage || 'continue');
          return;
        }
        if (/^save this plan$/i.test(val)) {
          sendMessage('How do I save my plan?');
          return;
        }
        if (normalizedVal === 'book now' || normalizedVal === 'book' || normalizedVal === 'book this caterer') {
          openLatestSelectedVendorBooking();
          return;
        }
        // Removed handlers for 'request custom menu' and 'ask about veg options'
        if (/^customization help$/i.test(val)) {
          sendMessage('I need customization workflow for decoration, catering, and dresses with vendor chat.');
          return;
        }
        if (/^open vendor threads$/i.test(val)) {
          loadVendorConversationsSummary();
          const list = document.getElementById('vendorConvList');
          if (list) {
            list.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setStatus('Open a vendor thread from the right panel to discuss customization and share images.');
          }
          return;
        }
        if (/^show vendor map$/i.test(val) && !MAP_ENABLED) {
          setStatus('Vendor map is off in this build — use View Details on each card for location and contact.');
          return;
        }
        if (/other\s*\(type manually\)/i.test(val)) {
          el.chatInput.value = '';
          el.chatInput.focus();
          setStatus('Type your city/area and press Send.');
          return;
        }
        sendMessage(val);
      });
    });

    node.querySelectorAll('.category-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const category = btn.dataset.category;

        // Update active state for this message bubble only.
        node.querySelectorAll('.category-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Filter vendor cards
        node.querySelectorAll('.vendor-card').forEach((card) => {
          const cardCategory = card.dataset.category;
          if (category === 'all' || cardCategory === category) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });

        // Hide empty category sections
        node.querySelectorAll('.vendor-category-section').forEach((section) => {
          const visibleCount = Array.from(section.querySelectorAll('.vendor-card')).filter((c) => c.style.display !== 'none').length;
          section.style.display = visibleCount > 0 ? '' : 'none';
        });

        const grouped = node.querySelector('.vendor-cards-grouped');
        if (grouped) grouped.setAttribute('data-active-filter', category || 'all');

        const visibleCards = Array.from(node.querySelectorAll('.vendor-card')).filter((c) => c.style.display !== 'none').length;
        const prettyCategory = category === 'all'
          ? 'All'
          : `${String(category || '').charAt(0).toUpperCase()}${String(category || '').slice(1)}`;
        const countText = `Showing ${visibleCards} vendors for ${prettyCategory}`;

        const filterPanel = btn.closest('.vendor-filter-panel') || node;
        let countEl = filterPanel.querySelector('.vendor-filter-count');
        if (!countEl) {
          countEl = document.createElement('div');
          countEl.className = 'vendor-filter-count';
          countEl.style.cssText = 'font-size:0.8rem;color:#475569;margin-top:8px;font-weight:600;';
          filterPanel.appendChild(countEl);
        }
        countEl.textContent = countText;
      });
    });

    node.querySelectorAll('[data-selector-submit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-selector-submit');
        const selectorRoot = node.querySelector('.service-select-box');
        const selectorTypeValue = selectorRoot?.getAttribute('data-selector-type') || 'services';
        if (action === 'continue') {
          sendMessage('continue');
          return;
        }
        if (action === 'date') {
          const picker = node.querySelector('#eventDatePicker');
          const val = picker?.value?.trim();
          if (val) { sendMessage(val); return; }
          return;
        }
        if (action === 'guests') {
          const slider = node.querySelector('#guestSlider');
          const manual = node.querySelector('#guestsManualInput');
          const manualVal = manual?.value?.trim();
          const sliderVal = slider?.value;

          // Prioritize manual input if provided
          if (manualVal && Number(manualVal) >= 20 && Number(manualVal) <= 5000) {
            sendMessage(`${manualVal} guests`);
            return;
          }

          // Fall back to slider value
          if (sliderVal) {
            sendMessage(`${sliderVal} guests`);
            return;
          }

          setStatus('Please specify guest count (20-5000)');
          return;
        }
        if (action === 'budget') {
          const manual = node.querySelector('#budgetManualInput');
          const val = manual?.value?.trim();
          if (val && Number(val) >= 10000) { sendMessage(String(val)); return; }
          return;
        }
        const isSingleChoice = selectorTypeValue === 'religion' || selectorTypeValue === 'quality';
        const isRequirements = selectorTypeValue === 'requirements';
        const checked = Array.from(node.querySelectorAll(
          `.service-select-box input[type="${isSingleChoice ? 'radio' : 'checkbox'}"]:checked`
        ))
          .map((cb) => cb.value)
          .filter(Boolean);
        const otherInput = node.querySelector('.service-select-box [data-selector-other-input="true"]');
        const otherText = String(otherInput?.value || '').trim();

        if (selectorTypeValue === 'eventType' || selectorTypeValue === 'city') {
          const payload = otherText || checked[0] || '';
          if (!payload) {
            setStatus(`Please select ${selectorTypeValue === 'eventType' ? 'an event type' : 'a city/area'}.`);
            return;
          }
          sendMessage(payload);
          return;
        }

        if (isRequirements) {
          const reqChecked = Array.from(node.querySelectorAll('.service-select-box input[type="checkbox"]:checked'))
            .map((cb) => cb.value)
            .filter(Boolean);
          const reqOther = String(otherInput?.value || '').trim();
          const reqValues = [...new Set([...reqChecked, ...(reqOther ? [reqOther] : [])])]
            .filter((value) => value.toLowerCase() !== 'no special requirements');
          let payload = reqValues.length ? reqValues.join(', ') : 'No Special Requirements';
          if (reqValues.includes('No Special Requirements')) payload = 'No Special Requirements';
          sendMessage(payload);
          return;
        }

        let payload = isSingleChoice ? (checked[0] || '') : checked.join(', ');
        if (!payload) {
          if (selectorTypeValue === 'services') {
            sendMessage('continue');
            return;
          }
          payload = selectorTypeValue === 'quality'
            ? 'Standard'
            : selectorTypeValue === 'religion'
              ? 'All Religions'
              : 'Function Hall';
        }

        if (selectorTypeValue === 'religion') {
          const selectedReligion = String(payload || '').trim();
          if (!selectedReligion) {
            setStatus('Please select a religion preference.');
            return;
          }
          state.summary.religion = selectedReligion;
          renderSummary();
          sendMessage(selectedReligion);
          return;
        }

        if (selectorTypeValue === 'quality') {
          const selectedQuality = String(payload).match(/^(economy|standard|premium)/i)?.[1] || payload;
          sendMessage(selectedQuality);
          return;
        }

        sendMessage(payload);
      });
    });
  });

  el.messages.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.copy;
      const target = state.messages.find((m) => m.id === id);
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.content || '');
        setStatus('Copied AI response.');
      } catch {
        setStatus('Copy failed.');
      }
    });
  });

  if (state.typing) renderTyping(true);
  scrollToBottom();
}

function groupConversation(history = []) {
  if (!history.length) return [];
  const groups = [];
  let current = [];

  history.forEach((m, idx) => {
    if (m.role === 'user' && /restart|new event|start over|reset/i.test(m.content || '') && current.length) {
      groups.push(current);
      current = [];
    }
    current.push({
      ...m,
      role: m.role === 'assistant' ? 'ai' : m.role === 'user' ? 'user' : m.role,
      createdAt: m.createdAt || m.timestamp || new Date(Date.now() - (history.length - idx) * 60000).toISOString(),
    });
  });

  if (current.length) groups.push(current);

  return groups.map((messages, index) => {
    const firstUser = messages.find((m) => m.role === 'user');
    return {
      id: `conv-${index + 1}`,
      createdAt: messages[0].createdAt,
      preview: (firstUser?.content || messages[0].content || 'Conversation').slice(0, 80),
      messages,
    };
  }).reverse();
}

function renderHistoryList() {
  if (!state.historyGroups.length) {
    el.historyList.innerHTML = '<li class="history-item">No previous conversations</li>';
    return;
  }

  el.historyList.innerHTML = state.historyGroups
    .map((h) => `
      <li class="history-item ${state.selectedHistoryId === h.id ? 'active' : ''}" data-history-id="${h.id}">
        <div class="item-date">${toDateLabel(h.createdAt)}</div>
        <div class="item-preview">${escapeHtml(h.preview)}</div>
      </li>
    `)
    .join('');

  el.historyList.querySelectorAll('[data-history-id]').forEach((item) => {
    item.addEventListener('click', () => {
      const id = item.dataset.historyId;
      const conv = state.historyGroups.find((x) => x.id === id);
      if (!conv) return;
      state.selectedHistoryId = id;
      state.activeConversationId = id;
      state.messages = conv.messages.map((m) => {
        const normalizedRole = m.role === 'assistant' ? 'ai' : m.role;
        const eventPlan = m.event_plan || null;
        return {
          id: `${Date.now()}-${Math.random()}`,
          role: normalizedRole,
          content: m.content,
          usage: m.usage || null,
          timestamp: m.createdAt || new Date().toISOString(),
          eventPlan,
          chips: normalizedRole === 'ai' ? generateChipsFromResponse(m.content || '', eventPlan) : [],
          vendorCards: eventPlan ? extractPlanVendors(eventPlan) : [],
        };
      });

      const lastAiMsg = state.messages
        .slice()
        .reverse()
        .find((m) => m.role === 'ai' && m.eventPlan);

      state.lastEventPlan = lastAiMsg?.eventPlan || null;

      hydrateSummaryFromMessages();
      renderHistoryList();
      renderMessages();
      closeMobilePanels();
    });
  });
}

function parseSummaryFromUserTurns() {
  state.summary = {
    eventType: null,
    date: null,
    location: null,
    guests: null,
    budget: null,
    religion: null,
    requirements: null,
  };

  const flow = {
    eventType: null,
    location: null,
    date: null,
    guests: null,
    religion: null,
    budget: null,
    requirements: null,
  };

  const isNoise = (text) => /^(ok|okay|hi|hello|hey|continue|start|yes|no)$/i.test(String(text || '').trim());
  const looksLikeBudgetUpdate = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    return (
      /(?:total\s+budget|my\s+new\s+budget|increase\s+budget|increase\s+the\s+budget|set\s+budget|budget\s+is|budget\s+to|budget\s+for|₹|rs\.?|rupees?|lakh|lac|crore|\bcr\b)/i.test(raw)
      || (/\d/.test(raw) && (/budget/i.test(raw) || /₹|rs\.?|rupees?|lakh|lac|crore|\bcr\b/i.test(raw)))
      || (/my\s+budget/i.test(lower) && /\d/.test(raw))
    );
  };
  const extractBudgetAmount = (text) => {
    const raw = String(text || '').replace(/,/g, ' ').trim();
    if (!looksLikeBudgetUpdate(raw)) return null;

    const currencyMatch = raw.match(/₹\s*([\d.]+)/i) || raw.match(/(?:rs\.?|inr)\s*([\d.]+)/i);
    if (currencyMatch?.[1]) {
      const value = Number(currencyMatch[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }

    const lakhMatch = raw.match(/([\d.]+)\s*(lakh|lac)/i);
    if (lakhMatch?.[1]) {
      const value = Number(lakhMatch[1]);
      if (Number.isFinite(value) && value > 0) return value * 100000;
    }

    const croreMatch = raw.match(/([\d.]+)\s*(crore|cr)\b/i);
    if (croreMatch?.[1]) {
      const value = Number(croreMatch[1]);
      if (Number.isFinite(value) && value > 0) return value * 10000000;
    }

    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;
    const value = Number(digits);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const looksLikeRequirementsUpdate = (text) => {
    const lower = String(text || '').toLowerCase();
    if (!lower) return false;
    if (looksLikeBudgetUpdate(lower)) return false;
    return /(?:special\s+requirements?|requirements?|no\s+special\s+requirements|pure\s+veg|halal|parking|generator|ac\s+venue|wheelchair|rain\s+backup|sound\s+limit)/i.test(lower);
  };
  const messages = Array.isArray(state.messages) ? state.messages : [];

  // Find latest wizard start so old conversation does not pollute summary.
  let startIdx = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'ai' && /what type of event are you planning/i.test(String(m.content || ''))) {
      startIdx = i;
      break;
    }
  }

  for (let i = startIdx; i < messages.length - 1; i += 1) {
    const ai = messages[i];
    const user = messages[i + 1];
    if (!ai || !user || ai.role !== 'ai' || user.role !== 'user') continue;

    const aiText = String(ai.content || '').toLowerCase();
    const userText = String(user.content || '').trim();
    if (!userText || isNoise(userText)) continue;

    const budgetAmount = extractBudgetAmount(userText);
    if (!flow.budget && budgetAmount) {
      flow.budget = fmtINR(budgetAmount);
      continue;
    }

    if (!flow.requirements && looksLikeRequirementsUpdate(userText)) {
      flow.requirements = userText;
      continue;
    }

    if (!flow.eventType && /what type of event/i.test(aiText)) {
      flow.eventType = userText;
      continue;
    }
    if (!flow.location && /(which city|city or area|city\/area)/i.test(aiText)) {
      flow.location = userText;
      continue;
    }
    if (!flow.date && /event date|yyyy-mm-dd/i.test(aiText)) {
      flow.date = userText;
      continue;
    }
    if (!flow.guests && /guests are expected|how many guests/i.test(aiText)) {
      flow.guests = userText.replace(/[^\d]/g, '') || userText;
      continue;
    }
    if (!flow.religion && /which religion/i.test(aiText)) {
      flow.religion = userText;
      continue;
    }
    if (!flow.budget && /total budget/i.test(aiText)) {
      const digits = extractBudgetAmount(userText);
      flow.budget = digits ? fmtINR(digits) : userText;
      continue;
    }
    if (!flow.requirements && /special requirements/i.test(aiText)) {
      flow.requirements = userText;
      continue;
    }
  }

  if (flow.eventType) state.summary.eventType = flow.eventType;
  if (flow.location) state.summary.location = flow.location;
  if (flow.date) state.summary.date = flow.date;
  if (flow.guests) state.summary.guests = flow.guests;
  if (flow.religion) state.summary.religion = flow.religion;
  if (flow.budget) state.summary.budget = flow.budget;
  if (flow.requirements) state.summary.requirements = flow.requirements;
}

function hydrateSummaryFromPlan(eventPlan) {
  if (!eventPlan) return;

  const s = eventPlan.event_summary || '';
  const requestedBudget = Number(eventPlan.ai_context?.requested_budget || 0);
  const budget = Number(eventPlan.budget_breakdown?.total || requestedBudget || eventPlan.total_estimated_cost || 0);

  if (budget > 0) state.summary.budget = fmtINR(budget);

  // Pass selected services and confirmed bookings to budget chart renderer
  if (eventPlan.budget_breakdown && eventPlan.selected_services) {
    renderBudgetChart(eventPlan.budget_breakdown, eventPlan.selected_services, state.userBookings || []);
  }

  const dateMatch = s.match(/on\s(\d{4}-\d{2}-\d{2})/i);
  const guestsMatch = s.match(/for\s(\d+)\s+guests/i);
  const inMatch = s.match(/(.+?)\sin\s(.+?)\sfor\s/i);
  if (dateMatch) state.summary.date = dateMatch[1];
  if (guestsMatch) state.summary.guests = guestsMatch[1];
  if (inMatch) {
    state.summary.eventType = inMatch[1].trim();
    state.summary.location = inMatch[2].trim();
  }
  if (eventPlan.requirements) state.summary.requirements = eventPlan.requirements;
}

function hydrateSummaryFromMessages() {
  parseSummaryFromUserTurns();
  renderSummary();
}

function renderSummary() {
  const currentBudget = state.summary.budget
    || (state.lastEventPlan?.ai_context?.requested_budget ? fmtINR(Number(state.lastEventPlan.ai_context.requested_budget)) : '')
    || (state.lastEventPlan?.budget_breakdown?.total ? fmtINR(Number(state.lastEventPlan.budget_breakdown.total)) : '')
    || (state.lastEventPlan?.total_estimated_cost ? fmtINR(Number(state.lastEventPlan.total_estimated_cost)) : '');
  const estimatedBudget = Number(state.lastEventPlan?.budget_breakdown?.total || state.lastEventPlan?.total_estimated_cost || 0);
  const confirmedFromBookings = (state.userBookings || [])
    .filter((b) => {
      const st = String(b?.status || '').toLowerCase();
      return st === 'confirmed' || st === 'completed';
    })
    .reduce((sum, b) => sum + Number(b?.vendorConfirmedPrice || b?.finalPrice || 0), 0);
  const confirmedBudget = confirmedFromBookings > 0
    ? confirmedFromBookings
    : Number(state.bookingSummary?.confirmedTotal || state.lastEventPlan?.budget_breakdown?.total_vendor_cost || 0);

  if (!state.summary.budget && currentBudget) state.summary.budget = currentBudget;
  el.sumEventType.textContent = state.summary.eventType || 'Not set';
  el.sumDate.textContent = state.summary.date || 'Not set';
  el.sumLocation.textContent = state.summary.location || 'Not set';
  el.sumGuests.textContent = state.summary.guests || 'Not set';

  if (el.sumPlannedBudget) {
    el.sumPlannedBudget.textContent = estimatedBudget > 0 ? fmtINR(estimatedBudget) : (currentBudget || 'Not set');
  }
  if (el.sumAfterBookingBudget) {
    if (confirmedBudget > 0) {
      el.sumAfterBookingBudget.textContent = fmtINR(confirmedBudget);
    } else {
      el.sumAfterBookingBudget.textContent = 'Waiting for vendor confirmation';
    }
  }
  if (el.sumBudgetNote) {
    if (estimatedBudget > 0 && confirmedBudget > 0 && confirmedBudget !== estimatedBudget) {
      const diff = confirmedBudget - estimatedBudget;
      const trend = diff > 0 ? 'higher' : 'lower';
      el.sumBudgetNote.textContent = `Planned: ${fmtINR(estimatedBudget)} | Confirmed: ${fmtINR(confirmedBudget)} (${fmtINR(Math.abs(diff))} ${trend}).`;
    } else if (estimatedBudget > 0 && confirmedBudget > 0) {
      el.sumBudgetNote.textContent = 'Planned and confirmed totals currently match.';
    } else if (currentBudget) {
      el.sumBudgetNote.textContent = 'Planned is AI estimate; confirmed total updates as vendors confirm booking prices.';
    } else {
      el.sumBudgetNote.textContent = 'Estimates can change after vendor confirmation.';
    }
  }
  el.sumReligion.textContent = state.summary.religion || 'Not set';
  el.sumRequirements.textContent = state.summary.requirements || 'Not set';
}

function openBudgetEditor() {
  if (!el.summaryBudgetEditor || !el.summaryBudgetInput) return;
  const currentBudget = state.summary.budget
    || (state.lastEventPlan?.ai_context?.requested_budget ? fmtINR(Number(state.lastEventPlan.ai_context.requested_budget)) : '')
    || (state.lastEventPlan?.budget_breakdown?.total ? fmtINR(Number(state.lastEventPlan.budget_breakdown.total)) : '')
    || (state.lastEventPlan?.total_estimated_cost ? fmtINR(Number(state.lastEventPlan.total_estimated_cost)) : '');
  const currentDigits = String(currentBudget || '').replace(/[^\d]/g, '');
  el.summaryBudgetInput.value = currentDigits || '';
  el.summaryBudgetEditor.classList.add('open');
  el.summaryBudgetInput.focus();
}

function closeBudgetEditor() {
  if (!el.summaryBudgetEditor) return;
  el.summaryBudgetEditor.classList.remove('open');
}

function resetConversationState() {
  if (state.historyRefreshTimer) {
    clearTimeout(state.historyRefreshTimer);
    state.historyRefreshTimer = null;
  }
  state.messages = [];
  state.historyGroups = [];
  state.selectedHistoryId = null;
  state.activeConversationId = createConversationId();
  state.lastUserMessage = '';
  state.lastEventPlan = null;
  state.summary = {
    eventType: null,
    date: null,
    location: null,
    guests: null,
    budget: null,
    religion: null,
  };
}

async function applyBudgetChangeFromSummary() {
  if (!el.summaryBudgetInput) return;
  const newBudget = Number(String(el.summaryBudgetInput.value || '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(newBudget) || newBudget <= 0) {
    setStatus('Enter a valid budget amount in rupees.');
    el.summaryBudgetInput.focus();
    return;
  }

  state.summary.budget = fmtINR(newBudget);
  renderSummary();
  closeBudgetEditor();
  setStatus('Updating budget and regenerating best plan...');

  await sendMessage(`My total budget is ₹${Math.round(newBudget)}. Keep same event details and regenerate vendor recommendations with realistic nearby results.`);
}

function renderBudgetChart(budgetBreakdown, selectedServices = [], confirmedBookings = []) {
  if (!budgetBreakdown || !selectedServices || selectedServices.length === 0) {
    el.budgetChart.style.display = 'none';
    return;
  }

  const SERVICE_ICONS = {
    venue: '🏛️',
    catering: '🍽️',
    decoration: '🎨',
    photography: '📸',
    videography: '🎥',
    dj: '🎵',
    florist: '💐',
    dresses: '👗',
    priest: '🙏',
    band: '🎺',
    tent: '⛺',
  };

  const SERVICE_LABELS = {
    venue: 'Venue / Hall',
    catering: 'Catering',
    decoration: 'Decoration',
    photography: 'Photography',
    videography: 'Videography',
    dj: 'DJ / Music',
    florist: 'Florist',
    dresses: 'Dresses / Makeup',
    priest: 'Religious Officiant',
    band: 'Band',
    tent: 'Tent / Shamiana',
  };

  // Build a map of serviceCategory -> confirmed booking price.
  const confirmedByCategory = {};
  (confirmedBookings || []).forEach((booking) => {
    const status = String(booking?.status || '').toLowerCase().trim();
    if (status !== 'confirmed' && status !== 'completed') return;

    const cat = normalizeBookingService(booking);
    const price = Number(booking?.vendorConfirmedPrice || booking?.finalPrice || booking?.quotedPrice || 0);
    if (cat && cat !== 'other' && price > 0) {
      confirmedByCategory[cat] = (confirmedByCategory[cat] || 0) + price;
    }
  });

  let plannedTotal = 0;
  let confirmedTotal = 0;
  let html = `
    <div class="budget-chart-title">💰 Budget Tracker</div>
    <div class="budget-table-header">
      <span>Service</span>
      <span>Planned</span>
      <span>Confirmed</span>
    </div>
  `;

  selectedServices.forEach((service) => {
    const normalizedService = String(service || '').toLowerCase().trim();
    const breakdownKey = {
      'function hall': 'venue',
      venue: 'venue',
      catering: 'catering',
      decoration: 'decoration',
      photography: 'photography',
      videography: 'videography',
      dj: 'dj',
      florist: 'florist',
      dresses: 'dresses',
      priest: 'priest',
      band: 'band',
      tent: 'tent',
    }[normalizedService] || normalizedService;

    const planned = Number(budgetBreakdown[breakdownKey] || 0);
    const confirmed = Number(confirmedByCategory[breakdownKey] || 0);
    const isConfirmed = confirmed > 0;

    plannedTotal += planned;
    confirmedTotal += confirmed;

    const icon = SERVICE_ICONS[breakdownKey] || '📦';
    const label = SERVICE_LABELS[breakdownKey] || service;
    const confirmedCell = isConfirmed
      ? `<span class="budget-confirmed-amount">₹${confirmed.toLocaleString('en-IN')} ✅</span>`
      : '<span class="budget-pending-amount">Pending</span>';

    html += `
      <div class="budget-row ${isConfirmed ? 'budget-row-confirmed' : ''}">
        <span class="budget-service-label">${icon} ${escapeHtml(String(label))}</span>
        <span class="budget-planned-amount">₹${planned.toLocaleString('en-IN')}</span>
        ${confirmedCell}
      </div>
    `;
  });

  html += `
    <div class="budget-totals-row">
      <span class="budget-service-label"><strong>💵 Total</strong></span>
      <span class="budget-planned-amount"><strong>₹${plannedTotal.toLocaleString('en-IN')}</strong></span>
      <span class="${confirmedTotal > 0 ? 'budget-confirmed-amount' : 'budget-pending-amount'}">
        <strong>${confirmedTotal > 0 ? `₹${confirmedTotal.toLocaleString('en-IN')}` : 'Pending'}</strong>
      </span>
    </div>
  `;

  if (confirmedTotal > 0 && confirmedTotal !== plannedTotal) {
    const diff = confirmedTotal - plannedTotal;
    const dir = diff > 0 ? 'more' : 'less';
    html += `
      <div class="budget-diff-note ${diff > 0 ? 'budget-over' : 'budget-under'}">
        ${diff > 0 ? '⚠️' : '✨'} Confirmed vendors cost ₹${Math.abs(diff).toLocaleString('en-IN')} ${dir} than planned
      </div>
    `;
  }

  html += '<div class="budget-note">Planned = AI estimate. Confirmed = vendor\'s actual price after booking.</div>';

  el.budgetChart.innerHTML = html;
  el.budgetChart.style.display = 'block';
}

function showRetry(message, onRetry) {
  const box = document.createElement('div');
  box.className = 'msg ai';
  box.innerHTML = `<div class="retry-pill">⚠️ Something went wrong. Tap to retry.</div>`;
  box.querySelector('.retry-pill').addEventListener('click', onRetry);
  el.messages.appendChild(box);
  setStatus(message || 'Action failed.');
  scrollToBottom();
}

async function loadHistory() {
  const data = await apiFetch('/ai/chat/history', { method: 'GET' });
  const history = data.data?.history || [];

  state.historyGroups = groupConversation(history);
  if (!history.length) {
    resetConversationState();
    renderSummary();
    addMessage('ai', WELCOME_MESSAGE);
  } else if (!state.selectedHistoryId) {
    const top = state.historyGroups[0];
    if (top) {
      state.selectedHistoryId = top.id;
      state.activeConversationId = top.id;
      state.messages = top.messages.map((m) => {
        const normalizedRole = m.role === 'assistant' ? 'ai' : m.role;
        const eventPlan = m.event_plan || null;
        return {
          id: `${Date.now()}-${Math.random()}`,
          role: normalizedRole,
          content: m.content,
          usage: m.usage || null,
          timestamp: m.createdAt || new Date().toISOString(),
          eventPlan,
          chips: normalizedRole === 'ai' ? generateChipsFromResponse(m.content || '', eventPlan) : [],
          vendorCards: eventPlan ? extractPlanVendors(eventPlan) : [],
        };
      });
    }
  }

  renderHistoryList();
  hydrateSummaryFromMessages();
  renderMessages();
}

async function sendMessage(rawMessage) {
  let message = String(rawMessage || '').trim();
  if (!message) return;

  const isWarmupGreeting = /^(ok|okay|hi|hello|hey|start|begin|continue|yes)$/i.test(message);
  const hasAnyUserMessage = state.messages.some((m) => m.role === 'user');
  const hasTypeQuestionVisible = state.messages.some(
    (m) => m.role === 'ai' && /what type of event are you planning/i.test(String(m.content || ''))
  );
  const suppressGreetingBubble = isWarmupGreeting && !hasAnyUserMessage && !hasTypeQuestionVisible;

  state.lastUserMessage = message;
  if (!suppressGreetingBubble) {
    addMessage('user', message);
  } else {
    // Normalize first-turn warmup utterances so they don't pollute summary state.
    message = 'start';
  }
  hydrateSummaryFromMessages();
  renderSummary();

  renderTyping(true);
  setStatus('AI is thinking...');

  try {
    const data = await apiFetch('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId: state.activeConversationId || createConversationId() }),
    });

    renderTyping(false);

    const text = data.data?.message || '';
    const usage = data.data?.usage || null;
    const eventPlan = data.data?.event_plan || null;
    const serverChips = Array.isArray(data.data?.chips) ? data.data.chips : [];
    const venueBlock = data.data?.venue_block || null;
    const textVendors = eventPlan ? [] : extractVendorsFromText(text);
    const hydratedVendors = textVendors.length ? await hydrateVendorCardsFromSearch(textVendors) : [];

    // Server-provided chips take priority over generated chips
    const responseChips = serverChips.length > 0
      ? serverChips
      : generateChipsFromResponse(text, eventPlan);
    addMessage('ai', text, usage, eventPlan, responseChips, hydratedVendors);

    // If server reported a venue block, show a visual indicator in the right panel
    if (venueBlock) {
      const sumEventType = document.getElementById('sumEventType');
      if (sumEventType) {
        sumEventType.style.color = '#dc2626';
      }
      setStatus(`⚠️ Venue not confirmed for ${venueBlock.city} on ${venueBlock.date} — respond to fix this first.`);
    }

    // Map is intentionally hidden in this UX mode.
    if (el.showMapBtn) el.showMapBtn.style.display = 'none';
    if (el.mapSection) el.mapSection.style.display = 'none';

    if (eventPlan) {
      state.lastEventPlan = eventPlan;
      hydrateSummaryFromPlan(eventPlan);
      renderSummary();
    }

    if (!venueBlock) setStatus('');
    scheduleHistoryRefresh();
  } catch (error) {
    renderTyping(false);
    showRetry(error.message, () => sendMessage(message));
  }
}

function quickQuestionPrompt(type) {
  if (type === 'location') return 'My event location is ';
  if (type === 'guests') return 'Expected guests count is ';
  if (type === 'budget') return 'My total budget is ₹';
  if (type === 'requirements') return 'My special requirements are ';
  return '';
}

function normalizeBookingService(booking = {}) {
  const fromServiceCategory = resolveServiceCategoryKey(String(booking?.serviceCategory || '').trim());
  if (fromServiceCategory && fromServiceCategory !== 'other') return fromServiceCategory;
  const vendorCategory = String(booking?.vendorId?.category || '').trim();
  const fromVendorCategory = resolveServiceCategoryKey(vendorCategory);
  if (fromVendorCategory && fromVendorCategory !== 'other') return fromVendorCategory;
  return 'other';
}

function getPlanSelectedServiceKeys(plan = state.lastEventPlan || {}) {
  const selected = getSelectedServicesForPlan(plan);
  const keys = new Set(
    (Array.isArray(selected) ? selected : [])
      .map((service) => resolveServiceCategoryKey(service))
      .filter((service) => service && service !== 'other')
  );

  if (keys.size > 0) return keys;

  const budgetBreakdown = plan?.budget_breakdown || {};
  const knownServiceKeys = ['venue', 'catering', 'decoration', 'photography', 'videography', 'dj', 'florist', 'dresses', 'priest', 'band', 'tent'];
  knownServiceKeys.forEach((serviceKey) => {
    if (Number(budgetBreakdown?.[serviceKey] || 0) > 0) keys.add(serviceKey);
  });

  return keys;
}

function buildConfirmedVendorReport(confirmedBookings = [], allBookings = []) {
  const now = new Date();
  const plannedServices = getPlanSelectedServiceKeys(state.lastEventPlan || {});
  const confirmedServices = new Set(
    confirmedBookings
      .map((booking) => normalizeBookingService(booking))
      .filter((service) => service && service !== 'other')
  );

  const pendingFromPlan = Array.from(plannedServices).filter((service) => !confirmedServices.has(service));
  const pendingFromBookings = (Array.isArray(allBookings) ? allBookings : [])
    .filter((booking) => String(booking?.status || '').toLowerCase().trim() === 'pending')
    .map((booking) => normalizeBookingService(booking))
    .filter((service) => service && service !== 'other' && !confirmedServices.has(service));
  const pendingServices = Array.from(new Set([...pendingFromPlan, ...pendingFromBookings]));

  const confirmedTotal = confirmedBookings.reduce((sum, booking) => {
    const amount = Number(booking?.vendorConfirmedPrice || booking?.finalPrice || booking?.quotedPrice || 0);
    return sum + amount;
  }, 0);
  const plannedServicesArray = Array.from(plannedServices);
  const budgetBreakdown = state.lastEventPlan?.budget_breakdown || {};
  const plannedTotal = Number(
    state.lastEventPlan?.budget_breakdown?.total_vendor_cost
    || state.lastEventPlan?.total_estimated_cost
    || state.lastEventPlan?.budget_breakdown?.total
    || plannedServicesArray.reduce((sum, service) => sum + Number(budgetBreakdown?.[service] || 0), 0)
    || 0
  );
  const delta = confirmedTotal - plannedTotal;
  const deltaText = delta === 0
    ? 'same as planned'
    : `${delta > 0 ? 'higher' : 'lower'} by ₹${Math.abs(delta).toLocaleString('en-IN')}`;

  const lines = [
    'BUDGET AI CONFIRMED VENDORS REPORT',
    `Generated: ${now.toLocaleString('en-IN')}`,
    '',
    `Event: ${state.lastEventPlan?.event_summary || 'Event plan'}`,
    `Planned services: ${Array.from(plannedServices).join(', ') || 'N/A'}`,
    `Confirmed services: ${Array.from(confirmedServices).join(', ') || 'N/A'}`,
    `Pending services: ${pendingServices.length ? pendingServices.join(', ') : 'None'}`,
    '',
    `Planned vendor total: ₹${plannedTotal.toLocaleString('en-IN')}`,
    `Confirmed vendor total: ₹${confirmedTotal.toLocaleString('en-IN')}`,
    `Variance: ${deltaText}`,
    '',
    'Confirmed vendors:',
  ];

  confirmedBookings.forEach((booking, idx) => {
    const vendorName = booking?.vendorId?.businessName || booking?.vendorName || 'Vendor';
    const service = normalizeBookingService(booking);
    const amount = Number(booking?.vendorConfirmedPrice || booking?.finalPrice || booking?.quotedPrice || 0);
    const eventDate = booking?.eventDate
      ? new Date(booking.eventDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' })
      : '-';
    lines.push(`${idx + 1}. ${vendorName} | service: ${service} | booking: ${booking?.bookingId || booking?._id || '-'} | date: ${eventDate} | amount: ₹${amount.toLocaleString('en-IN')}`);
  });

  return { reportText: lines.join('\n'), pendingServices };
}

function buildSavedPlanFile(plan = {}, confirmedBookings = []) {
  const now = new Date();
  const selectedServices = Array.from(getPlanSelectedServiceKeys(plan));
  const budgetBreakdown = plan?.budget_breakdown || {};
  const vendors = extractPlanVendors(plan);

  const confirmedByService = {};
  (Array.isArray(confirmedBookings) ? confirmedBookings : []).forEach((booking) => {
    const status = String(booking?.status || '').toLowerCase().trim();
    if (status !== 'confirmed' && status !== 'completed') return;
    const serviceKey = normalizeBookingService(booking);
    const amount = Number(booking?.vendorConfirmedPrice || booking?.finalPrice || booking?.quotedPrice || 0);
    if (!serviceKey || serviceKey === 'other' || amount <= 0) return;
    confirmedByService[serviceKey] = (confirmedByService[serviceKey] || 0) + amount;
  });

  const lines = [
    'BUDGET AI SAVED PLAN',
    `Generated: ${now.toLocaleString('en-IN')}`,
    '',
    `Event: ${plan?.event_summary || state.summary?.eventType || 'Event plan'}`,
    `Location: ${plan?.ai_context?.requested_city || state.summary?.location || '-'}`,
    `Date: ${plan?.ai_context?.event_date || state.summary?.date || '-'}`,
    `Guests: ${plan?.ai_context?.guest_count || state.summary?.guests || '-'}`,
    `Budget: ₹${Number(plan?.ai_context?.requested_budget || String(state.summary?.budget || '').replace(/[^\d.]/g, '') || 0).toLocaleString('en-IN')}`,
    '',
    `Selected services: ${selectedServices.length ? selectedServices.join(', ') : 'N/A'}`,
    '',
    'Budget allocation:',
  ];

  selectedServices.forEach((serviceKey) => {
    const planned = Number(budgetBreakdown?.[serviceKey] || 0);
    const confirmed = Number(confirmedByService?.[serviceKey] || 0);
    lines.push(`- ${serviceKey}: planned ₹${planned.toLocaleString('en-IN')} | confirmed ${confirmed > 0 ? `₹${confirmed.toLocaleString('en-IN')}` : 'Pending'}`);
  });

  lines.push('', 'Selected vendors:');
  if (!vendors.length) {
    lines.push('- No vendors listed in the current plan snapshot');
  } else {
    vendors.forEach((vendor, idx) => {
      const name = vendor?.vendor_name || 'Vendor';
      const category = resolveServiceCategoryKey(vendor?.category || vendor?.services || 'other');
      const cityArea = [vendor?.area, vendor?.city].filter(Boolean).join(', ');
      const amount = Number(vendor?.estimated_cost || 0);
      lines.push(`${idx + 1}. ${name} | service: ${category} | location: ${cityArea || '-'} | estimate: ${amount > 0 ? `₹${amount.toLocaleString('en-IN')}` : '-'}`);
    });
  }

  lines.push('', 'Saved location: My Plans (sidebar)');
  return lines.join('\n');
}

function downloadTextFile(content, fileName) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function clearHistoryAndRestart() {
  await apiFetch('/ai/chat/history', { method: 'DELETE' });
  resetConversationState();
  renderSummary();
  el.budgetChart.style.display = 'none';
  await loadHistory();
  setStatus('Started a fresh conversation.');
}

function createConversationId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPlanAnswersFromSummary() {
  const budgetRaw = String(state.summary.budget || '').replace(/[^\d.]/g, '');
  const budget = Number(budgetRaw || 0);
  const income = Math.max(budget * 1.5, 50000);

  return {
    monthly_income: Math.round(income),
    housing: Math.round(income * 0.25),
    food: Math.round(income * 0.15),
    transport: Math.round(income * 0.1),
    entertainment: Math.round(income * 0.08),
    savings_goal: Math.round(income * 0.2),
    financial_goal: String(state.summary.eventType || 'Event Planning Fund'),
  };
}

async function savePlan() {
  const ensurePlan = async () => {
    if (state.lastEventPlan) return state.lastEventPlan;
    try {
      const plansData = await apiFetch('/ai/plans', { method: 'GET' });
      const latest = plansData?.data?.plans?.[0];
      if (!latest?.id) return null;
      const planData = await apiFetch(`/ai/plans/${latest.id}`, { method: 'GET' });
      const fetchedPlan = planData?.data?.plan?.eventPlan || null;
      if (fetchedPlan) {
        state.lastEventPlan = fetchedPlan;
        hydrateSummaryFromPlan(fetchedPlan);
        renderSummary();
      }
      return fetchedPlan;
    } catch {
      return null;
    }
  };

  const plan = await ensurePlan();
  if (!plan) {
    setStatus('No event plan found yet. Generate one in chat, then click Save Plan.');
    return;
  }

  setStatus('Saving plan and checking vendor confirmations...');
  try {
    const bookings = await loadUserBookings();
    const confirmedBookings = (Array.isArray(bookings) ? bookings : []).filter((booking) => {
      const st = String(booking?.status || '').toLowerCase();
      return st === 'confirmed' || st === 'completed';
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const savedPlanText = buildSavedPlanFile(plan, confirmedBookings);
    downloadTextFile(savedPlanText, `saved-plan-${stamp}.txt`);

    const { reportText, pendingServices } = buildConfirmedVendorReport(confirmedBookings, bookings);

    if (pendingServices.length > 0) {
      setStatus(`✅ Plan saved in My Plans and file downloaded. Vendor confirmations pending for: ${pendingServices.join(', ')}.`);
      addMessage('ai', `Plan saved in My Plans and downloaded as file. Waiting for confirmations on: ${pendingServices.join(', ')}.`);
      return;
    }

    if (!confirmedBookings.length) {
      setStatus('✅ Plan saved in My Plans and file downloaded. No confirmed vendors yet, so report was not generated.');
      return;
    }

    downloadTextFile(reportText, `confirmed-vendors-report-${stamp}.txt`);
    addMessage('ai', '✅ All selected vendors are confirmed. I generated your confirmed-vendors report.');
    setStatus('✅ Saved-plan file and confirmed-vendors report generated. Plan is available in My Plans.');
  } catch (error) {
    setStatus(`❌ Save Plan failed: ${error?.message || 'Unknown error'}`);
    showRetry(error.message, savePlan);
  }
}

async function loadPlans() {
  const data = await apiFetch('/ai/plans', { method: 'GET' });
  const plans = data.data?.plans || [];

  if (!plans.length) {
    el.plansList.innerHTML = '<li class="plan-item">No saved plans.</li>';
    return;
  }

  el.plansList.innerHTML = plans
    .map(
      (p) => `
    <li class="plan-item">
      <div class="item-date">${toDateLabel(p.createdAt)}</div>
      <div class="item-preview">${p.summary || 'Event Plan'}</div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <button class="btn small" data-view-plan="${escapeHtml(String(p.id || ''))}">View</button>
        <button class="btn small danger" data-delete-plan="${escapeHtml(String(p.id || ''))}">Delete</button>
      </div>
    </li>`
    )
    .join('');

  el.plansList.querySelectorAll('[data-view-plan]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.viewPlan;
      if (!id) {
        setStatus('Could not open this plan. Please refresh My Plans.');
        return;
      }
      try {
        setStatus('Opening saved plan...');
        const planData = await apiFetch(`/ai/plans/${id}`, { method: 'GET' });
        const p = planData.data?.plan;
        if (!p) {
          setStatus('Plan details not available.');
          return;
        }

        if (p.eventPlan && typeof p.eventPlan === 'object') {
          state.lastEventPlan = p.eventPlan;
          hydrateSummaryFromPlan(p.eventPlan);
          renderSummary();
        }

        const summary = p.planText
          ? p.planText
          : p.eventPlan?.event_summary
            ? `Saved Plan\n\n${p.eventPlan.event_summary}`
            : p.eventDraftSnapshot
              ? `Event Draft\n\n${JSON.stringify(p.eventDraftSnapshot, null, 2)}`
              : 'Plan details not available.';
        addMessage('ai', summary, null, p.eventPlan || null);
        setStatus('Saved plan loaded.');
      } catch (error) {
        if (error?.status === 404) {
          setStatus('This saved plan no longer exists. Refreshing plan list...');
          await loadPlans();
          return;
        }
        showRetry(error.message, () => {});
      }
    });
  });

  el.plansList.querySelectorAll('[data-delete-plan]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deletePlan;
      try {
        await apiFetch(`/ai/plans/${id}`, { method: 'DELETE' });
        setStatus('Plan deleted.');
        await loadPlans();
        await loadHistory();
        await loadVendorConversationsSummary();
      } catch (error) {
        showRetry(error.message, () => loadPlans());
      }
    });
  });
}

function closeMobilePanels() {
  el.leftPanel.classList.remove('mobile-open');
  el.rightPanel.classList.remove('mobile-open');
}

function bindEvents() {
  el.chatInput.addEventListener('input', autoResizeInput);
  el.chatInput.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    el.chatInput.value = '';
    autoResizeInput();
    await sendMessage(text);
  });

  document.querySelectorAll('[data-quick-question]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type = btn.getAttribute('data-quick-question');
      if (!type) return;

      const starter = quickQuestionPrompt(type);
      el.chatInput.value = starter;
      autoResizeInput();
      el.chatInput.focus();
      setStatus('Fill this and press Send.');
    });
  });

  el.chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    el.chatInput.value = '';
    autoResizeInput();
    await sendMessage(text);
  });

  el.regenerateBtn.addEventListener('click', async () => {
    if (!state.lastUserMessage) {
      setStatus('No previous user question to regenerate.');
      return;
    }
    await sendMessage(state.lastUserMessage);
  });

  el.logoutBtn.addEventListener('click', async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      redirectToLogin();
    } catch {
      redirectToLogin();
    }
  });

  el.newChatBtn.addEventListener('click', async () => {
    try {
      await clearHistoryAndRestart();
    } catch (error) {
      showRetry(error.message, clearHistoryAndRestart);
    }
  });

  el.myPlansBtn.addEventListener('click', async () => {
    const open = !el.plansDrawer.classList.contains('open');
    el.plansDrawer.classList.toggle('open', open);
    if (open) {
      try {
        await loadPlans();
      } catch (error) {
        showRetry(error.message, loadPlans);
      }
    }
  });

  el.savePlanBtn.addEventListener('click', async () => {
    try {
      await savePlan();
      await loadPlans();
    } catch (error) {
      showRetry(error.message, savePlan);
    }
  });

  el.toggleSummaryBtn.addEventListener('click', () => {
    el.rightPanel.classList.toggle('collapsed');
    syncPanelLayoutButtons();
  });

  el.toggleLeftPanelBtn?.addEventListener('click', () => {
    setLeftPanelHidden(!state.panelLayout.leftHidden);
  });

  el.enlargeLeftPanelBtn?.addEventListener('click', () => {
    setLeftPanelEnlarged(!state.panelLayout.leftEnlarged);
  });

  el.toggleRightPanelBtn?.addEventListener('click', () => {
    setRightPanelHidden(!state.panelLayout.rightHidden);
  });

  el.enlargeRightPanelBtn?.addEventListener('click', () => {
    setRightPanelEnlarged(!state.panelLayout.rightEnlarged);
  });

  setupPanelDragResize(el.leftResizeHandle, 'left');
  setupPanelDragResize(el.rightResizeHandle, 'right');

  if (el.changeBudgetBtn) {
    el.changeBudgetBtn.addEventListener('click', openBudgetEditor);
  }
  if (el.cancelBudgetBtn) {
    el.cancelBudgetBtn.addEventListener('click', closeBudgetEditor);
  }
  if (el.applyBudgetBtn) {
    el.applyBudgetBtn.addEventListener('click', async () => {
      try {
        await applyBudgetChangeFromSummary();
      } catch (error) {
        showRetry(error.message, applyBudgetChangeFromSummary);
      }
    });
  }
  if (el.summaryBudgetInput) {
    el.summaryBudgetInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        try {
          await applyBudgetChangeFromSummary();
        } catch (error) {
          showRetry(error.message, applyBudgetChangeFromSummary);
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeBudgetEditor();
      }
    });
  }

  el.tabHistoryBtn.addEventListener('click', () => {
    const open = !el.leftPanel.classList.contains('mobile-open');
    closeMobilePanels();
    if (open) el.leftPanel.classList.add('mobile-open');
    if (Date.now() - Number(state.bookingsLastLoadedAt || 0) > 20000) {
      loadUserBookings().catch(() => {});
    }
  });

  el.tabSummaryBtn.addEventListener('click', () => {
    const open = !el.rightPanel.classList.contains('mobile-open');
    closeMobilePanels();
    if (open) el.rightPanel.classList.add('mobile-open');
    if (Date.now() - Number(state.bookingsLastLoadedAt || 0) > 20000) {
      loadUserBookings().catch(() => {});
    }
  });

  el.tabChatBtn.addEventListener('click', closeMobilePanels);

  applyPanelState(el.leftPanel, state.panelLayout.leftHidden, state.panelLayout.leftEnlarged, state.panelLayout.leftWidth, 250, 340);
  applyPanelState(el.rightPanel, state.panelLayout.rightHidden, state.panelLayout.rightEnlarged, state.panelLayout.rightWidth, 300, 360);
  syncPanelLayoutButtons();

  if (el.refreshBookingsBtn) {
    el.refreshBookingsBtn.addEventListener('click', () => {
      state.bookingsRateLimitedUntil = 0;
      loadUserBookings().catch(() => {});
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    window.closePortfolioLightbox();
    window.closeVendorDetailModal();
    window.closeBookingModal();
  });

  document.getElementById('reviewModalClose')?.addEventListener('click', closeReviewModal);
  document.getElementById('reviewBackdrop')?.addEventListener('click', closeReviewModal);
  document.getElementById('reviewModalSubmit')?.addEventListener('click', submitReview);
}

async function loadVendorConversationsSummary() {
  const root = document.getElementById('vendorConvList');
  if (!root) return;
  const role = state.currentUserProfile?.role;
  if (role && role !== 'user') {
    root.innerHTML = '<span class="muted">Vendor coordination summary is available on the customer (user) account.</span>';
    return;
  }
  try {
    const data = await apiFetch('/user/me/conversations-summary', { method: 'GET' });
    const rows = data.data?.summaries || [];
    if (!rows.length) {
      root.innerHTML = '<span class="muted">No vendor threads yet. After you request a booking, you and the vendor can exchange messages there.</span>';
      return;
    }
    root.innerHTML = rows.map(r => `
    <div style="border-bottom:1px dashed #e7ecf9;padding:8px 0;cursor:pointer;"
      data-booking-ref="${escapeHtml(r.bookingRef || r.bookingId || '')}"
      onclick="window.openUserThread('${escapeHtml(r.bookingRef || r.bookingId || '')}', '${escapeHtml(r.vendorName || '')}')">
      <strong>${escapeHtml(r.vendorName || 'Vendor')}</strong>
      <span class="muted" style="font-size:11px;"> · ${escapeHtml(r.bookingId || '')}</span><br/>
      <span class="muted" style="font-size:11px;">${r.lastAt ? new Date(r.lastAt).toLocaleString('en-IN') : '—'}</span><br/>
      <span style="font-size:12px;">${escapeHtml(r.lastPreview || 'No messages yet')}</span>
      <span style="float:right;font-size:11px;color:#f97316;font-weight:700;">Chat →</span>
    </div>`).join('');
  } catch {
    root.innerHTML = '<span class="muted">Could not load vendor threads (try refreshing).</span>';
  }
}

async function loadBookingBudgetSummary() {
  const bookings = Array.isArray(state.userBookings) ? state.userBookings : [];
  const isConfirmedStatus = (value) => {
    const status = String(value || '').toLowerCase().trim();
    return status === 'confirmed' || status === 'completed';
  };
  const isPlannedStatus = (value) => {
    const status = String(value || '').toLowerCase().trim();
    return status === 'pending' || status === 'confirmed' || status === 'completed';
  };

  const confirmedTotal = bookings
    .filter((b) => isConfirmedStatus(b?.status))
    .reduce((sum, booking) => sum + Number(booking.vendorConfirmedPrice || booking.finalPrice || booking.quotedPrice || 0), 0);
  const plannedTotal = bookings
    .filter((b) => isPlannedStatus(b?.status))
    .reduce((sum, booking) => sum + Number(booking.quotedPrice || booking.finalPrice || 0), 0);
  state.bookingSummary = {
    plannedTotal,
    confirmedTotal,
    confirmedCount: bookings.filter((b) => isConfirmedStatus(b?.status)).length,
    totalCount: bookings.length,
  };
  renderSummary();
}

function bookingStatusClass(statusLike) {
  const status = String(statusLike || '').toLowerCase();
  if (status === 'confirmed' || status === 'completed') return 'status-confirmed';
  if (status === 'cancelled') return 'status-cancelled';
  return 'status-pending';
}

function renderUserBookings(bookings = []) {
  if (!el.userBookingsList) return;
  if (!Array.isArray(bookings) || bookings.length === 0) {
    el.userBookingsList.innerHTML = '<span class="muted" style="font-size:12px;">No bookings yet. Book a vendor to track status here.</span>';
    return;
  }

  el.userBookingsList.innerHTML = bookings.map((booking) => {
    const vendorName = booking?.vendorId?.businessName || booking?.vendorName || 'Vendor';
    const status = String(booking?.status || 'Pending');
    const eventDate = booking?.eventDate ? new Date(booking.eventDate).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' }) : 'Date not set';
    const confirmedAt = booking?.confirmedAt ? toDateLabel(booking.confirmedAt) : '';
    const amount = Number(booking?.finalPrice || booking?.quotedPrice || 0);
      return `
      <div class="user-booking-item" data-booking-id="${escapeHtml(String(booking?.bookingId || booking?._id || ''))}">
        <div class="booking-top-row">
          <strong>${escapeHtml(vendorName)}</strong>
          <span class="status-badge ${bookingStatusClass(status)}">${escapeHtml(status)}</span>
        </div>
        <div class="muted">${escapeHtml(String(booking?.bookingId || ''))}</div>
        <div>📅 ${escapeHtml(eventDate)}</div>
        ${amount > 0 ? `<div>💰 ₹${amount.toLocaleString('en-IN')}</div>` : ''}
        ${(status.toLowerCase() === 'confirmed' || status.toLowerCase() === 'completed') && confirmedAt ? `<div style="color:#166534;">✅ Confirmed at ${escapeHtml(confirmedAt)}</div>` : ''}
        ${(status.toLowerCase() === 'confirmed' || status.toLowerCase() === 'completed') ? `
          <div style="margin-top:8px;">
            <button class="btn small" data-action="open-review" data-booking="${escapeHtml(String(booking?.bookingId || booking?._id || ''))}">Write review</button>
          </div>` : ''}
      </div>
    `;
  }).join('');
}

async function loadUserBookings() {
  if (state.bookingsRequestInFlight) return state.bookingsRequestInFlight;

  if (Date.now() < Number(state.bookingsRateLimitedUntil || 0)) {
    const waitSec = Math.max(1, Math.ceil((state.bookingsRateLimitedUntil - Date.now()) / 1000));
    if (el.userBookingsList) {
      el.userBookingsList.innerHTML = `<span class="muted" style="font-size:12px;">Too many requests. Retry in ~${waitSec}s.</span>`;
    }
    return state.userBookings;
  }

  state.bookingsRequestInFlight = (async () => {
    try {
      const json = await apiFetch('/user/bookings', { method: 'GET' });
      const bookings = json.data?.bookings || [];
      state.userBookings = bookings;
      state.bookingsLastLoadedAt = Date.now();
      state.bookingsRateLimitedUntil = 0;
      renderUserBookings(bookings);
      loadBookingBudgetSummary();

      // Refresh budget chart with latest confirmed prices.
      if (state.lastEventPlan?.budget_breakdown && state.lastEventPlan?.selected_services) {
        renderBudgetChart(
          state.lastEventPlan.budget_breakdown,
          state.lastEventPlan.selected_services,
          bookings,
        );
      }

      if (Array.isArray(state.messages) && state.messages.length) {
        renderMessages();
      }

      return bookings;
    } catch (e) {
      if (e?.status === 429) {
        state.bookingsRateLimitedUntil = Date.now() + 60 * 1000;
      }
      console.error('Failed to load bookings', e);
      if (el.userBookingsList) {
        el.userBookingsList.innerHTML = e?.status === 429
          ? '<span class="muted" style="font-size:12px;">Rate limit reached. Please wait a minute.</span>'
          : '<span class="muted" style="font-size:12px;">Failed to load bookings. Try Refresh.</span>';
      }
      return state.userBookings;
    } finally {
      state.bookingsRequestInFlight = null;
    }
  })();

  return state.bookingsRequestInFlight;
}

async function init() {
  bindEvents();
  autoResizeInput();

  if (!MAP_ENABLED) {
    if (el.showMapBtn) el.showMapBtn.style.display = 'none';
    if (el.mapSection) el.mapSection.style.display = 'none';
  }

  try {
    const profileData = await apiFetch('/auth/profile', { method: 'GET' });
    state.currentUserProfile = profileData.data?.user || null;
    if (state.currentUserProfile?.role && state.currentUserProfile.role !== 'user') {
      window.location.href = './vendor-dashboard.html';
      return;
    }
    await loadHistory();
    await loadUserBookings();
    loadBookingBudgetSummary();
    renderSummary();
    await loadVendorConversationsSummary();
    if (state.bookingRefreshTimer) clearInterval(state.bookingRefreshTimer);
    state.bookingRefreshTimer = setInterval(() => {
      loadUserBookings().catch(() => {});
    }, 30000);
    setStatus('');
  } catch (error) {
    showRetry(error.message, init);
  }
}

// Review modal handlers
function openReviewModal(bookingId) {
  const backdrop = document.getElementById('reviewBackdrop');
  const modal = document.getElementById('reviewModal');
  if (!backdrop || !modal) return;
  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');
  modal.dataset.booking = String(bookingId || '');
}

function closeReviewModal() {
  const backdrop = document.getElementById('reviewBackdrop');
  const modal = document.getElementById('reviewModal');
  if (!backdrop || !modal) return;
  backdrop.classList.add('hidden');
  modal.classList.add('hidden');
  modal.dataset.booking = '';
  document.getElementById('reviewComment').value = '';
  document.getElementById('reviewRating').value = 5;
}

async function submitReview() {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;
  const bookingRef = modal.dataset.booking || '';
  const rating = Number(document.getElementById('reviewRating').value || 0);
  const comment = String(document.getElementById('reviewComment').value || '').trim();
  if (!bookingRef) return showToast('Booking reference missing', 'error');
  if (!rating || rating < 1 || rating > 5) return showToast('Please provide a valid rating (1-5)', 'error');

  try {
    showToast('Submitting review...', 'success');
    await apiFetch(`/user/me/bookings/${encodeURIComponent(bookingRef)}/review`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    });
    showToast('Thanks — review submitted', 'success');
    closeReviewModal();
    await loadUserBookings();
  } catch (e) {
    showToast(e.message || 'Failed to submit review', 'error');
  }
}

// Global delegation for review buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-action="open-review"]');
  if (btn) {
    const bookingRef = btn.dataset.booking;
    openReviewModal(bookingRef);
    return;
  }
});

window.openUserThread = async function(bookingRef, vendorName) {
  if (!bookingRef) return;
  state.vendorThread.bookingRef = bookingRef;
  state.vendorThread.open = true;
  document.getElementById('userThreadPanel').style.display = 'flex';
  document.getElementById('userThreadVendorName').textContent = vendorName || 'Vendor';
  await window.refreshUserThread();
  if (state.vendorThread.pollTimer) clearInterval(state.vendorThread.pollTimer);
  state.vendorThread.pollTimer = setInterval(window.refreshUserThread, 12000);
};

window.closeUserThread = function() {
  document.getElementById('userThreadPanel').style.display = 'none';
  state.vendorThread.open = false;
  if (state.vendorThread.pollTimer) clearInterval(state.vendorThread.pollTimer);
  state.vendorThread.pollTimer = null;
};

window.refreshUserThread = async function() {
  const ref = state.vendorThread.bookingRef;
  if (!ref) return;
  try {
    const data = await apiFetch(`/user/me/bookings/${encodeURIComponent(ref)}/thread`, { method: 'GET' });
    const msgs = data.data?.messages || [];
    const root = document.getElementById('userThreadMessages');
    if (!root) return;
    root.innerHTML = msgs.length
      ? msgs.map(m => {
          const align = m.fromRole === 'user' ? 'flex-end' : 'flex-start';
          const bg    = m.fromRole === 'user' ? 'linear-gradient(135deg,#f97316,#c2410c)' : '#f1f5f9';
          const color = m.fromRole === 'user' ? '#fff' : '#1e1b4b';
          const imgHtml = m.imageUrl
            ? `<img src="${m.imageUrl}" style="max-width:100%;border-radius:8px;margin-top:4px;display:block;" loading="lazy">`
            : '';
          const when = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
          return `<div style="display:flex;justify-content:${align};">
            <div style="max-width:78%;background:${bg};color:${color};padding:8px 12px;border-radius:12px;font-size:0.84rem;line-height:1.4;">
              ${escapeHtml(m.body)}${imgHtml}
              <div style="font-size:0.68rem;opacity:0.65;margin-top:3px;text-align:right;">${when}</div>
            </div>
          </div>`;
        }).join('')
      : '<div style="color:#6b7280;font-size:0.83rem;text-align:center;padding:20px;">No messages yet. Start the conversation!</div>';
    root.scrollTop = root.scrollHeight;
  } catch {}
};

window.sendUserThreadMsg = async function() {
  const input  = document.getElementById('userThreadInput');
  const status = document.getElementById('userThreadStatus');
  const text   = String(input?.value || '').trim();
  const ref    = state.vendorThread.bookingRef;
  if (!text || !ref) return;
  input.value = '';
  try {
    await apiFetch(`/user/me/bookings/${encodeURIComponent(ref)}/thread`, {
      method: 'POST',
      body: JSON.stringify({ message: text }),
    });
    await window.refreshUserThread();
  } catch (err) {
    if (status) status.textContent = 'Failed to send. Try again.';
  }
};

window.triggerUserThreadImagePicker = function() {
  const picker = document.getElementById('userThreadImageInput');
  if (!picker) return;
  picker.click();
};

window.uploadUserThreadImage = async function(inputEl) {
  const file = inputEl.files?.[0];
  const ref  = state.vendorThread.bookingRef;
  const status = document.getElementById('userThreadStatus');
  if (!file || !ref) return;

  const maxSizeBytes = 4 * 1024 * 1024;
  if (!/^image\//.test(String(file.type || ''))) {
    if (status) status.textContent = 'Only image files are allowed.';
    inputEl.value = '';
    return;
  }
  if (file.size > maxSizeBytes) {
    if (status) status.textContent = 'Image is too large. Max size is 4MB.';
    inputEl.value = '';
    return;
  }

  if (status) status.textContent = '⏳ Uploading image...';
  const fd = new FormData();
  fd.append('image', file);
  try {
    const res = await fetch(`${API_BASE}/user/me/bookings/${encodeURIComponent(ref)}/thread/image`, {
      method: 'POST', credentials: 'include', body: fd,
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    await window.refreshUserThread();
    if (status) status.textContent = '';
  } catch (err) {
    if (status) status.textContent = err.message || 'Upload failed';
  }
  inputEl.value = '';
};

window.submitBooking = async function(event) {
  event.preventDefault();
  
  const form = event.target;
  const modal = document.getElementById('bookingModal');
  const submitBtn = form.querySelector('button[type="submit"]');
  const summaryBudget = Number(modal?.dataset?.eventBudget || String(state.summary?.budget || '').replace(/[^\d.]/g, '')) || 0;
  const serviceBudget = Number(modal?.dataset?.serviceBudget || document.getElementById('bookingBudget').value || 0) || 0;
  const plannedBudget = Number(state.lastEventPlan?.budget_breakdown?.total || state.lastEventPlan?.total_estimated_cost || 0) || 0;
  
  const bookingData = {
    vendorId: modal.dataset.vendorId,
    vendorName: modal.dataset.vendorName,
    serviceCategory: modal.dataset.serviceKey || '',
    vendorArea: modal.dataset.vendorArea || '',
    name: document.getElementById('bookingName').value.trim(),
    email: document.getElementById('bookingEmail').value.trim(),
    phone: document.getElementById('bookingPhone').value.trim(),
    location: document.getElementById('bookingLocation').value.trim(),
    eventDate: document.getElementById('bookingEventDate').value,
    guests: parseInt(document.getElementById('bookingGuests').value),
    budget: serviceBudget,
    allocatedBudget: serviceBudget,
    eventBudget: summaryBudget || plannedBudget || 0,
    eventBudgetBreakdown: state.lastEventPlan?.budget_breakdown || null,
    message: document.getElementById('bookingMessage').value.trim(),
  };
  
  if (!bookingData.name || !bookingData.email || !bookingData.phone || !bookingData.location || !bookingData.eventDate || !bookingData.guests || !bookingData.budget) {
    setStatus('❌ Please fill all required fields');
    return;
  }
  
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Sending...';
    
    const response = await fetch(`${API_BASE}/user/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(bookingData),
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.message || 'Booking failed');
    }
    
    setStatus('✅ Booking request sent! The vendor will contact you soon.');
    window.closeBookingModal();
    form.reset();
    
    // Add confirmation message to chat
    const areaText = bookingData.vendorArea ? ` (${bookingData.vendorArea})` : '';
    addMessage('ai', `✅ Your booking request for ${bookingData.vendorName}${areaText} has been sent! You'll receive a confirmation at ${bookingData.email}.`);
    loadBookingBudgetSummary().catch(() => {});
    loadUserBookings().catch(() => {});
    loadVendorConversationsSummary().catch(() => {});
    
  } catch (error) {
    console.error('Booking error:', error);
    setStatus(`❌ ${error.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Booking Request';
  }
};

document.addEventListener('DOMContentLoaded', init);