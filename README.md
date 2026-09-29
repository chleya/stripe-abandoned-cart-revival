# Stripe Abandoned Cart Revival

A production-oriented Cloudflare Worker that receives signed Stripe Checkout webhooks, stores lifecycle state in D1, suppresses recovery mail after a completed purchase, and sends a one-click Resend email using Stripe's official recovery URL.

## Why this exists
Abandoned checkout follow-up is usually delayed, manually operated, or risks sending a coupon after a customer has already paid. This edge worker keeps the state machine close to the webhook, uses idempotent D1 writes, and treats a completed checkout as the source of truth.

## Deploy
1. Create a D1 database and replace `database_id` in `wrangler.toml`.
2. Run `npx wrangler secret put STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, and optionally `REVIVE_DISCOUNT_CODE`.
3. Set `RESEND_FROM` to a verified Resend sender.
4. Apply `schema.sql` with `npx wrangler d1 execute stripe-cart-revival --remote --file=schema.sql`.
5. Configure Stripe's endpoint as `/webhooks/stripe` for `checkout.session.expired` and `checkout.session.completed`.
6. Set GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the included deployment workflow.

## Monetization
A Polar.sh-ready offer can charge $9/month for a managed endpoint, or 10% of recovered revenue. The worker itself remains self-hostable; billing and customer provisioning belong in a separate control plane.

## Security
Stripe signatures are verified with a five-minute replay window. Recovery URLs are taken only from Stripe's `after_expiration.recovery.url`; do not accept arbitrary redirect URLs from clients. Restrict D1 and Resend credentials to the Worker and GitHub Actions secrets.
