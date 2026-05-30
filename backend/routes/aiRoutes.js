import express from 'express';
import { requireAuth, requireRole, asyncHandler } from '../middleware/sessionAuth.js';
import chatAgent from '../agents/chatAgent.js';
import analysisAgent from '../agents/analysisAgent.js';
import { normalizeVendorBasePrice } from '../utils/vendorPricing.js';
import {
  generateAndSavePlan,
  listPlans,
  getPlanById,
  deletePlan,
} from '../controllers/planController.js';

const router = express.Router();

// Helper functions for menu normalization
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

function normalizeMenuFromDataset(menu = {}) {
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

	return {
		vendor_name: menu.vendor_name || '',
		vendor_city: menu.vendor_city || menu.city || '',
		category: menu.category || '',
		per_plate_base: baseCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0,
		total_items: totalItemsCandidates.map((value) => Number(value || 0)).find((value) => value > 0) || 0,
		packages,
		description: String(menu.description || '').trim(),
		city: menu.city || '',
		area: menu.area || '',
	};
}

function hasMeaningfulMenu(menuCard) {
  if (!menuCard || typeof menuCard !== 'object') return false;
  const packages = menuCard.packages || {};
  const packageValues = Object.values(packages);
  return (
    Number(menuCard.per_plate_base || 0) > 0
    || Number(menuCard.total_items || 0) > 0
    || packageValues.some((pkg) => Number(pkg?.per_plate || 0) > 0 || (Array.isArray(pkg?.items) && pkg.items.length > 0))
  );
}

router.use(requireAuth, requireRole('user'));

/**
 * POST /api/ai/chat
 */
router.post('/chat', asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;
  const userId = req.session.userId;

  if (!message || message.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Message is required',
    });
  }

  const response = await chatAgent.chat(userId, message, { conversationId });

  if (!response.success) {
    return res.status(500).json(response);
  }

  res.json({
    success: true,
    data: {
      message: response.message,
      usage: response.usage,
      event_plan: response.event_plan || null,
      chips: response.chips || [],
      venue_block: response.venue_block || null,
    },
  });
}));

/**
 * POST /api/ai/generate-image
 * Lightweight image URL generator for customization ideas.
 */
router.post('/generate-image', asyncHandler(async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({
      success: false,
      message: 'Prompt is required',
    });
  }

  const safePrompt = encodeURIComponent(prompt.slice(0, 300));
  const seed = Date.now();
  const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=1024&height=768&seed=${seed}&nologo=true`;

  res.json({
    success: true,
    data: {
      prompt,
      imageUrl,
      provider: 'pollinations',
    },
  });
}));

/**
 * GET /api/ai/chat/history
 */
router.get('/chat/history', asyncHandler(async (req, res) => {
  const userId = req.session.userId;
  const history = await chatAgent.getConversationHistory(userId);

  res.json({
    success: true,
    data: {
      history,
      messageCount: history.length,
    },
  });
}));

/**
 * DELETE /api/ai/chat/history
 */
router.delete('/chat/history', asyncHandler(async (req, res) => {
  const userId = req.session.userId;
  await chatAgent.clearConversation(userId);
  res.json({
    success: true,
    message: 'Chat history cleared',
  });
}));

/**
 * POST /api/ai/analyze
 */
router.post('/analyze', asyncHandler(async (req, res) => {
  const { dataContext } = req.body;
  const userId = req.session.userId;

  if (!dataContext) {
    return res.status(400).json({
      success: false,
      message: 'Data context is required',
    });
  }

  const response = await analysisAgent.analyzeData(userId, dataContext);

  if (!response.success) {
    return res.status(500).json(response);
  }

  res.json({
    success: true,
    data: {
      analysis: response.analysis,
      tokensUsed: response.tokens_used,
    },
  });
}));

/**
 * POST /api/ai/analyze/category
 */
router.post('/analyze/category', asyncHandler(async (req, res) => {
  const { categoryName, expenses } = req.body;

  if (!categoryName || !expenses || !Array.isArray(expenses)) {
    return res.status(400).json({
      success: false,
      message: 'Category name and expenses array are required',
    });
  }

  const response = await analysisAgent.analyzeCategory(categoryName, expenses);

  if (!response.success) {
    return res.status(500).json(response);
  }

  res.json({
    success: true,
    data: {
      categoryAnalysis: response.categoryAnalysis,
    },
  });
}));

/**
 * POST /api/ai/recommendations
 */
router.post('/recommendations', asyncHandler(async (req, res) => {
  const currentBudget = Number(req.body?.currentBudget);
  const targetSavings = Number(req.body?.targetSavings);

  if (!Number.isFinite(currentBudget) || !Number.isFinite(targetSavings) || currentBudget < 0 || targetSavings < 0) {
    return res.status(400).json({
      success: false,
      message: 'Current budget and target savings must be valid non-negative numbers',
    });
  }

  const response = await analysisAgent.generateRecommendations(
    currentBudget,
    targetSavings
  );

  if (!response.success) {
    return res.status(500).json(response);
  }

  res.json({
    success: true,
    data: {
      recommendations: response.recommendations,
    },
  });
}));

/**
 * POST /api/ai/budget/plan
 */
router.post('/budget/plan', asyncHandler(async (req, res) => {
  const currentBudget = Number(req.body?.currentBudget);
  const targetSavings = Number(req.body?.targetSavings);

  if (!Number.isFinite(currentBudget) || !Number.isFinite(targetSavings) || currentBudget < 0 || targetSavings < 0) {
    return res.status(400).json({
      success: false,
      message: 'Current budget and target savings must be valid non-negative numbers',
    });
  }

  const response = await analysisAgent.generateRecommendations(
    currentBudget,
    targetSavings
  );

  if (!response.success) {
    return res.status(500).json(response);
  }

  res.json({
    success: true,
    data: {
      plan: response.plan,
    },
  });
}));

// GET /api/ai/vendor-menu/:vendorId
router.get('/vendor-menu/:vendorId', asyncHandler(async (req, res) => {
  const rawVendorId = String(req.params.vendorId || '').trim();
  if (!rawVendorId) {
    return res.status(400).json({ success: false, message: 'vendorId required' });
  }

  const normalizedVendorId = rawVendorId.toLowerCase();

  // Check if vendor has a manually set menu card in their VendorProfile.
  // If profile exists but menu is empty, continue to dataset lookup instead of returning empty packages.
  let profileMeta = null;
  try {
    const { VendorProfile } = await import('../models/VendorProfile.js');
    await import('../datasets/vendorsDataset.js').then(m => m.getVendorsDataset());

    const profile = await VendorProfile.findOne({
      $or: [
        { vendorDatasetId: rawVendorId },
        { _id: rawVendorId },
        { businessName: new RegExp(`^${rawVendorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ],
    }).select('menuCard vendorDatasetId businessName basePrice description category city area').lean();

    profileMeta = profile || null;

    if (hasMeaningfulMenu(profile?.menuCard)) {
      return res.json({ success: true, data: { menu: { ...profile.menuCard, vendor_name: profile.businessName } } });
    }
  } catch {}
  // Falls through to dataset lookup

  try {
    const { getMenusDataset } = await import('../datasets/menusDataset.js');
    const menusData = await getMenusDataset();
    const map = menusData?.menusByVendorId;
    const datasetVendorId = String(profileMeta?.vendorDatasetId || '').trim();
    const menu = map?.get(rawVendorId)
      || map?.get(normalizedVendorId)
      || (datasetVendorId ? map?.get(datasetVendorId) : null)
      || (datasetVendorId ? map?.get(datasetVendorId.toLowerCase()) : null);

    if (!menu) {
      if (profileMeta) {
        return res.json({
          success: true,
          data: {
            menu: {
              vendor_name: profileMeta.businessName,
              per_plate_base: normalizeVendorBasePrice(profileMeta.basePrice || 0, profileMeta.category || profileMeta.businessType || ''),
              total_items: 0,
              packages: {},
              description: profileMeta.description || '',
              category: profileMeta.category || '',
              city: profileMeta.city || '',
              area: profileMeta.area || '',
            },
          },
        });
      }
      return res.json({ success: true, data: { menu: null } });
    }

    // Normalize the menu data (parses JSON strings, extracts packages)
    const normalized = normalizeMenuFromDataset(menu);
    if (profileMeta?.businessName && !normalized.vendor_name) normalized.vendor_name = profileMeta.businessName;
    if (profileMeta?.category && !normalized.category) normalized.category = profileMeta.category;
    if (profileMeta?.city && !normalized.city) normalized.city = profileMeta.city;
    if (profileMeta?.area && !normalized.area) normalized.area = profileMeta.area;
    return res.json({ success: true, data: { menu: normalized } });
  } catch (err) {
    console.error('vendor-menu error:', err.message);
    return res.json({ success: true, data: { menu: null } });
  }
}));

/**
 * GET /api/ai/budget/plan
 */
router.get('/budget/plan', asyncHandler(async (req, res) => {
  const currentBudget = Number(req.query.currentBudget);
  const targetSavings = Number(req.query.targetSavings);

  if (!Number.isFinite(currentBudget) || !Number.isFinite(targetSavings) || currentBudget < 0 || targetSavings < 0) {
    return res.status(400).json({
      success: false,
      message: 'currentBudget and targetSavings query params must be valid non-negative numbers',
    });
  }

  const response = await analysisAgent.generateRecommendations(
    currentBudget,
    targetSavings
  );

  if (!response.success) {
    return res.status(500).json(response);
  }

  res.json({
    success: true,
    data: {
      plan: response.plan,
    },
  });
}));

/**
 * POST /api/ai/plans/generate — wizard completion: compute plan, merge AI allocation, save
 */
router.post('/plans/generate', asyncHandler(generateAndSavePlan));

/**
 * GET /api/ai/plans — list saved plans for current user
 */
router.get('/plans', asyncHandler(listPlans));

/**
 * GET /api/ai/plans/:id
 */
router.get('/plans/:id', asyncHandler(getPlanById));

/**
 * DELETE /api/ai/plans/:id
 */
router.delete('/plans/:id', asyncHandler(deletePlan));

export default router;
