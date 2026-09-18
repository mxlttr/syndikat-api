# API improvement backlog

Small, low-risk improvements ordered roughly by payoff.

## P0 — do first

- [x] Add a CI workflow that runs `npm ci`, `npm test`, `npm run build`, `npm run biome:check`, and `npm run openapi:lint`.
- [x] Add a `check` script for the complete local quality gate, so contributors have one documented command to run.
- [x] Remove unused legacy type packages (`@types/axios`, `@types/cheerio`, `@types/stripe`, and verify whether `@types/ioredis` is still needed); regenerate the lockfile.
- [x] Add health-status test coverage for the response and dependency health fields.
- [x] Add a request ID to incoming requests and include it in error logs and error responses.
- [x] Replace ad-hoc `console.*` calls with a tiny structured logger that emits JSON in production and readable output locally.

## P1 — quick hardening

- [ ] Add common security headers with `helmet` (or equivalent) and document any intentional exceptions.
- [ ] Add route-level rate limiting for public scraping, product-search, training, and webhook endpoints.
- [ ] Set explicit request-body size limits instead of relying on Express defaults.
- [ ] Add timeouts and consistent error classification for every external HTTP call; include the upstream name in logs.
- [x] Standardize on Axios and remove direct `fetch` usage.
- [x] Add graceful shutdown for HTTP, Redis, and PostgreSQL connections on `SIGTERM`/`SIGINT`.
- [x] Add an npm `engines` check in CI and document the supported Node version in the workflow.

## P2 — small maintainability wins

- [x] Add HTTP-level tests for representative success and failure cases at the app boundary. (Run in CI; skipped locally where network listeners are restricted.)
- [x] Add coverage reporting to the test command and establish an initial non-blocking baseline.
- [o] Add dependency update automation (for example, Dependabot or Renovate) with a weekly schedule.
- [x] Upgrade Express 4 to Express 5 after checking route and error-handler compatibility.
- [ ] Add real local PostgreSQL and Redis provisioning, without Docker, or document a working mise-based setup.
- [ ] Add a startup log showing enabled optional integrations without printing secrets.
- [o] Document deployment, rollback, and migration procedures next to the development documentation.

## Definition of done

- [ ] All changes pass `npm test`, `npm run build`, `npm run biome:check`, and `npm run openapi:lint`.
- [ ] Public API behavior or schemas are reflected in `docs/openapi.yaml`.
- [ ] Changes to browser-consumed endpoints are checked against `syndikat-web`.
