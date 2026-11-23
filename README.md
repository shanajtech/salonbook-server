# SalonBook server

Express REST API for salon services, role-based bookings and Stripe Checkout. Uses MongoDB, Better Auth, JWT verification, Stripe and ImgBB.

1. Run npm ci.
2. Copy .env.example to .env and set the MongoDB URI, Better Auth secret and URLs.
3. Run npm start. GET /health reports readiness after MongoDB connects.
4. Sign up with a dedicated test account from the client. Promote it with node --env-file=.env promote-admin.js your-test-email. Use a separate customer account.
5. Configure the Google callback at BETTER_AUTH_URL/api/auth/callback/google.
6. Configure Stripe test keys and webhook delivery at /api/stripe/webhook. Listen for checkout.session.completed and checkout.session.async_payment_succeeded. Enter the endpoint signing secret.
7. Configure the ImgBB API key before adding services.

Production needs HTTPS, exact configured client and auth origins, and browser-compatible cookie delivery. Host the two apps on same-site HTTPS origins or verify your reverse proxy and cookie setup before evaluation. Create six active services through the admin dashboard. Do not publish secrets or put evaluator passwords in the README.

Add live client, client repository and server repository links once deployed.

