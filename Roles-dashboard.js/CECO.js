// Roles-dashboard.js/CECO.js — Chief E-Commerce Officer
// Pages, traffic and checkout completion from your own data, search rankings
// from Google Search Console, the latest app build per platform (read from
// the CTO's records), and a list of marketplace listings you keep by hand.

'use strict';

const { defineRecords, f } = require('./_records.js');
const services = require('./_services.js');

const LISTING_STATUSES = ['draft', 'live', 'paused', 'removed'];

const rec = defineRecords({
  listing: {
    table: 'marketplace_listings',
    status: { values: LISTING_STATUSES },
    stamp: 'updated_at',
    fields: [
      f.text('marketplace', 'marketplace', 'Marketplace', { required: true }),
      f.text('productName', 'product_name', 'Product', { required: true }),
      f.url('listingUrl', 'listing_url', 'Listing link'),
      f.enum('status', 'status', 'Status', LISTING_STATUSES, { dbDefault: true }),
      f.number('price', 'price', 'Price', { min: 0, max: 100000000 }),
    ],
  },
});

module.exports = {
  role: 'CECO',
  title: 'Chief E-Commerce Officer',
  departments: ['Website/App', 'Marketplace', 'Payments', 'SEO', 'Conversion'],
  notBuilt: [],
  actions: rec.actions,

  async load({ supabase, getJSON, env, h }) {
    const [pages, pageViews, carts, wishlists, orders, listings, builds, seo, productNames] = await Promise.all([
      h.safe('ceco pages', async () => {
        const { data, count, error } = await supabase
          .from('pages').select('slug, title, type', { count: 'exact' })
          .order('created_at', { ascending: false }).limit(40);
        if (error) throw error;
        return {
          total: count || (data || []).length,
          byType: h.tally(data || [], (p) => p.type || 'untyped'),
          latest: (data || []).slice(0, 12),
        };
      }),
      h.safe('ceco page views', () => h.loadPageViews(supabase)),
      h.safe('ceco carts', async () => (await h.countRows(supabase, 'cart_items')) + (await h.countRows(supabase, 'customer_cart_items'))),
      h.safe('ceco wishlists', async () => (await h.countRows(supabase, 'wishlist_items')) + (await h.countRows(supabase, 'customer_wishlist_items'))),
      h.safe('ceco orders', async () => h.summarizeOrders(await h.fetchOrders(supabase))),
      h.safe('ceco listings', () => h.listRows(supabase, 'marketplace_listings', { order: 'updated_at', limit: 200 })),
      h.safe('ceco app builds', () => h.listRows(supabase, 'app_builds', { order: 'released_on', limit: 50 })),
      h.safe('ceco search console', () => services.searchConsole(env)),
      h.productNames(getJSON),
    ]);

    let checkout = null;
    if (orders) {
      const started = orders.byStatus.created || 0;
      const completed = orders.paidCount + (orders.byStatus.refunded || 0);
      const attempts = started + completed;
      checkout = {
        started: attempts,
        completed,
        abandoned: started,
        completionRate: attempts ? Math.round((completed / attempts) * 100) : null,
      };
    }

    // Latest build per platform, live ones first.
    let app = null;
    if (builds) {
      const latest = {};
      const rank = { live: 0, submitted: 1, testing: 2, building: 3, rejected: 4 };
      builds.forEach((b) => {
        const cur = latest[b.platform];
        if (!cur || (rank[b.status] ?? 9) < (rank[cur.status] ?? 9)) latest[b.platform] = b;
      });
      app = ['android', 'ios'].map((platform) => (latest[platform]
        ? { platform, version: latest[platform].version, status: latest[platform].status, releasedOn: latest[platform].released_on }
        : { platform, version: null, status: null, releasedOn: null }));
    }

    return {
      pages,
      pageViews,
      cartItems: carts,
      wishlistItems: wishlists,
      checkout,
      payments: { razorpayWebhookConfigured: !!env.RAZORPAY_WEBHOOK_SECRET },
      listings: listings
        ? {
            statuses: LISTING_STATUSES,
            byMarketplace: h.tally(listings.filter((l) => l.status === 'live'), (l) => l.marketplace),
            live: listings.filter((l) => l.status === 'live').length,
            list: listings.slice(0, 40).map((l) => ({
              id: l.id, marketplace: l.marketplace, product: l.product_name, url: l.listing_url, status: l.status,
              price: l.price == null ? null : Number(l.price),
            })),
          }
        : null,
      app,
      seo,
      productNames,
    };
  },
};
