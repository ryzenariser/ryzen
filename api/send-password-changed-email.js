import nodemailer from 'nodemailer';

// Simple in-memory rate limiter (resets on cold start — fine for now)
const recentSends = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Block repeat sends within 60 seconds
  const lastSent = recentSends.get(email);
  const now = Date.now();
  if (lastSent && now - lastSent < 60_000) {
    return res.status(429).json({ error: 'Please wait before requesting again' });
  }
  recentSends.set(email, now);

  try {
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
      from: '"Razariser"
