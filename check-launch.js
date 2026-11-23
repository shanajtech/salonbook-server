const required = [
  'MONGODB_URI', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'CLIENT_URL',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'IMGBB_API_KEY',
];

const missing = required.filter(name => !process.env[name]?.trim());
const issues = missing.map(name => 'Missing ' + name);
const { CLIENT_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET, MONGODB_URI, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;

for (const [name, value] of Object.entries({ CLIENT_URL, BETTER_AUTH_URL })) {
  if (!value) continue;
  if (!URL.canParse(value)) {
    issues.push(name + ' must be a valid origin');
    continue;
  }
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (value !== url.origin || (!loopback && url.protocol !== 'https:')) {
    issues.push(name + ' must be an origin without a trailing slash, using HTTPS outside localhost');
  }
}
if (CLIENT_URL && BETTER_AUTH_URL && CLIENT_URL !== BETTER_AUTH_URL) issues.push('Set CLIENT_URL and BETTER_AUTH_URL to the same Next.js origin');
if (MONGODB_URI && !/^mongodb(?:\+srv)?:\/\//.test(MONGODB_URI)) issues.push('MONGODB_URI must use the MongoDB protocol');
if (BETTER_AUTH_SECRET && BETTER_AUTH_SECRET.length < 32) issues.push('BETTER_AUTH_SECRET must be at least 32 characters');
if (STRIPE_SECRET_KEY && !STRIPE_SECRET_KEY.startsWith('sk_test_')) issues.push('Use a Stripe test-mode secret key for evaluation');
if (STRIPE_WEBHOOK_SECRET && !STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) issues.push('Set the Stripe webhook endpoint signing secret');

if (issues.length) {
  for (const issue of issues) console.error(issue);
  process.exitCode = 1;
} else {
  console.log('All assignment configuration fields are present. Test the live integrations before submitting.');
}
