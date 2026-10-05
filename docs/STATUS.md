# Working Status

Updated: 2026-10-04 (investor/business analysis pass; replaces the stale 2026-09-27 12:01 version)

| Slice | State |
|---|---|
| Repo scaffold, secrets hygiene, DECISIONS (D-001 to D-024), clarifications | Done |
| Brand and naming (working brand **Telvey**; Guides **Ida**, **Emil**) | Done: `docs/BRAND.md`, assets. Preliminary non-legal screening only; domains unregistered (last RDAP check 2026-09-27) |
| Market, competitor, monetization, provider-pricing research | Done, dated 2026-09-27 (`docs/research/*`, `benchmark/research/*.json`) |
| Deterministic core (`packages/core`) | Done: 189 tests |
| Replay harness and fixtures | Done: 6 scenarios, 35 tests |
| Providers (adapters, router, guard, fakes) | Done: 104 tests; **no real provider exercised** (no keys) |
| Backend API (Fastify, WS, Postgres, Redis) | Done: 88 tests against fake providers |
| Web (site, WebApp/PWA, admin console) | Built; runs locally in offline demo mode; 5/5 Playwright smoke tests; **not deployed** |
| Mobile (Expo) | Code complete; JS bundles and `expo prebuild` pass; 15 logic tests; **no native build, never run on a device** |
| Benchmarks and cost model | Done: acceptance 13 PASS / 8 PARTIAL / 0 FAIL / 6 NOT RUN; cost model ESTIMATED at list prices |
| Cost/latency work D-018 to D-024 | Done, committed as `51a787e` |
| Investor report and comparison packet | `deliverables/INVESTOR_REPORT.md` / `.pdf` (47 pages), `deliverables/telvey-comparison-packet.zip` (120 files, 14.3 MB). Independently reviewed 2026-10-04 (`deliverables/REPORT_REVIEW.md`, 32 findings; most applied, open ones listed there) |
| Deployment (VPS, domain, TLS) | **Blocked**: no VPS or domain credentials; compose file never built on a real host |
| Realtime voice benchmark (D-010) | **NOT RUN**: no OpenAI or Google keys |
| iOS / Android builds | **Blocked**: no Apple Developer account, Expo token or Android SDK (D-016) |
| Live discovery test | **Blocked**: Wikimedia unreachable from the build sandbox |

Open items that need the owner: register the domains and commission a trademark clearance; supply provider keys, Maps keys, Expo and Apple credentials, and a VPS with a domain; decide the walking voice tier and a redesigned free tier; enforce or replace the Google-map display rule for Places content; upgrade dependencies with `pnpm audit` advisories (9 found 2026-10-04).
