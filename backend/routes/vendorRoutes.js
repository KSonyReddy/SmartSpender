import express from 'express';
import multer from 'multer';
import { requireAuth, requireRole, asyncHandler } from '../middleware/sessionAuth.js';
import {
	getInsights,
	getDataset,
	getVendorProfile,
	updateVendorProfile,
} from '../controllers/vendorController.js';
import { VendorProfile } from '../models/VendorProfile.js';
import { listVendorOptions } from '../controllers/vendorDatasetController.js';
import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import { haversineKm, distanceLabel, isValidCoordinate } from '../utils/geo.js';
import { normalizeVendorBasePrice } from '../utils/vendorPricing.js';

const router = express.Router();

const portfolioUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 5 * 1024 * 1024, files: 10 },
	fileFilter: (req, file, cb) => {
		if (/^image\//.test(file.mimetype)) cb(null, true);
		else cb(new Error('Images only'));
	},
});

function toNum(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function vendorCoordinates(vendor) {
	const lat = Number(vendor?.latitude ?? vendor?.lat);
	const lon = Number(vendor?.longitude ?? vendor?.lon ?? vendor?.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat, lon };
}

function buildMenuFromProfile(profile = {}) {
	const perPlateBase = normalizeVendorBasePrice(profile.basePrice || 0, profile.category || profile.businessType || '');
	const description = String(profile.description || '').trim();
	const totalItems = Number(profile.menuCard?.total_items || 0) || 0;
	const packageTemplate = {
		per_plate: perPlateBase,
		description,
		items: [],
	};

	return {
		vendor_name: profile.businessName || '',
		vendor_city: profile.city || '',
		category: profile.category || profile.businessType || '',
		per_plate_base: perPlateBase,
		total_items: totalItems,
		packages: {
			economy: { ...packageTemplate },
			standard: { ...packageTemplate },
			premium: { ...packageTemplate },
		},
		description,
		city: profile.city || '',
		area: profile.area || '',
	};
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

function normalizeDatasetMenu(menu = {}, profile = {}) {
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
		profile.basePrice,
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

	return {
		vendor_name: menu.vendor_name || profile.businessName || profile.vendorName || '',
		vendor_city: menu.vendor_city || menu.city || profile.city || '',
		category: menu.category || profile.category || profile.businessType || '',
		per_plate_base: baseCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0,
		total_items: totalItemsCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0,
		packages,
		description: String(menu.description || profile.description || '').trim(),
		city: menu.city || profile.city || '',
		area: menu.area || profile.area || '',
	};
}

function fallbackMeta(reasonCode, message, nextActions = []) {
	return { reason_code: reasonCode, message, next_actions: nextActions };
}

// Public endpoint for signup vendor dropdown
router.get('/vendors', asyncHandler(listVendorOptions));

router.get('/:id/portfolio', requireAuth, asyncHandler(async (req, res) => {
	const vendor = await VendorProfile.findOne({
		$or: [{ vendorDatasetId: req.params.id }, { _id: req.params.id }],
	}).select('portfolioImages portfolioCaption businessName description category city area menuCard');
	if (!vendor) return res.json({ success: true, data: { portfolioImages: [], businessName: '' } });
	res.json({
		success: true,
		data: {
			portfolioImages: vendor.portfolioImages || [],
			portfolioCaption: vendor.portfolioCaption || [],
			businessName: vendor.businessName,
			description: vendor.description || '',
			category: vendor.category || '',
			city: vendor.city || '',
			area: vendor.area || '',
			menuCard: vendor.menuCard || null,
		},
	});
}));

// Public vendor search endpoint — used by chat map + radius agent
router.get('/search', asyncHandler(async (req, res) => {
	const { city, category, eventType, religion, radius, limit = 20, lat, lon, place, vendorName, vendorId } = req.query;
	const { vendors } = await getVendorsDataset();

	let results = vendors;
	const maxRadiusKm = Math.max(1, parseInt(radius, 10) || 30);
	const maxRows = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
	const queryLat = toNum(lat);
	const queryLon = toNum(lon);
	let userCoords = (queryLat != null && queryLon != null)
		? { lat: queryLat, lon: queryLon }
		: null;
	if (userCoords && !isValidCoordinate(userCoords.lat, userCoords.lon)) userCoords = null;

	if (!userCoords && place) {
		// Geocoding disabled: do not resolve `place` to coordinates here.
		userCoords = null;
	}

	if (city) {
		const c = String(city).toLowerCase();
		results = results.filter(v => String(v.city || '').toLowerCase().includes(c));
	}

	if (vendorId) {
		const id = String(vendorId).trim().toLowerCase();
		results = results.filter(v => String(v.vendor_id || '').trim().toLowerCase() === id);
	}

	if (vendorName) {
		const q = String(vendorName).trim().toLowerCase();
		results = results
			.filter(v => String(v.vendor_name || '').toLowerCase().includes(q))
			.sort((a, b) => {
				const aName = String(a.vendor_name || '').toLowerCase();
				const bName = String(b.vendor_name || '').toLowerCase();
				const aExact = aName === q ? 1 : 0;
				const bExact = bName === q ? 1 : 0;
				if (aExact !== bExact) return bExact - aExact;
				const aStarts = aName.startsWith(q) ? 1 : 0;
				const bStarts = bName.startsWith(q) ? 1 : 0;
				if (aStarts !== bStarts) return bStarts - aStarts;
				return aName.length - bName.length;
			});
	}

	if (category) {
		const cat = String(category).toLowerCase();
		results = results.filter(v => String(v.category || '').toLowerCase().includes(cat));
	}

	if (religion && religion !== 'All' && religion !== 'all') {
		const wanted = String(religion || '').trim().toLowerCase();
		results = results.filter(v => {
			const servedRaw = String(
				v.religion_served
				|| v.suitable_for_religions
				|| v.religion
				|| v.religionType
				|| 'all'
			).toLowerCase();

			if (!servedRaw || servedRaw === 'all' || servedRaw.includes('all religion')) return true;
			if (servedRaw.includes(wanted)) return true;

			// Handle common label variants in dataset.
			if (wanted === 'muslim' && (servedRaw.includes('islam') || servedRaw.includes('muslim_name'))) return true;
			if (wanted === 'christian' && servedRaw.includes('christ')) return true;
			if (wanted === 'hindu' && servedRaw.includes('hindu')) return true;
			if (wanted === 'jain' && servedRaw.includes('jain')) return true;

			return false;
		});
	}

	if (eventType) {
		results = results.filter(v => {
			const sup = v.supported_events;
			if (!sup || sup === 'all') return true;
			return String(sup).toLowerCase().includes(String(eventType).toLowerCase());
		});
	}

	if (userCoords) {
		results = results
			.map((v) => {
				const coords = vendorCoordinates(v);
				if (!coords) return null;
				const rawDistance = haversineKm(userCoords, coords);
				if (!Number.isFinite(rawDistance)) return null;
				const distance = Math.round(rawDistance);
				if (distance > maxRadiusKm) return null;
				return { ...v, distance_km: distance, distance_label: distanceLabel(distance) };
			})
			.filter(Boolean);
	}
	const fallback = (() => {
		if (!place && !userCoords) {
			return fallbackMeta('location_missing', 'Provide a place or coordinates to enable distance-based search.', ['provide_place', 'share_coordinates']);
		}
		if (place && !userCoords) {
			return fallbackMeta('location_unresolved', `Could not resolve coordinates for "${place}".`, ['confirm_location', 'share_landmark']);
		}
		if (userCoords && results.length === 0) {
			return fallbackMeta('no_vendor_within_radius', `No vendors found within ${maxRadiusKm} km.`, ['expand_radius', 'change_city']);
		}
		return null;
	})();

	results = results
		.slice()
		.sort((a, b) => {
			const ad = Number.isFinite(Number(a.distance_km)) ? Number(a.distance_km) : Number.POSITIVE_INFINITY;
			const bd = Number.isFinite(Number(b.distance_km)) ? Number(b.distance_km) : Number.POSITIVE_INFINITY;
			if (ad !== bd) return ad - bd;
			return (Number(b.rating) || 0) - (Number(a.rating) || 0);
		});

	const responseVendors = results
		.slice(0, maxRows)
		.map(v => ({
			vendor_id:       v.vendor_id,
			vendor_name:     v.vendor_name,
			category:        v.category,
			city:            v.city,
			area:            v.area,
			rating:          v.rating,
			base_price:      v.base_price,
			estimated_cost:  v.estimated_cost || v.base_price,
			vendor_phone:    v.vendor_phone || v.phone || '',
			email:           v.email || v.contact_email || '',
			services:        v.services || v.specialties || v.specialization || v.category || '',
			travel_available: Boolean(v.travel_available),
			religion_served: v.religion_served,
			max_guests:      v.max_guests,
			distance_km:     v.distance_km ?? null,
			distance_label:  v.distance_label || '',
		}));

	res.json({
		success: true,
		data: {
			vendors: responseVendors,
			total: results.length,
			search: {
				radius_km: userCoords ? maxRadiusKm : null,
				location_used: userCoords ? (place || 'coordinates') : null,
				fallback,
			},
		},
	});
}));

router.use(requireAuth, requireRole('vendor'));

router.get('/insights', asyncHandler(getInsights));
router.get('/dataset', asyncHandler(getDataset));
router.get('/profile', asyncHandler(getVendorProfile));
router.put('/profile', asyncHandler(updateVendorProfile));

router.post(
	'/portfolio',
	requireAuth,
	requireRole('vendor'),
	portfolioUpload.array('images', 10),
	asyncHandler(async (req, res) => {
		const vendorProfileId = req.session?.vendorProfileId;
		const vendor = await VendorProfile.findById(vendorProfileId);
		if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

		const newImages = (req.files || []).map((f) => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);
		const captions = Array.isArray(req.body.captions)
			? req.body.captions
			: (req.body.captions ? [req.body.captions] : []);

		vendor.portfolioImages = [...(vendor.portfolioImages || []), ...newImages].slice(0, 20);
		vendor.portfolioCaption = [...(vendor.portfolioCaption || []), ...captions].slice(0, 20);
		await vendor.save();

		res.json({ success: true, data: { portfolioImages: vendor.portfolioImages } });
	})
);

router.delete('/portfolio/:index', requireAuth, requireRole('vendor'), asyncHandler(async (req, res) => {
	const vendor = await VendorProfile.findById(req.session?.vendorProfileId);
	const idx = parseInt(req.params.index, 10);
	if (!vendor || Number.isNaN(idx)) return res.status(400).json({ success: false });
	if (idx < 0 || idx >= (vendor.portfolioImages || []).length) {
		return res.status(400).json({ success: false, message: 'Invalid portfolio index' });
	}
	vendor.portfolioImages.splice(idx, 1);
	vendor.portfolioCaption.splice(idx, 1);
	await vendor.save();
	res.json({ success: true });
}));

// GET /api/vendor/menu — get current vendor's menu card
router.get('/menu', requireAuth, requireRole('vendor'), asyncHandler(async (req, res) => {
	const vendorProfileId = req.session?.vendorProfileId;
	if (!vendorProfileId) return res.status(401).json({ success: false, message: 'Not authenticated as vendor' });

	const profile = await VendorProfile.findById(vendorProfileId).select('menuCard vendorDatasetId businessName description basePrice businessType category city area').lean();
	if (!profile) return res.status(404).json({ success: false, message: 'Vendor profile not found' });

	const isCaterer = /caterer|catering|food|meals/i.test(profile?.category || profile?.businessType || '');
	if (!isCaterer) {
		return res.status(403).json({ success: false, message: 'Menu card is available only for food/catering vendors' });
	}

	const menuCard = profile.menuCard || null;
	const hasMeaningfulMenu = menuCard && (
		Number(menuCard.per_plate_base || 0) > 0
		|| Number(menuCard.total_items || 0) > 0
		|| Object.values(menuCard.packages || {}).some((pkg) => Number(pkg?.per_plate || 0) > 0 || (Array.isArray(pkg?.items) && pkg.items.length > 0))
	);

	if (hasMeaningfulMenu) {
		return res.json({ success: true, data: { menu: menuCard } });
	}

	try {
		const { getMenusDataset } = await import('../datasets/menusDataset.js');
		const menusMap = await getMenusDataset();
		const datasetMenu = menusMap?.menusByVendorId?.get(String(profile.vendorDatasetId || '').trim());
		if (datasetMenu) {
			return res.json({ success: true, data: { menu: normalizeDatasetMenu(datasetMenu, profile) } });
		}
	} catch {}

	return res.json({ success: true, data: { menu: buildMenuFromProfile(profile) } });
}));

// PUT /api/vendor/menu — save/update vendor's menu card
router.put('/menu', requireAuth, requireRole('vendor'), asyncHandler(async (req, res) => {
	const vendorProfileId = req.session?.vendorProfileId;
	if (!vendorProfileId) return res.status(401).json({ success: false, message: 'Not authenticated as vendor' });

	const profileForType = await VendorProfile.findById(vendorProfileId).select('businessType category').lean();
	if (!profileForType) return res.status(404).json({ success: false, message: 'Vendor profile not found' });

	const isCaterer = /caterer|catering|food|meals/i.test(profileForType?.category || profileForType?.businessType || '');
	if (!isCaterer) {
		return res.status(403).json({ success: false, message: 'Menu card is available only for food/catering vendors' });
	}

	const { per_plate_base, total_items, packages } = req.body;
	const menuCard = { per_plate_base: Number(per_plate_base) || 0, total_items: Number(total_items) || 0, packages: packages || {} };

	const profile = await VendorProfile.findByIdAndUpdate(
		vendorProfileId,
		{ menuCard },
		{ new: true }
	).select('menuCard');

	if (!profile) return res.status(404).json({ success: false, message: 'Vendor profile not found' });

	return res.json({ success: true, data: { menu: profile.menuCard } });
}));

export default router;
