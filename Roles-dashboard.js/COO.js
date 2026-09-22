// Roles-dashboard.js/COO.js — Chief Operations Officer
// Order fulfilment (from orders) plus the records you enter: stock,
// warehouses, suppliers and production batches.

'use strict';

const { defineRecords, f } = require('./_records.js');

const BATCH_STATUSES = ['planned', 'cutting', 'stitching', 'finishing', 'done'];

const rec = defineRecords({
  supplier: {
    table: 'suppliers',
    fields: [f.text('name', 'name', 'Name', { required: true }), f.text('contact', 'contact', 'Contact'), f.text('category', 'category', 'Category')],
  },
  warehouse: {
    table: 'warehouses',
    fields: [f.text('name', 'name', 'Name', { required: true }), f.text('city', 'city', 'City')],
  },
  // Saving the same product + size + warehouse again updates the count.
  stock: {
    table: 'stock_levels',
    conflict: 'product_name,size,warehouse_id',
    stamp: 'updated_at',
    fields: [
      f.text('productName', 'product_name', 'Product', { required: true }),
      f.text('size', 'size', 'Size', { required: true }),
      f.uuid('warehouseId', 'warehouse_id', 'Warehouse', { required: true }),
      f.int('quantity', 'quantity', 'Quantity', { required: true, min: 0, max: 1000000 }),
      f.int('reorderAt', 'reorder_at', 'Reorder at', { min: 0, max: 1000000, dbDefault: true }),
    ],
  },
  batch: {
    table: 'production_batches',
    status: { values: BATCH_STATUSES },
    fields: [
      f.text('productName', 'product_name', 'Product', { required: true }),
      f.int('quantity', 'quantity', 'Quantity', { required: true, min: 1, max: 1000000 }),
      f.enum('status', 'status', 'Status', BATCH_STATUSES, { dbDefault: true }),
      f.uuid('supplierId', 'supplier_id', 'Supplier'),
      f.date('startedOn', 'started_on', 'Started on'),
      f.date('dueOn', 'due_on', 'Due on'),
    ],
  },
});

module.exports = {
  role: 'COO',
  title: 'Chief Operations Officer',
  departments: ['Operations', 'Supply Chain', 'Manufacturing', 'Warehouses', 'Logistics', 'Inventory'],
  notBuilt: [],
  actions: rec.actions,

  async load({ supabase, getJSON, h }) {
    const [rows, maintenance, warehouses, suppliers, stockRows, batchRows, productNames] = await Promise.all([
      h.safe('coo orders', () => h.fetchOrders(supabase)),
      h.safe('coo maintenance', () => h.loadMaintenance(supabase)),
      h.safe('coo warehouses', () => h.listRows(supabase, 'warehouses', { order: 'name', ascending: true })),
      h.safe('coo suppliers', () => h.listRows(supabase, 'suppliers', { order: 'name', ascending: true })),
      h.safe('coo stock', () => h.listRows(supabase, 'stock_levels', { order: 'updated_at', limit: 500 })),
      h.safe('coo batches', () => h.listRows(supabase, 'production_batches', { order: 'created_at', limit: 200 })),
      h.productNames(getJSON),
    ]);

    // ── orders ──
    let orders = null;
    if (rows) {
      const summary = h.summarizeOrders(rows);
      const stale = h.staleOrders(rows, 5);
      const now = Date.now();
      const shipped = rows.filter((o) => ['shipped', 'delivered'].includes(o.status));
      const withTracking = shipped.filter((o) => !!o.tracking_number).length;
      orders = {
        total: summary.total,
        byStatus: summary.byStatus,
        awaitingShipment: rows.filter((o) => o.status === 'paid').length,
        shippedOrDelivered: shipped.length,
        trackingCoverage: shipped.length ? Math.round((withTracking / shipped.length) * 100) : null,
        stale: {
          count: stale.length,
          oldest: stale.slice(-8).reverse().map((o) => ({
            status: o.status, amount: Number(o.amount) || 0,
            ageDays: Math.floor((now - new Date(o.created_at).getTime()) / h.DAY),
          })),
        },
        recent: rows.slice(0, 10).map((o) => ({
          status: o.status, amount: Number(o.amount) || 0, createdAt: o.created_at, hasTracking: !!o.tracking_number,
        })),
      };
    }

    // ── stock ──
    let stock = null;
    if (stockRows && warehouses) {
      const nameById = new Map(warehouses.map((w) => [w.id, w.name]));
      const lines = stockRows.map((r) => ({
        id: r.id, product: r.product_name, size: r.size, warehouse: nameById.get(r.warehouse_id) || 'Unknown',
        quantity: Number(r.quantity) || 0, reorderAt: Number(r.reorder_at) || 0,
      }));
      const perWarehouse = {};
      lines.forEach((l) => { perWarehouse[l.warehouse] = (perWarehouse[l.warehouse] || 0) + l.quantity; });
      stock = {
        totalUnits: lines.reduce((s, l) => s + l.quantity, 0),
        lineCount: lines.length,
        low: lines.filter((l) => l.quantity <= l.reorderAt).sort((a, b) => a.quantity - b.quantity),
        byWarehouse: Object.entries(perWarehouse).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
        lines: lines.slice(0, 60),
      };
    }

    // ── production batches ──
    let batches = null;
    if (batchRows && suppliers) {
      const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
      const list = batchRows.map((b) => {
        const left = h.daysUntil(b.due_on);
        return {
          id: b.id, product: b.product_name, quantity: b.quantity, status: b.status,
          supplier: supplierName.get(b.supplier_id) || null, startedOn: b.started_on, dueOn: b.due_on,
          overdue: b.status !== 'done' && left !== null && left < 0,
        };
      });
      batches = {
        statuses: BATCH_STATUSES,
        byStatus: h.tally(list, (b) => b.status),
        overdue: list.filter((b) => b.overdue).length,
        open: list.filter((b) => b.status !== 'done').length,
        list: list.slice(0, 40),
      };
    }

    const suppliersOut = suppliers
      ? suppliers.map((s) => ({
          id: s.id, name: s.name, contact: s.contact, category: s.category,
          openBatches: batchRows ? batchRows.filter((b) => b.supplier_id === s.id && b.status !== 'done').length : null,
        }))
      : null;

    return {
      orders,
      maintenance,
      stock,
      batches,
      warehouses: warehouses ? warehouses.map((w) => ({ id: w.id, name: w.name, city: w.city })) : null,
      suppliers: suppliersOut,
      productNames,
    };
  },
};
