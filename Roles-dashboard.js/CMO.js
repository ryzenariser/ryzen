// Roles-dashboard.js/CMO.js — Chief Marketing Officer
// Audience and traffic from your own data, ad spend from Meta, Instagram
// numbers, and an influencer list you keep by hand.

'use strict';

const { defineRecords, f } = require('./_records.js');
const services = require('./_services.js');

const INFLUENCER_STATUSES = ['contacted', 'agreed', 'posted', 'declined'];

const rec = defineRecords({
  influencer: {
    table: 'influencers',
    status: { values: INFLUENCER_STATUSES },
    fields: [
      f.text('name', 'name', 'Name', { required: true }),
      f.text('handle', 'handle', 'Handle'),
      f.text('platform', 'platform', 'Platform'),
      f.int('followers', 'followers', 'Followers', { min: 0, max: 1000000000 }),
      f.enum('status', 'status', 'Status', INFLUENCER_STATUSES, { dbDefault: true }),
      f.number('cost', 'cost', 'Cost', { min: 0, max: 1000000000 }),
      f.text('notes', 'notes', 'Notes', { long: true }),
    ],
  },
});

module.exports = {
  role: 'CMO',
  title: 'Chief Marketing Officer',
  departments: ['Brand', 'Marketing', 'Performance', 'Social Media', 'Influencers', 'Campaigns'],
  notBuilt: [],
  actions: rec.actions,

  async load({ supabase, getJSON, env, h }) {
    const [customers, pageViews, carts, wishlists, rows, products, influencers] = await Promise.all([
      h.countOrNull(supabase, 'customers'),
      h.safe('cmo page views', () => h.loadPageViews(supabase)),
      h.safe('cmo carts', async () => (await h.countRows(supabase, 'cart_items')) + (await h.countRows(supabase, 'customer_cart_items'))),
      h.safe('cmo wishlists', async () => (await h.countRows(supabase, 'wishlist_items')) + (await h.countRows(supabase, 'customer_wishlist_items'))),
      h.safe('cmo orders', () => h.fetchOrders(supabase)),
      h.safe('cmo products', () => h.loadProducts(getJSON)),
      h.safe('cmo influencers', () => h.listRows(supabase, 'influencers', { order: 'created_at', limit: 200 })),
    ]);

    const summary = rows ? h.summarizeOrders(rows) : null;
    const revenue30 = rows ? h.windowRevenue(rows, 30, 0).revenue : null;

    const [ads, insta] = await Promise.all([
      h.safe('cmo meta ads', () => services.metaAds(env, revenue30)),
      h.safe('cmo instagram', () => services.instagram(env)),
    ]);

    return {
      customers,
      pageViews,
      cartItems: carts,
      wishlistItems: wishlists,
      orders: summary ? { total: summary.total, paid: summary.paidCount, revenue: summary.revenue } : null,
      catalog: products
        ? { total: products.length, byCategory: h.tally(products, (p) => p.catLabel || p.cat || 'Uncategorized') }
        : null,
      ads,
      instagram: insta,
      influencers: influencers
        ? {
            statuses: INFLUENCER_STATUSES,
            byStatus: h.tally(influencers, (i) => i.status),
            totalCost: influencers.filter((i) => i.status !== 'declined').reduce((s, i) => s + (Number(i.cost) || 0), 0),
            list: influencers.slice(0, 30).map((i) => ({
              id: i.id, name: i.name, handle: i.handle, platform: i.platform,
              followers: i.followers == null ? null : Number(i.followers), status: i.status, cost: i.cost == null ? null : Number(i.cost),
            })),
          }
        : null,
    };
  },
};
