import { getVendorsDataset } from '../datasets/vendorsDataset.js';

export async function listVendorOptions(req, res) {
  const q = String(req.query.q || '').trim().toLowerCase();
  const { vendors } = await getVendorsDataset();

  const filtered = q
    ? vendors.filter(
        (v) =>
          (v.vendor_name || '').toLowerCase().includes(q) ||
          (v.category || '').toLowerCase().includes(q) ||
          (v.city || '').toLowerCase().includes(q) ||
          (v.area || '').toLowerCase().includes(q)
      )
    : vendors;

  // Keep response small for the signup dropdown.
  const result = filtered
    .slice()
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 200)
    .map((v) => ({
      id: v.vendor_id,
      name: v.vendor_name,
      category: v.category,
      city: v.city,
      area: v.area,
      rating: v.rating,
    }));

  res.json({
    success: true,
    data: { vendors: result },
  });
}

