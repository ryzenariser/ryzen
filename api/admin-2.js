const crypto = require('crypto');

const GITHUB_API = 'https://api.github.com';
const PRODUCTS_PATH = 'products.json';
const FACE_PATH = 'face.json';
const BRANCH = 'main';

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

function repoUrl(path) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  return `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
}

function signToken() {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const expiry = Date.now() + 1000 * 60 * 60 * 6; // 6 hours
  const sig = crypto.createHmac('sha256', secret).update(String(expiry)).digest('hex');
  return `${expiry}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [expiry, sig] = token.split('.');
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const expected = crypto.createHmac('sha256', secret).update(expiry).digest('hex');
  if (expected !== sig) return false;
  if (Date.now() > Number(expiry)) return false;
  return true;
}

async function getProductsFile() {
  const r = await fetch(repoUrl(PRODUCTS_PATH) + `?ref=${BRANCH}`, { headers: ghHeaders() });
  if (!r.ok) throw new Error('Could not read products.json');
  const data = await r.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { products: JSON.parse(content), sha: data.sha };
}

async function putProductsFile(products, sha, message) {
  const content = Buffer.from(JSON.stringify(products, null, 2)).toString('base64');
  const r = await fetch(repoUrl(PRODUCTS_PATH), {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({ message, content, sha, branch: BRANCH }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error('Could not write products.json: ' + err);
  }
  return r.json();
}

async function uploadImage(base64Data, filename) {
  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `images/${Date.now()}-${safeName}`;
  const r = await fetch(repoUrl(path), {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({
      message: `Upload product image ${safeName}`,
      content: cleanBase64,
      branch: BRANCH,
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error('Image upload failed: ' + err);
  }
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${BRANCH}/${path}`;
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* ── FACE ID storage (same GitHub-as-datastore pattern as products.json) ── */
async function getFaceFile() {
  const r = await fetch(repoUrl(FACE_PATH) + `?ref=${BRANCH}`, { headers: ghHeaders() });
  if (r.status === 404) return { descriptor: null, sha: null };
  if (!r.ok) throw new Error('Could not read face.json');
  const data = await r.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  const parsed = JSON.parse(content);
  return { descriptor: parsed.descriptor || null, sha: data.sha };
}

async function putFaceFile(descriptor, sha, message) {
  const content = Buffer.from(JSON.stringify({ descriptor }, null, 2)).toString('base64');
  const payload = { message, content, branch: BRANCH };
  if (sha) payload.sha = sha;
  const r = await fetch(repoUrl(FACE_PATH), {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error('Could not write face.json: ' + err);
  }
  return r.json();
}

/* ── Telegram alert on face mismatch ── */
async function sendTelegramAlert(imageBase64, timestamp) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Telegram is not configured (missing env vars).');

  const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
  const buffer = Buffer.from(cleanBase64, 'base64');

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append(
    'caption',
    `⚠️ Unrecognized face attempted to access Ryzen Admin\n${timestamp || new Date().toISOString()}`
  );
  form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'alert.jpg');

  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error('Telegram send failed: ' + err);
  }
  return r.json();
}

module.exports = async (req, res) => {
  try {
    const body = req.body || {};
    const action = req.query.action || body.action;

    // ── LOGIN ──
    if (action === 'login') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword) return res.status(500).json({ error: 'Admin password not configured.' });
      if (!body.password || body.password !== adminPassword) {
        return res.status(401).json({ error: 'Incorrect password.' });
      }
      return res.status(200).json({ token: signToken() });
    }

    // ── EVERYTHING BELOW REQUIRES A VALID TOKEN ──
    const token = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : body.token;
    if (!verifyToken(token)) {
      return res.status(401).json({ error: 'Not authorized. Please log in again.' });
    }

    // ── FACE ID: status ──
    if (action === 'face-status') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const { descriptor } = await getFaceFile();
      return res.status(200).json({ enrolled: !!descriptor });
    }

    // ── FACE ID: fetch stored descriptor (used client-side to compare) ──
    if (action === 'face-descriptor') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const { descriptor } = await getFaceFile();
      return res.status(200).json({ descriptor: descriptor || null });
    }

    // ── FACE ID: enroll / re-enroll ──
    if (action === 'face-enroll') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { descriptor } = body;
      if (!Array.isArray(descriptor) || descriptor.length !== 128) {
        return res.status(400).json({ error: 'Invalid face data.' });
      }
      const existing = await getFaceFile();
      await putFaceFile(descriptor, existing.sha, 'Update admin Face ID');
      return res.status(200).json({ success: true });
    }

    // ── FACE ID: mismatch alert -> Telegram ──
    if (action === 'face-alert') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { imageBase64, timestamp } = body;
      if (!imageBase64) return res.status(400).json({ error: 'Missing image.' });
      await sendTelegramAlert(imageBase64, timestamp);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const { products } = await getProductsFile();
      return res.status(200).json({ products });
    }

    if (req.method === 'POST') {
      const { product, imageBase64, imageName } = body;
      if (!product || !product.name || !product.price) {
        return res.status(400).json({ error: 'Product name and price are required.' });
      }

      const { products, sha } = await getProductsFile();

      let imageUrl = product.image || '';
      if (imageBase64 && imageName) {
        imageUrl = await uploadImage(imageBase64, imageName);
      }
      if (!imageUrl) {
        return res.status(400).json({ error: 'Please provide an image URL or upload a file.' });
      }

      let id = slugify(product.name);
      let suffix = 1;
      const existingIds = new Set(products.map((p) => p.id));
      while (existingIds.has(id)) {
        id = `${slugify(product.name)}-${suffix}`;
        suffix++;
      }

      const newProduct = {
        id,
        cat: product.cat || 'tshirt',
        catLabel: product.catLabel || 'T-Shirts',
        name: product.name,
        label: product.label || product.name,
        price: Number(product.price),
        originalPrice: product.originalPrice ? Number(product.originalPrice) : null,
        badge: product.badge || null,
        description: product.description || '',
        image: imageUrl,
        sizes: Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['S', 'M', 'L', 'XL'],
      };

      products.push(newProduct);
      await putProductsFile(products, sha, `Add product: ${newProduct.name}`);
      return res.status(200).json({ success: true, product: newProduct });
    }

    if (req.method === 'PUT') {
      const { id, updates, imageBase64, imageName } = body;
      if (!id || !updates) {
        return res.status(400).json({ error: 'Product id and updates are required.' });
      }

      const { products, sha } = await getProductsFile();
      const idx = products.findIndex((p) => p.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      if (imageBase64 && imageName) {
        updates.image = await uploadImage(imageBase64, imageName);
      }

      products[idx] = { ...products[idx], ...updates };
      await putProductsFile(products, sha, `Update product: ${products[idx].name}`);
      return res.status(200).json({ success: true, product: products[idx] });
    }

    if (req.method === 'DELETE') {
      const { id } = body;
      if (!id) {
        return res.status(400).json({ error: 'Product id is required.' });
      }

      const { products, sha } = await getProductsFile();
      const filtered = products.filter((p) => p.id !== id);
      if (filtered.length === products.length) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      await putProductsFile(filtered, sha, `Remove product: ${id}`);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin error:', err);
    return res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
};
