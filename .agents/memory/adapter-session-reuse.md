---
name: Adapter session reuse
description: How to reuse a stored broker access_token without TOTP re-authentication in FyersAdapter / AngelAdapter.
---

## Rule
Call `adapter.configureSession(apiKey, accessToken)` — NOT `refreshSession()` — to prime a broker adapter from a stored token after a process restart.

## Why
Both current adapters (`FyersAdapter`, `AngelAdapter`) deliberately expose `configureSession()` for exactly this purpose: their data methods (`getHistoricalData`, `getQuotes`) require internal state set by either `login()` or `configureSession()`.  `refreshSession()` is a placeholder that throws `NotImplemented` in both.

## How to apply
- `configureSession(apiKey, accessToken)` is NOT on the `BrokerAdapter` interface — detect it via duck typing:
  ```ts
  const any = adapter as unknown as Record<string, unknown>;
  if (typeof any.configureSession === 'function') {
    (any.configureSession as (k: string, t: string) => void)(apiKey, accessToken);
  } else {
    await adapter.refreshSession(accessToken); // OAuth-refresh fallback
  }
  ```
- `api_key` in `broker_connections` maps to `appId` (Fyers) or `apiKey` (Angel) — it's always the first argument to `configureSession`.
- `access_token` in `broker_connections` is the JWT / access token — second argument.
- Both values are encrypted in the DB; call `decrypt()` before passing them.
- After configuring, cache the adapter instance keyed by `broker_connections.id` and expire it at `token_generated_at + 23 h`.

## Registration shortcut
`marketDataService.registerAdapter(connectionId, adapter, tokenGeneratedAt)` lets the broker-connections route register a freshly-logged-in adapter immediately, skipping the DB round-trip for the first request.
