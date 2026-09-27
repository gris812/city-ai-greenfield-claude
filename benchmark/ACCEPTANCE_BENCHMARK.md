# Acceptance Benchmark

The final implementation must run and report these scenarios. Raw timings and provider/cost metadata should be retained where possible.

## 0. Geography and operating-model requirement

The product is global and location-first. New York City, Chicago, San Francisco and U.S. highway routes are **test geographies**, not hard-coded operating regions. Production behavior must start from live user context and use the same discovery/narrative architecture in any geography supported by the selected data providers.

Required field-test classes:

- **NYC / dense urban** — high candidate density, walking and city driving;
- **Chicago / urban-cultural** — major museums, architecture, neighborhoods and mixed movement;
- **San Francisco / landmark-geographic** — major landmarks, greater trigger distances, terrain and mixed movement;
- **U.S. highway / OTR truck** — high-speed trajectory-aware discovery, sparse POIs, towns/cities/landmarks ahead, regional/road context, silence discipline and driver safety.

Fixtures may be deterministic, but city-specific fixtures must not leak into production ranking or discovery logic.

## A. Discovery and relevance

### A1 — World Trade Center / Ground Zero

Fixture: user physically near WTC/9-11 Memorial area.

Required:

- strong local Manhattan targets dominate unrelated distant targets;
- WTC/memorial context is recognized;
- no distant substitute silently replaces the obvious local landmark due to provider ordering.

### A2 — Golden Gate Bridge

Required:

- bridge/immediate context outranks distant city alternatives;
- major landmark can trigger from a greater distance than a small POI.

### A3 — Art Institute of Chicago

Required:

- museum appears in nearby/relevant context when user is at/near it;
- farther objects do not silently replace it.

### A4 — Weak evidence

Input: candidate with name/category but insufficient evidence.

Required:

- optional brief orientation only if useful;
- no fabricated story;
- no deep-story control;
- no invented historical detail.

### A5 — Highway / Ahead Discovery

Fixture: user is driving at highway speed on an Interstate or U.S. highway in a truck.

Required:

- discovery prioritizes meaningful targets **ahead along trajectory/route**, not merely radial proximity;
- objects materially behind the vehicle are suppressed;
- materially off-route objects are suppressed unless product policy explicitly allows an exceptional landmark;
- major cities, landmarks, geographic features, historically/culturally relevant places and route context may trigger from substantially farther away than minor POIs;
- minor businesses and settlements do not create noisy narration;
- long silence is an acceptable and expected outcome when there is nothing worth interrupting the driver for;
- story length, interaction and UI satisfy driving-safety constraints;
- provider refresh cadence/caching does not create a paid request loop at highway GPS update frequency.

Required evidence: deterministic/replay route plus at least one real-road field run when practical. Record speed, heading/trajectory, selected target, rejected candidates/reasons, look-ahead distance, provider calls, latency and estimated variable cost.

### A6 — Environment Transition

Fixture sequence:

```text
highway -> outskirts -> urban area -> dense downtown -> stationary/walking
```

Required:

- discovery radius/look-ahead, target density, narration cadence, safety policy and presentation adapt automatically;
- current Journey/Conversation state is preserved through movement-context changes;
- no manual city selection or product restart is required;
- transitioning to walking must not retain inappropriate highway thresholds/cadence;
- transitioning to driving must apply stricter safety constraints without losing journey continuity.

### A7 — Cross-city portability

Run the production discovery flow in NYC, Chicago and San Francisco without city-specific code/config changes.

Required:

- same production services/contracts execute in all three locations;
- location/provider data, not hard-coded city identity, supplies candidates;
- city-specific replay fixtures may support deterministic validation but are not required for runtime discovery;
- telemetry can explain target selection consistently across cities.

## B. Narrative quality

### B1 — Short then deeper

Required:

- second response continues/expands;
- does not repeat first response with different wording;
- preserves approved evidence.

### B2 — Guide differentiation

Feed identical moment/evidence to both original Guides.

Required:

- same factual core;
- materially distinguishable pacing, structure and tone;
- no stereotype-based factual distortion.

### B3 — Callback

After discussing a topic, introduce a later related target.

Required:

- callback is coherent and not forced;
- system uses structured journey memory, not unsupported invented recollection.

## C. Conversation runtime

### C1 — Coffee interruption

Guide is mid-story.

User: “Where can I get coffee nearby?”

Required sequence:

1. current narration stops;
2. story state is preserved and not completed;
3. NearbySearch runs independently of automatic-discovery filtering;
4. structured result is validated;
5. spoken answer is grounded;
6. map highlight action is correct;
7. prior story may resume from same original moment according to deterministic resume policy.

Record:

- interruption -> audio stop;
- end speech -> first response audio;
- tool correctness;
- map correctness;
- resume correctness;
- estimated incremental cost.

### C2 — Contextual follow-up

User: “Why is that important?”

Required:

- active subject resolved without restatement;
- StoryEvidence/current brief used;
- no unnecessary place-search call;
- no unsupported facts.

### C3 — Change topic

User explicitly changes topic.

Required:

- prior story does not auto-resume against user intent;
- current topic updates predictably.

## D. Realtime voice benchmark (B1–B6)

Run the same scripts for each candidate realtime provider.

### B1 — Story interruption + coffee

Same as C1, using live voice path.

### B2 — Contextual follow-up

User: “Why is that important?”

Record grounding correctness and first-audio latency.

### B3 — Barge-in

Provider begins answering.

User interrupts: “No, I meant parking.”

Required:

- old output stops;
- stale audio/chunks do not continue;
- new turn wins;
- parking intent/tool executes, not prior coffee flow.

### B4 — Road noise

Use identical controlled noise fixture.

Record:

- intent/transcript correctness;
- false-start count;
- missed turns;
- latency change vs quiet.

### B5 — Guides/languages

Same factual content through both Guides in English and Russian.

Record 1–5 human rubric separately for:

- naturalness;
- pacing;
- pronunciation;
- persona distinctness;
- factual preservation.

### B6 — Session lifecycle

1. open realtime;
2. two turns;
3. wait beyond inactivity timeout;
4. verify close;
5. reopen;
6. one more turn.

Required:

- no provider traffic after close;
- clean reopen;
- no stale state.

## E. Safety and mobile UX

### E1 — Driving / OTR Safety

Required:

- audio-first;
- sparse UI;
- no dense mandatory reading;
- essential controls remain accessible with minimal visual interaction;
- story cadence/length stricter than walking;
- no interaction is required simply to keep safe ambient discovery running;
- interruptions/questions must support hands-free voice use where platform permissions allow;
- high-speed operation must not cause narration/provider-call spam;
- highway silence is treated as correct behavior when no worthwhile moment exists.

### E2 — Background/sleep resilience

Where platform policies permit, active audio/navigation-like session should handle screen lock/background transitions predictably. Report OS limitations and implementation behavior.

### E3 — Network degradation

Simulate loss and restoration.

Required:

- no corrupted session state;
- cached/current playback behaves safely;
- reconnection does not duplicate story/tool actions.

## F. Cost/failure resilience

### F1 — Empty discovery result

Required: no paid refresh on every GPS update.

### F2 — Place provider quota/timeout

Required: bounded retry/fallback; no tight billing loop.

### F3 — LLM failure

Required: safe degraded behavior; no target substitution by generator.

### F4 — TTS failure

Required: text remains available; session does not collapse.

### F5 — Cache unavailable

Required: service continues in defined reduced mode or fails explicitly; no unsafe provider storm.

## G. Final benchmark summary

Report at minimum:

| Metric | Result |
|---|---|
| target relevance regression pass rate | |
| wrong-target rate on fixed corpus | |
| weak-evidence correctness | |
| narrative repetition regressions | |
| guide/persona distinctness | |
| interruption correctness | |
| contextual follow-up grounding | |
| trigger -> first audio p50/p95 | |
| barge-in stop p50/p95 | |
| speech-end -> first audio p50/p95 | |
| provider tool reliability | |
| 30-min walk estimated variable cost | |
| 30-min drive estimated variable cost | |
| realtime active-minute cost | |
| cache hit rates by layer | |
| known failures | |
