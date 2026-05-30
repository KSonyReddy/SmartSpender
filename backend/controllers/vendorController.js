import { BudgetPlan } from '../models/BudgetPlan.js';
import { User } from '../models/User.js';
import { VendorProfile } from '../models/VendorProfile.js';
import { getVendorsDataset } from '../datasets/vendorsDataset.js';
import { getBookingsAggregates } from '../datasets/bookingsAggregates.js';

function anonymizeRecord(doc) {
  const q = doc.questionnaire || {};
  const cp = doc.clientPlan || {};
  return {
    createdAt: doc.createdAt,
    financial_goal: q.financial_goal || cp.financialGoal,
    monthly_income: parseFloat(q.monthly_income) || 0,
    housing: parseFloat(q.housing) || 0,
    food: parseFloat(q.food) || 0,
    transport: parseFloat(q.transport) || 0,
    entertainment: parseFloat(q.entertainment) || 0,
    savings_goal: parseFloat(q.savings_goal) || 0,
    can_achieve_savings: !!cp.canAchieveSavings,
    available_balance: typeof cp.availableBalance === 'number' ? cp.availableBalance : null,
    has_ai_plan: !!doc.aiPlan,
  };
}

export const getInsights = async (req, res) => {
  const totalPlans = await BudgetPlan.countDocuments();

  const agg = await BudgetPlan.aggregate([
    {
      $project: {
        income: { $ifNull: ['$clientPlan.income', 0] },
        savingsGoal: { $ifNull: ['$clientPlan.savingsGoal', 0] },
        totalExpenses: { $ifNull: ['$clientPlan.expenses.total', 0] },
        canAchieve: { $ifNull: ['$clientPlan.canAchieveSavings', false] },
      },
    },
    {
      $group: {
        _id: null,
        avgIncome: { $avg: '$income' },
        avgSavingsGoal: { $avg: '$savingsGoal' },
        avgExpenses: { $avg: '$totalExpenses' },
        achievableCount: {
          $sum: { $cond: ['$canAchieve', 1, 0] },
        },
      },
    },
  ]);

  const a = agg[0] || {};

  res.json({
    success: true,
    data: {
      totalPlans,
      averages: {
        income: a.avgIncome ? Math.round(a.avgIncome * 100) / 100 : 0,
        savingsGoal: a.avgSavingsGoal ? Math.round(a.avgSavingsGoal * 100) / 100 : 0,
        totalExpenses: a.avgExpenses ? Math.round(a.avgExpenses * 100) / 100 : 0,
      },
      achievableShare: totalPlans ? Math.round((a.achievableCount / totalPlans) * 1000) / 10 : 0,
    },
  });
};

export const getDataset = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const docs = await BudgetPlan.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('questionnaire clientPlan aiPlan createdAt')
    .lean();

  const rows = docs.map(anonymizeRecord);

  res.json({
    success: true,
    data: {
      count: rows.length,
      records: rows,
    },
  });
};

export const getVendorProfile = async (req, res) => {
  const user = await User.findById(req.session.userId).select('name email role vendorDatasetId').lean();
  if (!user) {
    return res.status(404).json({ success: false, message: 'Vendor user not found' });
  }

  const linkedProfile = await VendorProfile.findOne({ linkedUserId: req.session.userId }).lean();
  if (linkedProfile) {
    // If linked profile has a dataset ID, enrich with CSV aggregates
    let datasetMetrics = {};
    if (linkedProfile.vendorDatasetId) {
      try {
        const bookingAgg = await getBookingsAggregates();
        const agg = bookingAgg[String(linkedProfile.vendorDatasetId)] || null;
        if (agg) {
          datasetMetrics = {
            totalBookings: agg.totalBookings || 0,
            confirmedBookings: agg.confirmedBookings || 0,
            eventsAttended: Object.values(agg.eventsAttended || {})
              .sort((a, b) => (b.total || 0) - (a.total || 0))
              .slice(0, 8)
              .map(e => ({ event_type: e.event_type, totalBookings: e.total || 0 })),
            feedback: (agg.feedbackNotes || []).slice(0, 5).map(n => ({
              event_date: n.event_date, event_type: n.event_type, status: n.status, note: n.note,
            })),
          };
        }
      } catch {}
    }

    return res.json({
      success: true,
      data: {
        vendorProfile: {
          ...linkedProfile,
          vendorName: linkedProfile.businessName,
          fromDataset: !!linkedProfile.vendorDatasetId,
          isNewVendor: !linkedProfile.vendorDatasetId,
          totalBookings: datasetMetrics.totalBookings ?? 0,
          confirmedBookings: datasetMetrics.confirmedBookings ?? 0,
          eventsAttended: datasetMetrics.eventsAttended ?? [],
          feedback: datasetMetrics.feedback ?? [],
          ...datasetMetrics,
        },
      },
    });
  }

  if (!user.vendorDatasetId) {
    return res.status(400).json({
      success: false,
      message: 'Your account is not linked to a vendor dataset profile (vendorDatasetId).',
    });
  }

  const { vendorsById } = await getVendorsDataset();
  const bookingAgg = await getBookingsAggregates();

  const vendor = vendorsById.get(String(user.vendorDatasetId));
  const agg = bookingAgg[String(user.vendorDatasetId)] || null;

  if (!vendor) {
    return res.status(404).json({ success: false, message: 'Vendor dataset profile not found' });
  }

  const eventsAttended = agg
    ? Object.values(agg.eventsAttended || {})
        .sort((a, b) => (b.total || 0) - (a.total || 0))
        .slice(0, 12)
        .map((e) => ({
          event_type: e.event_type,
          totalBookings: e.total || 0,
          confirmedBookings: e.confirmed || 0,
        }))
    : [];

  res.json({
    success: true,
    data: {
      vendorProfile: {
        vendorDatasetId: vendor.vendor_id,
        vendorName: vendor.vendor_name,
        category: vendor.category,
        city: vendor.city,
        area: vendor.area,
        rating: vendor.rating,
        // Booking dataset-derived metrics
        totalBookings: agg?.totalBookings || 0,
        confirmedBookings: agg?.confirmedBookings || 0,
        eventsAttended,
        feedback: (agg?.feedbackNotes || []).map((n) => ({
          event_date: n.event_date,
          event_type: n.event_type,
          status: n.status,
          note: n.note,
        })),
        fromDataset: true,
        isNewVendor: false,
      },
    },
  });
};

export const updateVendorProfile = async (req, res) => {
  const allowed = {
    phone: req.body.phone,
    whatsappNumber: req.body.whatsappNumber,
    basePrice: req.body.basePrice,
    pricingUnit: req.body.pricingUnit,
    workingHoursStart: req.body.workingHoursStart,
    workingHoursEnd: req.body.workingHoursEnd,
    amenities: Array.isArray(req.body.amenities) ? req.body.amenities : undefined,
    description: req.body.description,
  };

  const update = Object.fromEntries(
    Object.entries(allowed).filter(([, value]) => value !== undefined)
  );

  const profile = await VendorProfile.findOneAndUpdate(
    { linkedUserId: req.session.userId },
    { $set: update },
    { new: true, runValidators: true }
  ).lean();

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'Vendor profile not found',
    });
  }

  return res.json({
    success: true,
    message: 'Vendor profile updated successfully',
    data: { vendorProfile: profile },
  });
};
