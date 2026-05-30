import mongoose from 'mongoose';
import { ChatConversation, MAX_CHAT_MESSAGES } from '../models/ChatConversation.js';
import { EventDraft } from '../models/EventDraft.js';
import { Booking } from '../models/Booking.js';
import { EventPlan } from '../models/EventPlan.js';
import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import { findVenues, findVenuesWithContext, findTents } from './venueAgent.js';
import { findCaterers } from './cateringAgent.js';
import { findDecorators } from './decorationAgent.js';
import { findByCategory } from './serviceAgent.js';
import {
  findNearestAvailableVendors,
  findAlternativeDates,
  findBudgetUpgradeOptions,
  generateAlternativeMessage,
  findVendorsInRadius,
} from './recommendationAgent.js';
import {
  getEventBudgetBreakdown,
  warnBudgetIssues,
  getMinimumViableBudget,
  needsBand,
  getReligiousVendorCategory,
  isOutdoorEvent,
} from '../utils/eventBudgetCalculator.js';
import { normalizeVendorBasePrice } from '../utils/vendorPricing.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your-anthropic-api-key-here'
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const NEARBY_CITIES = {
  'Hyderabad': ['Rangareddy', 'Medchal', 'Sangareddy'],
  'Rangareddy': ['Hyderabad', 'Mahbubnagar', 'Vikarabad'],
  'Warangal': ['Hanamkonda', 'Karimnagar', 'Nalgonda', 'Khammam'],
  'Karimnagar': ['Warangal', 'Nizamabad', 'Jagtial', 'Peddapalli'],
  'Nizamabad': ['Karimnagar', 'Medak', 'Kamareddy', 'Armoor'],
  'Khammam': ['Nalgonda', 'Warangal', 'Bhadradri'],
  'Nalgonda': ['Khammam', 'Hyderabad', 'Suryapet', 'Miryalaguda'],
  'Mahbubnagar': ['Hyderabad', 'Rangareddy', 'Wanaparthy', 'Gadwal'],
  'Medak': ['Hyderabad', 'Nizamabad', 'Sangareddy'],
  'Adilabad': ['Nirmal', 'Mancherial', 'Kumuram Bheem'],
  'Villages': ['Rangareddy', 'Karimnagar', 'Medak'],
};

const SERVICE_ALIASES = {
  venue: ['venue', 'function hall', 'hall', 'banquet hall', 'marriage hall', 'mandap', 'kalyana mandapam', 'church', 'parish hall', 'church hall', 'chapel', 'వెడ్డింగ్ హాల్', 'ఫంక్షన్ హాల్', 'मैरेज हॉल'],
  catering: ['catering', 'food', 'meal', 'meals', 'food service', 'భోజనం', 'कैटरिंग', 'खाना'],
  decoration: ['decoration', 'decor', 'stage decor', 'flowers', 'sajja', 'డెకరేషన్', 'सजावट'],
  photography: ['photography', 'photographer', 'photo', 'ఫోటోగ్రఫీ', 'फोटोग्राफी'],
  videography: ['videography', 'videographer', 'video', 'వీడియోగ్రఫీ', 'वीडियोग्राफी'],
  dj: ['dj', 'music', 'sound', 'డీజే', 'डीजे'],
  florist: ['florist', 'flowers', 'పూలు', 'फूल'],
  dresses: ['dress', 'dresses', 'dress designer', 'bridal dress', 'lehenga', 'sherwani', 'gown', 'makeup artist', 'makeup', 'bridal makeup', 'stylist', 'బ్రైడల్ మేకప్', 'డ్రెస్'],
  priest: ['priest', 'pandit', 'maulvi', 'qazi', 'pastor', 'father', 'officiant', 'clergyman', 'clergy', 'పండిట్', 'पंडित', 'मौलवी'],
  band: ['band', 'nadaswaram', 'బ్యాండ్', 'बैंड'],
  tent: ['tent', 'shamiana', 'furniture', 'టెంట్', 'टेंट'],
};

const SERVICE_LABELS = {
  venue: 'Function Hall',
  catering: 'Catering',
  decoration: 'Decoration',
  photography: 'Photographer',
  videography: 'Videographer',
  dj: 'DJ',
  florist: 'Florist',
  dresses: 'Makeup Artist',
  priest: 'Priest / Pandit',
  band: 'Band / Nadaswaram',
  tent: 'Tent / Shamiana',
  pastor: 'Pastor / Father',
  maulvi: 'Maulvi / Qazi',
};

function getReligiousVendorLabel(religion) {
  const r = String(religion || '').toLowerCase();
  if (r === 'muslim') return { icon: '🕌', label: 'Maulvi / Qazi', key: 'maulvi' };
  if (r === 'christian') return { icon: '⛪', label: 'Pastor / Father', key: 'pastor' };
  if (r === 'jain') return { icon: '🙏', label: 'Jain Priest', key: 'priest' };
  return { icon: '🙏', label: 'Priest / Pandit', key: 'priest' };
}

function getReligiousServiceLabel(religion) {
  return getReligiousVendorLabel(religion).label;
}

function getServiceLabelsByReligion(religion) {
  const relInfo = getReligiousVendorLabel(religion);
  const labels = { ...SERVICE_LABELS };
  
  // Replace generic priest with religion-specific one
  delete labels.priest;
  labels[relInfo.key] = relInfo.label;
  
  return labels;
}

function getStep6Prompt(lang = 'en', religion = 'all') {
  const relLabel = getReligiousServiceLabel(religion);
  const venueOptions = String(religion || '').toLowerCase() === 'christian'
    ? 'Function Hall, Try a different area or city that may have availability'
    : 'Function Hall';
  if (lang === 'hi') {
    return `Budget mein kaun se **vendors/services** include karun? _(${venueOptions}, Catering, Decoration, Photography, Videography, DJ, Florist, Dresses/Makeup, ${relLabel}, Band, Tent)_`;
  }
  if (lang === 'te') {
    return `Budget lo ye **vendors/services**? _(${venueOptions}, Catering, Decoration, Photography, Videography, DJ, Florist, Dresses/Makeup, ${relLabel}, Band, Tent)_`;
  }
  return `Which vendors should I include in the budget?\nSelect one or more services like: ${venueOptions}, Catering, Decoration, Photography, Videography, DJ, Florist, Dresses/Makeup, ${relLabel}, Band, Tent.\n\nYou can also say: only hall and decoration.`;
}

const SERVICE_WEIGHT_HINTS = {
  venue: 0.30,
  catering: 0.35,
  decoration: 0.15,
  photography: 0.10,
  videography: 0.08,
  dj: 0.05,
  florist: 0.04,
  dresses: 0.07,
  priest: 0.04,
  band: 0.04,
  tent: 0.05,
};

const DEFAULT_SELECTED_SERVICES = ['venue', 'catering', 'decoration', 'photography'];

const LANG_PACK = {
  en: {
    step0: `Namaste! 🙏 I'm your Budget Event Planner for Telangana events.\nI'll guide you like an experienced coordinator—calm, clear, and practical.\n\nWe'll go step by step. You can change your mind anytime (budget, guest count, services).\nWhat type of event are you planning?`,
    step1: 'Great! Which city or area should the event be in?\nFor example: Hyderabad, Warangal, Karimnagar, or your village name.\n(Tip: pin the main city first—you can refine locality later with vendors.)',
    step2: 'What is the event date?\nUse format: YYYY-MM-DD (example: 2026-12-15).\nIf the date is not fixed yet, pick your best estimate—we can revisit alternatives.',
    step3: 'How many guests are expected?\nEnter a number, for example 200.\nFor catering quotes, many families plan for the confirmed count + a small buffer (often 5–10%)—we can note that later.',
    step4: 'Which religion should the services follow?\nChoose: Hindu / Muslim / Christian / Jain / All.\nThis helps match dietary, ritual, and vendor norms correctly.',
    step5: 'What is your total budget for vendor services?\nEnter amount in rupees, for example 500000 for 5 lakhs.\n\n**Reality check from the field:** keep ~10–15% aside for GST, transport, overtime, extra hours, and last-minute adds—your number here is the main vendor pool; hidden extras still happen without a buffer.',
    step6: 'Which vendors should I include in the budget?\nSelect one or more services like: Function Hall, Catering, Decoration, Photography, Videography, DJ, Florist, Dresses/Makeup, Priest, Band, Tent.\n\nYou can also say: only hall and decoration, or no catering.',
    step7: 'Almost done! What quality level do you prefer?\nEconomy = most affordable\nStandard = good quality within budget\nPremium = top-rated vendors\n\nType: economy / standard / premium.\nIf family expectations differ, Standard is usually the safest compromise.',
    step8: 'Any special requirements?\nExamples: pure veg only, halal, jain meal, live counters, baraat route timing, parking count, generator + UPS, wheelchair / elderly access, separate green rooms, sound curfew, or outdoor rain backup.\n\nOr type: no special requirements.',
    dateError: 'I could not understand the date. Please enter the event date as `YYYY-MM-DD` (example: 2026-05-12).',
    guestsError: 'Please enter the guest count as a number (example: 150).',
    restart: 'Great - let us start a new event plan. What type of event are you planning? (e.g., Wedding, Reception, Birthday)',
    nearbyChange: 'Please send the new area or city you want function halls for, and I will search again.',
    nearbyVenuePrompt: "We don't have function halls in {city} right now. Please change the location or type a different area/city manually.",
    increaseRadiusPrompt: "",
    noVenuesFound: "I'm sorry, I couldn't find any function halls for {city}. Please try a different city or type another area manually.",
    selected: '✅ Got it! You selected: **{services}**\n\nDo you want to add or remove any services? You can say "add photography" or "remove catering", or just say "continue"',
    selectedUpdated: '✅ Updated selection: **{services}**\n\nAnything else to add or remove? Or just say "continue"',
    completedHint: 'Your event plan draft is saved in the conversation.\n\nTop vendor options:\n{list}\n\n**After the plan:** ask me for a **pre-booking checklist**, **guest count change tips**, or **weather backup**—or type **restart** for a new plan.',
    adviceChecklist: `📋 **Pre-booking checklist (what I insist on with clients)**\n\nBefore you pay a big advance, confirm **in writing** (WhatsApp/email is fine):\n\n1. **Scope** — exact services, hours, crew size, materials (flowers, stage, chairs), and what is *not* included.\n2. **Timeline** — setup/start/pack-up times; penalty if they run late.\n3. **Prices** — subtotal, GST, transport, overtime, and per-extra rates (guests, plates, prints).\n4. **Payment** — milestone schedule; never pay 100% upfront unless you fully trust them.\n5. **Cancellation / postponement** — refund %, date-change fees, force majeure (weather, strikes).\n6. **Backup** — named substitute crew or vendor if lead falls ill; emergency contact on event day.\n7. **Venue rules** — sound limit, kitchen access, loading dock, power load for catering & decor.\n\nKeep one family member as single point of contact so vendors get consistent instructions.`,
    adviceGuestChange: `👥 **Guest count changed? Here is how pros handle it**\n\n- Tell **catering first** — per-plate and kitchen capacity bite before anything else.\n- **Venue** — confirm fire/capacity limits; extra chairs/rounds often have a fee.\n- **Decor & stage** — backdrop width and seating layout may need redraw; photograph the agreed layout.\n- **Budget** — if guests go up more than ~10%, assume catering + rentals move first; use **Change Budget** in the app and regenerate.\n\nGet a **revised written quote** before paying the next installment.`,
    adviceWeather: `🌧️ **Outdoor or monsoon season — Plan A / Plan B**\n\n- Ask venue/vendor for **rain contingency**: covered mandap, side sheets, raised flooring, drainage.\n- **Generator + UPS** for sound and lights if power dips.\n- **Photo/video** — confirm they still deliver if outdoor shots move indoors.\n- Put **setup buffer** (extra 2–4 hours) in the contract for weather delays.\n\nClients stress less when Plan B is agreed *before* the week of the event.`,
    advicePayment: `💳 **Payments & disputes (field-tested)**\n\n- Typical pattern: **30–40%** to block date, **40–50%** before event week, **balance** after delivery — adjust per vendor trust.\n- Every installment tied to a **signed line item** or invoice.\n- If a vendor resists written terms, that is a red flag—polite, but firm.\n- Keep screenshots of **verbal promises** followed by “confirming our call…” messages.\n\nYour plan in this app is a **starting brief**; the vendor’s quotation is the legal reference.`,
    adviceFamily: `🤝 **Family stress & conflicting opinions**\n\n- Decide **one decision-maker** + one backup (spouse/parent) for vendor changes.\n- Put “nice to have” vs “must have” in writing so budget fights don’t happen at the venue.\n- If two relatives want different vendors, compare **total landed cost** (extras included), not sticker price.\n\nYou can always **restart** or **change budget** here and regenerate options—better now than three days before the event.`,
    adviceSavePlan: `✅ **Saving your plan**\n\nYour latest structured plan is stored with your account when generation finishes. Use **My Plans** in the sidebar to revisit it.\n\nStill ask vendors for their **own** quotations—this app gives direction, not a substitute for their invoices.`,
    adviceCompare: `⚖️ **Comparing vendors (how I brief clients)**\n\nDon’t compare **base price** alone—compare **landed cost**:\n\n- Same **guest count, hours, and deliverables** (album pages, raw footage, stage size).\n- **Overtime** rate after midnight or past agreed hours.\n- **Travel, loading, early setup** charges.\n- **Substitutions** if a flower or fabric is unavailable—who pays?\n- **Deposit & cancellation** terms side by side.\n\nPick two finalists, ask each for one revised “all-in” quote, then decide. Use **View Details** in the app as your discussion sheet.`,
    adviceCustomization: `🧵 **Customization workflow (decoration / catering / dresses)**\n\nUse the built-in **vendor thread** after booking request:\n\n- Share theme photos, color palette, menu references, or blouse/lehenga references as images.\n- Ask vendor to confirm **what is included**, what is paid add-on, and delivery/setup times.\n- Lock final version in writing: quantity, dimensions, material/brand, and correction cycle.\n\nTip: keep one message with “FINAL APPROVED VERSION” to avoid event-day confusion.`,
  },
  hi: {
    step0: `Namaste! 🙏 Main aapka Budget Event Planner hoon.\nMain experienced coordinator ki tarah step-by-step guide karunga—budget/date/services aap kabhi bhi badal sakte hain.\n\nAap Hindi, Telugu, ya English mein reply kar sakte hain.\n\n**Aap kaunsa event plan kar rahe hain?**`,
    step1: 'Badhiya! Event kis **city ya area** mein hai? _(Pehle main city fix karein.)_',
    step2: 'Event ki **date** kya hai? _(Format: YYYY-MM-DD)_ _(approx date bhi chalega)_',
    step3: 'Kitne **guests** expected hain? _(number)_ _(catering ke liye kabhi-kabhi 5–10% buffer socha jata hai)_',
    step4: 'Services kis **religion** ke hisab se chahiye? _(Hindu / Muslim / Christian / Jain / All)_',
    step5: 'Vendor services ke liye aapka **total budget** kitna hai? _(₹)_\n\n**Tip:** ~10–15% alag rakhein GST, transport, overtime, last-minute adds ke liye.',
    step6: 'Budget mein kaun se **vendors/services** include karun? _(Function Hall, Catering, Decoration, etc.)_',
    step7: '**Quality preference** kya rahegi? _(economy / standard / premium)_ _(family mix ho to "standard" safe hai)_',
    step8: 'Koi **special requirements**? _(veg/halal, generator, parking, wheelchair access, rain backup, sound limit)_ Nahi ho to "no special requirements".',
    dateError: 'Date samajh nahi aayi. Kripya `YYYY-MM-DD` format mein bhejiye.',
    guestsError: 'Guest count number mein bhejiye (example: 150).',
    restart: 'Theek hai, naya event plan start karte hain. Kaunsa event plan karna hai?',
    nearbyChange: 'Naya area/city bhejiye, main function halls dobara search karta hoon.',
    nearbyVenuePrompt: '{city} mein abhi hamare paas koi function hall nahi hai. Kripya location badal ke koi alag area/city type karein.',
    increaseRadiusPrompt: '',
    noVenuesFound: 'Kshamin kijiye, {city} ke liye koi function hall nahi mila. Dayachesi koi dusra city ya area type karein.',
    selected: '✅ Theek hai! Aapne select kiya: **{services}**\n\nKuch add/remove karna hai? Aap "add photography" ya "remove catering" bol sakte hain, ya "continue".',
    selectedUpdated: '✅ Updated selection: **{services}**\n\nAur kuch add/remove karna hai? Ya "continue" boliye.',
    completedHint: 'Aapka event plan save ho chuka hai.\n\nTop vendor options:\n{list}\n\n**Pooch sakte hain:** "pre-booking checklist", "guest count change", "weather backup" — ya "restart".',
  },
  te: {
    step0: `Namaste! 🙏 Nenu mee Budget Event Planner.\nAnubhava coordinator laaga step-by-step guide chestanu—budget/date/services meeru epuduaina marchukovachu.\n\nMeeru Telugu, Hindi, leda English lo reply ivvachu.\n\n**Meeru ye event plan chestunnaru?**`,
    step1: 'Bagundi! Event **city/area** enti? _(mudu main city fix cheyandi)_',
    step2: 'Event **date** enti? _(YYYY-MM-DD)_ _(approx date ok)_',
    step3: 'Entha mandi **guests**? _(number)_ _(catering ki 5–10% buffer common)_',
    step4: 'Services ye **religion** prakaram? _(Hindu / Muslim / Christian / Jain / All)_',
    step5: 'Vendor services kosam **total budget** entha? _(₹)_\n**Gnapakam:** GST, transport, overtime kosam ~10–15% reserve.',
    step6: 'Budget lo ye **vendors/services**? _(Function Hall, Catering, …)_',
    step7: '**Quality** enti? _(economy / standard / premium)_ _(kutumba mix ayite standard safe)_',
    step8: '**Special requirements** unnaya? _(veg/halal, generator, parking, wheelchair, rain backup)_ lekapothe "no special requirements".',
    dateError: 'Date ardham kaleedu. Dayachesi `YYYY-MM-DD` format lo pampandi.',
    guestsError: 'Guests count number ga pampandi (example: 150).',
    restart: 'Sare, kottha event plan start cheddam. Ye event plan cheyali?',
    nearbyChange: 'Kotha area/city pampandi, function halls malli search chestanu.',
    nearbyVenuePrompt: '{city} lo prastutaniki maaku function halls levu. Dayachesi location marchi vere area/city type cheyandi.',
    increaseRadiusPrompt: '',
    noVenuesFound: 'Kshaminchandi, {city} ki sambandhinchina function halls dorakadhu. Dayachesi vere city leda area type cheyandi.',
    selected: '✅ Sare! Meeru select chesindi: **{services}**\n\nInka add/remove cheyala? "add photography" leda "remove catering" ani cheppandi, leda "continue" ani cheppandi.',
    selectedUpdated: '✅ Updated selection: **{services}**\n\nInka emaina add/remove cheyala? Leda "continue" ani cheppandi.',
    completedHint: 'Mee event plan save ayyindi.\n\nTop vendor options:\n{list}\n\n**Adagachu:** "pre-booking checklist", "guest count change", "weather backup" — leda "restart".',
  },
};

function getLangPack(lang = 'en') {
  return LANG_PACK[lang] || LANG_PACK.en;
}

function lmsg(lang, key, vars = {}) {
  const template = getLangPack(lang)[key] || getLangPack('en')[key] || '';
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), template);
}

/** Post-plan “desk of an experienced event manager” — short, actionable guidance. */
function managerAdvisoryReply(text, lang) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  if (/pre-?booking|booking checklist|checklist|before i pay|advance payment|written quotation|what to confirm|confirm with vendor/i.test(t)) {
    return lmsg(lang, 'adviceChecklist');
  }
  if (/guest count|more guests|fewer guests|headcount|last-?minute guests|guests changed/i.test(t)) {
    return lmsg(lang, 'adviceGuestChange');
  }
  if (/weather|rain|monsoon|outdoor|plan b|backup plan|contingency/i.test(t)) {
    return lmsg(lang, 'adviceWeather');
  }
  if ((/payment|milestone|gst|hidden cost|dispute|refund|cancellation policy|postpone/i.test(t)) && !/total budget|my new budget/i.test(t)) {
    return lmsg(lang, 'advicePayment');
  }
  if (/family|stress|conflict|disagree|relative|in-?laws|mother-?in-?law|two opinions/i.test(t)) {
    return lmsg(lang, 'adviceFamily');
  }
  if (/save (this )?plan|^save plan$|how do i save|my plans/i.test(t)) {
    return lmsg(lang, 'adviceSavePlan');
  }
  if (/compare vendors|compare quotes|best value|negotiate/i.test(t)) {
    return lmsg(lang, 'adviceCompare');
  }
  if (/customi[sz]e|customisation|customization|theme|color palette|design|dress|lehenga|sherwani|makeup|menu changes?|vendor chat|image reference/i.test(t)) {
    return lmsg(lang, 'adviceCustomization');
  }
  return null;
}

function detectConversationIntent(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return 'generic';
  if (/(restart|new event|start over|reset)/i.test(t)) return 'restart';
  if (/(show|find|get).*(nearby|cheaper).*(venue|venues|hall|halls)|nearby.*(venue|venues|hall|halls)|show\s*(nearby\s*venues?\s*(within)?\s*\d+\s*km|\d+\s*km\s*range)/i.test(t)) return 'venue_nearby';
  if (/(show|find|get).*(other service vendors|service vendors|non[-\s]*venue vendors)|other service vendors|non[-\s]*vendors/i.test(t)) return 'other_services';
  if (/(show more|more vendors|next|continue)/i.test(t)) return 'show_more';
  if (/\b(change|update|modify|adjust|regenerate|recalculate)\b/i.test(t)) return 'modify_plan';
  if (/\b(budget|date|guest|guests|city|area|location|service|services|quality|economy|standard|premium|requirements?)\b/i.test(t)) return 'modify_plan';
  if (/customi[sz]e|customisation|customization|theme|color palette|design|dress|lehenga|sherwani|makeup|menu changes?|vendor chat|image reference/i.test(t)) return 'customization';
  if (/\b(book|booking|thread|vendor thread|chat with vendor|discuss with vendor)\b/i.test(t)) return 'vendor_chat';
  if (/checklist|compare|weather|payment|family|save plan|my plans/i.test(t)) return 'advice';
  return 'generic';
}

function isVenueNearbyApprovalText(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return false;
  // Nearby/auto-radius approvals are disabled. Users must change location manually.
  return false;
}

function getSlotConfidence(text, extracted = {}) {
  const s = String(text || '').toLowerCase();
  return {
    event_type: extracted.event_type ? 0.95 : /(wedding|reception|engagement|birthday|naming|thread ceremony)/i.test(s) ? 0.75 : 0,
    city: extracted.city ? 0.9 : /(city|area|hyderabad|warangal|karimnagar|nizamabad|khammam|nalgonda)/i.test(s) ? 0.6 : 0,
    event_date: extracted.event_date ? 0.98 : /\d{4}-\d{1,2}-\d{1,2}/.test(s) ? 0.7 : 0,
    guests: extracted.guests ? 0.95 : /(guests?|people|pax|mandi)/i.test(s) ? 0.6 : 0,
    budget: extracted.budget ? 0.98 : /(budget|₹|rs|lakh|lac|crore|\bk\b)/i.test(s) ? 0.65 : 0,
    selectedServices: Array.isArray(extracted.selectedServices) && extracted.selectedServices.length ? 0.95 : /(catering|decoration|photo|video|dj|florist|dress|makeup|tent|hall)/i.test(s) ? 0.6 : 0,
  };
}

function clarificationForStep(step, lang = 'en') {
  if (step === 2) {
    return lang === 'hi'
      ? 'Date clear nahi hui. Kripya YYYY-MM-DD format mein bhejiye (example: 2026-12-15).'
      : lang === 'te'
        ? 'Date clear kaaledu. Dayachesi YYYY-MM-DD format lo pampandi (example: 2026-12-15).'
        : 'I need the date in YYYY-MM-DD format (example: 2026-12-15) so I can continue accurately.';
  }
  if (step === 3) {
    return lang === 'hi'
      ? 'Guest count number mein bhejiye (example: 200).'
      : lang === 'te'
        ? 'Guests count number ga pampandi (example: 200).'
        : 'Please share guest count as a number (example: 200).';
  }
  if (step === 5) {
    return lang === 'hi'
      ? 'Budget amount rupaye mein bhejiye (example: 500000).'
      : lang === 'te'
        ? 'Budget amount rupees lo pampandi (example: 500000).'
        : 'Please share total budget in rupees (example: 500000).';
  }
  return null;
}

function detectLanguage(text, fallback = 'en') {
  const s = String(text || '').trim();
  if (!s) return fallback;
  if (/[\u0C00-\u0C7F]/.test(s)) return 'te';
  if (/[\u0900-\u097F]/.test(s)) return 'hi';
  const lower = s.toLowerCase();
  if (/\b(hai|nahi|kripya|shaadi|kitna|mein|karna)\b/.test(lower)) return 'hi';
  if (/\b(andi|cheppu|kavali|pelli|avunu|ledu|bagundi)\b/.test(lower)) return 'te';
  if (/^[\x00-\x7F\s\W]+$/.test(s) && /[a-z]/i.test(s)) return 'en';
  return fallback;
}

function isUiControlMessage(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return false;
  if (/^(continue|ok|okay|done|next|yes|no|send selection)$/i.test(s)) return true;
  if (/^(economy|standard|premium|hindu|muslim|christian|jain|all religions?)$/i.test(s)) return true;
  if (/^(function hall|catering|decoration|photography|videography|dj|florist|dresses\s*\/\s*makeup|band|tent|priest\s*\/\s*pandit)(\s*,\s*(function hall|catering|decoration|photography|videography|dj|florist|dresses\s*\/\s*makeup|band|tent|priest\s*\/\s*pandit))*$/i.test(s)) return true;
  return false;
}

function levenshtein(a = '', b = '') {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function fuzzyMatch(input, choices = [], threshold = 0.68) {
  const source = String(input || '').toLowerCase().trim();
  if (!source) return null;
  let best = null;
  let bestScore = 0;
  for (const choice of choices) {
    const target = String(choice || '').toLowerCase().trim();
    if (!target) continue;
    if (source.includes(target) || target.includes(source)) return choice;
    const dist = levenshtein(source, target);
    const score = 1 - dist / Math.max(source.length, target.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = choice;
    }
  }
  return bestScore >= threshold ? best : null;
}

function parseBudgetValue(text) {
  const s = String(text || '').toLowerCase();
  const lakh = s.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|lakhs|l)/i);
  if (lakh) return Math.round(Number(lakh[1]) * 100000);
  const crore = s.match(/(\d+(?:\.\d+)?)\s*(crore|cr)/i);
  if (crore) return Math.round(Number(crore[1]) * 10000000);
  const k = s.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (k) return Math.round(Number(k[1]) * 1000);
  const num = extractNumber(s);
  return num && num > 0 ? Math.round(num) : null;
}

function detectQualityPreference(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  const choices = ['economy', 'standard', 'premium'];
  const hint = fuzzyMatch(s, choices, 0.6);
  if (hint) return hint === 'standard' ? 'mid' : hint;
  if (/^economy\s*,\s*standard\s*,\s*premium$/i.test(String(text || '').trim())) {
    return 'mid';
  }
  if (/budget|cheap|low|affordable|basic/.test(s)) return 'economy';
  if (/luxury|top|best|high|costly/.test(s)) return 'premium';
  if (/normal|medium|mid/.test(s)) return 'mid';
  return null;
}

function isLikelyBudgetMessage(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return false;
  if (/\bkm\b|\bradius\b|within\s*\d+\s*km|show\s*\d+\s*km\s*range/.test(s)) return false;
  return /budget|rs\.?|₹|rupees?|lakh|lac|crore|\bcr\b|\bmy new budget\b|\btotal budget\b/.test(s);
}

function extractAnswersFromFreeText(text, supportedEventTypes, currentAnswers = {}) {
  const s = String(text || '').trim();
  const lower = s.toLowerCase();
  const out = {};

  const eventMatch = bestMatchEventType(lower, supportedEventTypes || []);
  // Do not override the event type once the user has already provided it.
  // This avoids later turns like "Christian" being remapped to "Christening".
  if (!currentAnswers.event_type && eventMatch) out.event_type = eventMatch;

  const date = toIsoDate(s);
  if (date) out.event_date = date;

  const guestsHit = lower.match(/(\d{1,5})\s*(guests?|members?|people|pax|mandi)/i);
  if (guestsHit) out.guests = Math.round(Number(guestsHit[1]));

  const religion = normalizeReligion(lower);
  if (religion) out.religion = religion;

  const budget = parseBudgetValue(lower);
  if (budget && isLikelyBudgetMessage(lower)) out.budget = budget;

  const selectedServices = parseSelectedServices(lower);
  if (selectedServices.length) out.selectedServices = selectedServices;
  const venuePreference = detectVenuePreferenceFromText(lower);
  if (venuePreference) out.venuePreference = venuePreference;
  if (/no\s*catering|without\s*catering|skip\s*catering/i.test(lower)) {
    out.selectedServices = (out.selectedServices || currentAnswers.selectedServices || DEFAULT_SELECTED_SERVICES).filter((x) => x !== 'catering');
  }

  const quality = detectQualityPreference(lower);
  if (quality) out.classPreference = quality;

  if (/no\s+special\s+requirements?|nothing\s+special|none\b/i.test(lower)) out.requirements = 'No special requirements';
  if (!out.requirements && /(parking|generator|halal|veg|vegetarian|timing|stage|backup|music|outdoor)/i.test(lower)) out.requirements = s;

  if (!currentAnswers.city && /\bin\s+([a-zA-Z\u0900-\u097F\u0C00-\u0C7F\s]+?)(?:\s+on\s|\s+for\s|\s+budget|\s+with|,|$)/i.test(s)) {
    const cityGuess = s.match(/\bin\s+([a-zA-Z\u0900-\u097F\u0C00-\u0C7F\s]+?)(?:\s+on\s|\s+for\s|\s+budget|\s+with|,|$)/i);
    if (cityGuess?.[1]) out.city = normalizeCityArea(cityGuess[1]);
  }

  return out;
}

function firstMissingStep(answers = {}) {
  if (!answers.event_type) return 0;
  if (!answers.city) return 1;
  if (!answers.event_date) return 2;
  if (!answers.guests) return 3;
  if (!answers.religion) return 4;
  if (!answers.budget) return 5;
  if (answers.servicesPromptPending === true) return 6;
  const hasSelectedServices = Array.isArray(answers.selectedServices) && answers.selectedServices.length > 0;
  if ((!hasSelectedServices && answers.servicesAlreadySelected !== true) || answers.stepSixConfirming) return 6;
  if (!answers.classPreference) return 7;
  if (!answers.requirements) return 8;
  return 9;
}

function normalizeServiceKey(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;

  for (const [key, aliases] of Object.entries(SERVICE_ALIASES)) {
    if (aliases.some((alias) => text === String(alias).toLowerCase())) return key;
    if (aliases.some((alias) => text.includes(String(alias).toLowerCase()))) return key;
    const fuzzyAlias = fuzzyMatch(text, aliases, 0.66);
    if (fuzzyAlias) return key;
  }

  return null;
}

function parseSelectedServices(text) {
  const raw = String(text || '').split(/[,/|\n]+/).map((part) => part.trim()).filter(Boolean);
  const keys = [];
  for (const part of raw.length ? raw : [text]) {
    const key = normalizeServiceKey(part);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.length ? keys : [];
}

function detectVenuePreferenceFromText(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  if (/church|parish|chapel/.test(s)) return 'church';
  if (/function\s*hall|marriage\s*hall|mandap|kalyana/.test(s)) return 'function_hall';
  return null;
}

function extractSelectedServicesFromHistory(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    const parsed = parseSelectedServices(message.content);
    if (parsed.length) return parsed;
  }
  return [];
}

function formatSelectedServices(keys = [], religion = 'all') {
  const labels = getServiceLabelsByReligion(religion);
  return keys.map((key) => labels[key] || key).join(', ');
}

function buildSelectedBudgetBreakdown(totalBudget, eventType, guests, classPreference, selectedServices = []) {
  const selected = selectedServices.length ? selectedServices : DEFAULT_SELECTED_SERVICES;
  const total = Math.max(0, Number(totalBudget) || 0);
  const ev = String(eventType || '').toLowerCase();

  // Event-type-aware base percentages (as event planner these matter)
  const EVENT_WEIGHTS = {
    venue:       ev.includes('birthday') ? 0.28 : ev.includes('corporate') ? 0.38 : 0.28,
    catering:    ev.includes('birthday') ? 0.38 : ev.includes('corporate') ? 0.28 : ev.includes('reception') ? 0.34 : 0.33,
    decoration:  ev.includes('birthday') ? 0.18 : ev.includes('corporate') ? 0.05 : ev.includes('engagement') ? 0.22 : 0.15,
    photography: ev.includes('birthday') ? 0.07 : ev.includes('engagement') ? 0.15 : 0.10,
    videography: ev.includes('corporate') ? 0.06 : 0.07,
    dj:          ev.includes('birthday') ? 0.04 : ev.includes('corporate') ? 0.02 : 0.04,
    florist:     0.04,
    dresses:     ev.includes('engagement') ? 0.10 : ev.includes('wedding') || ev.includes('nikah') ? 0.07 : 0.04,
    priest:      ev.includes('birthday') ? 0 : 0.04,
    band:        ev.includes('birthday') ? 0 : 0.03,
    tent:        0.04,
  };

  // Class modifier
  const classMod = {
    venue:      classPreference === 'premium' ? 1.12 : classPreference === 'economy' ? 0.88 : 1,
    catering:   classPreference === 'premium' ? 0.93 : classPreference === 'economy' ? 1.07 : 1,
    decoration: classPreference === 'premium' ? 1.10 : classPreference === 'economy' ? 0.90 : 1,
    photography: classPreference === 'premium' ? 1.08 : 1,
  };

  // Only sum weights for SELECTED services
  const rawWeights = {};
  let totalWeight = 0;
  for (const key of selected) {
    const w = (EVENT_WEIGHTS[key] || 0) * (classMod[key] || 1);
    rawWeights[key] = w;
    totalWeight += w;
  }
  if (totalWeight === 0) totalWeight = 1;

  // Allocate rupees proportionally
  const allocs = {};
  let assigned = 0;
  for (const key of selected) {
    allocs[key] = Math.round(total * rawWeights[key] / totalWeight);
    assigned += allocs[key];
  }

  // Absorb rounding remainder into catering (largest bucket), else venue
  const remainder = total - assigned;
  if (remainder !== 0) {
    if (selected.includes('catering'))   allocs.catering   = (allocs.catering   || 0) + remainder;
    else if (selected.includes('venue')) allocs.venue      = (allocs.venue      || 0) + remainder;
  }

  const g = Math.max(1, Number(guests) || 1);
  const catering = allocs.catering || 0;

  return {
    total,
    venue:            allocs.venue       || 0,
    catering,
    catering_per_plate: catering > 0 ? Math.round(catering / g) : 0,
    decoration:       allocs.decoration  || 0,
    photography:      allocs.photography || 0,
    videography:      allocs.videography || 0,
    dj:               allocs.dj          || 0,
    florist:          allocs.florist     || 0,
    dresses:          allocs.dresses     || 0,
    priest:           allocs.priest      || 0,
    band:             allocs.band        || 0,
    tent:             allocs.tent        || 0,
    misc_services:    0,
    other_services:   0,
    selected_services: selected,
  };
}

function toIsoDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  // Prefer YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const yyyy = m[1];
    const mm = String(m[2]).padStart(2, '0');
    const dd = String(m[3]).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Accept common slash formats only (DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD).
  const slash = s.match(/^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const c = Number(slash[3]);
    let yyyy;
    let mm;
    let dd;

    if (String(slash[1]).length === 4) {
      yyyy = a; mm = b; dd = c;
    } else if (String(slash[3]).length === 4) {
      yyyy = c;
      // Prefer DD/MM/YYYY for local context; fallback if impossible.
      if (a > 12) { dd = a; mm = b; } else { mm = a; dd = b; }
    } else {
      return null;
    }

    if (yyyy < 1900 || yyyy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return null;
}

function extractNumber(v) {
  const raw = String(v || '');
  if (!raw) return null;

  // Prefer explicit grouped or long numeric tokens (e.g. 1,00,000 / 100000).
  const grouped = raw.match(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/g) || [];
  if (grouped.length) {
    const best = grouped
      .map((x) => Number(String(x).replace(/,/g, '')))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0];
    if (Number.isFinite(best)) return best;
  }

  // Fallback for shorter plain numbers.
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function normalizeReligion(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return null;
  if (s.includes('hindu')) return 'Hindu';
  if (s.includes('muslim') || s.includes('islam')) return 'Muslim';
  if (s.includes('christian')) return 'Christian';
  if (s.includes('jain')) return 'Jain';
  // Match standalone words only; "hall" must not be interpreted as "all".
  if (/\b(all|any)\b/.test(s)) return 'all';
  const fuzzy = fuzzyMatch(s, ['hindu', 'muslim', 'christian', 'jain'], 0.62);
  if (fuzzy === 'all') return 'all';
  if (fuzzy) return fuzzy.charAt(0).toUpperCase() + fuzzy.slice(1);
  return null;
}

function bestMatchEventType(raw, supportedEventTypes) {
  const input = String(raw || '').trim().toLowerCase();
  if (!input) return null;

  // Exact match
  const exact = supportedEventTypes.find((t) => String(t).toLowerCase() === input);
  if (exact) return exact;

  // Substring match (prefer the longest match)
  let best = null;
  for (const t of supportedEventTypes) {
    const tt = String(t).toLowerCase();
    if (input.includes(tt) || tt.includes(input)) {
      if (!best || tt.length > String(best).toLowerCase().length) best = t;
    }
  }
  if (best) return best;

  const fuzzy = fuzzyMatch(input, supportedEventTypes || [], 0.55);
  if (fuzzy) return fuzzy;
  return best;
}

function normalizeCityArea(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  return s;
}

function hasLocalFunctionHallInventory(vendors = [], city = '', budget = 0, guests = 0) {
  const target = String(city || '').trim().toLowerCase();
  if (!target) return false;
  return vendors.some((v) => {
    const category = String(v.category || '').toLowerCase();
    if (!category.includes('function hall')) return false;
    const vc = String(v.city || '').toLowerCase();
    const va = String(v.area || '').toLowerCase();
    const inCity = vc === target || vc.includes(target) || target.includes(vc) || va.includes(target);
    if (!inCity) return false;
    // Must also fit budget (with 30% tolerance) and guest count
    if (budget > 0) {
      const price = Number(v.base_price || 0);
      if (price > 0 && price > budget * 1.30) return false;
    }
    if (guests > 0) {
      const maxG = Number(v.max_guests || 0);
      if (maxG > 0 && maxG < guests) return false;
    }
    return true;
  });
}

function annotateBudgetFit(vendor, budgetCap) {
  if (!vendor) return null;
  const cap = Math.max(0, Number(budgetCap || 0));
  const cost = vendorEstimatedCost(vendor);
  const delta = Math.round(cost - cap);
  let tag = 'unknown';
  if (!cap) tag = 'unknown';
  else if (delta <= 0) tag = 'in_budget';
  else if (delta <= cap * 0.2) tag = 'slightly_above_budget';
  else tag = 'above_budget';
  return { ...vendor, budget_fit_tag: tag, budget_delta: delta };
}

function vendorEstimatedCost(vendor) {
  if (!vendor) return 0;
  const candidates = [vendor.estimated_cost, vendor.estimated, vendor.base_price, vendor.basePrice, vendor.price];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function pickBestVendorForBudget(candidates = [], budgetCap = 0, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const maxOverrunFactor = Number(options.maxOverrunFactor || 1.35);
  const annotated = candidates.map((v) => annotateBudgetFit(v, budgetCap)).filter(Boolean);

  const cap = Math.max(0, Number(budgetCap || 0));
  const targetSpendRatio = (() => {
    if (Number(options.targetSpendRatio) > 0) return Math.min(0.9, Math.max(0.55, Number(options.targetSpendRatio)));
    return 0.72;
  })();

  const scoreVendor = (vendor) => {
    const cost = vendorEstimatedCost(vendor);
    const rating = Number(vendor.rating || 0);
    const spendTarget = cap > 0 ? cap * targetSpendRatio : cost;
    const spendGap = cap > 0 ? Math.abs(cost - spendTarget) / cap : 0;
    const spendBias = cap > 0 ? cost / cap : 0;

    // Prefer higher-rated vendors and gently bias toward fuller budget usage,
    // but do not force premium pricing just because the total budget is high.
    return (rating * 1000) + (spendBias * 35) - (spendGap * 90);
  };

  const inBudget = annotated
    .filter((v) => v.budget_fit_tag === 'in_budget')
    .sort((a, b) => scoreVendor(b) - scoreVendor(a));
  if (inBudget.length) return inBudget[0];
  const slightlyAbove = annotated
    .filter((v) => v.budget_fit_tag === 'slightly_above_budget')
    .sort((a, b) => (scoreVendor(b) - scoreVendor(a)) || (Number(a.budget_delta || 0) - Number(b.budget_delta || 0)));
  if (slightlyAbove.length) return slightlyAbove[0];
  if (cap > 0) {
    const acceptableAbove = annotated
      .filter((v) => vendorEstimatedCost(v) <= cap * maxOverrunFactor)
      .sort((a, b) => (scoreVendor(b) - scoreVendor(a)) || (Number(a.budget_delta || 0) - Number(b.budget_delta || 0)));
    if (acceptableAbove.length) return acceptableAbove[0];
    return null;
  }
  return annotated.sort((a, b) => (Number(a.budget_delta || 0) - Number(b.budget_delta || 0)))[0];
}

function isGreetingStartMessage(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return true;
  if (/^(hi|hello|hey|namaste|start|begin|new chat|plan event|can you help|help|hlo|helo|hii|hai|hye|hy|ok|okay|k|sure|yes|yep|ya|haan|ha|sare|avunu|continue)$/i.test(s)) {
    return true;
  }

  const firstToken = s.split(/\s+/)[0];
  const closeGreetings = ['hi', 'hello', 'hey', 'namaste', 'hai', 'hlo', 'helo', 'hii', 'hye', 'hy', 'ok', 'okay', 'sure', 'yes'];
  return closeGreetings.some((greeting) => levenshtein(firstToken, greeting) <= 1);
}

function toDateOffset(isoDate, offsetDays) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseFamilyContributors(answers) {
  // Try to extract number of family contributors from answers/requirements text
  const text = String(answers.requirements || answers.budget || '').toLowerCase();
  
  // Look for patterns like "3 members", "family of 4", "5 people contributing"
  const familyMatch = text.match(/(\d+)\s*(members?|people|persons?|family|contributors?)/);
  if (familyMatch) return parseInt(familyMatch[1], 10);
  
  // Default: assume 2 contributing family members if not specified
  return 2;
}

function isMonthlySavingScenario(answers) {
  const req = String(answers.requirements || '').toLowerCase();
  return /monthly|saving|installment|emi|salary|income/.test(req);
}

function buildFamilyBudgetTips(answers) {
  const totalBudget = Number(answers.budget || 0);
  const contributors = parseFamilyContributors(answers);
  const perPerson = contributors > 0 ? Math.ceil(totalBudget / contributors) : totalBudget;
  const monthly = isMonthlySavingScenario(answers);

  return [
    `If ${contributors} family members each contribute ₹${perPerson.toLocaleString('en-IN')}, this event is affordable.`,
    monthly
      ? 'This looks like a monthly-savings funded plan; keep 1-2 months buffer before final booking advances.'
      : 'This is likely a one-time family expense; reserve at least 15% extra for last-minute add-ons.',
    'Consider off-peak days (Mon-Thu) for 15-20% lower vendor rates.',
    'Village/semi-urban venues cost 30-40% less than city venues.',
  ];
}

function resolveNearbyCities(place) {
  const key = Object.keys(NEARBY_CITIES).find((k) => k.toLowerCase() === String(place || '').toLowerCase());
  if (key) return NEARBY_CITIES[key];
  if (/village/i.test(String(place || ''))) return NEARBY_CITIES.Villages;
  return [];
}

function nextRadiusStep(currentRadiusKm) {
  const radius = Number(currentRadiusKm) || 30;
  if (radius < 50) return 50;
  if (radius < 100) return 100;
  return null;
}

/**
 * Unit-test expectation for religious vendor mapping:
 * Hindu -> Priest / Pandit
 * Muslim -> Maulvi / Qazi
 * Christian -> Pastor / Father
 * Jain -> Priest / Pandit
 */
function vendorSupportsReligion(vendor, religion) {
  if (!religion) return true;
  const rs = String(vendor.religion_served || '').trim().toLowerCase();
  if (!rs || rs === 'all') return true;
  if (religion === 'all') return true;
  return rs.includes(String(religion).toLowerCase());
}

function venueSupportsReligion(vendor, religion) {
  if (!vendorSupportsReligion(vendor, religion)) return false;

  const r = String(religion || '').trim().toLowerCase();
  if (!r || r === 'all') return true;

  const haystack = `${String(vendor.vendor_name || '')} ${String(vendor.category || '')}`.toLowerCase();
  const blockedByReligion = {
    muslim: ['kalyana vedika', 'kalyana mandapam', 'mandapam', 'temple hall', 'dharmashala'],
    christian: ['kalyana vedika', 'kalyana mandapam', 'mandapam', 'temple hall'],
  };

  const blocked = blockedByReligion[r] || [];
  if (blocked.some((term) => haystack.includes(term))) return false;
  if (r === 'muslim' && /kalyana|mandapam|vedika/.test(haystack)) return false;

  return true;
}

function religionPreferenceScore(vendor, religion) {
  const target = String(religion || '').trim().toLowerCase();
  if (!target || target === 'all') return 0;
  const served = String(vendor.religion_served || '').trim().toLowerCase();
  if (served === target) return 4;
  if (served === 'all') return 1;
  return 0;
}

function vendorCapacityCanFit(vendor, guests) {
  if (!guests || guests <= 0) return true;

  // Dataset provides min/max guests for many vendors; use when present.
  if (vendor.max_guests && vendor.max_guests > 0) {
    return guests <= vendor.max_guests;
  }
  // Fallback: compare capacity when it's plausibly in the same unit.
  if (vendor.capacity && vendor.capacity > 0 && vendor.capacity_unit) {
    const u = String(vendor.capacity_unit).toLowerCase();
    const unitLooksLikePeople =
      u.includes('guests') ||
      u.includes('audience') ||
      u.includes('persons') ||
      u.includes('plates') ||
      u.includes('band');
    if (unitLooksLikePeople) return guests <= vendor.capacity;
  }
  return true;
}

function formatVendorLine(v) {
  const price = v.base_price ? `₹${v.base_price.toFixed(0)}` : '—';
  const rating = v.rating ? `⭐ ${v.rating.toFixed(1)}` : '';
  const loc = [v.city, v.area].filter(Boolean).join(', ');
  return `- ${v.vendor_name} (${v.category}) | ${loc || 'Location n/a'} | ${rating}${rating && price ? ' | ' : ''}${price}`;
}

function summarizeEventDraft(answers) {
  return [
    `Event type: ${answers.event_type || '—'}`,
    `Location: ${answers.city || answers.area || '—'}`,
    `Date: ${answers.event_date || '—'}`,
    `Guests: ${answers.guests || '—'}`,
    `Religion: ${answers.religion || 'all'}`,
    `Budget: ${answers.budget || '—'}`,
  ].join('\n');
}

function generateTips(religion, eventType, guests, budget) {
  const tips = [];
  const ev = String(eventType || '').toLowerCase();
  const g = Number(guests) || 0;
  const b = Number(budget) || 0;

  tips.push('💡 Hold **10–15% contingency** for GST, overtime, extra guests, and last-minute adds—clients rarely regret this buffer.');

  if (religion === 'Muslim') tips.push('💡 Book Maulvi at least 21 days before Nikah for muhurtam confirmation.');
  if (religion === 'Hindu') tips.push('💡 Confirm muhurtam timing with Pandit before locking venue slots and catering service windows.');
  if (religion === 'Christian') tips.push('💡 Coordinate church booking separately — clergy does not book the church.');
  if (g > 500) tips.push('💡 For 500+ guests, book venue and catering at least 60 days in advance; confirm **fire NOC / capacity** early.');
  if (g >= 150 && g <= 400) tips.push('💡 For mid-size gatherings, **one decision-maker + WhatsApp group admin** cuts vendor confusion by half.');
  if (b > 0 && g > 0 && b / g < 2500) {
    tips.push('💡 Per-guest vendor spend is modest—prioritise **must-haves** (food safety, power backup) over fringe décor.');
  }
  if (b < 200000) tips.push('💡 Budget is tight — ask vendors if they have off-season discounts (June–October) or weekday rates.');
  if (ev.includes('wedding') || ev.includes('nikah') || ev.includes('reception')) {
    tips.push('💡 Book photographer and decorator together — many offer combo discounts; align **stage dimensions** in one shared diagram.');
    tips.push('💡 Premium vendors often need **40–50% upfront**; split milestones against deliverables, not vibes.');
    tips.push('💡 **Peak season** (Nov–Feb, major holidays): block dates with token advance even if details are still moving.');
  }
  if (ev.includes('birthday') || ev.includes('naming')) {
    tips.push('💡 Shorter events: negotiate **hourly overtime** upfront; kids’ parties overrun on cake and photos.');
  }
  tips.push('💡 Day-before: share **vendor parking map, loading gate, and single POC phone** to every supplier.');
  return tips;
}

const SERVICE_TO_VENDOR_PROPS_MAP = {
  venue: 'venue',
  catering: 'catering',
  decoration: 'decoration',
  photography: 'photographer',
  videography: 'videographer',
  dj: 'dj',
  florist: 'florist',
  dresses: 'dresses_vendor',
  priest: 'religious_vendor',
  band: 'band',
  tent: 'tent',
};

const SERVICE_TO_ALTERNATIVES_PROPS_MAP = {
  venue: 'venue_alternatives',
  catering: 'catering_alternatives',
  decoration: 'decoration_alternatives',
  photography: 'photographer_alternatives',
  videography: 'videographer_alternatives',
  dj: 'dj_alternatives',
  florist: 'florist_alternatives',
  dresses: 'dresses_alternatives',
  priest: 'priest_alternatives',
  band: 'band_alternatives',
  tent: 'tent_alternatives',
};

const SERVICE_TO_BREAKDOWN_KEY = {
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
};

function buildUpgradeSuggestions(eventPlan) {
  const savings = Number(eventPlan?.savings || 0);
  const selected = Array.isArray(eventPlan?.selected_services) ? eventPlan.selected_services : [];
  if (savings <= 0 || !selected.length) return '';

  const UPGRADE_THRESHOLDS = {
    venue: 100000,
    catering: 80000,
    decoration: 50000,
    photography: 30000,
    videography: 25000,
    dj: 15000,
    florist: 10000,
    dresses: 10000,
    priest: 5000,
    band: 10000,
    tent: 15000,
  };

  const lines = ['', '✨ Budget Remaining — Upgrade Options:'];
  let suggested = 0;

  for (const serviceRaw of selected) {
    const service = String(serviceRaw || '').toLowerCase().trim();
    const threshold = UPGRADE_THRESHOLDS[service] || 20000;
    if (savings < threshold) continue;

    const vendorProp = SERVICE_TO_VENDOR_PROPS_MAP[service];
    if (!vendorProp) continue;

    const currentVendor = eventPlan[vendorProp];
    const alternativesProp = SERVICE_TO_ALTERNATIVES_PROPS_MAP[service] || `${vendorProp}_alternatives`;
    const alternatives = Array.isArray(eventPlan[alternativesProp]) ? eventPlan[alternativesProp] : [];
    const serviceBudgetKey = SERVICE_TO_BREAKDOWN_KEY[service] || service;
    const serviceAllocatedBudget = Number(eventPlan?.budget_breakdown?.[serviceBudgetKey] || 0);

    const premiumAlts = alternatives.filter(
      (v) => Number(v?.estimated_cost || 0) > Number(currentVendor?.estimated_cost || 0)
        && Number(v?.estimated_cost || 0) <= serviceAllocatedBudget
    );

    if (premiumAlts.length > 0) {
      const best = premiumAlts[0];
      const extra = Number(best.estimated_cost || 0) - Number(currentVendor?.estimated_cost || 0);
      if (extra <= 0 || extra > savings) continue;
      lines.push(
        `  💎 Upgrade ${service}: ${best.vendor_name} (+₹${extra.toLocaleString('en-IN')}) — rated higher, fits within remaining ₹${savings.toLocaleString('en-IN')}`
      );
      suggested += 1;
    }

    if (suggested >= 3) break;
  }

  if (suggested === 0) return '';
  lines.push('  Reply "upgrade [service name]" to switch to the premium option.');
  return lines.join('\n');
}

function buildOverBudgetMessage(eventPlan) {
  const allocated = Number(eventPlan?.total_allocated_budget || 0);
  const vendorTotal = Number(eventPlan?.total_estimated_cost || 0);
  if (vendorTotal <= allocated) return '';

  const overage = vendorTotal - allocated;
  const selected = Array.isArray(eventPlan?.selected_services) ? eventPlan.selected_services : [];

  const costs = selected
    .map((sRaw) => {
      const s = String(sRaw || '').toLowerCase().trim();
      const vendorProp = SERVICE_TO_VENDOR_PROPS_MAP[s];
      return {
        service: s,
        cost: Number(vendorProp ? eventPlan[vendorProp]?.estimated_cost || 0 : 0),
      };
    })
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  const topExpensive = costs.slice(0, 2).map((x) => x.service).join(' or ') || 'venue or catering';
  const suggestedIncrease = Math.ceil(overage / 10000) * 10000;

  const lines = [
    '',
    `⚠️ Over Budget by ₹${overage.toLocaleString('en-IN')}`,
    '',
    'To fix this, you can:',
    `  1️⃣  Increase total budget by ₹${suggestedIncrease.toLocaleString('en-IN')} — reply: "increase budget by ${suggestedIncrease}"`,
    `  2️⃣  Remove a service — the most expensive are: **${topExpensive}**`,
    '  3️⃣  Switch to Economy tier vendors — reply: "use economy vendors"',
    '',
    'What would you like to do?',
  ];

  return lines.join('\n');
}

function deduplicateVendorsAcrossServices(plan) {
  const seenIds = new Set();

  const vendorKeys = [
    'venue', 'catering', 'decoration', 'photographer', 'videographer',
    'dj', 'florist', 'dresses_vendor', 'religious_vendor', 'band', 'tent',
  ];

  const altKeys = vendorKeys.map((k) => `${k}_alternatives`);
  const legacyAltKeys = ['dresses_alternatives', 'priest_alternatives'];
  const allAltKeys = [...new Set([...altKeys, ...legacyAltKeys])];

  for (const key of vendorKeys) {
    const v = plan[key];
    if (!v) continue;
    const id = String(v.vendor_id || v.vendor_name || '').toLowerCase().trim();
    if (id) seenIds.add(id);
  }

  for (const altKey of allAltKeys) {
    if (!Array.isArray(plan[altKey])) continue;
    plan[altKey] = plan[altKey].filter((v) => {
      const id = String(v.vendor_id || v.vendor_name || '').toLowerCase().trim();
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
  }

  return plan;
}

// Budget breakdown should follow selected services, even when no vendor is confirmed yet.
function buildBudgetBreakdownText(eventPlan) {
  if (!eventPlan || !eventPlan.budget_breakdown || !eventPlan.selected_services) {
    return '';
  }

  const breakdown = eventPlan.budget_breakdown;
  const selectedServices = Array.isArray(eventPlan.selected_services) ? eventPlan.selected_services : [];
  if (!selectedServices.length) return '';

  const religiousVendorMeta = getReligiousVendorLabel(eventPlan?.religion);
  const SERVICE_DISPLAY_NAMES = {
    venue: '🏛️ Venue',
    catering: '🍽️ Catering',
    decoration: '🎨 Decoration',
    photography: '📸 Photography',
    videography: '🎥 Videography',
    dj: '🎵 DJ',
    florist: '💐 Florist',
    dresses: '👗 Dresses/Makeup',
    priest: `${religiousVendorMeta.icon} ${religiousVendorMeta.label}`,
    band: '🎺 Band',
    tent: '⛺ Tent',
  };

  const SERVICE_TO_BREAKDOWN_KEY = {
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
  };

  const parsedGuests = Number(
    eventPlan.ai_context?.guests
    || String(eventPlan.event_summary || '').match(/for\s+(\d+)\s+guests?/i)?.[1]
    || 0
  );

  const lines = [
    '💰 Budget Breakdown (selected services only):',
    'Note: these are base prices. Final vendor price may vary after add-ons, style, travel, and event complexity.',
    'Catering price depends on menu items selected — per-plate cost will be confirmed after you choose dishes with the caterer.',
    'The vendor will confirm the final quote after reviewing your exact requirements.',
  ];
  let totalAllocated = 0;
  let totalVendorCosts = 0;

  selectedServices.forEach((service) => {
    const normalizedService = String(service || '').toLowerCase().trim();
    if (!normalizedService) return;

    const breakdownKey = SERVICE_TO_BREAKDOWN_KEY[normalizedService] || normalizedService;
    const displayName = SERVICE_DISPLAY_NAMES[normalizedService] || service;
    const allocatedAmount = Number(breakdown[breakdownKey] || 0);
    const vendorProp = SERVICE_TO_VENDOR_PROPS_MAP[breakdownKey];
    const vendor = vendorProp ? eventPlan[vendorProp] : null;
    const actualVendorCost = Number(vendor?.estimated_cost || 0);

    totalAllocated += allocatedAmount;
    totalVendorCosts += actualVendorCost;

    if (!vendor) {
      if (breakdownKey === 'tent') {
        lines.push(`${displayName}: No vendors found - try relaxing filters`);
      } else {
        lines.push(`${displayName}: No vendors found - try increasing allocation`);
      }
      return;
    }

    let line = `${displayName}: ₹${allocatedAmount.toLocaleString('en-IN')}`;
    // Per-plate price depends on items ordered — only show after menu is confirmed, not upfront
    line += ` | Selected: ₹${actualVendorCost.toLocaleString('en-IN')}`;

    lines.push(line);
  });

  lines.push(`💵 Total Allocated: ₹${totalAllocated.toLocaleString('en-IN')} (for ${selectedServices.length} services)`);
  lines.push(`💵 Total Vendor Costs: ₹${totalVendorCosts.toLocaleString('en-IN')}`);

  if (totalVendorCosts < totalAllocated) {
    const buffer = totalAllocated - totalVendorCosts;
    if (buffer > totalAllocated * 0.2) {
      lines.push(`✨ Budget buffer remaining: ₹${buffer.toLocaleString('en-IN')} (good room for premium upgrades)`);
    } else {
      lines.push(`✨ You save: ₹${buffer.toLocaleString('en-IN')} (vendors came in under budget)`);
    }
  } else if (totalVendorCosts > totalAllocated) {
    lines.push(`⚠️ Vendors exceed budget by ₹${(totalVendorCosts - totalAllocated).toLocaleString('en-IN')}`);
  }

  if (Number(eventPlan.savings || 0) > 0) {
    const upgradeText = buildUpgradeSuggestions(eventPlan);
    if (upgradeText) lines.push(upgradeText);
  }

  return lines.join('\n');
}

function buildVendorOptionsText(eventPlan) {
  if (!eventPlan || !eventPlan.selected_services) return '';

  const selectedServices = Array.isArray(eventPlan.selected_services) ? eventPlan.selected_services : [];
  if (!selectedServices.length) return '';

  const lines = ['📦 All Vendor Options (after budget breakdown):'];
  const religiousVendorMeta = getReligiousVendorLabel(eventPlan?.religion);

  const SERVICE_TO_VENDOR_PROPS = {
    venue: { primary: 'venue', alternatives: 'venue_alternatives', icon: '🏛️', label: 'Function Hall' },
    catering: { primary: 'catering', alternatives: 'catering_alternatives', icon: '🍽️', label: 'Catering' },
    decoration: { primary: 'decoration', alternatives: 'decoration_alternatives', icon: '🎨', label: 'Decoration' },
    photography: { primary: 'photographer', alternatives: 'photographer_alternatives', icon: '📸', label: 'Photography' },
    videography: { primary: 'videographer', alternatives: 'videographer_alternatives', icon: '🎥', label: 'Videography' },
    dj: { primary: 'dj', alternatives: 'dj_alternatives', icon: '🎵', label: 'DJ' },
    florist: { primary: 'florist', alternatives: 'florist_alternatives', icon: '💐', label: 'Florist' },
    dresses: { primary: 'dresses_vendor', alternatives: 'dresses_alternatives', icon: '👗', label: 'Dresses / Makeup' },
    priest: {
      primary: 'religious_vendor',
      alternatives: 'priest_alternatives',
      icon: religiousVendorMeta.icon,
      label: religiousVendorMeta.label,
    },
    band: { primary: 'band', alternatives: 'band_alternatives', icon: '🎺', label: 'Band' },
    tent: { primary: 'tent', alternatives: 'tent_alternatives', icon: '⛺', label: 'Tent / Shamiana' },
  };

  const vendorBudgetStatus = (vendor) => {
    const fit = vendor?.budget_fit || vendor?.budget_fit_tag;
    if (fit === 'within' || fit === 'in_budget') return '[in-budget]';
    if (fit === 'slight_exceed' || fit === 'slightly_above_budget') return '[slightly over]';
    return '[over-budget]';
  };

  selectedServices.forEach((service) => {
    const normalizedService = String(service || '').toLowerCase().trim();
    const mapping = SERVICE_TO_VENDOR_PROPS[normalizedService];
    if (!mapping) return;

    let primaryVendor = eventPlan[mapping.primary];
    let alternatives = Array.isArray(eventPlan[mapping.alternatives]) ? eventPlan[mapping.alternatives] : [];

    // Only include primary vendor if it is at most slightly above budget.
    if (primaryVendor && String(primaryVendor.budget_fit_tag || primaryVendor.budget_fit || '').toLowerCase() === 'above_budget') {
      const inBudgetAlt = alternatives.find((v) => {
        const fit = String(v?.budget_fit_tag || v?.budget_fit || '').toLowerCase();
        return fit === 'in_budget' || fit === 'within' || fit === 'slightly_above_budget' || fit === 'slight_exceed';
      });
      if (inBudgetAlt) {
        const promotedId = String(inBudgetAlt.vendor_id || inBudgetAlt.vendor_name || '').toLowerCase();
        primaryVendor = inBudgetAlt;
        alternatives = alternatives.filter((v) => String(v.vendor_id || v.vendor_name || '').toLowerCase() !== promotedId);
      } else {
        primaryVendor = null;
      }
    }

    if (!primaryVendor && alternatives.length === 0) {
      lines.push(`${mapping.icon} ${mapping.label}: No in-budget vendors found. Showing closest options from other areas if available.`);
      return;
    }

    let vendorLine = `${mapping.icon} ${mapping.label}: `;
    if (primaryVendor) {
      vendorLine += `${primaryVendor.vendor_name} (₹${Number(primaryVendor.estimated_cost || 0).toLocaleString('en-IN')} ${vendorBudgetStatus(primaryVendor)})`;
      if (alternatives.length > 0) {
        const topAlts = alternatives.slice(0, 2).map((v) =>
          `${v.vendor_name} (₹${Number(v.estimated_cost || 0).toLocaleString('en-IN')} ${vendorBudgetStatus(v)})`
        );
        vendorLine += ` | Options: ${topAlts.join(', ')}`;
      }
    } else {
        const topAlts = alternatives.slice(0, 3).map((v) =>
        `${v.vendor_name} (₹${Number(v.estimated_cost || 0).toLocaleString('en-IN')} ${vendorBudgetStatus(v)})`
      );
      vendorLine += topAlts.join(' | ');
    }

    lines.push(vendorLine);
  });

  return lines.join('\n');
}

function buildPlanSummaryText(plan) {
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const eventPlan = plan;
  const selectedServices = Array.isArray(plan.selected_services) ? plan.selected_services : [];
  const needsVenue = selectedServices.includes('venue');
  const allowOtherServicesWithoutVenue = Boolean(plan?.ai_context?.allow_other_services_without_venue);
  const labels = getServiceLabelsByReligion(plan.religion);
  const religiousVendorMeta = getReligiousVendorLabel(plan.religion);
  const confirmedVenue = plan.venue && venueSupportsReligion(plan.venue, plan.religion) ? plan.venue : null;

  const lines = [
    `✅ Event Plan Ready: ${plan.event_summary}`,
    selectedServices.length ? `Selected services: ${selectedServices.map((s) => labels[s] || s).join(', ')}` : '',
  ];

  if (confirmedVenue) {
    lines.push(`✅ Venue confirmed: **${confirmedVenue.vendor_name}**, ${confirmedVenue.city}`);
    lines.push('All other vendors are matched to this venue location.');
  } else if (needsVenue) {
    lines.push('⚠️ Venue not yet confirmed. Prices below are estimates pending venue confirmation.');
    if (plan.venue && !confirmedVenue) {
      lines.push('⚠️ Previous venue was removed due to religion compatibility rules.');
    }
  }

  if (plan.requirements) {
    lines.push(`🧾 Special requirements: ${plan.requirements}`);
  }

  const budgetBreakdownText = buildBudgetBreakdownText(eventPlan);
  if (budgetBreakdownText) {
    lines.push('');
    lines.push(budgetBreakdownText);
  }

  const conciseVendorLines = [];
  const iconMap = {
    venue: '🏛️',
    catering: '🍽️',
    decoration: '🎨',
    photography: '📸',
    videography: '🎥',
    dj: '🎵',
    florist: '💐',
    dresses: '👗',
    priest: religiousVendorMeta.icon,
    band: '🎺',
    tent: '⛺',
  };

  selectedServices.forEach((serviceRaw) => {
    const service = String(serviceRaw || '').toLowerCase().trim();
    const vendorProp = SERVICE_TO_VENDOR_PROPS_MAP[service];
    if (!vendorProp) return;

    const primary = plan[vendorProp];
    const alternativesProp = SERVICE_TO_ALTERNATIVES_PROPS_MAP[service] || `${vendorProp}_alternatives`;
    const alternatives = Array.isArray(plan[alternativesProp]) ? plan[alternativesProp] : [];
    const label = labels[service] || service;

    if (primary) {
      conciseVendorLines.push(`${iconMap[service] || '•'} ${label}: ${primary.vendor_name} (${fmt(primary.estimated_cost)})`);
      return;
    }

    const topAlts = alternatives.slice(0, 2);
    if (topAlts.length) {
      conciseVendorLines.push(`${iconMap[service] || '•'} ${label}: Options ${topAlts.map((v) => `${v.vendor_name} (${fmt(v.estimated_cost)})`).join(' | ')}`);
      return;
    }

    conciseVendorLines.push(`${iconMap[service] || '•'} ${label}: No in-budget vendors found`);
  });

  if (conciseVendorLines.length) {
    lines.push('');
    lines.push('📌 Recommended Vendors (shortlist):');
    lines.push(...conciseVendorLines);
  }

  const categoryDiagnostics = Array.isArray(plan.category_diagnostics)
    ? plan.category_diagnostics.filter((d) => d && d.isLow)
    : [];
  if (categoryDiagnostics.length) {
    lines.push('');
    lines.push('ℹ️ Category Diagnostics (Why options are low):');
    for (const d of categoryDiagnostics) {
      lines.push(`• ${d.service}: ${d.reason}`);
    }
  }

  const servicesWithoutVendorsRaw = Array.isArray(eventPlan.missing_services) ? eventPlan.missing_services : [];
  const servicesWithoutVendors = allowOtherServicesWithoutVenue
    ? servicesWithoutVendorsRaw.filter((svc) => String(svc || '').toLowerCase() !== 'venue')
    : servicesWithoutVendorsRaw;
  if (servicesWithoutVendors.length) {
    lines.push('');
    lines.push(`⚠️ Action needed: No in-budget vendors for ${servicesWithoutVendors.join(', ')}.`);

    const otherServiceSuggestions = Array.isArray(plan?.alternatives_block?.otherServiceVendors)
      ? plan.alternatives_block.otherServiceVendors
      : [];
    if (servicesWithoutVendors.length === 1
      && String(servicesWithoutVendors[0] || '').toLowerCase() === 'venue'
      && otherServiceSuggestions.length > 0) {
      lines.push('');
      lines.push('🧩 Venue is pending. You can still proceed with these other service vendors:');
      otherServiceSuggestions.slice(0, 6).forEach((item) => {
        const label = labels[String(item?.service || '').toLowerCase().trim()] || String(item?.service || 'Service');
        lines.push(`• ${label}: ${item.vendor_name} (${fmt(item.estimated_cost)})`);
      });
      lines.push('Use these as shortlists now, then finalize venue separately.');
    }
  }

  const filteredWarnings = (Array.isArray(plan.warnings) ? plan.warnings : []).filter((w) => {
    if (!allowOtherServicesWithoutVenue || plan.venue) return true;
    return !/^⚠️ No vendors found for:/i.test(String(w || ''));
  });

  if (filteredWarnings.length) {
    lines.push('');
    lines.push(`⚠️ Note: ${filteredWarnings[0]}`);
  }

  return lines.join('\n');
}

async function polishPlanWithAI(planText, eventDraft, conversationHistory, language = 'en') {
  // Keep output deterministic and numerically correct.
  // LLM rewriting can distort budgets/dates, so always return structured plan text directly.
  const intro = language === 'hi'
    ? 'Yeh raha aapka event plan:\n\n'
    : language === 'te'
      ? 'Mee event plan ikkada undi:\n\n'
      : 'Here is your event plan:\n\n';
  return `${intro}${planText}`;

  try {
    const systemPrompt = `You are BudgetAI, a warm and knowledgeable Indian event planning assistant 
specializing in Telangana events. You speak in a friendly conversational tone, occasionally mixing 
English with Telugu/Hindi phrases (Namaste, Abba!, Chala bagundi, etc.).
You are presenting an event plan that was compiled by specialist agents. 
Present it naturally and encouragingly. Use emojis. Keep ₹ for amounts. 
  End with 2-3 actionable money-saving tips. Keep response under 600 words.
  Respond in ${language === 'hi' ? 'Hindi' : language === 'te' ? 'Telugu' : 'English'} by default unless the user asks for another language.`;

    const messages = [
      ...conversationHistory.slice(-6).map(m => ({ role: m.role, content: String(m.content || '') })),
      { role: 'user', content: `Please present this event plan in a warm, helpful way:\n\n${planText}` },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 900,
      system: systemPrompt,
      messages,
    });

    return response.content[0]?.text || planText;
  } catch (err) {
    // Log error but don't fail - return plain text plan
    console.warn('⚠️ AI polish skipped (API unavailable):', err.message);
    return planText;
  }
}

export class ChatAgent {
  constructor() {
    this.systemPrompt = `You are a Budget Management assistant that also guides users to plan events by collecting the right details and matching vendors from datasets.`;
  }

  async chat(userId, userMessage, options = {}) {
    try {
      const uid = new mongoose.Types.ObjectId(userId);
      const text = String(userMessage || '').trim();
      const conversationId = String(options.conversationId || 'default').trim() || 'default';
      if (!text) {
        return { success: false, message: 'Message is required', error: 'empty_message' };
      }

      const { vendorsByEventType, universalVendors, supportedEventTypes } = await getVendorsDataset({ forceRefresh: true });

      let draft = await EventDraft.findOne({ userId: uid });
      if (!draft) {
        draft = await EventDraft.create({ userId: uid, step: 0, answers: {}, completed: false, sessionId: conversationId });
      } else if (String(draft.sessionId || '') !== conversationId) {
        draft.step = 0;
        draft.answers = {};
        draft.completed = false;
        draft.sessionId = conversationId;
        await draft.save();
      }

      const existingAnswers = { ...(draft.answers || {}) };
      const preferredLanguage = existingAnswers.language || 'en';
      const responseLanguage = isUiControlMessage(text)
        ? preferredLanguage
        : detectLanguage(text, preferredLanguage);
      existingAnswers.language = responseLanguage;
      const turnIntent = detectConversationIntent(text);
      const effectiveReligion = existingAnswers.religion || 'all';
      let nearbyVenueApproval = false;
      let eventPlan = null;
      const stepSixConfirming = existingAnswers.stepSixConfirming === true;
      const stepPrompts = {
        0: lmsg(responseLanguage, 'step0'),
        1: lmsg(responseLanguage, 'step1'),
        2: lmsg(responseLanguage, 'step2'),
        3: lmsg(responseLanguage, 'step3'),
        4: lmsg(responseLanguage, 'step4'),
        5: lmsg(responseLanguage, 'step5'),
        6: getStep6Prompt(responseLanguage, effectiveReligion),
        7: lmsg(responseLanguage, 'step7'),
        8: lmsg(responseLanguage, 'step8'),
      };
      
      // Handle step 6 confirmation flow (add/remove services)
      if (stepSixConfirming && existingAnswers.selectedServices && existingAnswers.servicesAlreadySelected !== true) {
        const currentServices = [...(existingAnswers.selectedServices || [])];
        const addMatch = text.match(/add\s+(\w+(?:\s+\w+)*)/i);
        const removeMatch = text.match(/remove\s+(\w+(?:\s+\w+)*)/i);
        let updatedServices = [...currentServices];
        let confirmAndProceed = /continue|done|next|confirm|ok|yes|proceed|haan|ha|chalo|sare|సరే|అవును|aage|munduku/i.test(text);
        
        if (addMatch) {
          const toAdd = normalizeServiceKey(addMatch[1]);
          if (toAdd && !updatedServices.includes(toAdd)) {
            updatedServices.push(toAdd);
            confirmAndProceed = false; // Don't move forward yet, show updated list
          }
        } else if (removeMatch) {
          const toRemove = normalizeServiceKey(removeMatch[1]);
          updatedServices = updatedServices.filter((s) => s !== toRemove);
          confirmAndProceed = false;
        } else if (!confirmAndProceed) {
          // Try to parse as additional service selections
          const additionalServices = parseSelectedServices(text);
          for (const service of additionalServices) {
            if (!updatedServices.includes(service)) {
              updatedServices.push(service);
            }
          }
          if (additionalServices.length > 0) confirmAndProceed = false;
        }
        
        if (confirmAndProceed) {
          // Move to next step
          existingAnswers.selectedServices = updatedServices;
          existingAnswers.stepSixConfirming = false;
          draft.answers = existingAnswers;
          draft.step = 7;
          await draft.save();
          const nextPrompt = stepPrompts[7];
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: nextPrompt, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: nextPrompt, usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 } };
        } else {
          // Still in confirmation - show updated list
          existingAnswers.selectedServices = updatedServices;
          draft.answers = existingAnswers;
          await draft.save();
          const selectedLabels = formatSelectedServices(updatedServices, existingAnswers.religion);
          const updatedConfirmation = lmsg(responseLanguage, 'selectedUpdated', { services: selectedLabels });
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: updatedConfirmation, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: updatedConfirmation, usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 } };
        }
      }
      
      if (existingAnswers.nearbyVenuePending) {
        const approvedRadius = Number(existingAnswers.pendingRadiusKm || 30);
        if (/show\s+other\s+service\s+vendors?|other\s+service\s+vendors?|continue\s+without\s+venue|skip\s+venue/i.test(text)) {
          existingAnswers.allowOtherServicesWithoutVenue = true;
          existingAnswers.nearbyVenuePending = false;
          existingAnswers.allowNearbyVenueSearch = false;
          existingAnswers.venueBlockReason = null;
          draft.answers = existingAnswers;
          draft.step = 8;
          await draft.save();

          const assistantMessage = 'Understood. I will keep venue pending and show available vendors for your other selected services. Say "find venue again" anytime to retry venue-first matching.';
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: assistantMessage, usage: { prompt_tokens: 90, completion_tokens: 80, total_tokens: 170 } };
        }

        if (isVenueNearbyApprovalText(text)) {
          const radiusMatch = text.match(/(\d+)\s*km/i);
          const approvedRadius = radiusMatch ? parseInt(radiusMatch[1]) : (existingAnswers.pendingRadiusKm || 30);
          existingAnswers.allowNearbyVenueSearch = true;
          existingAnswers.nearbyVenuePending = false;
          existingAnswers.searchRadiusKm = approvedRadius;
          nearbyVenueApproval = true;
          draft.answers = existingAnswers;
          draft.step = 8;
          await draft.save();
        } else if (/change|area|city|location/i.test(text)) {
          existingAnswers.nearbyVenuePending = false;
          existingAnswers.allowNearbyVenueSearch = false;
          draft.answers = existingAnswers;
          draft.step = 1;
          draft.completed = false;
          await draft.save();
          const assistantMessage = 'Sure! Which city or area should I search for venues?';
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: assistantMessage, usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 } };
        }
      }

      // Handle venue block responses (budget increase, date change, etc.)
      if (existingAnswers.venueBlockReason && !existingAnswers.venueResolved) {
        const t = String(text || '').toLowerCase();

        if (isVenueNearbyApprovalText(text)) {
          existingAnswers.allowNearbyVenueSearch = true;
          existingAnswers.nearbyVenuePending = false;
          existingAnswers.searchRadiusKm = Number(existingAnswers.pendingRadiusKm || existingAnswers.searchRadiusKm || 30);
          existingAnswers.venueBlockReason = null;
          existingAnswers.venueResolved = false;
          nearbyVenueApproval = true;
          draft.answers = existingAnswers;
          draft.step = 8;
          await draft.save();
          // Continue to venue search with the approved radius.
        }

        if (/show\s+other\s+service\s+vendors?|other\s+service\s+vendors?|continue\s+without\s+venue|skip\s+venue/i.test(t)) {
          existingAnswers.allowOtherServicesWithoutVenue = true;
          existingAnswers.venueBlockReason = null;
          existingAnswers.nearbyVenuePending = false;
          existingAnswers.allowNearbyVenueSearch = false;
          draft.answers = existingAnswers;
          draft.step = 8;
          await draft.save();
          // Continue to plan generation with venue pending and non-venue services enabled.
        }

        // User wants to increase budget
        const budgetIncrease = parseBudgetValue(text);
        if (budgetIncrease && budgetIncrease > Number(existingAnswers.budget || 0)) {
          existingAnswers.budget = budgetIncrease;
          existingAnswers.venueBlockReason = null;
          existingAnswers.venueResolved = true;
          draft.answers = existingAnswers;
          draft.step = 8;
          await draft.save();
          // Will fall through to plan generation with new budget
        }

        // User wants to change date
        const newDate = toIsoDate(text);
        if (newDate && newDate !== existingAnswers.event_date) {
          existingAnswers.event_date = newDate;
          existingAnswers.venueBlockReason = null;
          existingAnswers.venueResolved = true;
          draft.answers = existingAnswers;
          draft.step = 8;
          await draft.save();
        }

        // User wants to reduce services — parse new service list
        if (/reduce|remove|only|less services|fewer/i.test(t) && !budgetIncrease && !newDate) {
          existingAnswers.venueBlockReason = null;
          draft.answers = existingAnswers;
          draft.step = 6; // Go back to service selection
          draft.completed = false;
          await draft.save();
          const msg = lmsg(responseLanguage, 'step6')
            || 'Which services should I include? Reducing services frees up more budget for the venue.';
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            { $push: { messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: msg, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES } } },
            { upsert: true, new: true }
          );
          return { success: true, message: msg, usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } };
        }

        // User typed a specific budget amount like "increase to 7 lakhs" or "700000"
        if (/increase|higher|more budget/i.test(t) && !budgetIncrease) {
          const promptMsg = `What would you like to increase the budget to? Current budget: ₹${Number(existingAnswers.budget || 0).toLocaleString('en-IN')}`;
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            { $push: { messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: promptMsg, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES } } },
            { upsert: true, new: true }
          );
          return { success: true, message: promptMsg, chips: ['3 Lakhs', '5 Lakhs', '7 Lakhs', '10 Lakhs'], usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } };
        }
      }

      // Handle "upgrade venue to X (vendor_id:Y) extra:Z" — swap venue and bump budget
      const upgradeVenueMatch = text.match(/upgrade venue to (.+?)\s*\(vendor_id:([^)]+)\)\s*extra:(\d+)/i);
      if (upgradeVenueMatch) {
        const upgradeVendorName = upgradeVenueMatch[1].trim();
        const upgradeVendorId   = upgradeVenueMatch[2].trim();
        const extraRequired     = Number(upgradeVenueMatch[3]) || 0;
        // Bump the saved budget so the venue search now includes this vendor
        const currentBudget = Number(existingAnswers.budget || 0);
        const newBudget = currentBudget + extraRequired;
        existingAnswers.budget = newBudget;
        existingAnswers.preferredVenueId = upgradeVendorId;   // hint for venue search
        existingAnswers.venueBlockReason = null;
        existingAnswers.venueResolved    = true;
        existingAnswers.allowNearbyVenueSearch  = false;
        existingAnswers.allowOtherServicesWithoutVenue = false;
        draft.answers   = existingAnswers;
        draft.step      = 8;      // re-run plan generation
        draft.completed = false;
        await draft.save();
        // Fall through to plan generation with the new budget and preferred venue
      }

      // Allow simple restart.
      if (turnIntent === 'restart') {
        await EventDraft.updateOne({ userId: uid }, { step: 0, answers: {}, completed: false });
        const assistantMessage = lmsg(responseLanguage, 'restart');
        await ChatConversation.findOneAndUpdate(
          { userId: uid },
          {
            $push: {
              messages: {
                $each: [
                  { role: 'user', content: text },
                  { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                ],
                $slice: -MAX_CHAT_MESSAGES,
              },
            },
          },
          { upsert: true, new: true }
        );
        return { success: true, message: assistantMessage, usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 } };
      }

      // If already completed, provide guidance or show more vendors.
      if (draft.completed) {
        const completedAnswers = draft.answers || {};
        const completedSelectedServices = Array.isArray(completedAnswers.selectedServices) ? completedAnswers.selectedServices : [];
        const venueStillUnresolved = completedSelectedServices.includes('venue')
          && !completedAnswers.allowNearbyVenueSearch
          && !completedAnswers.allowOtherServicesWithoutVenue
          && completedAnswers.venueResolved !== true;
        const affirmativeForNearby = isVenueNearbyApprovalText(text);
        const plainLocationReply = venueStillUnresolved
          && !affirmativeForNearby
          && !/^(restart|show more|more vendors|next|continue|checklist|compare|weather|payment|family|save plan|my plans)$/i.test(String(text || '').trim())
          && String(text || '').trim().length > 0
          && String(text || '').trim().length <= 40;
        const isEditIntent = turnIntent === 'modify_plan';
        const treatAsVenueNearby = venueStillUnresolved && affirmativeForNearby;
        if (isEditIntent) {
          // Re-open the flow with existing answers so the same turn can apply edits and regenerate.
          draft.completed = false;
          draft.step = 0;
          await draft.save();
        } else if (plainLocationReply) {
          // Treat a plain city/area reply as the next venue search location.
          draft.completed = false;
          draft.step = 8;
          const location = normalizeCityArea(text) || String(text || '').trim();
          draft.answers = {
            ...completedAnswers,
            city: location,
            venueResolved: false,
            venueBlockReason: null,
            allowNearbyVenueSearch: false,
          };
          await draft.save();
          const locationMessage = location
            ? `Got it — I updated the location to ${location}. I’ll search venues there next and, if needed, I’ll also list other service vendors.`
            : 'Got it — I updated the location. I’ll search venues there next and, if needed, I’ll also list other service vendors.';
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: locationMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return {
            success: true,
            message: locationMessage,
            chips: ['Show other service vendors', 'Change city/area'],
            usage: { prompt_tokens: 70, completion_tokens: 60, total_tokens: 130 },
          };
        } else {
        if (turnIntent === 'venue_nearby' || treatAsVenueNearby) {
          const answers = draft.answers || {};
          const city = normalizeCityArea(answers.city);
          const nearbyCities = city ? resolveNearbyCities(city).map((c) => String(c || '').toLowerCase()) : [];
          const venueBudgetCap = Number(answers.venueBudget || answers.budget || 0);
          const eventTypeNorm = String(answers.event_type || '').toLowerCase();
          const religionNorm = String(answers.religion || '').toLowerCase();
          const preferChurchVenues = religionNorm === 'christian'
            || /(christian|christening|baptism|holy communion|confirmation|church wedding)/i.test(eventTypeNorm);
          const strictChurchOnly = String(answers.venuePreference || '').toLowerCase() === 'church';
          const isChurchCategory = (cat = '') => cat.includes('church') || cat.includes('parish') || cat.includes('chapel');

          const candidates = (answers.event_type && vendorsByEventType.get(answers.event_type)) || [];
          const pool = [...candidates, ...universalVendors];
          const unique = new Map(pool.map((v) => [v.vendor_id, v]));

          const venueOnly = Array.from(unique.values()).filter((v) => {
            const cat = String(v.category || '').toLowerCase();
            if (strictChurchOnly && !isChurchCategory(cat)) return false;
            if (!(cat.includes('function hall') || cat.includes('church'))) return false;
            if (!venueSupportsReligion(v, answers.religion)) return false;
            if (!vendorCapacityCanFit(v, answers.guests)) return false;

            if (city) {
              const vc = String(v.city || '').toLowerCase();
              const va = String(v.area || '').toLowerCase();
              const q = String(city || '').toLowerCase();
              const cityMatch = vc.includes(q) || va.includes(q);
              const nearbyMatch = nearbyCities.includes(vc);
              if (!cityMatch && !nearbyMatch) return false;
            }

            if (venueBudgetCap > 0) {
              const price = Number(v.base_price || 0);
              if (price > venueBudgetCap * 1.35) return false;
            }

            return true;
          });

          venueOnly.sort((a, b) => {
            if (preferChurchVenues) {
              const aCat = String(a.category || '').toLowerCase();
              const bCat = String(b.category || '').toLowerCase();
              const aChurchRank = isChurchCategory(aCat) ? 0 : 1;
              const bChurchRank = isChurchCategory(bCat) ? 0 : 1;
              if (aChurchRank !== bChurchRank) return aChurchRank - bChurchRank;
            }

            return (Number(a.base_price || 0) - Number(b.base_price || 0))
              || (Number(b.rating || 0) - Number(a.rating || 0));
          });

          if (!venueOnly.length) {
            const noVenueMsg = city
              ? `I could not find cheaper nearby venues around ${city} for your saved plan filters. Try increasing venue budget slightly or changing city/area.`
              : 'I could not find cheaper nearby venues for your saved plan filters. Try sharing city/area or increasing venue budget slightly.';
            await ChatConversation.findOneAndUpdate(
              { userId: uid },
              {
                $push: {
                  messages: {
                    $each: [
                      { role: 'user', content: text },
                      { role: 'assistant', content: noVenueMsg, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                    ],
                    $slice: -MAX_CHAT_MESSAGES,
                  },
                },
              },
              { upsert: true, new: true }
            );
            return {
              success: true,
              message: noVenueMsg,
              chips: ['3 Lakhs', '5 Lakhs', '7 Lakhs', '10 Lakhs', 'Change city/area'],
              usage: { prompt_tokens: 90, completion_tokens: 70, total_tokens: 160 },
            };
          }

          const assistantMessage = `Here are cheaper nearby venue options only:\n\n${venueOnly.slice(0, 6).map(formatVendorLine).join('\n')}`;
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );

            return {
            success: true,
            message: assistantMessage,
            chips: ['3 Lakhs', '5 Lakhs', '7 Lakhs', '10 Lakhs', 'Change city/area'],
            usage: { prompt_tokens: 95, completion_tokens: 90, total_tokens: 185 },
          };
        }

        const advisory = managerAdvisoryReply(text, responseLanguage);
        if (advisory) {
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: advisory, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: advisory, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } };
        }

        if (turnIntent === 'other_services') {
          const answers = draft.answers || {};
          const candidates = (answers.event_type && vendorsByEventType.get(answers.event_type)) || [];
          const pool = [...candidates, ...universalVendors];
          const unique = new Map(pool.map((v) => [v.vendor_id, v]));
          const nonVenueVendors = Array.from(unique.values()).filter((v) => {
            const cat = String(v.category || '').toLowerCase();
            return !(cat.includes('function hall') || cat.includes('church') || cat.includes('parish'));
          });

          nonVenueVendors.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (a.base_price || 0) - (b.base_price || 0));

          if (!nonVenueVendors.length) {
            const assistantMessage = 'I could not find matching non-venue vendors for your current filters. Try changing city/area or relaxing filters.';
            await ChatConversation.findOneAndUpdate(
              { userId: uid },
              {
                $push: {
                  messages: {
                    $each: [
                      { role: 'user', content: text },
                      { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                    ],
                    $slice: -MAX_CHAT_MESSAGES,
                  },
                },
              },
              { upsert: true, new: true }
            );
            return {
              success: true,
              message: assistantMessage,
              chips: ['Change city/area', 'Relax filters'],
              usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
            };
          }

          const list = nonVenueVendors.slice(0, 6);
          const assistantMessage = `Venue is still pending, but you can shortlist these other service vendors now:\n\n${list.map(formatVendorLine).join('\n')}`;
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );

          return {
            success: true,
            message: assistantMessage,
            chips: ['Change city/area', 'Change event date'],
            usage: { prompt_tokens: 85, completion_tokens: 95, total_tokens: 180 },
          };
        }

        const showMore = turnIntent === 'show_more';
        const looksLikeVendorRequest = /show\s+more|more\s+vendors|vendor\s+list|vendors?|nearby|cheaper|venue|venues|hall|halls|service\s+vendors|options|list\s+vendors/i.test(String(text || '').toLowerCase());
        if (turnIntent === 'generic' && !showMore && !looksLikeVendorRequest) {
          const nudge = 'Your plan is already generated. You can ask me: "pre-booking checklist", "compare vendors", "weather backup", or type "restart" for a new plan.';
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: nudge, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: nudge, usage: { prompt_tokens: 70, completion_tokens: 70, total_tokens: 140 } };
        }
        const answers = draft.answers || {};

        const candidates = (answers.event_type && vendorsByEventType.get(answers.event_type)) || [];
        const pool = [...candidates, ...universalVendors];
        const unique = new Map(pool.map((v) => [v.vendor_id, v]));
        const eligible = Array.from(unique.values()).filter((v) => {
          const city = normalizeCityArea(answers.city);
          if (city) {
            const vc = String(v.city || '').toLowerCase();
            const va = String(v.area || '').toLowerCase();
            const q = city.toLowerCase();
            if (!vc.includes(q) && !va.includes(q)) return false;
          }
          if (!vendorSupportsReligion(v, answers.religion)) return false;
          if (!vendorCapacityCanFit(v, answers.guests)) return false;
          return true;
        });

        eligible.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (a.base_price || 0) - (b.base_price || 0));

        if (!eligible.length) {
          const assistantMessage = 'I could not find matching vendors for your saved plan filters. You can relax filters, change city/area, or increase budget slightly.';
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return {
            success: true,
            message: assistantMessage,
            fallback: {
              reason_code: 'no_match_for_filters',
              next_actions: ['relax_filters', 'change_city', 'increase_budget'],
            },
            usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
          };
        }

        const finalAdvisory = managerAdvisoryReply(text, responseLanguage);
        if (finalAdvisory) {
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: finalAdvisory, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: finalAdvisory, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } };
        }

        const list = eligible.slice(0, showMore ? 10 : 6);
        const assistantMessage = lmsg(responseLanguage, 'completedHint', { list: list.map(formatVendorLine).join('\n') });

        await ChatConversation.findOneAndUpdate(
          { userId: uid },
          {
            $push: {
              messages: {
                $each: [
                  { role: 'user', content: text },
                  { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                ],
                $slice: -MAX_CHAT_MESSAGES,
              },
            },
          },
          { upsert: true, new: true }
        );

        return { success: true, message: assistantMessage, usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 } };
        }
      }

      const answers = { ...(draft.answers || {}), language: responseLanguage };

      // Hybrid mode: extract multiple fields from free-form user text.
      const extracted = extractAnswersFromFreeText(text, supportedEventTypes, answers);
      const slotConfidence = getSlotConfidence(text, extracted);
      Object.assign(answers, extracted);

      if (!draft || draft.step === undefined || draft.step === 0) {
        const hasAnswers = draft?.answers && Object.keys(draft.answers).length > 0;
        const hasHistory = await ChatConversation.exists({ userId: uid, 'messages.0': { $exists: true } });
        if (!hasAnswers && !hasHistory && isGreetingStartMessage(text)) {
          draft.step = 0;
          draft.completed = false;
          await draft.save();

          const assistantMessage = stepPrompts[0];
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );

          return { success: true, message: assistantMessage, usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 } };
        }
      }

      // Capture the current user message into the current step answer.
      let nextStep = draft.step;
      if (nearbyVenueApproval) {
        nextStep = 9;
      }

      // If user provided multiple details in one go, skip already-filled steps.
      if (!nearbyVenueApproval) {
        nextStep = Math.max(nextStep, firstMissingStep(answers));
      }

      if (!nearbyVenueApproval && draft.step === 0) {
        const match = bestMatchEventType(text, supportedEventTypes);
        if (answers.event_type || match) {
          answers.event_type = answers.event_type || match;
          nextStep = 1;
        } else if (!isGreetingStartMessage(text)) {
          answers.event_type = text;
          nextStep = 1;
        } else {
          nextStep = 0;
        }
      } else if (!nearbyVenueApproval && draft.step === 1) {
        answers.city = answers.city || normalizeCityArea(text);
        nextStep = 2;
      } else if (!nearbyVenueApproval && draft.step === 2) {
        const iso = answers.event_date || toIsoDate(text);
        if (!iso) {
          const assistantMessage = clarificationForStep(2, responseLanguage) || lmsg(responseLanguage, 'dateError');
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: assistantMessage, usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } };
        }
        answers.event_date = iso;
        nextStep = 3;
      } else if (!nearbyVenueApproval && draft.step === 3) {
        const n = answers.guests || extractNumber(text);
        if (!n || n <= 0) {
          const assistantMessage = clarificationForStep(3, responseLanguage) || lmsg(responseLanguage, 'guestsError');
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: assistantMessage, usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } };
        }
        answers.guests = Math.round(n);
        nextStep = 4;
      } else if (!nearbyVenueApproval && draft.step === 4) {
        const r = normalizeReligion(text);
        answers.religion = answers.religion || r || text;
        answers.servicesPromptPending = true;
        nextStep = 5;
      } else if (!nearbyVenueApproval && draft.step === 5) {
        const budgetFromText = parseBudgetValue(text);
        const numericOnlyBudget = /^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(String(text || '')) && Number(budgetFromText || 0) >= 1000;
        if (!isLikelyBudgetMessage(text) && !numericOnlyBudget) {
          const assistantMessage = clarificationForStep(5, responseLanguage) || lmsg(responseLanguage, 'step5');
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: assistantMessage, usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } };
        }
        const b = answers.budget || budgetFromText;
        if (!b || b < 1000) {
          const assistantMessage = clarificationForStep(5, responseLanguage) || lmsg(responseLanguage, 'step5');
          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES },
              },
            },
            { upsert: true, new: true }
          );
          return { success: true, message: assistantMessage, usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } };
        }
        answers.budget = Math.round(b);
        nextStep = 6;
      } else if (!nearbyVenueApproval && draft.step === 6) {
        const directContinue = /^\s*(continue|ok|okay|next|done)\s*$/i.test(String(text || ''));
        if (directContinue && (!answers.selectedServices || !answers.selectedServices.length)) {
          answers.selectedServices = DEFAULT_SELECTED_SERVICES;
          answers.servicesAlreadySelected = true;
          answers.stepSixConfirming = false;
          answers.servicesPromptPending = false;
          nextStep = 7;
        } else if (answers.servicesAlreadySelected || (answers.selectedServices && answers.selectedServices.length > 0)) {
          // Skip asking again if services are already captured
          answers.servicesAlreadySelected = true;
          answers.stepSixConfirming = false;
          answers.servicesPromptPending = false;
          nextStep = 7;
        } else {
        const selectedServices = Array.isArray(answers.selectedServices) && answers.selectedServices.length
          ? answers.selectedServices
          : parseSelectedServices(text);
        const explicitVenuePreference = detectVenuePreferenceFromText(text);
        const specialNoCatering = /no catering|without catering|skip catering/i.test(text);
        // Determine base selection
        let selectedServicesForSave = [];
        if (specialNoCatering) {
          const baseSelection = selectedServices.length
            ? selectedServices
            : (answers.selectedServices || DEFAULT_SELECTED_SERVICES);
          selectedServicesForSave = baseSelection.filter((s) => s !== 'catering');
        } else if (selectedServices.length) {
          selectedServicesForSave = [...selectedServices];
        } else if (/^all$/i.test(String(text || '').trim()) || /all services|everything/i.test(text)) {
          selectedServicesForSave = Object.keys(SERVICE_LABELS);
        } else {
          selectedServicesForSave = [...DEFAULT_SELECTED_SERVICES];
        }

        // Auto-inject religion-specific services
        const religion = answers.religion || 'all';
        const eventType = answers.event_type || '';
        const rel = String(religion).toLowerCase();

        // Auto-add religious officiant service only for Muslim/Christian when a mapped category exists.
        const religiousCatForStep6 = getReligiousVendorCategory(religion, eventType);
        const shouldInjectPriestService =
          (rel === 'muslim' || rel === 'christian') &&
          Boolean(religiousCatForStep6);
        if (shouldInjectPriestService && !selectedServicesForSave.includes('priest')) {
          selectedServicesForSave.push('priest');
        }

        // Auto-add band if Hindu + wedding/reception/engagement
        const bandNeededForStep6 = needsBand(religion, eventType);
        if (bandNeededForStep6 && !selectedServicesForSave.includes('band')) {
          selectedServicesForSave.push('band');
        }

        // Remove duplicates
        selectedServicesForSave = [...new Set(selectedServicesForSave)];
        
        // Save once and move forward; do not re-ask the same service-selection step.
        answers.selectedServices = selectedServicesForSave;
        if (explicitVenuePreference && selectedServicesForSave.includes('venue')) {
          answers.venuePreference = explicitVenuePreference;
        }
        answers.servicesAlreadySelected = true;
        answers.stepSixConfirming = false;
        answers.servicesPromptPending = false;
        nextStep = 7;
        }
      } else if (!nearbyVenueApproval && draft.step === 7) {
        answers.classPreference = answers.classPreference || detectQualityPreference(text) || 'mid';
        nextStep = 8;
      } else if (!nearbyVenueApproval && draft.step === 8) {
        answers.requirements = answers.requirements || text;
        nextStep = 9;
      }

      // Final auto-advance after current input is parsed.
      if (!nearbyVenueApproval && nextStep < 9) {
        nextStep = Math.max(nextStep, firstMissingStep(answers));
      }

      let assistantMessage = '';
      let responsePayload = null;

      if (nextStep < 9) {
        draft.step = nextStep;
        draft.answers = answers;
        draft.completed = false;
        await draft.save();
         console.log('💾 Draft saved. Step:', draft.step, 'nextStep:', nextStep, 'Questions answered:', Object.keys(draft.answers || {}).length);
        assistantMessage = stepPrompts[nextStep];
      } else {
        console.log('🎉 REACHING PLAN GENERATION - Step 8!');
        const { event_type, city, event_date, guests, religion, budget, requirements } = answers;
        const classPreference = answers.classPreference || 'mid';
        const convDoc = await ChatConversation.findOne({ userId: uid }).lean();
        const recentHistory = (convDoc?.messages || []).slice(-12);
        const recoveredSelectedServices = extractSelectedServicesFromHistory(recentHistory);

        let selectedServices = Array.isArray(answers.selectedServices) && answers.selectedServices.length
          ? answers.selectedServices
          : DEFAULT_SELECTED_SERVICES;
        if (recoveredSelectedServices.length > selectedServices.length) {
          selectedServices = recoveredSelectedServices;
          answers.selectedServices = selectedServices;
        }
        answers.servicesPromptPending = false;

        const minViableBudget = getMinimumViableBudget(event_type, guests, city);
        // Only block if the budget is ACTUALLY too low — not when there's enough buffer/savings
        // from other allocated services that can cover the shortfall.
        const breakdown_preview = buildSelectedBudgetBreakdown(budget, event_type, guests, answers.classPreference || 'mid', selectedServices);
        const previewTotalVendorCost = [
          breakdown_preview.venue, breakdown_preview.catering, breakdown_preview.decoration,
          breakdown_preview.photography, breakdown_preview.videography, breakdown_preview.dj,
          breakdown_preview.florist, breakdown_preview.dresses, breakdown_preview.priest,
          breakdown_preview.band, breakdown_preview.tent,
        ].reduce((a, b) => a + (b || 0), 0);
        const previewSavings = Math.max(0, Number(budget || 0) - previewTotalVendorCost);
        // If there's enough buffer to cover the shortfall, skip the block entirely
        const shortfall = Math.max(0, minViableBudget - Number(budget || 0));
        const budgetActuallyTooLow = Number(budget || 0) > 0 && Number(budget || 0) < minViableBudget && previewSavings < shortfall;
        if (budgetActuallyTooLow) {
          const assistantMessage = responseLanguage === 'hi'
            ? `Aapka budget ₹${Number(budget).toLocaleString('en-IN')} lag raha hai, lekin ${guests} guests ke liye minimum practical budget करीब ₹${Number(minViableBudget).toLocaleString('en-IN')} hai. Kya aap budget update karna chahenge ya category count kam karna chahenge?`
            : responseLanguage === 'te'
              ? `Mee budget ₹${Number(budget).toLocaleString('en-IN')} la undi, kani ${guests} guests ki minimum practical budget సుమారు ₹${Number(minViableBudget).toLocaleString('en-IN')} అవుతుంది. Budget penchala లేదా categories takkuva cheyyala?`
              : `Your entered budget is ₹${Number(budget).toLocaleString('en-IN')}, but for ${guests} guests the minimum practical budget is about ₹${Number(minViableBudget).toLocaleString('en-IN')}. Would you like to increase the budget or reduce the number of services?`;

          await ChatConversation.findOneAndUpdate(
            { userId: uid },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                  ],
                  $slice: -MAX_CHAT_MESSAGES,
                },
              },
            },
            { upsert: true, new: true }
          );

          return {
            success: true,
            message: assistantMessage,
            fallback: {
              reason_code: 'budget_too_low',
              next_actions: ['increase_budget', 'change_category'],
            },
            usage: { prompt_tokens: 80, completion_tokens: 80, total_tokens: 160 },
          };
        }

        // Step A: Split budget
        const breakdown = buildSelectedBudgetBreakdown(budget, event_type, guests, classPreference || 'mid', selectedServices);
        const warnings = warnBudgetIssues(budget, guests, classPreference || 'mid');
        // Venue search uses the FULL budget as ceiling, not just the 28% slice.
        // Reason: other vendors (catering, decor, photo) almost always cost less than allocated,
        // creating a buffer. That buffer is real money available for the venue.
        // We discover actual vendor costs AFTER searching — so we must give venue the full budget
        // to search against, then recalculate allocations once all vendors are found.
        const allServicesAllocated = (breakdown.venue || 0) + (breakdown.catering || 0) +
          (breakdown.decoration || 0) + (breakdown.photography || 0) + (breakdown.videography || 0) +
          (breakdown.dj || 0) + (breakdown.florist || 0) + (breakdown.dresses || 0) +
          (breakdown.priest || 0) + (breakdown.band || 0) + (breakdown.tent || 0);
        const preSearchBuffer = Math.max(0, Number(budget || 0) - allServicesAllocated);
        const venueSearchBudget = Math.min(
          Number(budget || 0),  // never exceed total budget
          Math.max(
            Number(breakdown.venue || 0) + preSearchBuffer, // venue slice + any buffer
            Math.max(200000, Math.round(Number(guests || 0) * 250)),
          ),
        );

        const vendorDatasetForDiagnostics = await getVendorsDataset({ forceRefresh: true });
        const allVendorsForDiagnostics = vendorDatasetForDiagnostics?.vendors || [];

        // Step B: Determine what's needed
        const religiousCat = getReligiousVendorCategory(religion, event_type);
        const bandNeeded = needsBand(religion, event_type);
        const outdoorNeeded = isOutdoorEvent(event_type);

        // Step C: Extract dietary preference from requirements
        let dietaryPreference = 'no_restriction';
        if (/halal/i.test(requirements || '')) dietaryPreference = 'halal';
        if (/veg only|vegetarian|pure veg/i.test(requirements || '')) dietaryPreference = 'vegetarian';
        if (religion === 'Muslim') dietaryPreference = 'halal';

        const commonArgs = {
          city,
          religion,
          eventType: event_type,
          venuePreference: answers.venuePreference,
          numGuests: guests,
          classPreference,
          eventDate: event_date,
          timeSlot: '10:00-14:00',
        };
        const statewideArgs = {
          ...commonArgs,
          religion: religion || 'all',
        };
        const filterByReligion = (vendors = []) => vendors.filter((v) => vendorSupportsReligion(v, religion));

        // Step D: Run agents only for selected categories.
        const needsVenue = selectedServices.includes('venue');
        const needsCatering = selectedServices.includes('catering');
        const needsDecoration = selectedServices.includes('decoration');
        const needsPhotography = selectedServices.includes('photography');
        const needsVideography = selectedServices.includes('videography');
        const needsDj = selectedServices.includes('dj');
        const needsFlorist = selectedServices.includes('florist');
        const needsDresses = selectedServices.includes('dresses');
        const needsTentService = selectedServices.includes('tent');
        const needsBandService = selectedServices.includes('band') || bandNeeded;
        const needsPriestService = selectedServices.includes('priest') || Boolean(religiousCat);

        // ═══ VENUE FIRST GATE ═══
        // Venue is the anchor. Confirm it BEFORE suggesting any other vendors.
        // Rule: if venue is selected and not resolved → stop, diagnose, ask user to act.

        if (needsVenue) {
          const allVendors = allVendorsForDiagnostics;

          // Phase 1: Strict city search
          const venueProbe = await findVenuesWithContext({
            ...commonArgs,
            eventType: event_type,
            budget: venueSearchBudget,
            limit: 10,
            strictCity: true,
          });

          const strictVenues = venueProbe.venues || [];
          const venueLocationContext = venueProbe.locationContext || { strategy: 'none', note: '' };

          // Radius logic
          const currentRadius = Number(answers.searchRadiusKm || 30);
          const nextRadius = nextRadiusStep(currentRadius);

          // Phase 2: Diagnose WHY no venue was found
          if (!answers.allowNearbyVenueSearch && !answers.allowOtherServicesWithoutVenue) {
            const venueCategoryLabel = (String(religion || '').toLowerCase() === 'christian') ? 'Church / Parish halls' : 'Function halls';
            const cityHasInventory = allVendors.some(v =>
              /function hall|church|parish|banquet|kalyana|marriage/i.test(String(v.category || '')) &&
              String(v.city || '').trim().toLowerCase() === String(city || '').trim().toLowerCase()
            );

            const venueExistButBooked = strictVenues.length > 0 &&
              strictVenues.every(v => v.availability_status !== 'available');

            const venueExistButOverBudget = strictVenues.length > 0 &&
              strictVenues.every(v => Number(v.base_price || 0) > breakdown.venue);

            const noVenueAtAll = strictVenues.length === 0 && !cityHasInventory;

            let blockReason = null;
            let blockMessage = '';
            let blockChips = [];

            if (noVenueAtAll) {
              // Check 30km radius for venues
              const radiusResult = await findVendorsInRadius({
                city, eventType: event_type, date: event_date,
                budget: venueSearchBudget, guestCount: guests, religion, radiusKm: currentRadius,
              }).catch(() => ({ vendors: [], searchRadius: currentRadius, nearestCity: null }));

              if (radiusResult.vendors.length > 0) {
                blockReason = 'no_venue_in_city_but_radius_found';
                blockMessage = lmsg(responseLanguage, 'nearbyVenuePrompt', { city, radius: currentRadius });
                if (!blockMessage) {
                  blockMessage =
                    `📍 We don't have ${venueCategoryLabel.toLowerCase()} in **${city}** in our database yet.\n\n` +
                    `However, we found **${radiusResult.vendors.length} venue(s) within ${currentRadius}km** ` +
                    `(nearest: **${radiusResult.nearestCity}**) that can host your event.\n\n` +
                    `These venues serve events in ${city} — would you like to see them?\n\n` +
                    `If venue still does not work, I can also show other service vendors without venue.`;
                }
                blockChips = ['Change city/area', 'Show other service vendors'];
              } else {
                blockReason = 'no_venue_anywhere';
                // Do not offer automatic radius expansion. Ask the user to change location manually.
                blockMessage = lmsg(responseLanguage, 'nearbyVenuePrompt', { city, radius: currentRadius });
                if (!blockMessage) {
                  blockMessage = `📍 We couldn't find ${venueCategoryLabel.toLowerCase()} for **${city}** in our database. Please type a different area or city to search.`;
                }
                blockChips = ['Change city/area', 'Show other service vendors'];
                }
              // All venues in city are booked on requested date
              blockReason = 'venue_all_booked_on_date';
              blockMessage =
                `📅 ${venueCategoryLabel} in **${city}** are fully booked on **${event_date}**.\n\n` +
                `This is a popular date in your area. Here are your options:\n` +
                `• **Change the event date** — venues usually have slots ±1–2 weeks\n` +
                `• **Search nearby cities** within 30km that may have availability\n` +
                `• **Increase your guest flexibility** if current count limits options\n\n` +
                `Should I check alternative dates around ${event_date}?\n\n` +
                `If you prefer, I can show other service vendors first while we keep venue pending.`;
              blockChips = ['Check ±1 week dates', 'Change city/area', 'Change event date', 'Show other service vendors'];
            } else if (venueExistButOverBudget) {
              const lowestVenuePrice = Math.min(...strictVenues.map(v => Number(v.base_price || 0)));
              const venueAllocated = breakdown.venue;
              const gapFromSlice = Math.round(lowestVenuePrice - venueAllocated);
              const suggestBudget = Math.round(budget + Math.max(0, lowestVenuePrice - Number(budget)));

              // KEY FIX: Check if the total budget (not just the 28% slice) can afford this venue.
              // The slice is just for planning — the buffer from cheaper other vendors is real money.
              const venueAffordableFromTotalBudget = lowestVenuePrice <= Number(budget || 0);
              if (venueAffordableFromTotalBudget) {
                // Don't block — the full budget covers it. venueSearchBudget already includes buffer,
                // so strictVenues should have caught this. Skip the block and proceed to plan generation.
                // (This branch is a safety net; ideally venueExistButOverBudget won't be true here.)
              } else {
                blockReason = 'venue_over_budget';
                const trueGap = Math.round(lowestVenuePrice - Number(budget || 0));
                blockMessage =
                  `💰 ${venueCategoryLabel} in **${city}** exist, but even the cheapest is ` +
                  `**₹${lowestVenuePrice.toLocaleString('en-IN')}**, which is ₹${trueGap.toLocaleString('en-IN')} ` +
                  `above your **total budget** of ₹${Number(budget).toLocaleString('en-IN')}.\n\n` +
                  `Your options:\n` +
                  `• **Increase total budget** to ~₹${lowestVenuePrice.toLocaleString('en-IN')} ` +
                  `(add ₹${trueGap.toLocaleString('en-IN')} to your current ₹${Number(budget).toLocaleString('en-IN')})\n` +
                  `• **Reduce services** to free up more for the venue\n` +
                  `• **Search nearby areas** — smaller cities are 30–40% cheaper\n\n` +
                  `The venue is the most location-dependent booking. All other services ` +
                  `(catering, decor, photo) can travel to wherever you hold it.\n\n` +
                  `If you want, I can show other service vendors now and keep venue pending.`;
                blockChips = [
                  `Increase budget to ₹${lowestVenuePrice.toLocaleString('en-IN')}`,
                  'Change city/area',
                  'Reduce services',
                  'Show other service vendors',
                ];
              }
            }

            if (blockReason) {
              // Save state so user's answer continues the plan
              draft.answers = {
                ...answers,
                selectedServices,
                nearbyVenuePending: blockReason === 'no_venue_in_city_but_radius_found',
                venueBlockReason: blockReason,
              };
              draft.step = 8;
              draft.completed = false;
              await draft.save();

              await ChatConversation.findOneAndUpdate(
                { userId: uid },
                { $push: { messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: blockMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES } } },
                { upsert: true, new: true }
              );

              return {
                success: true,
                message: blockMessage,
                chips: blockChips,
                venue_block: { reason: blockReason, city, date: event_date },
                usage: { prompt_tokens: 120, completion_tokens: 160, total_tokens: 280 },
              };
            }
          }
        }
        // ═══ END VENUE FIRST GATE ═══
        // If we reach here, venue is either confirmed or user approved nearby search.

        const [venueRes, cateringRes, decorRes, photoRes, videoRes, djRes, floristRes, dressesRes] = await Promise.allSettled([
          needsVenue
            ? findVenuesWithContext({
                ...commonArgs,
                eventType: event_type,
                budget: venueSearchBudget,
                limit: 8,
                strictCity: !Boolean(answers.allowNearbyVenueSearch),
                allowNearby: Boolean(answers.allowNearbyVenueSearch),
                radiusKm: Number(answers.searchRadiusKm || 30),
              })
            : Promise.resolve({ venues: [], locationContext: { note: '', strategy: 'none', nearestCity: null } }),
          needsCatering
            ? findCaterers({
                ...statewideArgs,
                perPlateBudget: breakdown.catering_per_plate,
                dietaryPreference,
                budget: breakdown.catering,
              })
            : Promise.resolve([]),
          needsDecoration ? findDecorators({ ...statewideArgs, budget: breakdown.decoration }) : Promise.resolve([]),
          needsPhotography ? findByCategory({ ...statewideArgs, category: 'Photographer', budget: breakdown.photography }) : Promise.resolve([]),
          needsVideography ? findByCategory({ ...statewideArgs, category: 'Videographer', budget: breakdown.videography || breakdown.photography }) : Promise.resolve([]),
          needsDj
            ? findByCategory({ ...statewideArgs, category: 'DJ', budget: Math.max(breakdown.dj || 0, 1000) })
            : Promise.resolve([]),
          needsFlorist
            ? findByCategory({ ...statewideArgs, category: 'Florist', budget: Math.max(breakdown.florist || 0, 1000) })
            : Promise.resolve([]),
          needsDresses
            ? findByCategory({ ...statewideArgs, category: 'Makeup Artist', budget: Math.max(breakdown.dresses || 0, 3000) })
            : Promise.resolve([]),
        ]);

        // Also run conditional agents
        let bandResult = [], religiousResult = [], tentResult = [];
        if (needsBandService) {
          bandResult = filterByReligion(await findByCategory({
            ...statewideArgs,
            category: 'Band / Nadaswaram',
            budget: breakdown.band || breakdown.other_services,
          }).catch(() => []));
        }
        if (needsPriestService) {
          if (religiousCat) {
            religiousResult = filterByReligion(await findByCategory({
              ...statewideArgs,
              category: religiousCat,
              budget: breakdown.priest || breakdown.other_services,
            }).catch(() => []));
          }
        }
        if (needsTentService || outdoorNeeded) {
          tentResult = filterByReligion(await findTents({ ...statewideArgs, budget: breakdown.tent || breakdown.venue }).catch(() => []));
        }

        // Extract results safely
        const venueContext = venueRes.status === 'fulfilled'
          ? venueRes.value
          : { venues: [], locationContext: { note: '', strategy: 'none', nearestCity: null } };
        const rawVenues = venueContext.venues || [];
        const venues = rawVenues.filter((v) => venueSupportsReligion(v, religion));
        if (needsVenue && rawVenues.length > venues.length) {
          warnings.push('Some venue options were excluded due to religion compatibility rules.');
        }

        // ═══ VENUE CONFIRMATION GATE (post-parallel search) ═══
        // After parallel search, re-check venue health before processing other results.
        // Other agents already ran (we can't cancel Promise.allSettled) but we only
        // SHOW their results if venue is confirmed.
        const venueSolved = venues.some(v => v.availability_status === 'available' || v.base_price <= breakdown.venue * 1.2);

        if (needsVenue && !venueSolved && !answers.allowNearbyVenueSearch && !answers.allowOtherServicesWithoutVenue) {
          // All venues are either booked or over budget after the full search
          const availableVenues = venues.filter(v => v.availability_status === 'available');
          const inBudgetVenues  = venues.filter(v => Number(v.base_price || 0) <= breakdown.venue * 1.2);

          let lateBlockMsg = '';
          if (!availableVenues.length && venues.length > 0) {
            lateBlockMsg =
              `📅 **All ${venues.length} function hall(s) in ${city} are booked on ${event_date}.**\n\n` +
              `I've found venues for you — they just need a different date.\n\n` +
              `**Top venue options available on other dates:**\n` +
              venues.slice(0, 3).map(v =>
                `• **${v.vendor_name}** · ₹${Number(v.base_price || 0).toLocaleString('en-IN')} · ${v.city}`
              ).join('\n') +
              `\n\nOnce we confirm the venue, I'll immediately find caterers, decorators, and photographers. ` +
              `All other vendors can work around the venue date.\n\n` +
              `Would you like to:\n• **Change the date** for ${event_date}?\n• **Show nearby venues within 30km** that are available on ${event_date}?\n• **Show other service vendors** while venue stays pending?`;
          } else if (!inBudgetVenues.length && venues.length > 0) {
            const lowestPrice = Math.min(...venues.map(v => Number(v.base_price || 0)));
            lateBlockMsg =
              `💰 **Venue budget needs adjustment for ${city}.**\n\n` +
              `The cheapest available function hall is **₹${lowestPrice.toLocaleString('en-IN')}** ` +
              `but your current venue allocation is **₹${breakdown.venue.toLocaleString('en-IN')}**.\n\n` +
              `**Nearest venue options:**\n` +
              venues.slice(0, 3).map(v =>
                `• **${v.vendor_name}** · ₹${Number(v.base_price || 0).toLocaleString('en-IN')} · ` +
                `${v.availability_status === 'available' ? '✅ Available' : '⛔ Booked'}`
              ).join('\n') +
              `\n\nAll other vendors (catering, decoration, photography) work around the venue. ` +
              `Once we fix the venue, I'll complete your full plan immediately.\n\n` +
              `Would you like to increase your total budget, reduce other services, or see other service vendors now while venue remains pending?`;
          }

          // Replace any automated "show nearby" phrasing with manual-change instruction
          if (lateBlockMsg && lateBlockMsg.includes('Show nearby venues within')) {
            lateBlockMsg = lateBlockMsg.replace(/Show nearby venues within \d+km/g, 'Change city/area (type a different area to search)');
          }

          if (lateBlockMsg) {
            draft.answers = { ...answers, selectedServices, venueBlockReason: 'post_search_unresolved' };
            draft.step = 8;
            draft.completed = false;
            await draft.save();

            await ChatConversation.findOneAndUpdate(
              { userId: uid },
              { $push: { messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: lateBlockMsg, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES } } },
              { upsert: true, new: true }
            );

            return {
              success: true,
              message: lateBlockMsg,
              chips: ['Change event date', 'Change city/area', 'Increase total budget', 'Reduce services', 'Show other service vendors'],
              usage: { prompt_tokens: 140, completion_tokens: 180, total_tokens: 320 },
            };
          }
        }
        // ═══ END VENUE CONFIRMATION GATE ═══

        const locationContext = venueContext.locationContext || { note: '', strategy: 'none', nearestCity: null };
        const caterers = cateringRes.status === 'fulfilled' ? cateringRes.value : [];
        const decorators = decorRes.status === 'fulfilled' ? decorRes.value : [];
        const photographers = photoRes.status === 'fulfilled' ? photoRes.value : [];
        const videographers = videoRes.status === 'fulfilled' ? videoRes.value : [];
        const djs = djRes.status === 'fulfilled' ? djRes.value : [];
        const florists = floristRes.status === 'fulfilled' ? floristRes.value : [];
        const dressesVendors = dressesRes.status === 'fulfilled' ? dressesRes.value : [];

        // Relaxed fallback: if a selected category has no in-budget match,
        // fetch best alternatives with softer constraints so UI still shows options.
        let finalCaterers = filterByReligion(caterers);
        let finalDecorators = filterByReligion(decorators);
        let finalPhotographers = filterByReligion(photographers);
        let finalVideographers = filterByReligion(videographers);
        let finalDjs = filterByReligion(djs);
        let finalFlorists = filterByReligion(florists);
        let finalDressesVendors = filterByReligion(dressesVendors);
        let finalBandVendors = filterByReligion(bandResult);
        let finalReligiousVendors = filterByReligion(religiousResult);
        let finalTentVendors = filterByReligion(tentResult);

        // Local-first query with explicit statewide fallback.
        async function fetchWithStatewideFullback(agentFn, args, minResults = 1) {
          const { serviceName, ...baseArgs } = args || {};
          const localResult = await agentFn(baseArgs).catch(() => []);
          if (localResult.length >= minResults) return localResult;

          const statewideResult = await agentFn({
            ...baseArgs,
            city: '',
            budget: Math.round(Number(baseArgs.budget || 0) * 1.5),
            allowBudgetExceedPercent: 0.5,
            classPreference: null,
          }).catch(() => []);

          if (localResult.length === 0 && statewideResult.length > 0) {
            console.log(`[chatAgent] Statewide fallback used for ${baseArgs.category || serviceName || 'service'} — ${statewideResult.length} found`);
          }

          return statewideResult.length ? statewideResult : localResult;
        }

        if (needsCatering && finalCaterers.length === 0) {
          finalCaterers = filterByReligion(await fetchWithStatewideFullback(
            findCaterers,
            {
              ...statewideArgs,
              serviceName: 'Catering',
              perPlateBudget: breakdown.catering_per_plate,
              dietaryPreference,
              budget: breakdown.catering,
              eventType: event_type,
            },
            1,
          ));
        }
        if (needsCatering) {
          const caterCap = Math.max(0, Number(breakdown.catering || 0));
          const annotatedCaterers = finalCaterers
            .map((v) => annotateBudgetFit(v, caterCap))
            .filter(Boolean);
          const inOrNearBudget = annotatedCaterers.filter((v) => v.budget_fit_tag !== 'above_budget');
          // Strictly keep catering options within category budget policy.
          finalCaterers = inOrNearBudget;
        }
        if (needsDecoration && finalDecorators.length === 0) {
          finalDecorators = filterByReligion(await fetchWithStatewideFullback(
            findByCategory,
            {
              ...statewideArgs,
              city,
              category: 'Decorator',
              budget: breakdown.decoration,
            },
            1,
          ));
        }
        if (needsPhotography && finalPhotographers.length === 0) {
          finalPhotographers = filterByReligion(await fetchWithStatewideFullback(
            findByCategory,
            {
              ...statewideArgs,
              city,
              category: 'Photographer',
              budget: breakdown.photography,
            },
            1,
          ));
        }
        if (needsVideography && finalVideographers.length === 0) {
          finalVideographers = filterByReligion(await fetchWithStatewideFullback(
            findByCategory,
            {
              ...statewideArgs,
              city,
              category: 'Videographer',
              budget: breakdown.videography || breakdown.photography,
            },
            1,
          ));
        }
        if (needsDj && finalDjs.length === 0) {
          const djBudget = Math.max(breakdown.dj || 0, 5000);
          finalDjs = filterByReligion(await fetchWithStatewideFullback(
            findByCategory,
            {
              ...statewideArgs,
              city,
              category: 'DJ',
              budget: djBudget,
            },
            1,
          ));
        }
        if (needsFlorist && finalFlorists.length === 0) {
          const floristBudget = Math.max(breakdown.florist || 0, 5000);
          finalFlorists = filterByReligion(await fetchWithStatewideFullback(
            findByCategory,
            {
              ...statewideArgs,
              city,
              category: 'Florist',
              budget: floristBudget,
            },
            1,
          ));
        }
        if (needsDresses && finalDressesVendors.length === 0) {
          const dressesBudget = Math.max(breakdown.dresses || 0, 7000);
          finalDressesVendors = filterByReligion(await fetchWithStatewideFullback(
            findByCategory,
            {
              ...statewideArgs,
              city,
              category: 'Makeup Artist',
              budget: dressesBudget,
            },
            1,
          ));
        }
        if (needsBandService && finalBandVendors.length === 0) {
          finalBandVendors = filterByReligion(await fetchWithStatewideFullback(
            findByCategory,
            {
              ...statewideArgs,
              city,
              category: 'Band / Nadaswaram',
              budget: breakdown.band || breakdown.other_services,
            },
            1,
          ));
        }
        if (needsPriestService && finalReligiousVendors.length === 0) {
          if (religiousCat) {
            finalReligiousVendors = filterByReligion(await fetchWithStatewideFullback(
              findByCategory,
              {
                ...statewideArgs,
                city,
                category: religiousCat,
                budget: breakdown.priest || breakdown.other_services,
              },
              1,
            ));
          }
        }
        if ((needsTentService || outdoorNeeded) && finalTentVendors.length === 0) {
          finalTentVendors = filterByReligion(await fetchWithStatewideFullback(
            findTents,
            {
              ...statewideArgs,
              serviceName: 'Tent / Shamiana',
              budget: breakdown.tent || breakdown.venue,
            },
            1,
          ));
        }

        const selectedCaterer = needsCatering ? pickBestVendorForBudget(finalCaterers, breakdown.catering, { maxOverrunFactor: 1.35 }) : null;
        const selectedDecorator = needsDecoration ? pickBestVendorForBudget(finalDecorators, breakdown.decoration) : null;
        const selectedPhotographer = needsPhotography ? pickBestVendorForBudget(finalPhotographers, breakdown.photography, { maxOverrunFactor: 1.2 }) : null;
        const selectedVideographer = needsVideography ? pickBestVendorForBudget(finalVideographers, breakdown.videography || breakdown.photography, { maxOverrunFactor: 1.2 }) : null;
        const selectedDj = needsDj ? pickBestVendorForBudget(finalDjs, breakdown.dj || breakdown.other_services, { maxOverrunFactor: 1.2 }) : null;
        const selectedFlorist = needsFlorist ? pickBestVendorForBudget(finalFlorists, breakdown.florist || breakdown.other_services, { maxOverrunFactor: 1.2 }) : null;
        const selectedDressesVendor = needsDresses ? pickBestVendorForBudget(finalDressesVendors, breakdown.dresses || breakdown.other_services) : null;
        const selectedBandVendor = needsBandService ? pickBestVendorForBudget(finalBandVendors, breakdown.band || breakdown.other_services) : null;
        const selectedReligiousVendor = needsPriestService && religiousCat
          ? pickBestVendorForBudget(finalReligiousVendors, breakdown.priest || breakdown.other_services)
          : null;
        const selectedTentVendor = (needsTentService || outdoorNeeded) ? pickBestVendorForBudget(finalTentVendors, breakdown.tent || breakdown.venue) : null;

        const cateringAlternatives = needsCatering
          ? finalCaterers.filter((v) => v.vendor_id !== selectedCaterer?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.catering))
          : [];
        const decorationAlternatives = needsDecoration
          ? finalDecorators.filter((v) => v.vendor_id !== selectedDecorator?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.decoration))
          : [];
        const photographerAlternatives = needsPhotography
          ? finalPhotographers.filter((v) => v.vendor_id !== selectedPhotographer?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.photography))
          : [];
        const videographerAlternatives = needsVideography
          ? finalVideographers.filter((v) => v.vendor_id !== selectedVideographer?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.videography || breakdown.photography))
          : [];
        const djAlternatives = needsDj
          ? finalDjs.filter((v) => v.vendor_id !== selectedDj?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.dj || breakdown.other_services))
          : [];
        const floristAlternatives = needsFlorist
          ? finalFlorists.filter((v) => v.vendor_id !== selectedFlorist?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.florist || breakdown.other_services))
          : [];
        const dressesAlternatives = needsDresses
          ? finalDressesVendors.filter((v) => v.vendor_id !== selectedDressesVendor?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.dresses || breakdown.other_services))
          : [];
        const bandAlternatives = needsBandService
          ? finalBandVendors.filter((v) => v.vendor_id !== selectedBandVendor?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.band || breakdown.other_services))
          : [];
        const priestAlternatives = needsPriestService
          ? finalReligiousVendors.filter((v) => v.vendor_id !== selectedReligiousVendor?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.priest || breakdown.other_services))
          : [];
        const tentAlternatives = (needsTentService || outdoorNeeded)
          ? finalTentVendors.filter((v) => v.vendor_id !== selectedTentVendor?.vendor_id).map((v) => annotateBudgetFit(v, breakdown.tent || breakdown.venue))
          : [];

        const availableVenuesOnDate = venues.filter((v) => v.availability_status === 'available');
        // If user clicked "Explore" on a specific upgrade vendor, pick that one directly
        const preferredVenueId = answers.preferredVenueId || null;
        const preferredVenue = preferredVenueId
          ? venues.find(v => String(v.vendor_id || '').trim() === String(preferredVenueId).trim())
          : null;
        const selectedVenue = needsVenue
          ? (preferredVenue
            || pickBestVendorForBudget(availableVenuesOnDate, breakdown.venue)
            || pickBestVendorForBudget(venues, breakdown.venue)
            || null)
          : null;
        // Clear preferred hint after use so it doesn't persist across future plan changes
        if (preferredVenueId) {
          delete answers.preferredVenueId;
          draft.answers = answers;
          await draft.save();
        }
        const venueAlternatives = needsVenue
          ? venues
              .filter((v) => v.vendor_id !== selectedVenue?.vendor_id)
              .map((v) => annotateBudgetFit(v, breakdown.venue))
          : [];

        // ──── ENHANCED ALTERNATIVES BLOCK ────
        const alternativesBlock = {
          locationNote: null,
          dateOptions: [],
          budgetOptions: [],
          radiusVendors: [],
          searchRadius: 30,
        };

        let smartAlternatives = {
          nearestVendors: [],
          alternativeDates: [],
          budgetUpgradeOptions: [],
          message: '',
        };

        let venueFixMessage = '';
        if (needsVenue && !selectedVenue) {
          const venueReason = (() => {
            if (!venues.length) {
              if (locationContext?.note) return locationContext.note;
              return `No function hall found in ${city} for this date and budget.`;
            }
            if (!availableVenuesOnDate.length) {
              return `Function halls are available in ${city}, but none are free on ${event_date}.`;
            }
            return `Function halls exist in ${city}, but they are above your current venue budget of ₹${Number(breakdown.venue || 0).toLocaleString('en-IN')}.`;
          })();

          venueFixMessage = `${venueReason} Please change the date, increase the venue budget, or change the location.`;
          alternativesBlock.locationNote = venueFixMessage;
          smartAlternatives.message = venueFixMessage;
        }

        let otherServiceVendors = [];
        if (needsVenue && !selectedVenue) {
          const nonVenueSuggestionsPool = [
            ...finalCaterers,
            ...finalDecorators,
            ...finalPhotographers,
            ...finalVideographers,
            ...finalDjs,
            ...finalFlorists,
            ...finalDressesVendors,
            ...finalBandVendors,
            ...finalReligiousVendors,
            ...finalTentVendors,
          ];
          const fallbackNonVenuePool = allVendorsForDiagnostics.filter((v) => {
            const cat = String(v?.category || '').toLowerCase();
            if (!v || !v.vendor_name) return false;
            if (cat.includes('function hall') || cat.includes('church') || cat.includes('parish')) return false;
            if (!vendorSupportsReligion(v, religion)) return false;

            const cityNorm = String(city || '').trim().toLowerCase();
            if (!cityNorm) return true;
            const vendorCity = String(v.city || '').toLowerCase();
            const vendorArea = String(v.area || '').toLowerCase();
            return vendorCity.includes(cityNorm) || vendorArea.includes(cityNorm);
          });
          const rawSuggestionPool = nonVenueSuggestionsPool.length > 0
            ? nonVenueSuggestionsPool
            : fallbackNonVenuePool;

          const categoryToServiceKey = {
            catering: 'catering',
            caterer: 'catering',
            decoration: 'decoration',
            decorator: 'decoration',
            photographer: 'photography',
            photography: 'photography',
            videographer: 'videography',
            videography: 'videography',
            dj: 'dj',
            florist: 'florist',
            flower: 'florist',
            makeup: 'dresses',
            dress: 'dresses',
            stylist: 'dresses',
            priest: 'priest',
            pandit: 'priest',
            maulvi: 'priest',
            pastor: 'priest',
            qazi: 'priest',
            band: 'band',
            nadaswaram: 'band',
            tent: 'tent',
            shamiana: 'tent',
          };

          const resolveServiceFromCategory = (category = '') => {
            const c = String(category || '').toLowerCase();
            const key = Object.keys(categoryToServiceKey).find((k) => c.includes(k));
            return key ? categoryToServiceKey[key] : 'other';
          };

          const seenSuggestion = new Set();
          otherServiceVendors = rawSuggestionPool
            .filter((v) => v && v.vendor_name)
            .map((v) => {
              const service = resolveServiceFromCategory(v.category);
              return {
                service,
                vendor_id: v.vendor_id,
                vendor_name: v.vendor_name,
                estimated_cost: Number(v.estimated_cost || v.base_price || 0),
                rating: Number(v.rating || 0),
                category: v.category,
                city: v.city,
              };
            })
            .filter((v) => v.service !== 'other')
            .filter((v) => {
              const key = String(v.vendor_id || v.vendor_name || '').toLowerCase();
              if (!key || seenSuggestion.has(key)) return false;
              seenSuggestion.add(key);
              return true;
            })
            .sort((a, b) => (b.rating - a.rating) || (a.estimated_cost - b.estimated_cost))
            .slice(0, 6);

          if (otherServiceVendors.length > 0) {
            alternativesBlock.otherServiceVendors = otherServiceVendors;
          }
        }

        // Radius search disabled — require manual city/area change instead of auto-expansion
        const needsRadiusSearch = false; // previously: needsVenue && venues.length === 0;

        if (needsRadiusSearch && !existingAnswers.nearbyVenuePending && !existingAnswers.allowNearbyVenueSearch && !answers.allowOtherServicesWithoutVenue) {
          // Ask user FIRST before expanding search radius
          const radiusResult = await findVendorsInRadius({
            city,
            eventType: event_type,
            date: event_date,
            budget: venueSearchBudget,
            guestCount: guests,
            religion,
            radiusKm: 30,
            allowBudgetExceedPercent: 0,
          }).catch(() => ({ vendors: [], searchRadius: 30, nearestCity: null, fallback: { reason_code: 'search_failed' } }));

          if (radiusResult.vendors.length > 0) {
            // Don't run the full plan yet — ask user if they want nearby vendors
            existingAnswers.nearbyVenuePending = true;
            existingAnswers.pendingRadiusKm = 30;
            existingAnswers.radiusResult = { count: radiusResult.vendors.length, nearestCity: radiusResult.nearestCity };
            draft.answers = existingAnswers;
            draft.step = draft.step; // Keep same step
            await draft.save();

            const normalizedCity = String(city || '').trim().toLowerCase();
            const normalizedNearestCity = String(radiusResult.nearestCity || '').trim().toLowerCase();
            const nearbyIsSameCity = normalizedCity && normalizedNearestCity && normalizedCity === normalizedNearestCity;

            const askMsg = venues.length === 0
              ? `We couldn't find exact venue matches in **${city}** for your current filters (date, guest count, budget, or preferences).\n\nWould you like to change the city/area?`
              : `We found only ${venues.length} venue(s) in **${city}**.\n\nWould you like to change the city/area?`;

            await ChatConversation.findOneAndUpdate(
              { userId: uid },
              { $push: { messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: askMsg, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES } } },
              { upsert: true, new: true }
            );

            return {
              success: true,
              message: askMsg,
              usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
            };
          }
          if (radiusResult.fallback?.reason_code === 'location_unresolved') {
            const locationClarify = responseLanguage === 'hi'
              ? `Aapka location clear nahi ho pa raha. Please city + area ya nearest landmark bhejiye.`
              : responseLanguage === 'te'
                ? `Mee location clear ga resolve cheyyalekapoyam. City + area leda daggara landmark pampandi.`
                : `I could not resolve your location clearly. Please share city + area or a nearby landmark.`;
            await ChatConversation.findOneAndUpdate(
              { userId: uid },
              { $push: { messages: { $each: [{ role: 'user', content: text }, { role: 'assistant', content: locationClarify, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null }], $slice: -MAX_CHAT_MESSAGES } } },
              { upsert: true, new: true }
            );
            return {
              success: true,
              message: locationClarify,
              usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
            };
          }
        }

        // If user approved nearby search, get the actual vendors
        if (existingAnswers.allowNearbyVenueSearch || nearbyVenueApproval) {
          const activeRadius = Number(existingAnswers.searchRadiusKm || 30);
          const radiusResult = await findVendorsInRadius({
            city, eventType: event_type, date: event_date,
            budget: venueSearchBudget, guestCount: guests, religion, radiusKm: activeRadius,
          }).catch(() => ({ vendors: [], searchRadius: 30, nearestCity: null, fallback: { reason_code: 'search_failed' } }));

          if (radiusResult.vendors.length > 0) {
            alternativesBlock.locationNote = `Showing vendors within ${radiusResult.searchRadius}km of ${city} who can travel to your event.`;
            alternativesBlock.radiusVendors = radiusResult.vendors;
            alternativesBlock.searchRadius = radiusResult.searchRadius;
            // Merge radius venues into venues list for plan generation
            venues.push(...radiusResult.vendors.filter(v => !venues.find(vv => vv.vendor_id === v.vendor_id)));
          } else {
            // No nearby vendors found — instruct the user to change location manually
            existingAnswers.nearbyVenuePending = false;
            existingAnswers.allowNearbyVenueSearch = false;
            draft.answers = existingAnswers;
            draft.step = 8;
            draft.completed = false;
            await draft.save();

            const manualChangeMsg = responseLanguage === 'hi'
              ? `Humein ${city} mein vendors nahi mile. Kripya location badal kar koi alag area/city type karein.`
              : responseLanguage === 'te'
                ? `${city} lo vendors dorakaledu. Dayachesi location marchi vere area/city type cheyandi.`
                : `No vendors found for ${city}. Please change the location or type a different area/city manually.`;

            await ChatConversation.findOneAndUpdate(
              { userId: uid },
              {
                $push: {
                  messages: {
                    $each: [
                      { role: 'user', content: text },
                      { role: 'assistant', content: manualChangeMsg, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
                    ],
                    $slice: -MAX_CHAT_MESSAGES,
                  },
                },
              },
              { upsert: true, new: true }
            );

            return {
              success: true,
              message: manualChangeMsg,
              usage: { prompt_tokens: 90, completion_tokens: 80, total_tokens: 170 },
            };
          }
        }

        // 2. DATE ALTERNATIVES — if most venues on requested date are booked
        const bookedOnDate = venues.filter(v => v.availability_status === 'booked');
        if (bookedOnDate.length > 0 && bookedOnDate.length >= venues.length * 0.6) {
          for (let offset = 1; offset <= 14; offset++) {
            for (const sign of [1, -1]) {
              const altDate = toDateOffset(event_date, offset * sign);
              if (!altDate) continue;
              const dayVenues = await findVenues({ ...commonArgs, eventType: event_type, eventDate: altDate, budget: venueSearchBudget, limit: 3 }).catch(() => []);
              const freeOnAlt = dayVenues.filter(v => v.availability_status !== 'booked');
              if (freeOnAlt.length >= 2) {
                alternativesBlock.dateOptions.push({ date: altDate, availableCount: freeOnAlt.length, vendors: freeOnAlt.slice(0, 2) });
                if (alternativesBlock.dateOptions.length >= 2) break;
              }
            }
            if (alternativesBlock.dateOptions.length >= 2) break;
          }
        }

        // 3. BUDGET UPGRADE — if budget too tight, ask user
        const overBudgetVenues = venues.filter(v => v.base_price && v.base_price > breakdown.venue);
        if (overBudgetVenues.length > 0 && venues.filter(v => v.base_price <= breakdown.venue).length < 2) {
          const premiumBudget = Math.round(breakdown.venue * 1.15);
          const premiumVenues = await findVenues({ ...commonArgs, eventType: event_type, budget: premiumBudget, limit: 3 }).catch(() => []);
          const newWithUpgrade = premiumVenues.filter(pv => !venues.find(v => v.vendor_id === pv.vendor_id));
          if (newWithUpgrade.length > 0) {
            const extraAmt = Math.round((premiumBudget - breakdown.venue)).toLocaleString('en-IN');
            alternativesBlock.budgetOptions = newWithUpgrade.slice(0, 2).map(v => ({
              vendor: v,
              extraRequired: premiumBudget - breakdown.venue,
              message: `₹${extraAmt} more unlocks ${v.vendor_name} — ⭐${Number(v.rating||0).toFixed(1)} · ${v.city}`,
            }));
          }
        }

        // Legacy alternatives object preserved for existing summary/context consumers.
        const alternatives = {
          location_fallback_note: alternativesBlock.locationNote || locationContext.note || '',
          option_a: alternativesBlock.dateOptions.length
            ? `Date ${event_date} is fully booked. Here are vendors available on ${alternativesBlock.dateOptions[0].date} and ${alternativesBlock.dateOptions[1]?.date || alternativesBlock.dateOptions[0].date} within your budget.`
            : '',
          option_b: alternativesBlock.budgetOptions.length
            ? alternativesBlock.budgetOptions[0].message
            : '',
          option_c: alternativesBlock.radiusVendors.length && normalizeCityArea(city)
            ? `Here are vendors in nearby cities available on your date within your budget.`
            : '',
          option_a_dates: alternativesBlock.dateOptions.map((opt) => opt.date).slice(0, 2),
        };

        if (needsVenue && venues.length === 0) {
          const nearestVendors = await findNearestAvailableVendors({
            city,
            eventType: event_type,
            date: event_date,
            budget: venueSearchBudget,
            guestCount: guests,
            religion,
          }).catch(() => []);

          const referenceVendorId = selectedVenue?.vendor_id || nearestVendors[0]?.vendor?.vendor_id;
          const alternativeDates = referenceVendorId
            ? await findAlternativeDates({ vendorId: referenceVendorId, preferredDate: event_date, rangedays: 14 }).catch(() => [])
            : [];

          const budgetUpgradeOptions = await findBudgetUpgradeOptions({
            eventType: event_type,
            city,
            date: event_date,
            currentBudget: venueSearchBudget,
            upgradePercent: 0.20,
          }).catch(() => []);

          const familyContributors = parseFamilyContributors(answers);
          const message = generateAlternativeMessage({
            requestedCity: city,
            requestedDate: event_date,
            requestedBudget: breakdown.venue,
            alternatives: {
              nearestVendors,
              alternativeDates,
              budgetUpgradeOptions,
              familyContributors,
            },
          });

          smartAlternatives = {
            nearestVendors,
            alternativeDates,
            budgetUpgradeOptions,
            message,
          };
        }

        const familyFriendlyBudgetTips = buildFamilyBudgetTips(answers);

        const aiContext = {
          requested_city: city,
          requested_date: event_date,
          requested_budget: budget,
          selected_services: selectedServices,
          venue_preference: answers.venuePreference || null,
          allow_other_services_without_venue: Boolean(answers.allowOtherServicesWithoutVenue),
          slot_confidence: slotConfidence,
          location_fallback_note: alternatives.location_fallback_note,
          alternatives: {
            option_a: alternatives.option_a,
            option_b: alternatives.option_b,
            option_c: alternatives.option_c,
          },
          smart_alternatives: smartAlternatives,
          family_friendly_budget_tips: familyFriendlyBudgetTips,
        };

        const venueLockActive = needsVenue && !selectedVenue && !answers.allowOtherServicesWithoutVenue;
        const outputSelectedServices = venueLockActive ? ['venue'] : selectedServices;
        const labels = getServiceLabelsByReligion(religion);

        const serviceOptionCounts = {
          venue: needsVenue ? venues.length : 0,
          catering: needsCatering ? finalCaterers.length : 0,
          decoration: needsDecoration ? finalDecorators.length : 0,
          photography: needsPhotography ? finalPhotographers.length : 0,
          videography: needsVideography ? finalVideographers.length : 0,
          dj: needsDj ? finalDjs.length : 0,
          florist: needsFlorist ? finalFlorists.length : 0,
          dresses: needsDresses ? finalDressesVendors.length : 0,
          band: needsBandService ? finalBandVendors.length : 0,
          priest: needsPriestService ? finalReligiousVendors.length : 0,
          tent: (needsTentService || outdoorNeeded) ? finalTentVendors.length : 0,
        };

        const serviceToCategories = {
          venue: ['Function Hall'],
          catering: ['Catering'],
          decoration: ['Decoration'],
          photography: ['Photographer'],
          videography: ['Videographer'],
          dj: ['DJ'],
          florist: ['Florist'],
          dresses: ['Makeup Artist'],
          band: ['Band / Nadaswaram'],
          priest: religiousCat ? [religiousCat] : ['Priest / Pandit', 'Maulvi / Qazi', 'Pastor / Father'],
          tent: ['Tent / Shamiana'],
        };

        function inventoryCountsForService(serviceKey) {
          const categories = serviceToCategories[serviceKey] || [];
          const cityNorm = String(city || '').trim().toLowerCase();
          const inCategory = allVendorsForDiagnostics.filter((v) => categories.includes(String(v.category || '').trim()));
          const cityMatches = inCategory.filter((v) => String(v.city || '').trim().toLowerCase() === cityNorm);
          return {
            cityInventory: cityMatches.length,
            totalInventory: inCategory.length,
          };
        }

        const categoryDiagnostics = outputSelectedServices.map((svcRaw) => {
          const svc = String(svcRaw || '').toLowerCase().trim();
          const optionCount = Number(serviceOptionCounts[svc] || 0);
          const { cityInventory, totalInventory } = inventoryCountsForService(svc);
          const isLow = optionCount <= 2;
          if (!isLow) return null;

          let reason;
          if (totalInventory <= 2) {
            reason = `Data scarcity: only ${totalInventory} vendor record(s) available for this category in the dataset.`;
          } else if (cityInventory === 0) {
            reason = `Data scarcity in ${city}: no local listings, so results come from nearby/statewide matches.`;
          } else {
            reason = `Filter-limited: current constraints (economy tier, budget split, date/time, religion/diet) reduced options to ${optionCount}.`;
          }

          return {
            service: labels[svc] || svc,
            key: svc,
            isLow,
            optionCount,
            cityInventory,
            totalInventory,
            reason,
          };
        }).filter(Boolean);

        // Step E: Build the structured EventPlan object
        console.log('📋 Creating eventPlan object...');
        eventPlan = {
          event_summary: `${event_type} in ${city} for ${guests} guests on ${event_date}`,
          selected_services: outputSelectedServices,
          requirements,
          budget_breakdown: breakdown,
          warnings: [...warnings],
          tips: generateTips(religion, event_type, guests, budget),
          venue: selectedVenue ? annotateBudgetFit(selectedVenue, breakdown.venue) : null,
          venue_alternatives: venueAlternatives,
          catering: venueLockActive ? null : (selectedCaterer ? annotateBudgetFit(selectedCaterer, breakdown.catering) : null),
          catering_alternatives: venueLockActive ? [] : cateringAlternatives,
          decoration: venueLockActive ? null : (selectedDecorator ? annotateBudgetFit(selectedDecorator, breakdown.decoration) : null),
          decoration_alternatives: venueLockActive ? [] : decorationAlternatives,
          photographer: venueLockActive ? null : (selectedPhotographer ? annotateBudgetFit(selectedPhotographer, breakdown.photography) : null),
          photographer_alternatives: venueLockActive ? [] : photographerAlternatives,
          videographer: venueLockActive ? null : (selectedVideographer ? annotateBudgetFit(selectedVideographer, breakdown.videography || breakdown.photography) : null),
          videographer_alternatives: venueLockActive ? [] : videographerAlternatives,
          dj: venueLockActive ? null : (selectedDj ? annotateBudgetFit(selectedDj, breakdown.dj || breakdown.other_services) : null),
          dj_alternatives: venueLockActive ? [] : djAlternatives,
          florist: venueLockActive ? null : (selectedFlorist ? annotateBudgetFit(selectedFlorist, breakdown.florist || breakdown.other_services) : null),
          florist_alternatives: venueLockActive ? [] : floristAlternatives,
          dresses_vendor: venueLockActive ? null : (selectedDressesVendor ? annotateBudgetFit(selectedDressesVendor, breakdown.dresses || breakdown.other_services) : null),
          dresses_alternatives: venueLockActive ? [] : dressesAlternatives,
          band: needsBandService ? (venueLockActive ? null : (selectedBandVendor ? annotateBudgetFit(selectedBandVendor, breakdown.band || breakdown.other_services) : null)) : undefined,
          band_alternatives: needsBandService ? (venueLockActive ? [] : bandAlternatives) : [],
          religious_vendor: needsPriestService ? (venueLockActive ? null : (selectedReligiousVendor ? annotateBudgetFit(selectedReligiousVendor, breakdown.priest || breakdown.other_services) : null)) : undefined,
          priest_alternatives: needsPriestService ? (venueLockActive ? [] : priestAlternatives) : [],
          tent: (needsTentService || outdoorNeeded) ? (venueLockActive ? null : (selectedTentVendor ? annotateBudgetFit(selectedTentVendor, breakdown.tent || breakdown.venue) : null)) : undefined,
          tent_alternatives: (needsTentService || outdoorNeeded) ? (venueLockActive ? [] : tentAlternatives) : [],
          alternatives,
          alternatives_block: alternativesBlock,
          category_diagnostics: categoryDiagnostics,
          family_friendly_budget_tips: familyFriendlyBudgetTips,
          smart_alternatives: smartAlternatives,
          smart_alternatives_message: smartAlternatives.message,
          ai_context: aiContext,
        };
        if (needsVenue && !selectedVenue && venueFixMessage) {
          eventPlan.warnings.push(`⚠️ Venue pending: ${venueFixMessage}`);
        }
        console.log('✅ eventPlan object created with', Object.keys(eventPlan).length, 'properties');

        // Calculate total estimated cost
        const vendorList = [
          eventPlan.venue,
          eventPlan.catering,
          eventPlan.decoration,
          eventPlan.photographer,
          eventPlan.videographer,
          eventPlan.dj,
          eventPlan.florist,
          eventPlan.dresses_vendor,
          eventPlan.band,
          eventPlan.religious_vendor,
          eventPlan.tent,
        ].filter(Boolean);

        const totalAllocatedForSelected = outputSelectedServices.reduce((sum, service) => {
          const normalizedService = String(service || '').toLowerCase().trim();
          const breakdownKey = {
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

          return sum + (breakdown[breakdownKey] || 0);
        }, 0);

        const totalVendorCosts = vendorList.reduce((sum, v) => sum + (v.estimated_cost || 0), 0);

        eventPlan.total_allocated_budget = totalAllocatedForSelected;
        eventPlan.total_estimated_cost = totalVendorCosts;
        eventPlan.savings = Math.max(0, totalAllocatedForSelected - totalVendorCosts);

        const servicesWithoutVendors = venueLockActive
          ? ['venue']
          : outputSelectedServices.filter((svc) => {
          const serviceToVendorMap = {
            venue: 'venue',
            catering: 'catering',
            decoration: 'decoration',
            photography: 'photographer',
            videography: 'videographer',
            dj: 'dj',
            florist: 'florist',
            dresses: 'dresses_vendor',
            band: 'band',
            priest: 'religious_vendor',
            tent: 'tent',
          };
          const vendorProp = serviceToVendorMap[String(svc || '').toLowerCase().trim()];
          return vendorProp && !eventPlan[vendorProp];
        });

        eventPlan.missing_services = servicesWithoutVendors;
        eventPlan.unallocated_budget = servicesWithoutVendors.reduce((sum, svc) => {
          const map = {
            venue: 'venue',
            catering: 'catering',
            decoration: 'decoration',
            photography: 'photography',
            videography: 'videography',
            dj: 'dj',
            florist: 'florist',
            dresses: 'dresses',
            band: 'band',
            priest: 'priest',
            tent: 'tent',
          };
          return sum + (breakdown[map[svc]] || 0);
        }, 0);

        const suppressVenueOnlyMissingWarning = Boolean(answers.allowOtherServicesWithoutVenue)
          && servicesWithoutVendors.length === 1
          && String(servicesWithoutVendors[0] || '').toLowerCase() === 'venue';

        if (servicesWithoutVendors.length > 0 && !suppressVenueOnlyMissingWarning) {
          eventPlan.warnings.push(
            `⚠️ No vendors found for: ${servicesWithoutVendors.join(', ')}. `
            + `Budget was allocated (₹${totalAllocatedForSelected.toLocaleString('en-IN')}) but needs to be spent. `
            + 'Try: increasing budget, relaxing filters, or changing location.'
          );
        }

        // Add availability warnings
        vendorList.forEach((v) => {
          if (v.availability_status === 'check_required') {
            eventPlan.warnings.push(`${v.vendor_name} — availability not confirmed for ${event_date}. Call to verify.`);
          }
        });

        deduplicateVendorsAcrossServices(eventPlan);
        const planText = buildPlanSummaryText(eventPlan);

        draft.step = 8;
        draft.answers = answers;
        draft.completed = true;
        await draft.save();

        await EventPlan.create({
          userId: uid,
          eventDraftSnapshot: answers,
          vendorShortlist: vendorList.map((v) => ({
            vendor_id: v.vendor_id,
            vendor_name: v.vendor_name,
            category: v.category,
          })),
          planText,
          eventPlan,
        });

        // Get conversation history for context
        const recentHistoryForAI = recentHistory.slice(-8);
        assistantMessage = await polishPlanWithAI(planText, answers, recentHistoryForAI, responseLanguage);
        responsePayload = {
          success: true,
          message: assistantMessage,
          event_plan: eventPlan,
          usage: { prompt_tokens: 200, completion_tokens: 400, total_tokens: 600 },
        };
        console.log('✅ ResponsePayload created with event_plan keys:', Object.keys(eventPlan).length);
      }

      await ChatConversation.findOneAndUpdate(
        { userId: uid },
        {
          $push: {
            messages: {
              $each: [
                { role: 'user', content: text },
                    { role: 'assistant', content: assistantMessage, event_plan: typeof eventPlan !== 'undefined' ? eventPlan : null, usage: typeof usage !== 'undefined' ? usage : null },
              ],
              $slice: -MAX_CHAT_MESSAGES,
            },
          },
        },
        { upsert: true, new: true }
      );

      if (responsePayload) {
        console.log('✅ Returning responsePayload with event_plan');
        return responsePayload;
      }

      return {
        success: true,
        message: assistantMessage,
        usage: { prompt_tokens: 120, completion_tokens: 240, total_tokens: 360 },
      };
    } catch (error) {
      console.error('❌ Chat agent error:', error);
      console.error('Error stack:', error.stack);
      return {
        success: false,
        message: 'Sorry, I encountered an error. Please try again.',
        error: error.message,
      };
    }
  }

  async clearConversation(userId) {
    const uid = new mongoose.Types.ObjectId(userId);
    await ChatConversation.deleteOne({ userId: uid });
    await EventDraft.deleteMany({ userId: uid });
    await Booking.updateMany({ userId: uid }, { $set: { threadMessages: [] } });
  }

  async getConversationHistory(userId) {
    const uid = new mongoose.Types.ObjectId(userId);
    const doc = await ChatConversation.findOne({ userId: uid }).lean();
    return doc?.messages || [];
  }
}

export default new ChatAgent();