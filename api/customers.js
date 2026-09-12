const { supabase } = require('./_lib/supabase');
const { hashPassword, verifyPassword } = require('./_lib/passwords');
const { signCustomerToken, requireCustomerAuth, TOKEN_TTL_MS } = require('./_lib/customer-auth');
const nodemailer = require('nodemailer');

async function sendPasswordChangedEmail(email) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'razarizerverify@gmail.com',
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: '"Razariser" <razarizerverify@gmail.com>',
    to: email,
    subject: 'Your Razariser password was changed',
    html: `<div style="background:#1a1a1a; padding:40px 0; font-family:Arial, sans-serif;">
      <div style="max-width:380px; margin:0 auto; background:#0d0d0d; border:1px solid #3a3020; border-radius:12px; padding:40px 32px; text-align:center;">
        <p style="font-size:22px; font-weight:bold; letter-spacing:2px; color:#d4af37; margin:0 0 4px;">RAZARISER</p>
        <p style="font-size:12px; color:#8a8a8a; letter-spacing:1px; margin:0 0 28px;">STYLE FOR THE RISER</p>
        <div style="width:40px; height:1px; background:#3a3020; margin:0 auto 28px;"></div>
        <p style="font-size:17px; color:#e8e8e8; margin:0 0 14px; font-weight:bold;">Password changed</p>
        <p style="font-size:13px; color:#b0b0b0; margin:0 0 24px; line-height:1.6;">Your Razariser account password was just changed. If this was you, no action is needed.</p>
        <p style="font-size:12px; color:#e2a03f; margin:0;">If you didn't make this change, contact us immediately at razarizerverify@gmail.com.</p>
      </div>
    </div>`,
  });
}

async function getSavedState(customerId) {
  const [{ data: cartRows }, { data: wlRows }, { data: address }] = await Promise.all([
    supabase.from('customer_cart_items').select('*').eq('customer_id', customerId),
    supabase.from('customer_wishlist_items').select('*').eq('customer_id', customerId),
    supabase.from('customer_addresses').select('*').eq('customer_id', customerId).maybeSingle(),
  ]);

  return {
    cart: (cartRows || []).map((r) => ({ name: r.name, price: r.price, size: r.size, qty: r.qty })),
    wishlist: (wlRows || []).map((r) => ({ name: r.name, price: r.price })),
    address: address || null,
  };
}

async function handleSignup(req, res) {
  const { name, email, phone, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const { data: existing } = await supabase.from('customers').select('id').eq('email', email).maybeSingle();
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists. Try signing in instead.' });
  }

  const { data: customer, error } = await supabase
    .from('customers')
    .insert([{ name: name || null, email, phone: phone || null, password_hash: hashPassword(password) }])
    .select()
    .single();

  if (error) throw error;

  const token = signCustomerToken({ customerId: customer.id, email: customer.email, exp: Date.now() + TOKEN_TTL_MS });
  return res.status(201).json({ token, customer: { id: customer.id, name: customer.name, email: customer.email } });
}

async function handleLogin(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const { data: customer, error } = await supabase.from('customers').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  if (!customer || !verifyPassword(password, customer.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signCustomerToken({ customerId: customer.id, email: customer.email, exp: Date.now() + TOKEN_TTL_MS });
  const saved = await getSavedState(customer.id);

  return res.status(200).json({
    token,
    customer: { id: customer.id, name: customer.name, email: customer.email },
    ...saved,
  });
}

async function handleMerge(req, res) {
  const session = requireCustomerAuth(req, res);
  if (!session) return;

  const { cart, wishlist } = req.body || {};

  if (Array.isArray(cart)) {
    for (const item of cart) {
      if (!item.name || !item.size) continue;
      const { data: existingRow } = await supabase
        .from('customer_cart_items')
        .select('*')
        .eq('customer_id', session.customerId)
        .eq('name', item.name)
        .eq('size', item.size)
        .maybeSingle();

      if (existingRow) {
        await supabase
          .from('customer_cart_items')
          .update({ qty: existingRow.qty + (item.qty || 1) })
          .eq('id', existingRow.id);
      } else {
        await supabase.from('customer_cart_items').insert([{
          customer_id: session.customerId,
          name: item.name,
          price: item.price,
          size: item.size,
          qty: item.qty || 1,
        }]);
      }
    }
  }

  if (Array.isArray(wishlist)) {
    for (const item of wishlist) {
      if (!item.name) continue;
      await supabase.from('customer_wishlist_items')
        .insert([{ customer_id: session.customerId, name: item.name, price: item.price }])
        .select()
        .maybeSingle()
        .then(() => {}, () => {}); // unique constraint silently skips duplicates
    }
  }

  const saved = await getSavedState(session.customerId);
  return res.status(200).json(saved);
}

async function handleSaveAddress(req, res) {
  const session = requireCustomerAuth(req, res);
  if (!session) return;

  const { name, phone, email, country, state, city, pincode, line1, line2 } = req.body || {};

  const { data, error } = await supabase
    .from('customer_addresses')
    .upsert(
      { customer_id: session.customerId, name, phone, email, country, state, city, pincode, line1, line2, updated_at: new Date().toISOString() },
      { onConflict: 'customer_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return res.status(200).json({ address: data });
}

async function handleGetState(req, res) {
  const session = requireCustomerAuth(req, res);
  if (!session) return;

  const saved = await getSavedState(session.customerId);
  return res.status(200).json(saved);
}

async function handlePasswordChangedEmail(req, res) {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  try {
    await sendPasswordChangedEmail(email);
  } catch (err) {
    console.error('Failed to send password-changed email:', err);
  }
  return res.status(200).json({ success: true });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Phone-Verify-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  try {
    if (req.method === 'POST' && action === 'signup') return await handleSignup(req, res);
    if (req.method === 'POST' && action === 'login') return await handleLogin(req, res);
    if (req.method === 'POST' && action === 'merge') return await handleMerge(req, res);
    if (req.method === 'POST' && action === 'save-address') return await handleSaveAddress(req, res);
    if (req.method === 'GET' && action === 'state') return await handleGetState(req, res);
    if (req.method === 'POST' && action === 'password-changed-email') return await handlePasswordChangedEmail(req, res);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('customers.js error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};    
