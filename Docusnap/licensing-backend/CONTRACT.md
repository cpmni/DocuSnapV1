# /v1 API contract (frozen — Loop 2)

Versioned, narrow, HTTPS-only, JSON. Every request carries `product_id` and
`fp_hash`. Every response that grants **or denies** access returns a **signed
token** (compact JWS, `alg=EdDSA`) the client verifies offline; HTTP transport is
never the trust anchor. Additive-only; breaking changes become `/v2`.

## Token claims (every token)
`kid` (JWS header), `product_id`, `subject` (`trial:<fp_hash>` | `seat:<seat_id>`),
`kind` (`trial|seat`), `state` (`active|expired|revoked|seat_reassigned`),
`issued_at`, `not_after`, `grace_until` (= `issued_at + 7d`; `not_after ==
grace_until` in v1, both retained), `nonce`.
- trial kind adds: `trial_start`, `trial_end`.
- seat kind adds: `entitlement_id`, `seat_id`, `seats_total`, `seats_used`,
  `expires_at`, and (schema_version 2) `schema_version`, `features`.

### Phase 2: signed per-feature capacity (`schema_version: 2`, seat tokens)
A seat token carries `schema_version: 2` and a `features` OBJECT mapping each licensed
feature to its seat capacity, e.g. `{"core":1,"search":2,"workflow":1}`. These counts are
SIGNED (tamper-proof, offline-verifiable), so the desktop enforces the per-feature caps
(concurrent search clients, the workflow add-on) from the TOKEN rather than the unsigned
JSON body. ADDITIVE / backward-compatible: a verifier that doesn't read `features` ignores
it, and an OLDER token without `schema_version`/`features` is still valid — the desktop then
falls back to the Phase 1 per-feature counts carried in the (unsigned) JSON response.
Once a v2 token is present its signed `features` take precedence; the unsigned JSON cannot
raise the caps. activate/validate retain the JSON `features` field only for that Phase-1
fallback.

## Endpoints
| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| POST | `/v1/trial/start` | start **or resume** trial | `fp_hash` | signed trial token (resume if `fp_hash` known — never re-mints) |
| POST | `/v1/activate` | bind a **seat** to this fingerprint | `account_key, fp_hash, device_label?` | signed seat token, or `seat_limit_reached` (4xx) |
| POST | `/v1/validate` | refresh/re-verify current token | `fp_hash, token_id?` | fresh signed token + state |
| POST | `/v1/revoke` | release the seat on this fingerprint | `account_key, fp_hash` (or admin) | confirmation; seat freed |
| GET  | `/v1/status` | read-only snapshot (**display only**, unsigned) | `fp_hash` | `state, days_remaining, seats_total, seats_used` |

- **Reactivate** = `revoke` (old fp) then `activate` (new fp); **no new
  entitlement** is created.
- Operational errors (no access-state change) return HTTP 4xx
  `{ "error": { "code", "message", "request_id" } }`. Codes: `bad_request,
  unknown_account, unknown_product, seat_limit_reached, not_bound, rate_limited`.
- `seat_limit_reached` is a 4xx error (no token); `revoked` / `expired` /
  `seat_reassigned` ARE signed tokens (authoritative, tamper-proof lock).
