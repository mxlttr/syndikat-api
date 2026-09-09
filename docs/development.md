# API development

## Local setup

Install dependencies with `npm install`. Supply a local `.env` with configuration appropriate for the features being exercised, then run `npm run dev`. Use `npm run build` for the distributable `dist/` output and `npm start` to run it.

## Environment variables

Configuration names are documented here only; values, tokens, passwords, and production URLs must stay out of the repository.

| Category | Variables |
| --- | --- |
| Runtime and CORS | `NODE_ENV`, `PORT`, `ALLOWED_ORIGIN`, `ALLOWED_ORIGIN_SUFFIX` |
| Caching | `REDIS_URL`, `CACHE_EXPIRY` |
| Tournament sources | `OFFICIAL_URL`, `TOURNAMENTS_API_TOKEN`, `TOURNAMENTS_API_SECRET`, `METRIX_URL` |
| Ratings and bag tags | `RATING_URL`, `BAGTAG_ENDPOINT` |
| Route planning | `OPENROUTESERVICE_API_KEY`, `OPENROUTESERVICE_API_URL`, `BAHN_STATION_API_URL` |
| Product feed | `NEW_PRODUCT_DAYS` |
| Training signups | `DATABASE_URL`, `SESSION_SECRET`, `TRAINING_SIGNUP_PASSWORD` |
| Stripe integration (not public API documentation) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Membership analytics | `UMAMI_SEND_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_HOSTNAME`, `STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS`, `DATABASE_URL` |
| Existing notification integration | `DISCORD_CHANNEL_ID`, `DISCORD_WEBHOOK_URL` |

The environment schema currently expects the listed source configuration fields to be present. Training signup endpoints additionally require a database URL, a session secret of at least 32 characters, and a signup password; otherwise they return `503`.

## Dependencies and checks

- Redis is optional outside production. It enables response caching and contributes to health status.
- PostgreSQL is optional unless training signup or membership analytics is enabled. Startup applies pending migrations automatically.
- OpenRouteService is needed for route planning and tournament-location normalization. Deutsche Bahn station lookup is optional.
- Scrapers depend on third-party markup and feeds, so change selectors conservatively and keep error handling resilient.

Run before submitting changes:

```sh
npm run build
npm run biome:check
npm run openapi:lint
```

For any API change, compare the affected route with `docs/openapi.yaml` and test its browser integration in [mxlttr/syndikat-web](https://github.com/mxlttr/syndikat-web).

The `/tournaments/on-tour` response includes Syndikat players from both the starter and waiting lists. Each `our_players` entry includes `waitlisted` (boolean); the website lists starters first and groups waiting-list players in parentheses, e.g. “Person 1, Person 2, (Person 3, Person 4)”.

## Membership conversion analytics

The existing signed `POST /stripe-webhook` endpoint optionally sends
`membership_completed` to Umami for paid subscription Checkouts from an explicit
membership Payment Link allowlist. Existing payment notifications remain unchanged.
No website changes are required; these are aggregate server-side counts and are
not attributed to the original browser visitor or its funnel.

Enable the integration by setting all of:

- `UMAMI_SEND_URL`: complete Umami collection endpoint including `/api/send`.
- `UMAMI_WEBSITE_ID`: target website UUID (consider a separate website for backend
  events so synthetic server sessions do not affect visitor conversion rates).
- `UMAMI_HOSTNAME`: hostname associated with that website, without a scheme.
- `STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS`: comma-separated Stripe `plink_...` IDs for
  membership links. These are API IDs, not the codes in public `buy.stripe.com` URLs.
- `DATABASE_URL`: PostgreSQL for durable delivery records. Startup applies the
  new analytics migration automatically.

Leave all four analytics settings unset to disable tracking. Partial configuration
fails startup. Configure the existing Stripe webhook destination to receive
`checkout.session.completed` and `checkout.session.async_payment_succeeded`, keeping
`payment_intent.succeeded` for existing notifications. Use matching test/live Stripe
configuration and a separate Umami website when testing.

Only `paid` sessions with `mode=subscription` and an allowlisted Payment Link qualify.
Unpaid or free-trial checkouts, donations, and recurring invoice payments do not count.
A free trial's later first invoice is not currently tracked as a new membership.
Events contain the Payment Link ID, amount in currency minor units, currency, and
`source=stripe_webhook`; no customer details or checkout IDs are sent to Umami.

PostgreSQL serializes delivery by Checkout Session ID and skips already delivered
sessions, including when both completion event types arrive. Delivery/database failures
return 503 so Stripe can retry. Delivery is at-least-once: if Umami accepts a request
but the response is lost, or the database commit fails afterwards, a retry can duplicate
it. Umami's collection API has no documented idempotency key. Failed events beyond
Stripe's retry window need manual redelivery from Stripe; there is no background worker.

Run the focused regression checks with:

```sh
node --import tsx --test tests/membershipAnalytics.test.ts
```
