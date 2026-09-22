// Roles-dashboard.js/CPO.js — Chief Product Officer
// The live catalog and margins, plus the records you enter: quality checks,
// custom orders and the product roadmap.

'use strict';

const { defineRecords, f } = require('./_records.js');

const PRICE_BANDS = [
  { label: 'Under \u20B91,000', min: 0, max: 1000 },
  { label: '\u20B91,000 \u2013 \u20B92,499', min: 1000, max: 2500 },
  { label: '\u20B92,500 \u2013 \u20B94,999', min: 2500, max: 5000 },
  { label: '\u20B95,000 and above', min: 5000, max: Infinity },
];
const CHECK_RESULTS = ['pass', 'fail', 'rework'];
const ORDER_STATUSES = ['enquiry', 'quoted', 'in_production', 'delivered', 'cancelled'];
const ROADMAP_STATUSES = ['idea', 'planned', 'in_progress', 'done'];

const rec = defineRecords({
  'quality-check': {
    table: 'quality_checks',
    fields: [
      f.text('productName', 'product_name', 'Product', { required: true }),
      f.uuid('batchId', 'batch_id', 'Production batch'),
      f.enum('result', 'result', 'Result', CHECK_RESULTS, { required: true }),
      f.text('defects', 'defects', 'Defects found', { long: true }),
      f.date('checkedOn', 'checked_on', 'Checked on', { dbDefault: true }),
    ],
  },
  'custom-order': {
    table: 'custom_orders',
    status: { values: ORDER_STATUSES },
    fields: [
      f.email('customerEmail', 'customer_email', 'Customer email'),
      f.text('productName', 'product_name', 'Product'),
      f.text('details', 'details', 'What they want', { long: true }),
      f.number('quotedPrice', 'quoted_price', 'Quoted price', { min: 0, max: 100000000 }),
      f.enum('status', 'status', 'Status', ORDER_STATUSES, { dbDefault: true }),
    ],
  },
  'roadmap-item': {
    table: 'roadmap_items',
    status: { values: ROADMAP_STATUSES },
    fields: [
      f.text('title', 'title', 'Item', { required: true }),
      f.text('quarter', 'quarter', 'Quarter (e.g. Q4 2026)'),
      f.text('owner', 'owner', 'Owner'),
      f.enum('status', 'status', 'Status', ROADMAP_STATUSES, { dbDefault: true }),
    ],
  },
});

module.exports = {
  role: 'CPO',
  title: 'Chief Product Officer',
  departments: ['Collections', 'Pricing', 'Quality', 'Custom Orders', 'Product Roadmap'],
  notBuilt: [],
  actions: rec.actions,

  async load({ supabase, getJSON, h }) {
    const [products, tableCount, marginData, checks, customOrders, roadmap, batches, productNames] = await Promise.all([
      h.safe('cpo products', () => h.loadProducts(getJSON)),
      h.countOrNull(supabase, 'products'),
      h.safe('cpo margins', () => h.loadMargins(supabase, getJSON)),
      h.safe('cpo checks', () => h.listRows(supabase, 'quality_checks', { order: 'checked_on', limit: 300 })),
      h.safe('cpo custom orders', () => h.listRows(supabase, 'custom_orders', { order: 'created_at', limit: 100 })),
      h.safe('cpo roadmap', () => h.listRows(supabase, 'roadmap_items', { limit: 100 })),
      h.safe('cpo batches', () => h.listRows(supabase, 'production_batches', { columns: 'id, product_name, status', order: 'created_at', limit: 100 })),
      h.productNames(getJSON),
    ]);

    let catalog = null;
    if (products) {
      const priced = products.filter((p) => Number(p.price) > 0).map((p) => ({ name: p.name, category: p.catLabel || p.cat || 'Uncategorized', price: Number(p.price) }));
      const sorted = [...priced].sort((a, b) => a.price - b.price);
      const prices = sorted.map((p) => p.price);
      catalog = {
        total: products.length,
        unpriced: products.length - priced.length,
        byCategory: h.tally(products, (p) => p.catLabel || p.cat || 'Uncategorized'),
        byBadge: h.tally(products, (p) => p.badge),
        withoutBadge: products.filter((p) => !p.badge).length,
        price: {
          min: prices[0] ?? null,
          max: prices[prices.length - 1] ?? null,
          avg: prices.length ? Math.round(prices.reduce((s, n) => s + n, 0) / prices.length) : null,
          median: prices.length ? prices[Math.floor(prices.length / 2)] : null,
        },
        bands: PRICE_BANDS.map((b) => ({ label: b.label, count: priced.filter((p) => p.price >= b.min && p.price < b.max).length })),
        cheapest: sorted.slice(0, 5),
        priciest: sorted.slice(-5).reverse(),
      };
    }

    let quality = null;
    if (checks) {
      const passed = checks.filter((c) => c.result === 'pass').length;
      quality = {
        results: CHECK_RESULTS,
        total: checks.length,
        passRate: checks.length ? Math.round((passed / checks.length) * 100) : null,
        defectsByProduct: h.tally(checks.filter((c) => c.result !== 'pass'), (c) => c.product_name).slice(0, 6),
        list: checks.slice(0, 15).map((c) => ({ id: c.id, product: c.product_name, result: c.result, defects: c.defects, checkedOn: c.checked_on })),
      };
    }

    let custom = null;
    if (customOrders) {
      custom = {
        statuses: ORDER_STATUSES,
        byStatus: h.tally(customOrders, (o) => o.status),
        quotedValue: customOrders.filter((o) => !['cancelled'].includes(o.status)).reduce((s, o) => s + (Number(o.quoted_price) || 0), 0),
        open: customOrders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length,
        list: customOrders.slice(0, 25).map((o) => ({
          id: o.id, email: o.customer_email, product: o.product_name, quoted: o.quoted_price == null ? null : Number(o.quoted_price), status: o.status,
        })),
      };
    }

    let road = null;
    if (roadmap) {
      const order = { in_progress: 0, planned: 1, idea: 2, done: 3 };
      road = {
        statuses: ROADMAP_STATUSES,
        byStatus: h.tally(roadmap, (r) => r.status),
        list: [...roadmap]
          .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
          .slice(0, 40)
          .map((r) => ({ id: r.id, title: r.title, quarter: r.quarter, owner: r.owner, status: r.status })),
      };
    }

    return {
      catalog,
      margins: marginData ? marginData.margins : null,
      costs: marginData ? marginData.costs.slice(0, 15).map((c) => ({ name: c.product_name, cost: Number(c.cost_price), fabric: c.fabric })) : null,
      tableCount,
      inSync: !products || tableCount === null ? null : tableCount === products.length,
      quality,
      customOrders: custom,
      roadmap: road,
      batches: batches ? batches.map((b) => ({ id: b.id, product: b.product_name, status: b.status })) : [],
      productNames,
    };
  },
};
