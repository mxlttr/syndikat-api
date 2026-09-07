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
| Existing notification integration | `DISCORD_CHANNEL_ID`, `DISCORD_WEBHOOK_URL` |

The environment schema currently expects the listed source configuration fields to be present. Training signup endpoints additionally require a database URL, a session secret of at least 32 characters, and a signup password; otherwise they return `503`.

## Dependencies and checks

- Redis is optional outside production. It enables response caching and contributes to health status.
- PostgreSQL is optional unless training signup is enabled. Startup applies pending migrations automatically.
- OpenRouteService is needed for route planning and tournament-location normalization. Deutsche Bahn station lookup is optional.
- Scrapers depend on third-party markup and feeds, so change selectors conservatively and keep error handling resilient.

Run before submitting changes:

```sh
npm run build
npm run biome:check
npm run openapi:lint
```

For any API change, compare the affected route with `docs/openapi.yaml` and test its browser integration in [mxlttr/syndikat-web](https://github.com/mxlttr/syndikat-web).
