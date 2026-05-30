/**
 * Venue Search API (DB-only, no geocoding or radius expansion)
 * Route: POST /api/venues/search
 */

import express from 'express';
import { haversineKm } from '../utils/geo.js';
import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = express.Router();

/**
 * POST /api/venues/search
 * 
 * Request:
 * {
 *   "area": "Jubilee Hills",
 *   "city": "Hyderabad",
 *   "budget": 200000,
 *   "quality": "standard",
 *   "guestCount": 300,
 *   "eventType": "wedding",
 *   "maxRadius": 50
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "venues": [...],
 *     "searchRadius": 25,
 *     "radiusExpansionSteps": [...],
 *     "sourceMix": { "database": 8, "googleMaps": 2 }
 *   }
 * }
 */
router.post('/search', asyncHandler(async (req, res) => {
  const {
    area,
    city,
    budget = 200000,
    quality = 'standard',
    guestCount = 300,
    eventType = 'wedding',
    maxRadius = 50,
  } = req.body;

  if (!area && !city && !(req.body && Number.isFinite(Number(req.body.lat)) && Number.isFinite(Number(req.body.lng)))) {
    return res.status(400).json({
      success: false,
      error: 'Please provide area, city or lat/lng coordinates',
    });
  }

  try {
    // Load vendors from database
    const allVendors = await getVendorsDataset();

    // Determine which vendors to search:
    // - If includeAllVendors === true -> search all vendors
    // - Else if category provided -> filter by that category
    // - Else (default) -> search for function halls/venues
    const includeAll = req.body && req.body.includeAllVendors === true;
    const requestedCategory = req.body && typeof req.body.category === 'string' ? req.body.category.trim().toLowerCase() : null;

    let functionHalls;
    if (includeAll) {
      functionHalls = allVendors;
      console.log(`[API] includeAllVendors requested — using all ${allVendors.length} vendors from DB`);
    } else if (requestedCategory) {
      functionHalls = allVendors.filter(v => String(v.category || '').toLowerCase().includes(requestedCategory));
      console.log(`[API] Filtering DB vendors by category '${requestedCategory}' — ${functionHalls.length} matched`);
    } else {
      functionHalls = allVendors.filter(v => {
        const category = String(v.category || '').toLowerCase();
        return category.includes('function hall') || 
               category.includes('venue') || 
               category.includes('banquet') ||
               category.includes('hall') ||
               category.includes('marriage');
      });
      console.log(`[API] Total function halls in DB: ${functionHalls.length}`);
    }

    // Perform DB-only search. Two modes:
    // 1) If lat/lng provided -> filter by distance within maxRadiusKm (no expansion)
    // 2) Else -> match by area/city substring against vendor area/city fields
    const maxRadiusKm = (req.body && Number.isFinite(Number(req.body.maxRadius))) ? Number(req.body.maxRadius) : 25;

    let matched = [];
    if (req.body && Number.isFinite(Number(req.body.lat)) && Number.isFinite(Number(req.body.lng))) {
      const center = { lat: Number(req.body.lat), lon: Number(req.body.lng) };
      matched = functionHalls.map(v => ({ ...v, distance: haversineKm(center, { lat: Number(v.lat), lon: Number(v.lon) }) })).filter(v => Number.isFinite(v.distance) && v.distance <= maxRadiusKm);
    } else {
      const needle = (area || city || '').toString().toLowerCase();
      matched = functionHalls.filter(v => {
        const a = String(v.area || v.address || '').toLowerCase();
        const c = String(v.city || '').toLowerCase();
        return a.includes(needle) || c.includes(needle);
      });
    }

    // Enrich results with capacity and rating information
    const enrichedVenues = matched.map(venue => ({
      id: venue.id || venue._id,
      name: venue.name,
      category: venue.category,
      price: venue.price || venue.estimated_price,
      capacity: venue.capacity,
      rating: venue.rating,
      address: venue.address || `${venue.area}, ${venue.city}`,
      distance: venue.distance ? Math.round(venue.distance * 10) / 10 : null,
      distanceLabel: venue.distance ? formatDistance(venue.distance) : null,
      quality: venue.class_type,
      phone: venue.phone,
      website: venue.website,
      amenities: venue.amenities,
      source: venue.source || 'database',
      capacityMatch: guestCount ? getCapacityMatch(venue.capacity, guestCount) : null,
    }));

    // Sort by relevance
    const sorted = enrichedVenues
      .map(v => ({
        ...v,
        relevance: calculateVenueRelevance(v, {
          budget,
          quality,
          guestCount,
        }),
      }))
      .sort((a, b) => b.relevance - a.relevance);

    if (!sorted.length) {
      return res.json({
        success: true,
        data: {
          venues: [],
          totalFound: 0,
          message: 'No vendors found for this location. Please change the location or type a different area/city manually.',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        venues: sorted.slice(0, 15),
        totalFound: sorted.length,
      },
    });

  } catch (error) {
    console.error('[API] Venue search error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Venue search failed',
    });
  }
}));

// /expand-radius endpoint removed per request: no radius expansion or geocoding

/**
 * Helper Functions
 */

function formatDistance(km) {
  if (km <= 2) return 'In city';
  if (km <= 10) return `${Math.round(km)} km away`;
  if (km <= 50) return `${Math.round(km)} km away`;
  return `${Math.round(km)} km away`;
}

function getCapacityMatch(venueCapacity, guestCount) {
  if (!venueCapacity || !guestCount) return null;
  
  const capacity = parseInt(venueCapacity);
  const guests = parseInt(guestCount);
  
  if (capacity >= guests * 1.2) return 'spacious';
  if (capacity >= guests) return 'perfect fit';
  if (capacity >= guests * 0.9) return 'tight but workable';
  if (capacity >= guests * 0.8) return 'might be tight';
  return 'too small';
}

function calculateVenueRelevance(venue, criteria) {
  let score = 100;

  // Distance (prefer closer)
  if (venue.distance) {
    if (venue.distance <= 5) score += 30;
    else if (venue.distance <= 15) score += 20;
    else if (venue.distance <= 30) score += 10;
    else if (venue.distance <= 50) score += 5;
    else score -= 10;
  }

  // Quality match
  if (criteria.quality && venue.quality) {
    const qualityMap = {
      'economy': ['budget', 'economy'],
      'standard': ['mid', 'standard'],
      'premium': ['premium', 'luxury'],
    };
    if (qualityMap[criteria.quality]?.includes(venue.quality.toLowerCase())) {
      score += 20;
    }
  }

  // Price alignment
  if (venue.price && criteria.budget) {
    const ratio = venue.price / criteria.budget;
    if (ratio >= 0.6 && ratio <= 0.95) score += 25;
    else if (ratio < 0.5) score += 5; // Maybe suspiciously cheap
    else if (ratio > 1.2) score -= 20; // Too expensive
  }

  // Capacity match
  if (venue.capacityMatch) {
    const match = venue.capacityMatch;
    if (match === 'perfect fit' || match === 'spacious') score += 20;
    else if (match === 'tight but workable') score += 10;
    else if (match === 'might be tight') score += 5;
    // Don't penalize "too small" harshly, user can still consider
  }

  // Rating boost
  if (venue.rating) {
    if (venue.rating >= 4.7) score += 15;
    else if (venue.rating >= 4.3) score += 10;
    else if (venue.rating >= 4.0) score += 5;
  }

  // Source preference (database vendors over Google Maps for now, as they're verified)
  if (venue.source === 'database') score += 5;

  return Math.max(0, Math.min(150, score));
}

// generateSearchSummary removed — summary is now returned directly from the route

export default router;
