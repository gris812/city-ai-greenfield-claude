# Telvey API contract (v1)

All types referenced here are defined in `packages/core/src/contracts.ts` (single source of truth). Base URL `API_BASE_URL`. JSON over HTTPS; one WebSocket per active session. All times epoch ms.

## Auth model
- **Guest-first.** `POST /v1/guest` → `{ guestId, token }` (signed JWT, role `guest`, 90-day expiry). No PII.
- **Optional account.** `POST /v1/auth/otp/start {email}` → sends code (only when an email provider is configured; otherwise 501). `POST /v1/auth/otp/verify {email, code}` → `{ token, user }`, merging the guest's history into the account.
- **Admin (web).** WebAuthn passkeys: `POST /v1/admin/webauthn/register/options|verify` (requires a one-time bootstrap code from `pnpm --filter @city/api admin:bootstrap`, or an invite by an existing owner), `POST /v1/admin/webauthn/login/options|verify` → admin JWT with role `owner|admin|analyst` (12 h).
- **Admin (mobile).** `POST /v1/admin/pairing` (web admin, returns `{code, qrPayload, expiresAt}` valid 5 min) → phone calls `POST /v1/admin/pairing/redeem {code, deviceName}` → device-scoped admin token (role ≤ issuer's, revocable at `DELETE /v1/admin/devices/:id`).
- Every admin mutation is appended to `audit_log`.

## Session lifecycle
| Method | Path | Body → Response |
|---|---|---|
| POST | `/v1/sessions` | `{guideId, locale, units:'metric'|'imperial', simulated, client:{platform, appVersion}}` → `{sessionId, wsUrl, guide, policyVersion}` |
| GET | `/v1/sessions/:id` | → session summary + memory digest |
| POST | `/v1/sessions/:id/end` | → `{durationS, stories, costUsdEstimate}` |

## Realtime channel — `GET /v1/sessions/:id/ws?token=…`
Client → server messages (`{type, ...}`):
- `context` — a `ContextFrame` (send every 1–2 s while moving, every 10 s stationary; batched fixes).
- `audio_progress` — `{planId, segmentIndex, offsetMs, state:'playing'|'finished'|'stopped'}`.
- `utterance` — `{text, sttProvider?, speechEndAt}` (client-side or server STT result).
- `control` — `{action:'skip'|'pause'|'resume'|'stop'|'repeat'|'not_that_one'|'quieter'|'chattier'|'interrupt', at}`.
- `ping`.

Server → client: `directive` messages carrying a core `Directive` (`play`, `stop_audio`, `map`, `listen`, `say`, `navigate_handoff`, `state`, `card`), plus `pong` and `error {code, retryable}`.
- Directives carry a monotonic `directiveSeq`; clients ACK via `audio_progress`/`ack` so reconnection never replays a story or tool action (E3).
- On reconnect the client sends `resume {lastDirectiveSeq}`; server re-sends only un-acked directives.

## REST fallbacks (for WebApp debugging and degraded transport)
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/sessions/:id/context` | same as WS `context`, returns directives |
| POST | `/v1/sessions/:id/utterance` | same as WS `utterance`, returns directives |
| POST | `/v1/sessions/:id/control` | same as WS `control` |
| GET | `/v1/audio/:hash.mp3` | content-addressed TTS segment (immutable, `Cache-Control: public, max-age=31536000`) |
| POST | `/v1/nearby` | `{sessionId, query, category?, location}` → validated results (NearbySearch tool, independent of discovery filtering) |
| POST | `/v1/stt` | audio upload → transcript (hybrid voice path) |
| POST | `/v1/realtime/token` | ephemeral realtime-provider credential, gated by ProviderBudget; → `{provider, clientSecret, expiresAt, maxSeconds}` |
| POST | `/v1/feedback` | `{sessionId, planId?, rating, reason?}` |
| GET | `/v1/me/history` | the user's discussed places (from journey memory) |
| DELETE | `/v1/me` | delete account/guest data |
| GET | `/v1/guides` | Guide profiles (public fields) |
| GET | `/healthz`, `/readyz` | liveness / dependencies |

## Admin API (role-gated)
| Path | Role | Content |
|---|---|---|
| `GET /v1/admin/metrics/overview?range=` | analyst+ | DAU/WAU/MAU, guest vs account, sessions, duration, stories funnel, questions, nearby, guide mix, regime mix |
| `GET /v1/admin/metrics/latency` | analyst+ | p50/p95 per interaction (trigger→first audio, speech-end→first audio, barge-in stop, nearby) |
| `GET /v1/admin/metrics/cost` | analyst+ | cost by provider/task/day, cost per session & per active user |
| `GET /v1/admin/metrics/providers` | analyst+ | calls, errors, fallbacks, cache hit rates by layer |
| `GET /v1/admin/metrics/quality` | analyst+ | wrong-target signals (`not_that_one`), skips, feedback, grounding failures |
| `GET /v1/admin/metrics/geo` | analyst+ | geohash-5 aggregates with k-anonymity (≥ 5 sessions per cell) |
| `GET /v1/admin/health` | analyst+ | API/DB/Redis status, recent errors, build SHA |
| `GET /v1/admin/sessions/:id/explain` | admin+ | decision timeline for one session (scores, suppression reasons) |
| `GET/PUT /v1/admin/config/budgets` | owner | provider budgets & kill switches (audited) |
| `GET /v1/admin/audit` | owner | audit log |
| `GET/POST/DELETE /v1/admin/users…` | owner | admin invites, roles, device revocation |

## Implementation notes (apps/api, additive to the contract above)
- **Envelope.** Every server directive is sent as `{type:'directive', seq, turn, ref?, at, directive}`. `turn` identifies the conversation turn (null = ambient narration); clients drop audio for turns older than the latest `stop_audio`. `ref` is set on `say` directives: report its end with `audio_progress {planId: ref, state:'finished'}` so the server can resume an interrupted story immediately (C1).
- **WS extras.** On connect the server sends `{type:'hello', sessionId, lastDirectiveSeq}`. Client may send `ack {seq}` (cumulative) and `resume {lastDirectiveSeq}`; utterances may carry `utteranceId` (idempotency — a retried id never re-runs a tool, E3).
- **Additive REST.** `POST /v1/sessions/:id/audio_progress` (REST twin of the WS message), `GET /v1/sessions/:id/directives?after=N` (REST twin of `resume`), `POST /v1/realtime/usage {sessionId, provider, model, userAudioS, assistantAudioS, connectMs?}` (realtime minutes → cost ledger), `POST /v1/stt?sessionId=…&submit=1` also runs the transcript as an utterance and returns directives.
- **Audio URLs** are `/v1/audio/<40-hex>.mp3` (or `.wav` for Gemini TTS). A `play` directive lists every segment URL immediately; segments after 0 are synthesized in the background and the audio route waits for them. A 404 means "speak `segments[i].text` with on-device TTS" (F4). `audioUrl: null` means the same for the whole plan.
- `/v1/nearby` returns `{provider, fake, category, results, invalidDropped, answer, map}`.
- Admin: `POST /v1/admin/users/invites {email, role}` (owner) returns a one-time code for `register/options|verify`; `DELETE /v1/admin/users/:id` disables an admin and revokes their devices.
