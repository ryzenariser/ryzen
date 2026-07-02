const Razorpay = require('razorpay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, currency, receipt } = req.body || {};

    if (!amount || typeof amount !== 'number' || amount < 100) {
      return res.status(400).json({ error: 'Amount must be at least 100 paise (₹1).' });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount),
      currency: currency || 'INR',
      receipt: receipt || `ryzen_${Date.now()}`,
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error('create-order error:', err);
    if (err.statusCode === 401) {
      return res.status(401).json({ error: 'Razorpay authentication failed. Check your API keys.' });
    }
    return res.status(500).json({ error: 'Could not create order. Please try again.' });
  }
};
