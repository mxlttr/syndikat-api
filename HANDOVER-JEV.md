# Jev disc recommendation handover

## Current status

The API now exposes a server-side Jev middleware endpoint:

```text
POST /recommendations/discs
```

The endpoint accepts a validated player profile and calls Jev without exposing `JEV_API_KEY` to the browser.

## Request

```json
{
  "skill": "beginner",
  "distance": "60",
  "throwType": "backhand",
  "category": "midrange",
  "stability": "understable",
  "shot": "straight"
}
```

Allowed values are defined in `src/routes/recommendationsRouter.ts`.

## Jev integration

The middleware calls:

```text
https://jevtypesafeai.com/api/v1/decide
```

with a Bearer token from `JEV_API_KEY` and fixed questions for:

- recommended disc category
- beginner fit
- stability fit

The API key is optional in the environment schema. If it is absent, the endpoint returns `503`. Invalid upstream credentials return `502` with a provider status and sanitized provider message.

`src/env.ts` explicitly loads `syndikat-api/.env`, including when the monorepo is started from the parent directory, and gives that file precedence over inherited environment variables.

## Web integration

`syndikat-web/scheiben-empfehlung.md` submits the default form to this endpoint. The form currently displays Jev’s raw JSON response for prototyping.

## Verified result

The default form successfully returned Jev output:

- recommended category: `midrange`
- beginner fit: `2.78 / 3`
- stability fit: `2.75 / 3`
- confidence: `0.75–0.98`
- reported cost: `$0.00022`

The API TypeScript build passes with:

```bash
npm run build
```

## Next step

Pass actual candidate discs from `syndikat-web/assets/discs.json` to the API, then extend the Jev workflow to rank those candidates. Keep deterministic filtering (category, flight numbers, price, availability, deduplication) in code and use Jev for player-to-disc fit judgments.

Do not put the Jev key in `syndikat-web` or commit `.env` values.
