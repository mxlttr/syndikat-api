# syndikat-api

The backend for the Syndikat Disc Golf website. It presents a small public HTTP API over tournament and ratings sources, bag tags, shop product data, route planning, and training signups.

## Architecture

Express routers call focused services and scrapers. Redis is an optional cache; PostgreSQL is used only for training signups. The website is the primary consumer. See [architecture](docs/architecture.md), [development](docs/development.md), and the website-facing [OpenAPI contract](docs/openapi.yaml).

## Prerequisites

- Node.js 24 or newer
- npm
- Redis for production caching (optional locally)
- PostgreSQL when working on training signups

Configure the environment variables described in [development](docs/development.md). Do not commit `.env` files or credentials.

## Setup and commands

```sh
npm install
npm run dev
```

The development server listens on port `8080` unless `PORT` is set.

```sh
npm run build
npm run biome:check
npm run openapi:lint
npm start
```

When changing a browser-consumed route, update `docs/openapi.yaml` and the corresponding usage in [mxlttr/syndikat-web](https://github.com/mxlttr/syndikat-web) in the same review.
