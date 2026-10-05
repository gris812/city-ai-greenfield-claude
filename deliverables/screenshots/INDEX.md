# Screenshot index

Captured 2026-10-04 (UTC) by `scripts/report/capture-screenshots.mjs` with Playwright 1.56 / headless Chromium against the **production build** of `apps/web` served locally (`next start`, port 3100). The demo recording `deliverables/demo/telvey-web-demo.*` was made by `scripts/report/record-demo.mjs` against the same build.

## What every image is, and is not

- **Mode: offline demo mode on every web capture.** No API is configured in the build, so the WebApp runs the real `@city/core` decision pipeline inside the browser (`LocalEngine`) over **fixture** places and evidence.
- **The location is simulated.** An amber "SIMULATED LOCATION" banner is visible on every capture taken after a trip starts. S01, S02 (both before a trip starts) and the Settings/History/Admin pages have no banner because no location is in play.
- **Replays are simulated.** Stories are template prose (no LLM), there is no TTS provider and headless Chromium has no speech voice, so the cards say "Text only · no voice available". Nothing was spoken, and nothing here evidences voice quality.
- **Maps show the schematic fallback.** Map tile servers are unreachable from this sandbox, so the map draws its schematic overlay ("Map tiles unavailable offline"). Markers named "Cafe #NNN (synthetic)" are generated fixture places, not real businesses.
- **No real user, device or provider is involved.** The admin images in section 15 are an explicitly labelled demo-data preview: the banner reads "DEMO DATA: synthetic sample values for layout review. Nothing on this screen is a real measurement."
- **Not a device.** All images are a desktop Chromium engine at 390 x 844 (device pixel ratio 2) or 1280 x 800. They show layout and state, not on-device performance.

## Mapping to FINAL_REPORT_TEMPLATE section 3

| # | Template item | File (in `web/`) | Runtime state shown | Mode |
|---|---|---|---|---|
| 1 | Guest entry | `s01-guest-entry-mobile.png` | First run, no account or card. Start card with the simulated trips (Lower Manhattan, Chicago, Golden Gate, I-40) and "Use my location"; "Offline demo mode" chip | offline demo, before a trip starts |
| 2 | Guide selection | `s02-guide-selection-mobile.png` | Guide popover: Ida selected, Emil, talkativeness control at 0 | offline demo |
| 3 | Explore idle | `s03-explore-idle-quiet-mobile.png` | After Skip, the director enforces its cadence gap: "Quiet stretch" (silence is a designed state), regime "Walking, dense", SIMULATED banner | offline demo, replay `wtc-walk` x1 |
| 4 | Approaching target | `s04-approaching-target-mobile.png` | First story just started: spatial cue "straight ahead, about 800 feet", target ringed on the schematic map, segment 1 of 3 | offline demo, replay `wtc-walk` x1 |
| 5 | Active story | `s05-active-story-mobile.png` | Segment 2 of 3 with per-segment progress ticks, transcript in the story typeface, Pause / Skip / Not that one | offline demo |
| 6 | Interruption / listening | `s06-listening-mobile.png`, `s06b-question-typed-mobile.png` | Mic pressed mid-story: narration stopped, listening sheet. Headless Chromium has no speech recognition, so the "Type instead" fallback is shown with the coffee question typed | offline demo |
| 7 | Nearby result on map | `s07-nearby-result-mobile.png` | Local nearby search over fixture places: caption "The closest is Corner coffee bar, about 0.2 miles away. I've put 5 options on the map.", markers on the schematic map, story card paused ("Paused while you talk") | offline demo; synthetic places |
| 8 | Resumed story | `s08-resumed-story-mobile.png` | After the answer, ResumePolicy resumes the interrupted plan at the start of the interrupted segment with a bridge ("Where was I? Ah yes, ...") | offline demo |
| 9 | Drive-safe state | `s09-drive-safe-mobile.png` | DRIVE HUD auto-activated by the highway regime on the synthetic I-40 replay: dark palette, one status line ("Quiet stretch / Emil, City driving"), one large mic, no lists, no text input | offline demo, replay `interstate` |
| 10 | History | `s10-history-mobile.png` | History of the session above, stored in this browser only, entries labelled "Simulated" | offline demo |
| 11 | Settings | `s11-settings-mobile.png` | Guide, talkativeness, language (EN / RU), units, appearance, voice, connection (Auto / Live / Offline demo), Delete my data | offline demo |
| 12 | Degraded / error state | `s12-degraded-text-only-mobile.png`, `s12b-degraded-api-unreachable-mobile.png` | (a) Text-only delivery: the answer arrives as text because no voice is available. (b) Connection set to "Live" in a build with no API: the app says "No API is configured for this build, so the offline demo is used" instead of pretending to be live. (a) looks like #7 because it is the same frame; it shows the degraded delivery line | offline demo |
| 13 | WebApp / PWA | `s13-webapp-desktop.png`, `s13b-webapp-debug-explain-desktop.png` | Desktop layout with the simulation panel (scenario, speed, progress), and the explain drawer with candidate scores and rejection reasons from the running core. The PWA manifest and service worker exist; installing to a home screen was not tested | offline demo, `wtc-walk` x20 |
| 14 | Public website | `s14-website-desktop-fold.png`, `s14b-website-desktop-full.png` | Landing page from the local production build. Not deployed anywhere | local build |
| 15 | Web admin console | `s15a-admin-login-desktop.png`, `s15-admin-overview-demo-desktop.png`, `s15c-admin-latency-demo-desktop.png`, `s15d-admin-cost-demo-desktop.png`, `s15e-admin-providers-demo-desktop.png` | Passkey-only login (no password exists) and the console in "Preview (not signed in)" with the Demo data toggle on. **All numbers are illustrative.** No API is connected, so without the toggle the console shows no data | local build, DEMO DATA |
| 16 | Mobile admin surface | **NOT CAPTURED** | See below | not available |

### Item 16: why there is no screenshot

No physical device, emulator, Android SDK, macOS host or EAS/Apple credential exists in this environment, so the native app and its operator screens were never run. `react-native-web` is not a dependency of `apps/mobile`, and adding it to render the operator screens was judged not worth faking: it would show a web re-render of native components and would be mistaken for a device capture. Nothing was mocked up.

What exists instead: the screen inventory in `docs/MOBILE.md` section 1 (`app/(tabs)/index` Explore + Drive HUD, `history`, `settings`, `onboarding`, `simulation`, `admin/` operator dashboard, `admin/pair` QR / code pairing, `pair` deep link `telvey://pair?code=...`), mobile logic tests (15 passing), a Hermes JS bundle (4.3 MB) that compiles and `expo prebuild` generating both native projects. Item 16 is listed under "not yet evidenced" in the report.

## Other files in `web/`

`_capture-log.json` is the machine-readable log of this capture run (state notes written while capturing). The older files (`app-*.png`, `home-*.png`, `admin-*.png`) came from an earlier UX pass and are not used in the report or the comparison packet; they may predate the latest web build.
