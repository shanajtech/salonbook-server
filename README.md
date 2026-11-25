# SalonBook server

Express REST API for salon services, role-based bookings and Stripe Checkout. Uses MongoDB, Better Auth, JWT verification, Stripe and ImgBB.

1. Run npm ci.
2. Copy .env.example to .env and set the MongoDB URI, Better Auth secret and URLs.
3. Run npm start. GET /health reports readiness after MongoDB connects.
4. Sign up with a dedicated test account from the client. Promote it with node --env-file=.env promote-admin.js your-test-email. Use a separate customer account.
5. Configure the Google callback at BETTER_AUTH_URL/api/auth/callback/google.
6. Configure Stripe test keys and webhook delivery at /api/stripe/webhook. Listen for checkout.session.completed, checkout.session.async_payment_succeeded and checkout.session.async_payment_failed. Enter the endpoint signing secret.
7. Configure the ImgBB API key before adding services.

In production, set both CLIENT_URL and BETTER_AUTH_URL to the HTTPS Next.js origin. Set SALONBOOK_API_ORIGIN on the Next.js host to the separately deployed Express origin. Register the Google OAuth callback on the public Next.js origin and send Stripe webhooks directly to the Express origin. Keep the default browser API setting relative so session cookies stay on the Next.js origin. Do not publish secrets or put evaluator passwords in the README.

Add live client, client repository and server repository links once deployed.

## Application links

- [Client repository](https://github.com/shanajtech/salonbook-client)
- [Server repository](https://github.com/shanajtech/salonbook-server)
- Public deployment pending.

## Add six starter services

Use the admin dashboard and ImgBB to upload service photos. Alternatively, for initial data setup, set SALONBOOK_SEED_IMAGES to a JSON array of six public HTTPS image URLs you may use. Run node --env-file=.env seed-services.js. The script inserts missing example services and leaves existing records alone.

## Before submitting Assignment 9

1. In the server folder, run node --env-file=.env check-launch.js. This checks configuration names and formats without printing values.
2. Start the Express server and check GET /health. Deploy Express and Next.js to HTTPS hosts, then register the deployed OAuth callback and Stripe test webhook.
3. Add six active services with photos and run the client smoke check against the deployed Next.js URL.
4. With a dedicated customer, sign in, book a free slot and verify it appears as pending and unpaid. Try booking the same slot again and confirm the conflict is handled.
5. With a dedicated admin, confirm the booking. As the customer, go through Stripe test checkout and verify the webhook changes the booking to paid and shows the transaction in both dashboards. Verify a second customer cannot access the first booking.
6. Refresh the protected pages as each role. Verify the admin can activate/deactivate services, cancel an eligible booking, and block/unblock a dedicated test customer.
7. Add the live URL to both READMEs. Submit the live URL, both repository URLs, and the dedicated evaluator admin email and password in the course form.
