// Roles-dashboard.js/CDO-Design.js — Chief Design Officer
// The live catalog, plus the records you enter: fabrics, trend notes, design
// files (links) and samples.

'use strict';

const { defineRecords, f } = require('./_records.js');

const FILE_KINDS = ['3d', 'tech_pack', 'sketch', 'pattern'];
const SAMPLE_STATUSES = ['requested', 'in_progress', 'received', 'approved', 'rejected'];

const rec = defineRecords({
  fabric: {
    table: 'fabrics',
    fields: [
      f.text('name', 'name', 'Fabric', { required: true }),
      f.text('composition', 'composition', 'Composition (e.g. 100% linen)'),
      f.uuid('supplierId', 'supplier_id', 'Supplier'),
      f.number('costPerMetre', 'cost_per_metre', 'Cost per metre', { min: 0, max: 10000000 }),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
  trend: {
    table: 'design_trends',
    fields: [
      f.text('title', 'title', 'Trend', { required: true }),
      f.text('season', 'season', 'Season'),
      f.text('source', 'source', 'Source'),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
  'design-file': {
    table: 'design_files',
    fields: [
      f.text('title', 'title', 'Title', { required: true }),
      f.enum('kind', 'kind', 'Kind', FILE_KINDS, { required: true }),
      f.url('fileLink', 'file_link', 'Link to the file', { required: true }),
      f.text('productName', 'product_name', 'Product'),
    ],
  },
  sample: {
    table: 'samples',
    status: { values: SAMPLE_STATUSES },
    fields: [
      f.text('productName', 'product_name', 'Product', { required: true }),
      f.int('version', 'version', 'Version', { min: 1, max: 999, dbDefault: true }),
      f.enum('status', 'status', 'Status', SAMPLE_STATUSES, { dbDefault: true }),
      f.uuid('supplierId', 'supplier_id', 'Supplier'),
      f.date('requestedOn', 'requested_on', 'Requested on'),
      f.text('feedback', 'feedback', 'Feedback', { long: true }),
    ],
  },
});

module.exports = {
  role: 'CDO (Design)',
  title: 'Chief Design Officer',
  departments: ['Fashion Design', 'Fabric Research', 'Trend Research', '3D Design', 'Sampling'],
  notBuilt: [],
  actions: rec.actions,

  async load({ supabase, getJSON, h }) {
    const [products, suppliers, fabrics, trends, files, samples, productNames] = await Promise.all([
      h.safe('cdo-design products', () => h.loadProducts(getJSON)),
      h.safe('cdo-design suppliers', () => h.listRows(supabase, 'suppliers', { order: 'name', ascending: true })),
      h.safe('cdo-design fabrics', () => h.listRows(supabase, 'fabrics', { order: 'name', ascending: true, limit: 200 })),
      h.safe('cdo-design trends', () => h.listRows(supabase, 'design_trends', { order: 'created_at', limit: 30 })),
      h.safe('cdo-design files', () => h.listRows(supabase, 'design_files', { order: 'created_at', limit: 100 })),
      h.safe('cdo-design samples', () => h.listRows(supabase, 'samples', { order: 'requested_on', limit: 100 })),
      h.productNames(getJSON),
    ]);

    let catalog = null;
    if (products) {
      catalog = {
        total: products.length,
        categories: h.tally(products, (p) => p.catLabel || p.cat || 'Uncategorized').map((c) => ({
          label: c.label,
          count: c.count,
          items: products
            .filter((p) => (p.catLabel || p.cat || 'Uncategorized') === c.label)
            .slice(0, 6)
            .map((p) => ({ name: p.name, price: Number(p.price) || null, badge: p.badge || null })),
        })),
        byBadge: h.tally(products, (p) => p.badge),
        withoutBadge: products.filter((p) => !p.badge).length,
      };
    }

    const supplierName = new Map((suppliers || []).map((s) => [s.id, s.name]));

    return {
      catalog,
      suppliers: suppliers ? suppliers.map((s) => ({ id: s.id, name: s.name })) : [],
      fabrics: fabrics
        ? fabrics.map((x) => ({
            id: x.id, name: x.name, composition: x.composition, supplier: supplierName.get(x.supplier_id) || null,
            costPerMetre: x.cost_per_metre == null ? null : Number(x.cost_per_metre),
          }))
        : null,
      trends: trends ? trends.slice(0, 12).map((t) => ({ id: t.id, title: t.title, season: t.season, source: t.source })) : null,
      files: files
        ? {
            kinds: FILE_KINDS,
            byKind: h.tally(files, (x) => x.kind),
            list: files.slice(0, 25).map((x) => ({ id: x.id, title: x.title, kind: x.kind, link: x.file_link, product: x.product_name })),
          }
        : null,
      samples: samples
        ? {
            statuses: SAMPLE_STATUSES,
            byStatus: h.tally(samples, (s) => s.status),
            awaitingApproval: samples.filter((s) => s.status === 'received').length,
            list: samples.slice(0, 30).map((s) => ({
              id: s.id, product: s.product_name, version: s.version, status: s.status,
              supplier: supplierName.get(s.supplier_id) || null, requestedOn: s.requested_on,
            })),
          }
        : null,
      productNames,
    };
  },
};
