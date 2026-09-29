# Telvey native app (apps/mobile)

Status: **buildable, not yet built into binaries** (2026-09-28). The JS bundles for Android and iOS compile, and `expo prebuild` generates both native projects cleanly. No APK/IPA has been produced, because no Expo/EAS token, Apple account, Android SDK or macOS is available here (D-016, C-002). The commands in §5 produce installable builds as soon as credentials arrive.

## 1. Architecture

```
apps/mobile (Expo SDK 57, RN 0.86, expo-router, dev-client)        packages/client (@city/client, pure TS)
 app/                     screens (router)                          api.ts        typed API client (fetch injected)
  (tabs)/index            Explore + Drive HUD                        channel.ts    SessionChannel: WS hello/ack/resume, REST fallback,
  (tabs)/history          local + account history                                  utterance outbox (idempotent utteranceId)
  (tabs)/settings         prefs, delete data, hidden Operator access sequencer.ts  exactly-once in-order directive delivery + turn gate
  onboarding              guest-first, permission rationale         reducer.ts    directive → view state; drive status line
  simulation              fixture trace replay (labelled)           batcher.ts    fixes → ContextFrames (1 s moving / 10 s still)
  admin/, admin/pair      operator dashboard, QR/code pairing       prefetch.ts   current + next 2 segment download queue
  pair                    deep link telvey://pair?code=…            bargein.ts    press→silent latency, p50/p95
 src/store/companion.ts   runtime: transport, sensors, audio, voice  local/*       LocalEngine (offline demo), fixtures, TracePlayer
 src/location/*           foreground watcher, background task       i18n.ts       EN/RU companion strings
 src/audio/*              player (expo-audio + expo-speech), session,
                          segment cache, voice input
 src/admin/store.ts       device-token operator client
 src/logic/*              pure helpers (unit-tested)
```

- **Server authority (D-002).** The phone is a sensor, renderer and audio player. It streams `ContextFrame`s and user intents, and it applies `Directive`s. It never ranks places. Offline demo mode runs the same `@city/core` pipeline on the phone over fixture data, clearly labelled (D-005). It is the same `LocalEngine` class the WebApp uses.
- **Shared client.** `packages/client` holds everything platform-neutral. apps/web now consumes it for the LocalEngine, transport types, the fixture model, i18n and `parseDirectives`. Web keeps its own `LiveTransport` for now; the TODO is to migrate web to `SessionChannel`, which uses the same wire protocol and has stronger E3 handling.
- **Transport selection.** Settings → Connection offers Auto, Live or Demo. Auto means `/healthz` OK leads to live; otherwise the app drops to offline demo with the reason shown. A build whose API URL is empty or a `*.example` placeholder says "API not connected in this build" and does not try to reach a server.
- **Theming.** Colours, type, spacing and sizes come from `assets/brand/tokens.json` (imported directly). There are three palettes: light, dark and **drive**. Onest and Literata are bundled from `@expo-google-fonts/*` (only the weights we use) and never fetched at runtime.
- **Icons and splash.** These are generated from `assets/brand` by `node apps/mobile/scripts/make-icons.mjs` and committed. Demo data (`assets/demo/*.json`, git-ignored) is regenerated from `/fixtures` by `scripts/prepare-assets.mjs`. That script runs on `start`, `typecheck`, `test`, `export:*` and the EAS `eas-build-post-install` hook. Set `MOBILE_DEMO_FIXTURES=0` to ship without fixtures.

### Protocol handling (docs/API.md implementation notes)
- On every socket open the client sends `resume {lastDirectiveSeq}`, including `0`, so directives emitted before attach are replayed once. Envelopes `{seq, turn, ref, directive}` pass through `DirectiveSequencer`:
  - `seq ≤ last` is dropped as a duplicate.
  - A gap is buffered, then filled with `GET /directives?after=`. If it cannot be filled after 1.5 s, it is skipped.
  - A cumulative `ack` follows every applied batch.
- `TurnGate` drops `play`/`say` belonging to turns older than the latest `stop_audio`, or older than a local barge-in.
- `say.ref` is acknowledged with `audio_progress {planId: ref, state: 'finished'}` when the answer finishes (C1 resume).
- Utterances carry an `utteranceId`. If the socket is down and REST fails, they wait in an outbox and are re-sent with the **same id** on reconnect, so the server never re-runs a tool (E3).
- Context frames go out over WS when it is open, otherwise over `POST /context`. On failure, fixes are merged into the next frame (≤ 120 fixes, the schema cap).

### Audio
- **Session.** `expo-audio` with `interruptionMode: 'duckOthers'` (iOS and Android), `shouldPlayInBackground`, and `playsInSilentMode`. Navigation prompts and music are ducked, not stopped. The session is released about 0.9 s after speech ends, which un-ducks the other apps.
- **Playback.** Each `play` segment is played from the local cache when it has been prefetched (current + next 2 segments, content-addressed URLs under `Paths.cache/telvey-audio`). Otherwise it is streamed. If `audioUrl` is null, returns 404, or fails to play, the app falls back to `expo-speech` on-device TTS (F4), labelled "Device voice · degraded". With spoken output turned off, stories advance as captions only.
- **Barge-in.** Pressing the mic stops output, polls until the player *and* TTS report silent, and records the latency. It then sends `control interrupt {bargeInStopMs}`; p50/p95 are shown on the Simulation screen.
- **Interruptions.** If the OS pauses our player after it started (phone call, Siri/Assistant, another app taking focus), the app pauses the story locally and sends `control pause`. The user resumes with one tap; we do not auto-resume after a call.
- **Lock screen.** Lock-screen metadata shows place + guide via `setActiveForLockScreen`.

### Voice input (D-010 hybrid)
Settings → Voice input offers Auto, On device or Server.
- **Device** uses `expo-speech-recognition` (maintained; v57 for SDK 57). It streams interim results and requests on-device recognition when the platform supports it.
- **Server** records mono 16 kHz AAC/m4a (~6 KB/s) with `expo-audio` and calls `POST /v1/stt?submit=1&utteranceId=…`. The returned directives go through the sequencer, and the recording file is deleted immediately (D-012).
- **Auto** prefers device. If the device recognizer is unavailable or errors (no service, network, language), later presses in that run use server STT.
- Listening is only ever opened by a user press. A server `listen` directive shows a "tap to talk" prompt and never auto-records. There is no text entry while drive-safe (D-008).

### Location
- **Foreground.** `watchPositionAsync` samples at 1 Hz when moving or driving and every 5 s / 5 m when still. It re-subscribes when the speed class changes, uses `BestForNavigation` while drive-safe, and adds compass heading for the puck when stationary.
- **Background.** `startLocationUpdatesAsync` runs task `telvey.session.location`, defined at module scope in `index.ts`. It starts only while a real-location session is active, the setting is on, and background permission is granted. It is stopped at session end.
- **Frames.** Fixes go through a module-level bus (buffered when no consumer is attached) into `FrameBatcher`. Frames are flushed **when fixes arrive**, not only on a timer, because RN pauses JS timers in the background while OS location callbacks keep coming. Frames carry `appState`, the audio state (`planId/segmentIndex/offsetMs`) and `lastInteractionAt`.
- **Denied permission.** The app switches to a manual/simulated puck and keeps a persistent "SIMULATED LOCATION" banner with an "Enable location" action. Mock-location providers on Android are marked `source: 'simulated'`.

### Drive mode (E1)
Drive mode switches on automatically from the server's `state {driveSafe: true}`; the user never selects it. The screen then shows:
- the drive palette (all text pairs ≥ 7:1);
- the tab bar hidden;
- a small glanceable map strip;
- **one** status line (listening → place being told → answering → silence reason → regime);
- one 96 dp mic and one 76 dp stop target.

It shows no lists, no body copy and no text input. Nothing has to be touched to keep ambient discovery running. `listen` directives are ignored, and a `navigate_handoff` requested by voice opens the navigation app directly.

### Operator access (D-013)
The entry is hidden: long-press the version row in Settings, or tap it 7 times. Once the phone is paired, the entry is always shown.
- **Pairing.** Scan the web console's pairing QR (`expo-camera` barcode scanner) or type the code. The app calls `POST /v1/admin/pairing/redeem`, and the device token goes into `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). The QR's `api` must match the build's API (overrides are allowed only in dev builds). The `telvey://pair?code=…` deep link opens the same screen.
- **Screens.** Health, today's sessions/DAU/stories funnel, latency p50/p95, cost today/7 d and recent errors. Owners also see the paired-device list with revoke.
- **Role awareness.** Sections the role cannot read show their own empty state (the server enforces roles).
- **No cache.** If the API is unreachable, everything is cleared and "API not connected" is shown; operator data is never shown from cache. A 401 (revoked device) wipes the token.
- **Sign out** revokes this device server-side (`DELETE /v1/admin/devices/:id`) and wipes the token.

## 2. E2 report — background, lock screen and what the OS may kill

| Situation | iOS (UIBackgroundModes `audio`, `location`) | Android (foreground service `location` + media playback service) |
|---|---|---|
| Screen locked, session active, background permission granted | Location updates continue (standard location service, `pausesUpdatesAutomatically: false`, `activityType: OtherNavigation`) and keep the app running. The blue location pill is shown. JS runs on each batch: frames are sent and the WS stays up while the app is running. Stories keep playing (audio mode); lock-screen metadata is shown. | A foreground service with a persistent notification ("Telvey is with you") keeps the process alive. Location keeps arriving at ~1 Hz and frames are sent on each event. Audio continues, and the media-playback service provides lock-screen controls. |
| Background permission **not** granted | Only "While Using": when the screen locks, updates stop after the app suspends. Narration of the current segment continues while audio plays, then the app suspends. Settings shows "Background location not allowed". On reopen, a new fix resumes the session (server resume policy decides). | "While using" only: the task is not started. On lock the app is backgrounded, the watcher stops, and the same fallback applies. Android 11+ grants "Allow all the time" only on the system Settings page; the app deep-links there. |
| JS timers in background | Paused or unreliable. The design does not depend on them: frame flush, segment advance (native `didJustFinish` / TTS `onDone`), and REST fallback are all event-driven. Periodic `playing` progress ticks and WS pings may pause; terminal `finished`/`stopped` events still go out. | Same (RN `JavaTimerManager` pauses on host pause). |
| User swipes the app away | Standard location updates stop and iOS does **not** relaunch the app. The session is over; the server session times out. | `killServiceOnDestroy: true` stops the service and the session. |
| OS memory pressure | A backgrounded navigation-class app (location + audio) is rarely terminated, but it can be. On relaunch, onboarding is skipped and the user taps Start: a new session. | OEM "battery optimisation" (Samsung, Xiaomi, Huawei, OnePlus) can kill foreground services. We do not request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Play policy). Testers on those devices should exempt the app manually (dontkillmyapp.com). |
| Phone call / assistant | The AVAudioSession interruption pauses our player. The app detects it, sends `pause`, and the story is resumable with one tap. | Audio-focus loss has the same behaviour. |
| Network lost while locked | Prefetched segments (current + next 2) keep playing. Fixes accumulate in the pending frame (≤ 120) and are sent on reconnect with `resume`. | Same. |
| Starting voice input from the lock screen | Not supported. Push-to-talk needs the app in the foreground (no background microphone; `enableBackgroundRecording: false`). CarPlay / Android Auto are not implemented. | Same. |
| Notifications permission denied (Android 13+) | — | The service still runs, but its notification is hidden from the shade (it still appears in the Task Manager). |

Other notes:
- **iOS "Always".** iOS offers "Always" provisionally: the first prompt allows only "While Using". The second request (Settings toggle "Keep going with the screen locked") asks for the upgrade.
- **`fetch` background mode.** `expo-task-manager`'s plugin also adds the `fetch` background mode. It is unused and harmless, but App Review may ask about it.
- **Android 14+.** `FOREGROUND_SERVICE_LOCATION` is declared, and the service is started from the foreground at session start (required: foreground services cannot be started from the background).

## 3. Verification done in this environment (Linux, no Android SDK, no macOS)

| Check | Result |
|---|---|
| `pnpm --filter @city/mobile typecheck` (TS strict, `noUncheckedIndexedAccess`) | ✅ |
| `pnpm --filter @city/mobile test` (vitest, pure logic: fix mapping, buffer, config/pairing guards, settings, trace decoding, operator view models) | ✅ 15 tests |
| `pnpm --filter @city/client test` (sequencer, turn gate, SessionChannel E3 reconnect with a fake socket, batcher, prefetch, barge-in, reducer, LocalEngine replay) | ✅ 29 tests |
| `npx expo config --type public` | ✅ |
| `npx expo export --platform android` | ✅ Hermes bytecode bundle, 4.3 MB |
| `npx expo export --platform ios` | ✅ Hermes bytecode bundle, 4.0 MB |
| `npx expo prebuild --no-install` (runs all config plugins) | ✅ Manifest has FINE/COARSE/BACKGROUND location, FOREGROUND_SERVICE(_LOCATION/_MEDIA_PLAYBACK), RECORD_AUDIO, POST_NOTIFICATIONS and CAMERA. Storage and overlay permissions are removed. The Maps key meta-data, `telvey://` scheme and FGS notification icon are present. Info.plist has all usage strings and `UIBackgroundModes` audio + location. Generated dirs were deleted afterwards (CNG). |
| `npx expo-doctor` | 19/21 pass. The 2 failures are network-only: the config-schema download from api.expo.dev and the React Native Directory lookup are both blocked by this sandbox's egress proxy. |
| apps/web after the `@city/client` extraction | ✅ typecheck, `next build`, Playwright 10/10 |

**Not verifiable here:**
- a native compile (Gradle/Xcode);
- real-device behaviour (audio focus, background survival, STT engines, maps rendering);
- `eas.json` validation against EAS servers.

## 4. Real-device test checklist (mapped to benchmark/ACCEPTANCE_BENCHMARK.md)

Run on at least one recent iPhone and one Android phone, and on one aggressive-OEM Android (Samsung or Xiaomi). Use the `preview` build with a live API.

**Setup**
- [ ] Fresh install → onboarding: no account asked; rationale screens appear before each OS prompt; each one can be skipped.
- [ ] Deny location → app runs a labelled simulated demo, and the banner offers "Enable location".
- [ ] Settings → Operator access (long-press version) → scan the pairing QR from the web console → dashboard loads.
- [ ] Sign out → the device disappears from the web console's device list.

**C1 — coffee interruption**
- [ ] Mid-story, press the mic, and say "Where can I get coffee nearby?"
- [ ] Audio stops within ~100 ms. Check the Simulation screen for barge-in p50/p95, and admin latency for `barge_in_stop`.
- [ ] The spoken answer names a real nearby place, and result markers appear on the map.
- [ ] The prior story resumes from the same segment after the answer (or is abandoned per policy). It is never restarted from the top.
- [ ] Record: stop latency, speech-end → first audio (admin `speech_end_to_first_audio`), map correctness.
- [ ] Repeat with Voice input = On device and = Server.

**E1 — driving / OTR safety** (passenger operates, or a closed course)
- [ ] Drive HUD appears automatically on reaching driving speed, with no user action.
- [ ] Palette is dark; the only content is one status line, one 96 dp mic and a stop button. No lists and no keyboard ever appear.
- [ ] Highway: long silences with the "Nothing worth interrupting for" line. No narration spam. Story length is noticeably shorter than walking.
- [ ] A voice question while driving works hands-free after one tap.
- [ ] "Navigate there" hands off to Google/Apple Maps; its prompts are ducked, not cut, by Telvey.
- [ ] Waze/Google Maps voice prompts during a story: both remain audible (ducking).

**E2 — background / sleep**
- [ ] Grant background location ("Always" / "Allow all the time"), start a session, lock the screen, walk or drive 10 min. Stories continue; admin health shows the session hot; the Android notification is visible.
- [ ] Without background permission: same test. Behaviour matches §2 (stops after lock), and the Settings row explains it.
- [ ] Incoming phone call mid-story: the story pauses; after the call, Resume continues from the same segment.
- [ ] Swipe the app away: the Android notification disappears, and no location indicator remains on either OS.
- [ ] Samsung/Xiaomi: 30 min locked; note whether the OEM kills the service.

**E3 — network degradation**
- [ ] Airplane mode mid-story: the current and next segments keep playing (prefetched); the offline banner appears.
- [ ] Ask a question while offline, then restore the network: the question is answered exactly once.
- [ ] After restoring: no story is replayed; the session continues. Check `/admin` sessions/explain for duplicates.
- [ ] Toggle Wi-Fi ↔ cellular while driving: reconnects within a few seconds with no duplicate audio.

**F4 — TTS failure**
- [ ] With server TTS disabled (budget kill switch), stories play with the device voice and the "Device voice · degraded" chip.

## 5. Producing builds once credentials exist

Prerequisites: Node 22 and pnpm 10 locally, run from the repo root. Nothing below needs macOS; EAS builds in the cloud.

```bash
pnpm install
cd apps/mobile
npx eas-cli@latest login                 # Expo account (or: export EXPO_TOKEN=… for CI)
npx eas-cli@latest init                  # creates the EAS project; prints the projectId
```

`app.config.ts` is dynamic, so `eas init` cannot write the id into it. Add the owner and id in **both** places:
- `eas.json` → `build.base.env`: add `"EAS_PROJECT_ID": "<id>"` and `"EXPO_OWNER": "<account>"`;
- your shell: `export EAS_PROJECT_ID=<id> EXPO_OWNER=<account>`, because the CLI evaluates the config locally.

Replace `https://api.telvey.example` in `eas.json` (development, preview and production `env`) with the real API URL. Alternatively, use `eas env:create --name EXPO_PUBLIC_API_BASE_URL --value https://api… --environment preview`, and do the same for the Maps key: `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, visibility "plain text". It is compiled into the app anyway and must be package + SHA-1 restricted.

**Android APK (sideload, no Play account needed)**
```bash
npx eas-cli@latest build -p android --profile preview
#   first run: "Generate a new Android Keystore?" → Yes (EAS stores it)
#   output: a URL to the .apk, installable directly (enable "Install unknown apps")
npx eas-cli@latest credentials -p android   # shows the keystore SHA-1 → add it to the Maps key restriction
```
Dev client for day-to-day development: `eas build -p android --profile development`, then `pnpm --filter @city/mobile start` and scan the QR code shown in the terminal.

**iOS (requires an Apple Developer Program membership, $99/yr)**
```bash
# Internal distribution (ad hoc) to registered devices:
npx eas-cli@latest device:create           # each tester opens the link on their iPhone to register the UDID
npx eas-cli@latest build -p ios --profile preview
#   log in with the Apple ID when asked; EAS creates the certificate + ad-hoc provisioning profile
#   output: an install link/QR (devices must be registered BEFORE the build)

# Or TestFlight (no UDIDs; up to 10,000 testers after beta review):
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios --profile production    # needs an App Store Connect app record (created on first submit)
```

**Play Store internal testing (optional)**
```bash
npx eas-cli@latest build -p android --profile production    # .aab
npx eas-cli@latest submit -p android --profile production   # needs a Play service-account JSON (first upload of an app must be manual)
```

**Local build (no EAS)**
- Android: `npx expo prebuild -p android && cd android && ./gradlew assembleRelease`. This requires the Android SDK/JDK 17 and a signing config, and was not possible here: the SDK download is outside the egress allowlist.
- iOS: `npx expo run:ios --configuration Release`. This requires macOS + Xcode.

Profiles in `eas.json`: `development` (dev client, internal, APK / device), `development-simulator` (iOS simulator build), `preview` (internal: Android APK, iOS ad hoc), and `production` (store: AAB, auto-incremented build numbers via remote app versions). App ids get a suffix per variant (`com.telvey.app.dev`, `.preview`), so all three can be installed side by side. Remember to add each package + SHA-1 to the Maps key restriction.

## 6. Credentials and decisions still needed from the owner

| Item | Needed for | Notes |
|---|---|---|
| **Expo account + `EXPO_TOKEN`** (or interactive `eas login`) | Any EAS build (Android and iOS) | Free tier suffices for low-volume builds (queue waits). |
| **Apple Developer Program membership** (team ID, admin Apple ID or App Store Connect API key .p8) | Any installable iOS build (ad hoc or TestFlight) | Blocking for iOS (D-016). An App Store Connect API key enables non-interactive CI builds and submits. |
| **Tester iPhone UDIDs** (via `eas device:create`) | iOS ad hoc `preview` | Not needed for TestFlight. |
| **Production API URL** (HTTPS, valid cert) | `EXPO_PUBLIC_API_BASE_URL` in all profiles | Without it the app runs in labelled offline demo mode. |
| **Google Maps SDK for Android key** | Google map on Android | Restrict to package names + the EAS keystore SHA-1 (and the Play app-signing SHA-1 if using Play). Without it: labelled schematic map. |
| Maps SDK for iOS key (optional) | Google map on iOS | Apple Maps is used otherwise (no key needed). |
| Final bundle id / package name | Store listings | Default `com.telvey.app`; change via `APP_BUNDLE_ID` / `APP_ANDROID_PACKAGE` **before** the first store upload (immutable afterwards). |
| Google Play Console account + service-account JSON (optional) | Play internal testing / `eas submit` | APK sideloading needs none of this. |
| Privacy policy URL | App Store / Play listings (location + microphone) | The web app has `/privacy`. |
