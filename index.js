import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { toNodeHandler } from 'better-auth/node';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { jwt, admin } from 'better-auth/plugins';
import { createLocalJWKSet, jwtVerify } from 'jose';
import Stripe from 'stripe';

const env = process.env;
const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DATABASE || 'salonbook');
const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.CLIENT_URL],
  database: mongodbAdapter(db, { client }),
  emailAndPassword: { enabled: true, minPasswordLength: 6 },
  socialProviders: env.GOOGLE_CLIENT_ID ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {},
  plugins: [admin(), jwt()],
  hooks: {
    before: createAuthMiddleware(async context => {
      if (context.path !== '/sign-up/email') return;
      const password = context.body?.password;
      if (typeof password !== 'string' || password.length < 6 || !/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
        throw new APIError('BAD_REQUEST', { message: 'Use at least six characters with uppercase and lowercase letters' });
      }
    }),
  },
});
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
const services = db.collection('services');
const appointments = db.collection('appointments');
const transactions = db.collection('transactions');
await appointments.createIndex({ appointmentDate: 1, timeSlot: 1 }, {
  unique: true, partialFilterExpression: { occupied: true },
});
await transactions.createIndex({ stripeSessionId: 1 }, { unique: true });

const app = express();
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.all('/api/auth/{*path}', toNodeHandler(auth));
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(503);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }
  const session = event.data.object;
  const paid = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && session.payment_status === 'paid';
  const failed = event.type === 'checkout.session.async_payment_failed';
  if (paid || failed) {
    const ref = session.metadata?.appointmentId;
    const booking = ObjectId.isValid(ref) && await appointments.findOne({ _id: new ObjectId(ref), stripeSessionId: session.id });
    if (booking && session.amount_total === booking.amount && session.currency === booking.currency) {
      await transactions.updateOne({ stripeSessionId: session.id }, { $setOnInsert: {
        appointmentId: booking._id, customerId: booking.customerId, amount: session.amount_total,
        currency: session.currency, status: paid ? 'paid' : 'failed', createdAt: new Date(),
      } }, { upsert: true });
      if (paid) {
        await transactions.updateOne({ stripeSessionId: session.id }, { $set: { status: 'paid' } });
        await appointments.updateOne({ _id: booking._id, stripeSessionId: session.id }, { $set: { paymentStatus: 'paid' } });
      }
    }
  }
  res.sendStatus(200);
});
app.use(express.json({ limit: '7mb' }));

const fail = (status, message) => Object.assign(new Error(message), { status });
const id = value => {
  if (!ObjectId.isValid(value)) throw fail(400, 'Invalid ID');
  return new ObjectId(value);
};
const slots = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
const guard = role => async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return next(fail(401, 'Sign in to continue'));
  let subject;
  try {
    const jwks = await auth.api.getJwks();
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), { issuer: env.BETTER_AUTH_URL, audience: env.BETTER_AUTH_URL });
    subject = payload.sub;
  } catch { return next(fail(401, 'Invalid or expired session')); }
  const user = await db.collection('user').findOne({ $or: [{ _id: subject }, ...(ObjectId.isValid(subject) ? [{ _id: new ObjectId(subject) }] : [])] });
  if (!user || user.banned || (role && (user.role || 'user') !== role)) return next(fail(403, 'Access denied'));
  req.user = user;
  next();
};
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/services', async (req, res) => {
  const query = { status: 'active' };
  if (typeof req.query.category === 'string' && req.query.category) query.category = req.query.category;
  if (typeof req.query.search === 'string' && req.query.search) {
    const safe = req.query.search.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.serviceName = { $regex: safe, $options: 'i' };
  }
  const sort = req.query.sort === 'asc' ? { price: 1 } : req.query.sort === 'desc' ? { price: -1 } : { createdAt: -1 };
  res.json(await services.find(query).sort(sort).toArray());
});
app.get('/api/services/:id', guard(), async (req, res) => {
  const row = await services.findOne({ _id: id(req.params.id), status: 'active' });
  if (!row) throw fail(404, 'Service unavailable');
  res.json(row);
});
app.get('/api/admin/services', guard('admin'), async (req, res) => res.json(await services.find().toArray()));
function serviceFields(body) {
  const { serviceName, category, description, image, price, duration, status = 'active' } = body;
  if (![serviceName, category, description, image].every(x => typeof x === 'string' && x.trim()) ||
      !Number.isFinite(price) || price <= 0 || !Number.isInteger(duration) || duration <= 0 ||
      !['active', 'inactive'].includes(status)) throw fail(400, 'Enter valid service details');
  return { serviceName, category, description, image, price, duration, status };
}
app.post('/api/admin/images', guard('admin'), async (req, res) => {
  if (!env.IMGBB_API_KEY) throw fail(503, 'Image hosting is unavailable');
  if (typeof req.body.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(req.body.image)) throw fail(400, 'Select an image file');
  const body = new URLSearchParams({ key: env.IMGBB_API_KEY, image: req.body.image });
  const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body });
  const result = await response.json();
  if (!response.ok || !result.data?.url) throw fail(502, 'Image upload failed');
  res.json({ url: result.data.url });
});
app.post('/api/admin/services', guard('admin'), async (req, res) => {
  const record = { ...serviceFields(req.body), createdAt: new Date() };
  const { insertedId } = await services.insertOne(record);
  res.status(201).json({ ...record, _id: insertedId });
});
app.patch('/api/admin/services/:id', guard('admin'), async (req, res) => {
  const result = await services.updateOne({ _id: id(req.params.id) }, { $set: serviceFields(req.body) });
  if (!result.matchedCount) throw fail(404, 'Service not found');
  res.json({ ok: true });
});
app.delete('/api/admin/services/:id', guard('admin'), async (req, res) => {
  if (!(await services.deleteOne({ _id: id(req.params.id) })).deletedCount) throw fail(404, 'Service not found');
  res.sendStatus(204);
});
app.post('/api/appointments', guard('user'), async (req, res) => {
  const { appointmentDate, timeSlot, message } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) || !slots.includes(timeSlot)
    || !Number.isFinite(Date.parse(appointmentDate))
    || new Date(appointmentDate).toISOString().slice(0, 10) !== appointmentDate
    || appointmentDate < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })) throw fail(400, 'Select a valid date and time');
  const service = await services.findOne({ _id: id(req.body.serviceId), status: 'active' });
  if (!service) throw fail(404, 'Service unavailable');
  const record = {
    serviceId: service._id, customerId: req.user._id, customerName: req.user.name, customerEmail: req.user.email,
    serviceName: service.serviceName, image: service.image, category: service.category,
    appointmentDate, timeSlot, message: String(message || '').slice(0, 500), servicePrice: service.price,
    status: 'pending', paymentStatus: 'unpaid', occupied: true, createdAt: new Date(),
  };
  const { insertedId } = await appointments.insertOne(record);
  res.status(201).json({ ...record, _id: insertedId });
});
app.get('/api/appointments', guard('user'), async (req, res) => res.json(await appointments.find({ customerId: req.user._id }).sort({ createdAt: -1 }).toArray()));
app.get('/api/admin/appointments', guard('admin'), async (req, res) => res.json(await appointments.find().sort({ createdAt: -1 }).toArray()));
app.patch('/api/appointments/:id/cancel', guard('user'), async (req, res) => {
  const result = await appointments.updateOne({ _id: id(req.params.id), customerId: req.user._id, status: 'pending' },
    { $set: { status: 'cancelled', occupied: false } });
  if (!result.matchedCount) throw fail(409, 'Only your pending appointments can be cancelled');
  res.json({ ok: true });
});
app.patch('/api/admin/appointments/:id', guard('admin'), async (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'cancelled'].includes(status)) throw fail(400, 'Invalid status');
  const allowed = status === 'confirmed' ? ['pending'] : ['pending', 'confirmed'];
  const booking = await appointments.findOne({ _id: id(req.params.id), status: { $in: allowed } });
  if (!booking) throw fail(409, 'This appointment cannot change to the requested status');
  if (status === 'cancelled' && booking.stripeSessionId && booking.paymentStatus !== 'paid') {
    if (!stripe) throw fail(503, 'Checkout is unavailable');
    const checkout = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
    if (checkout.status === 'open') {
      try { await stripe.checkout.sessions.expire(checkout.id); }
      catch { throw fail(409, 'Checkout changed. Reload the appointment and try again'); }
    } else if (checkout.status === 'complete') {
      const failure = await transactions.findOne({ stripeSessionId: checkout.id, status: 'failed' });
      if (!failure) throw fail(409, 'Payment is being verified. Try again after the status updates');
    }
  }
  const filter = {
    _id: booking._id,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    stripeSessionId: booking.stripeSessionId || { $exists: false },
  };
  const result = await appointments.updateOne(filter, { $set: { status, occupied: status !== 'cancelled' } });
  if (!result.matchedCount) throw fail(409, 'The appointment changed. Reload and try again');
  res.json({ ok: true });
});
app.post('/api/appointments/:id/checkout', guard('user'), async (req, res) => {
  if (!stripe) throw fail(503, 'Payments are unavailable');
  const bookingId = id(req.params.id);
  const booking = await appointments.findOne({ _id: bookingId, customerId: req.user._id, status: 'confirmed', paymentStatus: 'unpaid' });
  if (!booking) throw fail(409, 'Only confirmed unpaid appointments can be paid');
  if (booking.stripeSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
    if (existing.status === 'open') return res.json({ url: existing.url });
    if (existing.status !== 'expired') throw fail(409, 'Payment is being verified');
    await appointments.updateOne({ _id: bookingId, stripeSessionId: existing.id }, { $unset: { stripeSessionId: '' } });
  }
  const currency = env.STRIPE_CURRENCY || 'usd';
  const amount = Math.round(booking.servicePrice * 100);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency, unit_amount: amount, product_data: { name: booking.serviceName } } }],
    metadata: { appointmentId: String(bookingId) },
    success_url: env.CLIENT_URL + '/payment/success',
    cancel_url: env.CLIENT_URL + '/payment/cancel',
  }, { idempotencyKey: 'salonbook-' + bookingId + '-' + (booking.stripeSessionId || 'initial') });
  const result = await appointments.updateOne({ _id: bookingId, status: 'confirmed', paymentStatus: 'unpaid', stripeSessionId: { $exists: false } },
    { $set: { stripeSessionId: session.id, currency, amount } });
  if (!result.matchedCount) {
    const current = await appointments.findOne({ _id: bookingId });
    if (current?.stripeSessionId !== session.id) {
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      throw fail(409, 'Appointment changed during checkout');
    }
  }
  res.json({ url: session.url });
});
app.get('/api/admin/users', guard('admin'), async (req, res) => res.json(await db.collection('user').find({ role: { $ne: 'admin' } }, {
  projection: { name: 1, email: 1, image: 1, role: 1, banned: 1 },
}).toArray()));
app.patch('/api/admin/users/:id', guard('admin'), async (req, res) => {
  if (typeof req.body.blocked !== 'boolean') throw fail(400, 'Invalid block status');
  const result = await db.collection('user').updateOne({ _id: id(req.params.id), role: { $ne: 'admin' } }, { $set: { banned: req.body.blocked } });
  if (!result.matchedCount) throw fail(404, 'User not found');
  res.json({ ok: true });
});
app.get('/api/transactions', guard('user'), async (req, res) => res.json(await transactions.aggregate([
  { $match: { customerId: req.user._id } },
  { $lookup: { from: 'appointments', localField: 'appointmentId', foreignField: '_id', as: 'appointment' } },
  { $unwind: { path: '$appointment', preserveNullAndEmptyArrays: true } },
  { $project: { amount: 1, currency: 1, status: 1, createdAt: 1, 'appointment.serviceName': 1, 'appointment.appointmentDate': 1 } },
  { $sort: { createdAt: -1 } },
]).toArray()));
app.get('/api/admin/transactions', guard('admin'), async (req, res) => res.json(await transactions.aggregate([
  { $lookup: { from: 'appointments', localField: 'appointmentId', foreignField: '_id', as: 'appointment' } },
  { $unwind: { path: '$appointment', preserveNullAndEmptyArrays: true } },
  { $sort: { createdAt: -1 } },
]).toArray()));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 11000) return res.status(409).json({ error: 'This time slot is already booked' });
  if (!err.status) console.error(err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Unable to complete the request' });
});
app.listen(env.PORT || 4000, () => console.log('SalonBook API ready'));




