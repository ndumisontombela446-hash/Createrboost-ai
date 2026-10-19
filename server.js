require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]', { mode: 0o600 });
function readOrders() { try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; } }
function writeOrders(orders) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), { mode: 0o600 }); }

// Preserve raw body for Paystack webhook HMAC validation.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(PUBLIC_DIR));

const PACKAGES = {
  'quick-start': { name: 'Quick Start Pack', amount: 9900, currency: 'ZAR', type: 'once-off' },
  'content-starter': { name: 'Content Starter', planCode: process.env.PAYSTACK_PLAN_STARTER, currency: 'ZAR', type: 'subscription' },
  'content-plus': { name: 'Content Plus', planCode: process.env.PAYSTACK_PLAN_PLUS, currency: 'ZAR', type: 'subscription' }
};

function requiredSecret() {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured on the server.');
  return process.env.PAYSTACK_SECRET_KEY;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'CreateBoost AI payments', mode: process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test-or-unconfigured' }));

app.post('/api/payments/initialize', async (req, res) => {
  try {
    const secret = requiredSecret();
    const email = String(req.body.email || '').trim().toLowerCase();
    const packageId = String(req.body.packageId || '');
    const item = PACKAGES[packageId];
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!item) return res.status(400).json({ error: 'Unknown package.' });
    if (item.type === 'subscription' && !item.planCode) {
      return res.status(503).json({ error: `Set the Paystack plan code for ${item.name} in the server environment first.` });
    }

    const reference = `cb_${crypto.randomBytes(12).toString('hex')}`;
    const order = { reference, email, packageId, packageName: item.name, expectedAmount: item.amount || null, currency: item.currency, type: item.type, status: 'pending', createdAt: new Date().toISOString() };
    const orders = readOrders(); orders.push(order); writeOrders(orders);

    const payload = { email, currency: item.currency, reference, callback_url: `${process.env.APP_BASE_URL || `http://localhost:${PORT}`}/api/payments/callback`, metadata: { packageId, packageName: item.name, orderReference: reference } };
    if (item.type === 'subscription') payload.plan = item.planCode;
    else payload.amount = item.amount;

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.status || !result.data?.authorization_url) {
      order.status = 'initialization_failed'; order.error = result.message || 'Paystack initialization failed'; writeOrders(orders);
      return res.status(502).json({ error: result.message || 'Paystack could not start checkout.' });
    }
    res.json({ authorization_url: result.data.authorization_url, reference });
  } catch (err) {
    console.error('Payment initialize error:', err.message);
    res.status(500).json({ error: err.message || 'Unable to initialize payment.' });
  }
});

async function verifyAndUpdate(reference) {
  const secret = requiredSecret();
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  const result = await response.json();
  if (!response.ok || !result.status) throw new Error(result.message || 'Could not verify transaction.');
  const transaction = result.data;
  const orders = readOrders();
  const order = orders.find(o => o.reference === reference);
  if (!order) throw new Error('No matching order found for this reference.');
  const item = PACKAGES[order.packageId];
  const paidAmount = Number(transaction.amount);
  const amountMatches = order.type === 'subscription' ? Boolean(transaction.plan_object?.plan_code === item.planCode || transaction.plan === item.planCode) : paidAmount === order.expectedAmount;
  if (transaction.status === 'success' && transaction.currency === order.currency && transaction.customer?.email?.toLowerCase() === order.email && amountMatches) {
    order.status = 'paid'; order.paidAt = new Date().toISOString(); order.paystackTransactionId = String(transaction.id);
  } else if (transaction.status === 'success') {
    order.status = 'review_required'; order.verificationIssue = 'Success event did not match expected email, currency, amount, or plan.';
  } else {
    order.status = transaction.status || 'not_paid';
  }
  writeOrders(orders);
  return order;
}

app.get('/api/payments/callback', async (req, res) => {
  const reference = String(req.query.reference || '');
  if (!reference) return res.redirect('/?payment=failed');
  try {
    const order = await verifyAndUpdate(reference);
    return res.redirect(order.status === 'paid' ? '/?payment=success' : '/?payment=failed');
  } catch (err) {
    console.error('Callback verification error:', err.message);
    return res.redirect('/?payment=failed');
  }
});

app.post('/api/payments/webhook', (req, res) => {
  try {
    const secret = requiredSecret();
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.sendStatus(401);
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success' && event.data?.reference) {
      // Respond quickly; verify asynchronously against Paystack's API before granting value.
      verifyAndUpdate(String(event.data.reference)).catch(err => console.error('Webhook verification error:', err.message));
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.sendStatus(500);
  }
});

// Do not expose order/customer data through a public admin endpoint.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => console.log(`CreateBoost AI running on port ${PORT}`));
