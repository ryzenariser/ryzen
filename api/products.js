const { supabase } = require('./_lib/supabase');
const { verifyToken } = require('./_lib/auth');

function requireAuth(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  return verifyToken(token);
}

// DB rows use snake_case (Postgres folds unquoted identifiers to lowercase),
// so we map to/from the camelCase shape admin.html expects.
function toApi(row) {
  return {
    id: row.id,
    name: row.name,
    cat: row.cat,
    catLabel: row.cat_label,
    price: row.price,
    originalPrice: row.original_price ?? undefined,
    badge: row.badge || undefined,
    sizes: row.sizes || [],
    image: row.image,
    description: row.description || '',
  };
}

function toDb(product) {
  return {
    name: product.name,
    cat: product.cat,
    cat_label: product.catLabel,
    price: product.price,
    original_price: product.originalPrice ?? null,
    badge: product.badge || null,
    sizes: product.sizes || [],
    image: product.image,
    description: product.description || '',
  };
}

module.exports = async (req, res) => {
  const action = req.query.action;

  try {
    // GET list is public (storefront may need it); all other actions require auth
    if (action !== 'list') {
      const payload = requireAuth(req);
      if (!payload) {
        return res.status(401).json({ error: 'Session expired, please log in again.' });
      }
    }

    if (req.method === 'GET' && action === 'list') {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ products: data.map(toApi) });
    }

    if (req.method === 'POST' && action === 'create') {
      const { product } = req.body;
      if (!product || !product.name) {
        return res.status(400).json({ error: 'Product data is required' });
      }

      const { data, error } = await supabase
        .from('products')
        .insert([toDb(product)])
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ product: toApi(data) });
    }

    if (req.method === 'POST' && action === 'update') {
      const { id, updates } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'Product id is required' });
      }

      const dbUpdates = toDb(updates);
      dbUpdates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('products')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ product: toApi(data) });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'Product id is required' });
      }

      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('products.js error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
