function toNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeEventType(eventType) {
  return String(eventType || '').trim().toLowerCase();
}

function isVillageLikeCity(city) {
  const s = String(city || '').toLowerCase();
  return s.includes('village') || s.includes('semi') || s.includes('rural');
}

function inrRounded(n) {
  return Math.round(toNum(n, 0));
}

function pctText(value) {
  return `${Math.round(value * 100)}%`;
}

function getAllocationPreset(eventType) {
  const ev = normalizeEventType(eventType);

  if (ev.includes('birthday')) {
    return {
      venue: 0.30,
      catering: 0.40,
      decoration: 0.20,
      photography: 0.05,
      miscServices: 0.05,
      contingency: 0,
      priest: 0,
      avTech: 0,
    };
  }

  if (ev.includes('engagement') || ev.includes('mangni')) {
    return {
      venue: 0.25,
      catering: 0.30,
      decoration: 0.25,
      photography: 0.15,
      miscServices: 0.05,
      contingency: 0,
      priest: 0,
      avTech: 0,
    };
  }

  if (ev.includes('corporate')) {
    return {
      venue: 0.35,
      catering: 0.30,
      decoration: 0,
      photography: 0,
      miscServices: 0.10,
      contingency: 0.05,
      priest: 0,
      avTech: 0.20,
    };
  }

  if (ev.includes('reception')) {
    return {
      venue: 0.25,
      catering: 0.35,
      decoration: 0.15,
      photography: 0.10,
      miscServices: 0.10,
      contingency: 0.05,
      priest: 0,
      avTech: 0,
    };
  }

  // Wedding / Nikah / Church wedding default
  return {
    venue: 0.25,
    catering: 0.35,
    decoration: 0.15,
    photography: 0.10,
    miscServices: 0.05,
    contingency: 0.05,
    priest: 0.05,
    avTech: 0,
  };
}

const CATEGORY_BASELINES = {
  venue: 50000,
  cateringPerGuest: 350,
  decoration: 20000,
  photography: 15000,
  priest: 5000,
  avTech: 15000,
  misc: 10000,
};

function savingTipForCategory(category, eventType, city) {
  const ev = normalizeEventType(eventType);
  if (category === 'venue') {
    return isVillageLikeCity(city)
      ? 'Negotiate bundled seating + basic decor with venue for extra savings.'
      : 'Book venue 3+ months in advance for 10-15% discount.';
  }
  if (category === 'catering') {
    if (ev.includes('wedding') || ev.includes('nikah')) return 'Morning ceremony menus usually cost 15-20% less than evening service.';
    return 'Limit starter varieties and prioritize one signature dish to reduce catering cost.';
  }
  if (category === 'decoration') {
    return 'Use reusable stage decor and local flowers to cut decoration costs by 20-30%.';
  }
  if (category === 'photography') {
    return 'Choose a half-day shoot + edited digital album instead of full cinematic package.';
  }
  if (category === 'miscServices') {
    return 'Bundle transport, music, and host services with a single local event coordinator.';
  }
  if (category === 'contingency') {
    return 'Keep this reserve untouched for last-minute permits, weather backup, or overtime charges.';
  }
  if (category === 'priest') {
    return 'Confirm ritual list upfront to avoid same-day add-on charges.';
  }
  if (category === 'avTech') {
    return 'Share LED wall and sound setup across sessions to reduce AV rental cost.';
  }
  return 'Track costs line-by-line and renegotiate add-ons early.';
}

export function getEventBudgetBreakdown(totalBudget, eventType, guests, classPreference) {
  const total = Math.max(0, toNum(totalBudget));
  const g = Math.max(0, toNum(guests));
  const cls = String(classPreference || 'mid').toLowerCase();
  const ev = String(eventType || '').toLowerCase();

  // Base percentages by class — must always sum to 1.0
  const pct = {
    venue:       cls === 'budget' ? 0.28 : cls === 'premium' ? 0.32 : 0.28,
    catering:    cls === 'budget' ? 0.36 : cls === 'premium' ? 0.30 : 0.33,
    decoration:  cls === 'budget' ? 0.12 : cls === 'premium' ? 0.17 : 0.15,
    photography: cls === 'budget' ? 0.08 : cls === 'premium' ? 0.11 : 0.10,
    dj:          0.03,
    videography: 0.03,
    priest:      ev.includes('wedding') || ev.includes('nikah') || ev.includes('engag') ? 0.03 : 0,
    misc:        0,  // computed from remainder
  };

  // Adjust for event type
  if (ev.includes('birthday')) {
    pct.venue = 0.28; pct.catering = 0.40; pct.decoration = 0.18;
    pct.photography = 0.07; pct.dj = 0.04; pct.videography = 0.02; pct.priest = 0;
  } else if (ev.includes('corporate')) {
    pct.venue = 0.38; pct.catering = 0.30; pct.decoration = 0.05;
    pct.photography = 0.05; pct.dj = 0.02; pct.videography = 0.05; pct.priest = 0;
  } else if (ev.includes('reception')) {
    pct.venue = 0.26; pct.catering = 0.34; pct.decoration = 0.16;
    pct.photography = 0.10; pct.dj = 0.05; pct.videography = 0.04; pct.priest = 0;
  }

  // Compute misc as remainder to guarantee sum = total
  const fixedSum = pct.venue + pct.catering + pct.decoration + pct.photography +
    pct.dj + pct.videography + pct.priest;
  pct.misc = Math.max(0, 1.0 - fixedSum);

  // Allocate rupees
  const venue       = Math.round(total * pct.venue);
  const catering    = Math.round(total * pct.catering);
  const decoration  = Math.round(total * pct.decoration);
  const photography = Math.round(total * pct.photography);
  const dj          = Math.round(total * pct.dj);
  const videography = Math.round(total * pct.videography);
  const priest      = Math.round(total * pct.priest);

  // Compute misc as exact remainder (guarantees sum = total)
  const other_services = Math.max(0, total - venue - catering - decoration - photography - dj - videography - priest);

  const catering_per_plate = g > 0 ? Math.max(0, Math.round(catering / g)) : 0;

  return {
    total,
    venue,
    catering,
    catering_per_plate,
    decoration,
    photography,
    dj,
    videography,
    priest,
    other_services,
  };
}

export function warnBudgetIssues(totalBudget, guests, classPreference) {
  const warnings = [];
  const total = toNum(totalBudget);
  const g = toNum(guests);
  const cls = String(classPreference || 'mid').toLowerCase();

  if (g > 0 && total > 0) {
    const perGuest = total / g;
    if (perGuest < 1000) {
      warnings.push('Budget per guest is very tight; consider reducing vendor count or increasing total budget.');
    }
  }

  if (cls === 'premium' && total < 500000) {
    warnings.push('Premium preference selected with limited budget; availability may be constrained.');
  }

  if (total < 150000) {
    warnings.push('Total budget is on the lower side for full-service event planning.');
  }

  if (g > 0 && total > 0) {
    const perGuest = total / g;
    if (perGuest < 3500 && g >= 100) {
      warnings.push('With this guest count, keep a 10–15% contingency; catering and rentals move first if numbers shift.');
    }
  }

  return warnings;
}

export function needsBand(religion, eventType) {
  const rel = String(religion || '').toLowerCase();
  const ev = String(eventType || '').toLowerCase();
  if (rel !== 'hindu') return false;
  return (
    ev.includes('wedding') ||
    ev.includes('engagement') ||
    ev.includes('reception') ||
    ev.includes('gruhapravesam') ||
    ev.includes('thread ceremony') ||
    ev.includes('puberty ceremony')
  );
}

/**
 * Unit-test expectation for religious vendor mapping:
 * Hindu -> Priest / Pandit
 * Muslim -> Maulvi / Qazi
 * Christian -> Pastor / Father
 * Jain -> null
 */
export function getReligiousVendorCategory(religion, eventType) {
  const rel = String(religion || '').toLowerCase();
  const ev = String(eventType || '').toLowerCase();

  if (rel === 'hindu') {
    const hinduEvent = (
      ev.includes('wedding') ||
      ev.includes('engagement') ||
      ev.includes('reception') ||
      ev.includes('gruhapravesam') ||
      ev.includes('housewarming') ||
      ev.includes('thread ceremony') ||
      ev.includes('upanayanam') ||
      ev.includes('puberty ceremony')
    );
    if (hinduEvent) return 'Priest / Pandit';
    return null;
  }

  if (rel === 'muslim') {
    if (
      ev.includes('nikah') ||
      ev.includes('walima') ||
      ev.includes('aqiqah') ||
      ev.includes('mangni')
    ) {
      return 'Maulvi / Qazi';
    }
    return null;
  }

  if (rel === 'christian') {
    if (
      ev.includes('church wedding') ||
      ev.includes('baptism') ||
      ev.includes('christening') ||
      ev.includes('first communion') ||
      ev.includes('easter') ||
      ev.includes('carol')
    ) {
      return 'Pastor / Father';
    }
    return null;
  }

  if (rel === 'jain') return null;

  return null;
}

export function isOutdoorEvent(eventType) {
  const ev = String(eventType || '').toLowerCase();
  return (
    ev.includes('outdoor') ||
    ev.includes('garden') ||
    ev.includes('open air') ||
    ev.includes('sangeet') ||
    ev.includes('reception')
  );
}

export function getBudgetTier(totalBudget, guestCount) {
  const total = toNum(totalBudget, 0);
  const guests = Math.max(1, toNum(guestCount, 1));
  const perHead = total / guests;

  if (perHead < 500) return 'Economy';
  if (perHead <= 1500) return 'Standard';
  if (perHead <= 3000) return 'Premium';
  return 'Luxury';
}

export function getMinimumViableBudget(eventType, guestCount, city, selectedServices = null) {
  const ev = normalizeEventType(eventType);
  const g = Math.max(10, toNum(guestCount, 0));

  // Initialize all service costs
  let venue = CATEGORY_BASELINES.venue;
  let catering = g * CATEGORY_BASELINES.cateringPerGuest;
  let decoration = CATEGORY_BASELINES.decoration;
  let photography = CATEGORY_BASELINES.photography;
  let priest = 0;
  let avTech = 0;
  let misc = CATEGORY_BASELINES.misc;

  if (ev.includes('birthday')) {
    decoration *= 0.8;
    photography *= 0.7;
    misc *= 0.8;
  } else if (ev.includes('engagement') || ev.includes('mangni')) {
    decoration *= 1.1;
    photography *= 1.0;
  } else if (ev.includes('corporate')) {
    decoration = 5000;
    photography = 8000;
    avTech = CATEGORY_BASELINES.avTech;
  } else if (ev.includes('reception')) {
    decoration *= 1.0;
    photography *= 1.0;
  } else {
    // Wedding-like
    priest = CATEGORY_BASELINES.priest;
    decoration *= 1.1;
    photography *= 1.1;
    misc *= 1.1;
  }

  // Only include services in minimum budget if they're selected
  let subtotal = 0;
  if (!selectedServices || selectedServices.includes('venue')) subtotal += venue;
  if (!selectedServices || selectedServices.includes('catering')) subtotal += catering;
  if (!selectedServices || selectedServices.includes('decoration')) subtotal += decoration;
  if (!selectedServices || selectedServices.includes('photography')) subtotal += photography;
  if (!selectedServices || selectedServices.includes('priest')) subtotal += priest;
  if (!selectedServices || selectedServices.includes('dj') || selectedServices.includes('videography') || selectedServices.includes('florist')) subtotal += misc;
  if (!selectedServices || selectedServices.includes('band') || ev.includes('corporate')) subtotal += avTech;

  if (isVillageLikeCity(city)) {
    subtotal *= 0.7;
  }

  return inrRounded(subtotal);
}

export function getSavingsSuggestions(eventType, budget, guestCount) {
  const ev = normalizeEventType(eventType);
  const total = toNum(budget, 0);
  const tier = getBudgetTier(total, guestCount);

  const generic = [
    'Weekday events save 20% on venue costs.',
    'Compare at least 3 vendor quotes and ask for combo discounts.',
    'Keep guest list tight for premium experiences at lower total spend.',
    'Book decorators and photographers together for bundled pricing.',
    'Use digital invites to reduce print and distribution costs.',
  ];

  const weddingSpecific = [
    'Consider a morning ceremony — caterers charge 20% less before noon.',
    'Split events across one venue/day to reduce multiple setup fees.',
    'Use seasonal flowers and local decor teams to reduce logistics costs.',
    'Negotiate rehearsal and ceremony as one photo/video package.',
    'Book priest/maulvi/pastor early to avoid premium slot charges.',
  ];

  const corporateSpecific = [
    'Choose half-day conference slots to cut venue and AV billing cycles.',
    'Use buffet + limited menu to optimize per-head catering cost.',
    'Rent shared AV bundles instead of per-session standalone setups.',
    'Prefer business districts on weekdays for package discounts.',
    'Combine branding + stage setup with one vendor contract.',
  ];

  const birthdaySpecific = [
    'Use daytime celebration slots for lower venue and decorator rates.',
    'Choose one highlight activity instead of multiple entertainers.',
    'Use snack-heavy menu over full-course dining for kids parties.',
    'Book in-community halls to avoid premium banquet minimum charges.',
    'DIY return gifts and party props can trim miscellaneous spend.',
  ];

  let tips = generic;
  if (ev.includes('wedding') || ev.includes('nikah') || ev.includes('reception')) tips = weddingSpecific;
  if (ev.includes('corporate')) tips = corporateSpecific;
  if (ev.includes('birthday')) tips = birthdaySpecific;

  if (tier === 'Economy') {
    tips = [
      'Prioritize venue + catering first, then allocate leftovers to extras.',
      'Choose local vendors in nearby towns for 20-30% lower base rates.',
      ...tips.slice(0, 3),
    ];
  }

  return tips.slice(0, 5);
}

export function getFamilyBudgetBreakdown({ totalBudget, contributingMembers, eventType, guestCount, city }) {
  const total = Math.max(0, toNum(totalBudget, 0));
  const members = Math.max(1, Math.round(toNum(contributingMembers, 1)));
  const allocation = getAllocationPreset(eventType);

  const minBudget = getMinimumViableBudget(eventType, guestCount, city);
  const warnings = [];
  if (total < minBudget) {
    warnings.push(
      `Current budget ₹${total.toLocaleString('en-IN')} is below minimum viable budget ₹${minBudget.toLocaleString('en-IN')} for this plan.`
    );
  }

  const rawVenue = total * allocation.venue;
  const rawCatering = total * allocation.catering;
  const rawDecoration = total * allocation.decoration;
  const rawPhotography = total * allocation.photography;
  const rawPriest = total * allocation.priest;
  const rawMisc = total * allocation.miscServices + rawPriest + total * allocation.avTech;
  const rawContingency = total * allocation.contingency;

  const breakdownByCategory = {
    venue: {
      recommended: inrRounded(rawVenue),
      percentage: pctText(allocation.venue),
      savingTip: savingTipForCategory('venue', eventType, city),
    },
    catering: {
      recommended: inrRounded(rawCatering),
      percentage: pctText(allocation.catering),
      savingTip: savingTipForCategory('catering', eventType, city),
    },
    decoration: {
      recommended: inrRounded(rawDecoration),
      percentage: pctText(allocation.decoration),
      savingTip: savingTipForCategory('decoration', eventType, city),
    },
    photography: {
      recommended: inrRounded(rawPhotography),
      percentage: pctText(allocation.photography),
      savingTip: savingTipForCategory('photography', eventType, city),
    },
    miscServices: {
      recommended: inrRounded(rawMisc),
      percentage: pctText(allocation.miscServices + allocation.priest + allocation.avTech),
      savingTip: savingTipForCategory('miscServices', eventType, city),
    },
    contingency: {
      recommended: inrRounded(rawContingency),
      percentage: pctText(allocation.contingency),
      savingTip: savingTipForCategory('contingency', eventType, city),
    },
  };

  const tips = [
    'Book venue 3+ months in advance for 10-15% discount',
    'Weekday events save 20% on venue costs',
    'Village vendors charge 30% less and often travel to city',
    ...getSavingsSuggestions(eventType, total, guestCount).slice(0, 2),
  ].slice(0, 5);

  return {
    perPersonContribution: members > 0 ? inrRounded(total / members) : total,
    breakdownByCategory,
    budgetTier: getBudgetTier(total, guestCount),
    tips,
    warningMessages: warnings,
  };
}
