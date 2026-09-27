# Owner Clarifications

Clarifications received from the product owner after the repository audit. These are binding requirements alongside `AGENT_MASTER_TASK.md`.

## C-001 — Geography, location-first discovery and replay fixtures (2026-09-27)

Received verbatim:

> The product is global by design and location-first. There is no designated launch city and no city should be hard-coded as the primary operating geography.
>
> Production discovery must begin from the user's live context:
>
> - current location;
> - heading;
> - speed;
> - walking / driving / stationary state;
> - route or trajectory when available;
> - local density;
> - current journey and conversation context.
>
> From that context, the system determines what is relevant nearby or ahead.
>
> Do not architect production behavior around a manually curated city database, preconfigured city boundaries, city-specific ranking logic, fixed demo routes, or assumptions that the user is always walking in a dense tourist area.
>
> City-specific POI packs, route files and replay fixtures are allowed only for deterministic testing, regression coverage, demos and fallback behavior. They must remain separate from the production location-first discovery architecture.
>
> Initial real-world acceptance testing will be performed in:
>
> - New York City — dense urban discovery, high POI density, walking and city driving;
> - Chicago — museums, architecture, neighborhoods, walking and city driving;
> - San Francisco — major landmarks, larger trigger distances, terrain/topography and mixed movement;
> - long-distance U.S. highway driving in a truck — Interstate/US-highway travel, sparse POI density, towns/cities/landmarks ahead, regional and road context, long periods where silence is correct, and strict driver-safety constraints.
>
> These are acceptance-test environments, not product scope boundaries.
>
> For deterministic replay fixtures, use these geographies as appropriate. The existing baseline examples should include at least:
>
> - World Trade Center / Ground Zero — New York City;
> - Art Institute of Chicago — Chicago;
> - Golden Gate Bridge — San Francisco;
> - one or more realistic U.S. highway routes for high-speed ahead-discovery testing.
>
> For highway operation, simple radial "nearby POI" discovery is not sufficient. The system must reason about what is ahead along the user's trajectory or route, suppress irrelevant objects behind or materially off-course, allow greater look-ahead distances for significant landmarks/cities/geographic features, and tolerate long periods of silence when nothing is worth interrupting the driver for.
>
> The acceptance suite must also test automatic transitions such as:
>
> highway -> outskirts -> urban area -> dense downtown -> stationary/walking
>
> The product should adapt discovery radius/look-ahead, narration cadence, safety policy and presentation automatically, without requiring the user to select a different city or restart the experience.

### How it is applied

See `DECISIONS.md` D-004 … D-008. In short:

- `packages/core` has **no city identifiers anywhere**. Discovery takes a `JourneyContext` and a provider-agnostic `PlaceSource`; every radius, look-ahead, cadence and safety threshold is a function of the derived *movement regime* and *local density*, never of a city.
- Fixture POI packs and route traces live only under `fixtures/` and are loaded only by the `FixturePlaceSource` used in tests, replay and explicit demo mode. A lint test (`core/test/no-city-coupling.test.ts`) fails the build if production source imports from `fixtures/` or contains fixture city names.
- Highway operation uses a trajectory corridor (heading-projected or route-polyline-based) with significance-scaled look-ahead and an explicit silence budget.

## C-002 — Delivery and credentials (2026-09-27)

- Owner will upload `docs/PERFORMANCE_COST.md` and `benchmark/ACCEPTANCE_BENCHMARK.md` (referenced by the master task but not present in the repository). Until then, provisional budgets/scenarios are used and are clearly labeled **PROVISIONAL** in `docs/PERFORMANCE_COST.provisional.md` and `benchmark/ACCEPTANCE_BENCHMARK.provisional.md`; they will be replaced by the owner's versions verbatim.
- Owner will install the Claude GitHub App so commits can be pushed and a draft PR opened.
- Owner will provide: LLM + voice keys, Google Maps/Places, VPS + domain/DNS.
- Not selected at this time: Expo/EAS + Apple. Consequence: an installable **iOS** build cannot be produced from this environment (no Apple Developer account; no macOS). Android can be produced via EAS cloud build if an Expo token is supplied. Recorded as a blocking credential gap in the final report.
