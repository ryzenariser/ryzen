// Roles-dashboard.js/COO.js — Chief Operations Officer
// Real data only: order fulfilment pipeline, stuck orders, store status.

'use strict';

module.exports = {
  role: 'COO',
  title: 'Chief Operations Officer',
  departments: ['Operations', 'Supply Chain', 'Manufacturing', 'Warehouses', 'Logistics', 'Inventory'],
  notBuilt: ['Inventory and stock levels', 'Warehouses', 'Manufacturing', 'Supplier / supply chain tracking'],

  async load({ supabase, h }) {
    const [rows, maintenance] = await Promise.all([
      h.safe('coo orders', () => h.fetchOrders(supabase)),
      h.safe('coo maintenance', () => h.loadMaintenance(supabase)),
    ]);
    if (!rows) return { orders: null, maintenance };

    const summary = h.summarizeOrders(rows);
    const stale = h.staleOrders(rows, 5);
    const now = Date.now();
    const awaitingShipment = rows.filter((o) => o.status === 'paid').length;
    const shipped = rows.filter((o) => ['shipped', 'delivered'].includes(o.status));
    const withTracking = shipped.filter((o) => !!o.tracking_number).length;

    return {
      orders: {
        total: summary.total,
        byStatus: summary.byStatus,
        awaitingShipment,
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
      },
      maintenance,
    };
  },
};
