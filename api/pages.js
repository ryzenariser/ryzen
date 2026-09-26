const { supabase } = require('./_lib/supabase');
const { requireAuth } = require('./_lib/auth');

// Reserved slug for the single row that stores the homepage's extra,
// admin-managed sections. This row is never shown in the normal Pages
// table and can never be deleted or slug-changed.
const HOMEPAGE_SLUG = '__homepage__';

// Block types that touch raw HTML/JS and therefore need to stay
// Super Admin-only, mirroring the "Custom JavaScript Block (restricted to
// Super Admin)" rule from the original spec. Kept as a list (not just
// custom_html) so future raw-markup block types inherit the same gate.
const SUPER_ADMIN_ONLY_BLOCK_TYPES = ['custom_html'];

function checkPerm(session, action) {
  if (session.role === 'super_admin') return true;
  const perm = (session.permissions && session.permissions.pages) || {};
  if (action === 'delete') return !!perm.delete;
  return !!perm.edit; // create/update
}

function validateBlocks(blocks, session) {
  if (!Array.isArray(blocks)) return 'blocks must be an array';
  if (session.role === 'super_admin') return null;
  const hasRestricted = blocks.some((b) => b && SUPER_ADMIN_ONLY_BLOCK_TYPES.includes(b.type));
  if (hasRestricted) return 'Only a Super Admin can add or edit Custom HTML sections.';
  return null;
}

function toApi(row) {
  return {
    slug: row.slug,
    title: row.title,
    type: row.type || 'static',
    html: row.html || '',
    blocks: row.blocks || [],
    isHomepage: !!row.is_homepage,
  };
}

function slugify(title) {
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

module.exports = async (req, res) => {
  const action = req.query.action;

  try {
    let session = null;
    if (action !== 'list' && action !== 'get' && action !== 'get-homepage') {
      session = requireAuth(req, res);
      if (!session) return;
      if (!checkPerm(session, action)) {
        return res.status(403).json({ error: 'You do not have permission to do that.' });
      }
    }

    if (req.method === 'GET' && action === 'list') {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('is_homepage', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ pages: data.map(toApi) });
    }

    if (req.method === 'GET' && action === 'get') {
      const { slug } = req.query;
      if (!slug) return res.status(400).json({ error: 'slug is required' });

      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Page not found' });
      return res.status(200).json({ page: toApi(data) });
    }

    // Public, unauthenticated: the storefront homepage calls this on every
    // load to fetch its admin-managed extra sections. Never 404s — if the
    // row hasn't been created yet (fresh install, migration not run),
    // returns an empty section list so the homepage just renders nothing
    // extra instead of erroring.
    if (req.method === 'GET' && action === 'get-homepage') {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('is_homepage', true)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(200).json({ page: { slug: HOMEPAGE_SLUG, type: 'dynamic', blocks: [] } });
      return res.status(200).json({ page: toApi(data) });
    }

    if (req.method === 'POST' && action === 'create') {
      const { title, type, html, blocks } = req.body;
      if (!title) return res.status(400).json({ error: 'Title is required' });

      const blockErr = validateBlocks(blocks || [], session);
      if (blockErr) return res.status(403).json({ error: blockErr });

      let slug = slugify(title);
      if (slug === HOMEPAGE_SLUG.replace(/_/g, '') || !slug) slug = `page-${Date.now().toString(36)}`;
      const { data: existing } = await supabase.from('pages').select('slug').eq('slug', slug).maybeSingle();
      if (existing) slug = `${slug}-${Date.now().toString(36)}`;

      const { data, error } = await supabase
        .from('pages')
        .insert([{ slug, title, type: type || 'static', html: html || '', blocks: blocks || [], is_homepage: false }])
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ page: toApi(data) });
    }

    if (req.method === 'POST' && action === 'update') {
      const { slug, title, html, blocks } = req.body;
      if (!slug) return res.status(400).json({ error: 'slug is required' });

      if (blocks !== undefined) {
        const blockErr = validateBlocks(blocks, session);
        if (blockErr) return res.status(403).json({ error: blockErr });
      }

      const updates = { updated_at: new Date().toISOString() };
      if (title !== undefined) updates.title = title;
      if (html !== undefined) updates.html = html;
      if (blocks !== undefined) updates.blocks = blocks;

      const { data, error } = await supabase
        .from('pages')
        .update(updates)
        .eq('slug', slug)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Page not found' });
      return res.status(200).json({ page: toApi(data) });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { slug } = req.body;
      if (!slug) return res.status(400).json({ error: 'slug is required' });
      if (slug === HOMEPAGE_SLUG) {
        return res.status(400).json({ error: 'The homepage sections entry cannot be deleted.' });
      }

      const { error } = await supabase.from('pages').delete().eq('slug', slug);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('pages.js error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
