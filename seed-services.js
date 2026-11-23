import { MongoClient } from 'mongodb';

const examples = [
  ['Signature Haircut', 'Haircut & Styling', 30, 45, 'A consultation, tailored haircut and blow-dry.'],
  ['Gloss & Tone', 'Hair Coloring', 55, 60, 'Refresh your hair color with a low-commitment gloss.'],
  ['Deep Conditioning', 'Hair Treatment', 35, 40, 'A conditioning treatment for dry or dull hair.'],
  ['Hydrating Facial', 'Facial & Skincare', 50, 50, 'A gentle cleanse, mask and hydration treatment.'],
  ['Classic Manicure', 'Manicure & Pedicure', 25, 40, 'Nail shaping, cuticle care and a classic polish.'],
  ['Relaxation Massage', 'Spa & Massage', 65, 60, 'A relaxing full-body massage with adjustable pressure.'],
];

const images = JSON.parse(process.env.SALONBOOK_SEED_IMAGES || '[]');
if (!Array.isArray(images) || images.length !== examples.length ||
    !images.every(image => typeof image === 'string' && URL.canParse(image) && new URL(image).protocol === 'https:')) {
  throw new Error('Set SALONBOOK_SEED_IMAGES to a JSON array of six HTTPS salon service image URLs.');
}
if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before seeding.');

const client = new MongoClient(process.env.MONGODB_URI);
try {
  const services = client.db(process.env.MONGODB_DATABASE || 'salonbook').collection('services');
  const operations = examples.map(([serviceName, category, price, duration, description], index) => ({
    updateOne: {
      filter: { serviceName },
      update: { $setOnInsert: {
        serviceName, category, price, duration, description,
        image: images[index], status: 'active', createdAt: new Date(),
      } },
      upsert: true,
    },
  }));
  const result = await services.bulkWrite(operations);
  console.log('Added %d sample services. Existing records were preserved.', result.upsertedCount);
} finally {
  await client.close();
}
