# Telvey: Brand & Guides

Status: **Provisional (v0.1, 2026-09-27)**. Produced by the UX/Brand agent. The working brand is **Telvey**. Everything here is original work: names, mark, illustrations and copy. Nothing is derived from a prior project, an existing brand, a mascot or a character.

> **Not legal clearance.** The name screening below is a *preliminary* signal check: live RDAP/DNS lookups plus web, App Store and Google Play searches. It is **not** a trademark clearance, a freedom-to-operate opinion or legal advice. No official USPTO/EUIPO/WIPO/Rospatent database was queried directly; web searches for "<name> trademark" are a weak proxy. Before any public launch or filing, commission a professional clearance search in Nice classes 9, 38, 39, 41 and 42 for the US, EU, UK and RU markets.

---

## 1. Naming

### Brief
A short, pronounceable (EN + RU), verb-able, iconable name for a global, conversational, place-aware companion. It must not be tied to one city or to "tour", must not be generic "AI travel", and should ideally have a free `.com` or `.ai`.

### Method
1. Generated about 900 candidates: concept words (tell, wend, yonder, lore, along, voice/voce) plus coined consonant-vowel roots.
2. Pre-screened `.com/.ai/.app/.co/.io` with DNS NS lookups (8.8.8.8). This pre-screen is fast but *not* authoritative: `tivela.com` and `kolero.com` return NXDOMAIN yet are registered in RDAP.
3. Checked the shortlist authoritatively with **RDAP** via WebFetch. The shell's egress proxy blocks RDAP hosts (CONNECT 403). Endpoints used:
   - `.com`: `https://rdap.verisign.com/com/v1/domain/<d>`
   - `.ai` / `.io`: `https://rdap.identitydigital.services/rdap/domain/<d>`. The IANA bootstrap entry `https://rdap.nic.ai/` was unreachable from the fetch proxy (DNS failure).
   - `.app` / `.dev`: `https://pubapi.registry.google/rdap/domain/<d>` (IANA bootstrap, publication 2026-09-16T19:00:03Z)
   - `.co`: `https://rdap.nic.co/domain/<d>`, which was unreachable, so results are **inconclusive**. `.co` is absent from the IANA bootstrap.
   - Control lookups (`google.ai`, `google.io`, `google.app`) returned records, confirming each endpoint answers.
4. Collision screen: web search for `"<name>"`, `"<name>" app`, App Store / Play hits and `"<name>" trademark`, plus Cyrillic spelling for the winner.

Machine-readable results, with every endpoint and UTC time window: `benchmark/brand/domain_checks.json`.

### Longlist (12)

| # | Name | Idea | Outcome of screen |
|---|---|---|---|
| 1 | **Telvey** | *tell* + *convey / survey / way* | All TLDs free; no exact-name product found → **selected** |
| 2 | Loreyon | *lore* + *yonder* | All TLDs free; only a historical surname hit |
| 3 | Wendalong | *wend* (to go) + *along* | All TLDs free; long (3 syllables, 9 letters) |
| 4 | Sayonder | *say* + *yonder* | All TLDs free; sounds like "sayonara" |
| 5 | Tellaround | *tell* + *around* | All TLDs free; descriptive, close to "Showaround" app |
| 6 | Wendivo | *wend* + coined suffix | All TLDs free; evokes "Wendigo" (negative) |
| 7 | Voceway | *voce* (voice) + *way* | .ai/.app free; .com inconclusive (rate-limited); crowded "Voce" app space |
| 8 | Kolero | coined | .com registered 2025; Polish word/film/Overwatch player |
| 9 | Tivela | coined | .com registered 2016; Shell "Tivela" lubricant brand; clam genus |
| 10 | Hushway | *hush* + *way* ("knows when to be quiet") | .com and .app registered |
| 11 | Amblo | *amble* | .com (2007) and .app (2026) registered; musician name |
| 12 | Waytale | *way* + *tale* | **Direct collision**: "Waytale: AI Audio City Guide" is live on the App Store; .com/.app registered |

Rejected in the pre-screen (all `.com` registered, and live products found): Nearsay (live proximity-chat app on both stores), Alongo (group-trip-planner app), Yondo / Yondi (apps), Veyla (several apps), Omira (crypto/AI brands), Lorway, Vedi, Loqa, Kivo.

### Shortlist: full domain checks
RDAP result per TLD. "free" = RDAP 404, meaning no registry record at check time. All times are 2026-09-27 UTC.

| Name | .com | .ai | Alt | Checked (UTC) | Collision notes | Risk |
|---|---|---|---|---|---|---|
| **Telvey** | free (Verisign) | free (Identity Digital) | .app free, .io free, .dev free, gettelvey.com free; .co inconclusive (DNS NXDOMAIN) | 16:15–16:19, re-checked 16:30–16:35 | No product, company or app named Telvey found on web, App Store or Play. Neighbours in *different* sectors: TelVue (broadcast tech, US), Telviva (telecom app, ZA), Telvia Internet (ISP app), Telva (magazine app), Telveo (fortune-telling app, 10+ installs). No TELVEY trademark hits via web search (not a registry search). RU: «Телвей»; nearest word is the place name «Телави» (weak). | **Low–Medium** ("Tel-" prefix is crowded in telecom, class 38) |
| Loreyon | free | free | .app free | 16:17–16:19 | Only a historical surname hit; "LORE" marks exist (Amazon), which is weak similarity | Low |
| Wendalong | free | free | .app free | 16:17–16:19 | Several "Wend" word-game apps; Bundalong (place) | Low (but long) |
| Sayonder | free | free | .app free | 16:19–16:23 | No hits; phonetically near "sayonara" | Low (weak brand) |
| Tellaround | free | free | .app free | 16:24–16:30 | "Showaround" (local-guide app) is confusingly close in concept; descriptive | Medium |
| Wendivo | free | free | .app free | 16:19–16:23 | Personal-name hits; reads like "Wendigo" | Low (negative connotation) |
| Kolero | **registered** (2025-08-11) | free | .app free | 16:19–16:23 | Polish word, 2026 film title, esports handle | Medium |

### Selected: **Telvey** (pronounced *TEL-vay*; RU «Телвей»)
- **Meaning without being literal:** *tell* + *convey* / *way*, "the one who tells you the way". It is not a dictionary word, which gives it room to become ownable, and it does not say "tour", "guide", "city" or "AI".
- **Short and speakable:** 6 letters, 2 syllables, stress on the first. English and Russian speakers pronounce it the same way (Телвей), with no awkward consonant clusters and no meaning in RU.
- **Verb and wake-word friendly:** "Just Telvey it." / "Hey Telvey, what's that?" Its two distinct syllables are also a reasonable wake-word shape; a false-trigger benchmark is still needed.
- **Domains:** `telvey.com`, `telvey.ai`, `telvey.app`, `telvey.io`, `telvey.dev` and `gettelvey.com` had no RDAP record at check time. Recommended primary: **telvey.com**, with **telvey.ai** and **telvey.app** as defensive registrations.
- **Risk:** Low–Medium. The main exposure is visual/phonetic proximity to telecom brands starting "Tel-" (TelVue, Telviva). They sit in different classes and markets, but this must be assessed by counsel.

**Owner action:** register `telvey.com` + `telvey.ai` + `telvey.app` promptly (availability can change at any moment), reserve `@telvey` handles, and commission a formal clearance search before public use.

---
## 2. Brand system

![Brand board](../assets/brand/brand-board-2400.png)

### Idea
**"A local who knows when to talk."** The brand is calm, warm and precise. It uses petrol (deep blue-green: water, dusk, road signage at night) as the ground, and a single ember dot for *the place being talked about*. Restraint is the point: the product's most frequent state is silence.

### Mark
An **open speech bubble** with a single sharp corner at the lower left. That corner is also a **map-pin point** ("you are here / where you came from"). The outline stays **open toward the upper right**, which is *ahead*, and the **ember dot** in the centre is the place. It reads as conversation and location at once, holds up at 16 px, and works as a one-colour or themed (monochrome) icon.

Rules: keep clear space of at least the dot diameter on all sides. Never rotate the mark (the opening must face upper right) or close the gap. The dot is always ember (or the single colour in monochrome).

The wordmark is lowercase **telvey**, set in Onest SemiBold with −1.5% tracking and converted to outlines, so logo files never depend on installed fonts.

### Colour
Tokens: `assets/brand/tokens.json` (the source) and `assets/brand/tokens.css` (generated CSS variables with light, dark and `data-theme="drive"` sets).

| Role | Token | Hex |
|---|---|---|
| Primary (brand, text on light) | `petrol-700` | `#0F4C5C` |
| Primary deep / dark surfaces | `petrol-800` / `petrol-900` | `#0B3942` / `#082A31` |
| Primary mid / dark-mode secondary text | `petrol-500` / `petrol-300` | `#2A7A88` / `#8DBBC2` |
| Accent: place dot, listening | `ember-500` | `#FF6A4D` |
| Accent as text on light | `ember-ink` | `#B23A1E` |
| Accent as small UI indicator on light | `ember-600` | `#E0492A` |
| Signal (simulated/demo badge, drive route) | `amber-400` | `#FFC857` |
| Neutrals | `paper` · `sand-100` · `sand-200` · `stone-500` · `stone-600` · `ink` | `#F7F4EE` · `#EFEAE1` · `#E2DBCF` · `#726C63` · `#5F5A53` · `#131A1D` |
| Semantic | `success` / `warn` / `error` (+ `-bg`) | `#1A6B45` / `#8F5B00` / `#B42318` (`#DDF1E6` / `#FCEBC7` / `#FDE1DD`) |
| **Drive** | `bg` · `surface` · `text` · `text-2` · `signal` · `voice` · `ok` · `alert` | `#06090B` · `#11181C` · `#F4F7F8` · `#B8C4C9` · `#FFC857` · `#FF8A70` · `#5EE0A0` · `#FF6B5E` |
| Guides | `ida` / `ida-soft` / `ida-ink` · `emil` / `emil-soft` / `emil-ink` | `#C8702A` / `#F4E3CF` / `#8A4512` · `#5B5BD6` / `#E4E4FA` / `#3F3FB0` |

**WCAG 2.2 contrast** (computed with the relative-luminance formula, `contrast.py` in the generator). Body text needs ≥ 4.5:1 (AA), large text and non-text UI ≥ 3:1, and the **drive theme requires ≥ 7:1 (AAA) for every text pair**.

| Pair | Foreground | Background | Ratio | Grade |
|---|---|---|---|---|
| text/primary on paper | `#131A1D` | `#F7F4EE` | 16.03:1 | AAA |
| text/secondary on paper | `#5F5A53` | `#F7F4EE` | 6.22:1 | AA |
| text/tertiary on paper | `#726C63` | `#F7F4EE` | 4.73:1 | AA |
| brand petrol-700 on paper | `#0F4C5C` | `#F7F4EE` | 8.66:1 | AAA |
| paper on petrol-700 (buttons) | `#F7F4EE` | `#0F4C5C` | 8.66:1 | AAA |
| white on petrol-800 | `#FFFFFF` | `#0B3942` | 12.51:1 | AAA |
| ember-500 on paper (decorative only, never sole indicator) | `#FF6A4D` | `#F7F4EE` | 2.58:1 | FAIL (by design: not for text) |
| ember-600 on paper (UI indicator/dot) | `#E0492A` | `#F7F4EE` | 3.71:1 | PASS 3:1 non-text |
| ember-ink on paper (accent text) | `#B23A1E` | `#F7F4EE` | 5.44:1 | AA |
| ink on ember-500 (accent button) | `#131A1D` | `#FF6A4D` | 6.22:1 | AA |
| white on ember-500 (NOT for text) | `#FFFFFF` | `#FF6A4D` | 2.83:1 | FAIL (by design: not for text) |
| ink on amber-400 | `#131A1D` | `#FFC857` | 11.44:1 | AAA |
| success on success-bg | `#1A6B45` | `#DDF1E6` | 5.51:1 | AA |
| warn on warn-bg | `#8F5B00` | `#FCEBC7` | 4.87:1 | AA |
| error on error-bg | `#B42318` | `#FDE1DD` | 5.32:1 | AA |
| success on paper | `#1A6B45` | `#F7F4EE` | 5.92:1 | AA |
| error on paper | `#B42318` | `#F7F4EE` | 5.99:1 | AA |
| petrol-300 on petrol-900 (dark secondary) | `#8DBBC2` | `#082A31` | 7.23:1 | AAA |
| drive-text on drive-bg | `#F4F7F8` | `#06090B` | 18.55:1 | AAA |
| drive-text-2 on drive-bg | `#B8C4C9` | `#06090B` | 11.20:1 | AAA |
| drive-text on drive-surface | `#F4F7F8` | `#11181C` | 16.65:1 | AAA |
| drive-text-2 on drive-surface | `#B8C4C9` | `#11181C` | 10.06:1 | AAA |
| drive-signal on drive-bg | `#FFC857` | `#06090B` | 12.98:1 | AAA |
| drive-voice on drive-bg | `#FF8A70` | `#06090B` | 8.67:1 | AAA |
| drive-ok on drive-bg | `#5EE0A0` | `#06090B` | 12.02:1 | AAA |
| drive-alert on drive-bg | `#FF6B5E` | `#06090B` | 7.15:1 | AAA |
| drive-bg on drive-signal (chip) | `#06090B` | `#FFC857` | 12.98:1 | AAA |
| ida-ink on ida-soft | `#8A4512` | `#F4E3CF` | 5.69:1 | AA |
| emil-ink on emil-soft | `#3F3FB0` | `#E4E4FA` | 6.58:1 | AA |
| emil on paper (non-text accent) | `#5B5BD6` | `#F7F4EE` | 4.89:1 | PASS 3:1 non-text |
| white on emil | `#FFFFFF` | `#5B5BD6` | 5.37:1 | AA |
| ida on paper (non-text accent) | `#C8702A` | `#F7F4EE` | 3.29:1 | PASS 3:1 non-text |

Usage rules that follow from the table:
- **Never set text in `ember-500` on light backgrounds, or white text on `ember-500`.** Use `ember-ink` for accent text and `ink` on ember buttons.
- `ember-500` on paper (2.58:1) is decorative only. Where the dot is the *only* indicator of state, use `ember-600` (3.71:1).
- `stone-500` (4.73:1) is the lightest permitted text colour on paper.

### Typography (Google Fonts, SIL Open Font License 1.1)
| Use | Family | Why |
|---|---|---|
| UI, labels, drive mode | **Onest** (variable 100–900) | Contemporary humanist-grotesque with full **Latin + Cyrillic** designed together (not a bolted-on Cyrillic), open apertures and large x-height that stay legible at glance distances. |
| Story transcript and quotes | **Literata** (variable, optical sizes, italic) | A book serif designed for long-form screen reading, with excellent Cyrillic. It gives spoken stories a "narrated" feel distinct from UI chrome. |
| Debug and admin numerals | **JetBrains Mono** | Tabular, clear 0/O and 1/l, for the admin console and cost tables. |

Type scale (px = dp): Display 44/48 · Title-1 32/38 · Title-2 24/30 · Headline 19/26 · Body 17/25 · Body-sm 15/22 · Caption 13/18 · Overline 12/16 (+8% tracking) · Story 20/30 (Literata) · Drive-hero 40/46 Bold · Drive-label 28/34. No text in drive mode is smaller than 28.

### Spacing, radii, motion
- Spacing: 4-pt base (0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80).
- Radii: 6 / 10 / 14 / 20 / 28 / pill.
- Touch targets: 48 minimum; **76 in drive**. The mic button is 72, or 96 in drive.
- Motion: 80 / 140 / 220 / 360 / 600 ms. The "breath" loop is 3.2 s and the listening pulse 1.2 s. Easing standard is `(0.2,0,0,1)`.
- In drive: no decorative motion, only cross-fades of 140 ms or less, and the listening pulse is the only loop.

### UI visual language
- **Map styling.** Low-chroma base with paper land (`#F7F4EE`), `petrol-100` water and `sand-200` roads, and labels in `stone-600` shown only for major features. POIs are *not* pinned en masse; only the place currently being told (the ember dot with a halo ring) and at most 3 "ahead" candidates (hollow petrol rings) appear. The user is a petrol arrow inside a soft heading cone.
  - The route/trajectory corridor is a translucent band, never a bright line.
  - Dark and drive map: near-black land, `#1B252B` roads, an amber route and ember for the current place. Street labels are off above 15 m/s.
  - Any simulated or replayed location shows an amber **"Simulated"** chip (required by `ContextFrame.simulated`).
- **Now playing ("Now telling").** A card with the guide avatar, overline "NOW TELLING · IDA" in the guide's ink colour, the place name as the headline, and the current sentence in Literata italic.
  - A segmented progress bar has one tick per `NarrativeSegment`, so resume points are visible, followed by "segment 3 of 7 · 0:48 left · ahead, 120 m".
  - Pause is the single primary action. The card collapses to a 64-dp mini-player on the map.
- **Listening.** A full-bleed petrol-800 sheet with an ember mic disc and two concentric halos pulsing at 1.2 s. The label "Listening…" becomes the live partial transcript. The story underneath is visibly paused, with the progress tick frozen.
  - Interruptions are acknowledged by voice first; the UI never makes the user tap "OK".
- **Drive-safe.** The `data-theme="drive"` palette: one hero line ("Town ahead · 14 km"), one secondary line (who is speaking / what kind of story) and one 96-dp voice target.
  - No lists, no scrolling, no text input and no choice prompts (D-008).
  - An amber DRIVE chip confirms the mode. The screen may dim after 10 s; audio carries the experience.
- **Silence / idle.** A grey, outline-only mark in `stone-400` with "Quiet stretch" and "Nothing worth interrupting for. Still here — tap or say 'Telvey'."
  - A slow dotted "listening horizon" line (3.2 s breath) shows the app is alive without asking for attention.
  - Silence is presented as a feature, never as an error or empty state.
- **Chips.** Pill chips 44 high: Ahead · distance (petrol), Listening (ember/ink), Quiet (sand), Simulated (amber), guide chips (soft/ink), Offline · N stories cached (warn), Resumed (success).

---

## 3. Guides

Two original Guides share **the same facts** (the same `EvidencePack` and `StoryBrief` facts). They differ only in angle preference, length, humour, framing and voice (D-009). Both must work on a slow city walk *and* hours of highway in a truck cab.

| | **Ida** (`ida`) | **Emil** (`emil`) |
|---|---|---|
| Tagline | The unhurried storyteller who has time for every street. | The sharp-eyed observer who gets to the point. |
| Angle | People, origins, everyday life, connections to earlier places | Hidden details, numbers, architecture, turning points, nature |
| Verbosity (× regime budget) | 1.15 | 0.80 |
| Humour | 0.30: gentle, affectionate | 0.65: dry, wry, never snide |
| Journey callbacks | Yes, often ("like the river we crossed this morning") | Yes, sparingly, as a punchline |
| Opening | Sensory present-tense scene → the person at the heart of it | Hook detail first → spatial cue |
| Sign-off | Soft reflection that hands attention back to the road | Crisp one-liner, then silence |
| Voice direction | Mature, warm, low-mid; unhurried; pauses between sentence groups; rate 0.95 | Clear, bright, mid; brisk not rushed; crisp consonants; rate 1.05 |
| OpenAI TTS candidate | `sage` (alt `coral`) | `ash` (alt `cedar`) |
| Gemini TTS candidate | `Gacrux` "Mature" (alt `Sulafat` "Warm") | `Iapetus` "Clear" (alt `Sadachbia` "Lively") |
| Accent | `#C8702A` terracotta | `#5B5BD6` indigo |
| Look | Silver bob, round glasses, eyes smiling, rust cardigan, petrol scarf with amber dots | Short dark quiff, trimmed beard, one raised brow, indigo jacket over white tee, ember lapel pin |

Voice ids are **candidates pending the D-010 benchmark**, not decisions. They were verified live on 2026-09-27:
- OpenAI's `speech_create_params.py` in openai-python lists `alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar` for `gpt-4o-mini-tts`.
- Google's speech-generation docs (ai.google.dev) list 30 prebuilt voices, including Gacrux (Mature), Sulafat (Warm), Iapetus (Clear) and Sadachbia (Lively), for `gemini-3.8-flash-tts` with Russian supported.

Russian quality and gender/age fit must be judged by ear in the benchmark. The chosen ids go in `voice.byProvider`.

Profiles: `packages/core/src/guides/ida.json`, `packages/core/src/guides/emil.json` (typed via `packages/core/src/guides/index.ts`, which exports `GUIDES`, `IDA`, `EMIL`, `guideById`, `DEFAULT_GUIDE_ID = 'ida'`).

### Sample lines (EN / RU)
Places are generic. Angle-bracket slots (`⟨…⟩`) are filled only from evidence facts, so no facts are invented here. Driving lines never ask the user a question.

#### Ida
| Moment | EN | RU |
|---|---|---|
| Opening (session start) | "Hello, I'm Ida. I'll keep you company while you go. When something around us has a story worth telling, I'll tell it; otherwise I'll let you enjoy the quiet." | «Здравствуйте, я Ида. Я побуду рядом, пока вы в пути. Если вокруг найдётся история, которую стоит рассказать, — расскажу, а в остальное время дам вам побыть в тишине.» |
| Highway teaser (~20 s) | "Ahead, about fifteen kilometres on, the road brings us to ⟨town⟩. From here it's just a line of rooftops, but people have been ⟨origin fact⟩ there for a long time. When we get closer I'll tell you who started it all. For now, just watch for the ⟨landmark⟩ on the skyline." | «Впереди, примерно через пятнадцать километров, дорога приведёт нас в ⟨город⟩. Отсюда видна лишь линия крыш, но люди ⟨факт о происхождении⟩ там уже очень давно. Когда подъедем ближе, расскажу, с кого всё началось. А пока присмотритесь к ⟨ориентир⟩ на горизонте.» |
| Walking story opening | "Look at the doorway just to your left, the one worn smooth at the step. Somebody crossed it every morning for ⟨duration⟩, and this is their story." | «Посмотрите на дверь слева — ту, где ступенька стёрта до гладкости. Кто-то переступал этот порог каждое утро ⟨срок⟩, и вот его история.» |
| Interruption acknowledgement | "Of course, go ahead." | «Конечно, слушаю вас.» |
| Resume bridge | "Where was I? Ah yes, the ⟨subject⟩, just as the ⟨turning point⟩…" | «На чём я остановилась? Ах да — ⟨предмет⟩, как раз когда ⟨поворотный момент⟩…» |
| Staying-quiet acknowledgement | "I'll keep quiet for a while. Just say my name if you'd like me." | «Я немного помолчу. Позовите меня по имени, если захотите.» |

#### Emil
| Moment | EN | RU |
|---|---|---|
| Opening (session start) | "Emil here. I'll speak up when there's something worth hearing, and stay out of your way when there isn't." | «Это Эмиль. Буду говорить, когда есть что сказать, а в остальное время — не мешать.» |
| Highway teaser (~20 s) | "⟨Surprising number or detail⟩. That's ⟨town⟩, about fifteen kilometres ahead, straight on. Most people only see it as an exit sign. Keep an eye on the ⟨landmark⟩ on your right; I'll give you the short version as we pass." | «⟨Неожиданная цифра или деталь⟩. Это ⟨город⟩ — километров пятнадцать впереди, прямо по курсу. Большинство видит его только на указателе съезда. Следите за ⟨ориентир⟩ справа — расскажу коротко, когда будем проезжать.» |
| Walking story opening | "Top floor, third window from the corner: it doesn't match the others. There's a reason for that: ⟨hidden detail⟩." | «Верхний этаж, третье окно от угла — оно не такое, как остальные. И на то есть причина: ⟨скрытая деталь⟩.» |
| Interruption acknowledgement | "Sure, what's up?" (on foot) / "Go ahead." (driving) | «Да, слушаю.» (пешком) / «Говорите.» (за рулём) |
| Resume bridge | "Back to ⟨subject⟩, where we left off." | «Возвращаемся к ⟨предмет⟩ — с того места, где остановились.» |
| Staying-quiet acknowledgement | "Going quiet. I'll only pipe up for something good." | «Молчу. Заговорю, только если будет что-то стоящее.» |

Notes for the prompt/template layer:
- The RU lines use formal «вы» by default; a later setting may switch to «ты».
- Ida's RU past tense is feminine («остановилась»).
- Emil's walking question-hooks become statements while driving (D-008).
- Resume bridges are chosen by `ResumePolicy`; the guide only supplies the phrasing.

---

## 4. Asset index
All SVGs are hand-authored (generated from code) with no raster embeds and no external fonts; logo and board text is outlined. PNGs are rendered with resvg.

| Asset | Files |
|---|---|
| Mark | `assets/brand/logo-mark.svg`, `logo-mark-512.png` |
| Wordmark | `assets/brand/wordmark.svg`, `wordmark-light.svg`, `wordmark-1200.png` |
| Horizontal lockup | `assets/brand/logo-lockup.svg`, `logo-lockup-dark.svg`, `logo-lockup-1600.png`, `logo-lockup-dark-1600.png` |
| iOS app icon | `assets/brand/app-icon.svg` (1024, full-bleed, opaque, no pre-rounded corners), `app-icon-1024.png`, `app-icon-512.png` (RGB, no alpha) |
| Android adaptive icon | `assets/brand/app-icon-android-foreground.svg` (108 dp canvas = 432 u; art inside the 66 dp safe circle), `app-icon-android-background.svg`, `app-icon-android-monochrome.svg` (themed icon), plus `-432.png` renders |
| Favicon | `assets/brand/favicon.svg`, `favicon-32.png`, `favicon-180.png` (apple-touch) |
| Tokens | `assets/brand/tokens.json`, `assets/brand/tokens.css` |
| Brand board | `assets/brand/brand-board.svg`, `brand-board-2400.png` |
| Ida | `assets/guides/ida/portrait.svg` + `portrait-1200.png`, `avatar.svg` + `avatar-512.png`, `scene.svg` + `scene-1200.png` (generic low-rise street, golden hour) |
| Emil | `assets/guides/emil/portrait.svg` + `portrait-1200.png`, `avatar.svg` + `avatar-512.png`, `scene.svg` + `scene-1200.png` (generic highway at dusk, unnamed town ahead, blank sign) |
| Guide profiles | `packages/core/src/guides/ida.json`, `emil.json`, `index.ts` |
| Domain checks | `benchmark/brand/domain_checks.json` |

Scenes deliberately show no real skyline, landmark, route shield or sign text.

## 5. Open decisions for the owner
1. **Register the domains** `telvey.com` (+ `telvey.ai`, `telvey.app`) now, and commission a formal trademark clearance before public use.
2. Confirm **Telvey** as the product name, or pick from the shortlist (Loreyon is the cleanest alternative).
3. Choose the default Guide. **Ida** is proposed, since her warmth suits first-run; Emil may suit drivers better. Consider defaulting to Emil when the first session starts in a driving regime.
4. Voice ids: decide after the D-010 benchmark, including Russian listening tests.
5. Wake-word ("Hey Telvey"): needs a false-trigger evaluation before it is advertised.
