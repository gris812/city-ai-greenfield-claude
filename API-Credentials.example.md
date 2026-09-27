# API Credentials — Example Only

**Never put real secrets in this file.**

The owner may create a local sibling file named `API-Credentials.md` using this structure. `API-Credentials.md` is git-ignored and must never be committed, quoted in reports, copied into screenshots, or bundled into any client application.

Only request/fill credentials actually needed by the selected architecture. The entries below reflect the architecture in `DECISIONS.md`; categories marked *optional* are not required for the MVP.

## Repository / CI
- GitHub repository: `<repo URL>`
- GitHub auth method/token reference: `<local secret or connected account>`
- Container registry (if used): `<provider + credential reference>` *(optional — GHCR via GITHUB_TOKEN is the default)*

## VPS / Deployment
- Host: `<hostname/IP>`
- SSH user: `<user>`
- SSH key path/reference: `<local path or secure secret-store reference>`
- Deployment domain(s): `<domains>`

## Domain / DNS
- Registrar: `<provider>`
- DNS provider: `<provider>`
- API token/reference: `<secret>`

## Maps / Places / Routing
- Provider: `<provider>`
- Server key/reference: `<secret>`
- iOS restricted key/reference: `<secret if applicable>`
- Android restricted key/reference: `<secret if applicable>`
- Web restricted key/reference: `<secret if applicable>`

## Generative AI / Realtime
- Primary provider: `<provider>`
- API key/reference: `<secret>`
- Secondary benchmark provider: `<provider>`
- API key/reference: `<secret>`

## STT / TTS / Voice
- Provider(s): `<provider>`
- API key/reference: `<secret>`

## Email / OTP
- Provider: `<provider>`
- API key/reference: `<secret>`
- Sending domain/from address: `<value>`

## Database / Cache / Storage
- PostgreSQL URL/reference: `<secret>` *(defaults to self-hosted Postgres on the VPS)*
- Redis URL/reference: `<secret>` *(defaults to self-hosted Redis on the VPS)*
- Object storage endpoint/bucket: `<value>` *(optional — local volume by default)*
- Object storage access reference: `<secret>`

## Observability / Analytics
- Error monitoring: `<provider + secret reference>` *(optional)*
- Logs/metrics: `<provider + secret reference>` *(optional — first-party metrics pipeline is built in)*
- Product analytics: `<provider + secret reference>` *(optional — first-party)*

## Mobile Distribution
### Apple
- Apple Developer Team: `<team>`
- App Store Connect credentials/reference: `<secret>`
- Bundle ID: `<value>`

### Android
- Google Play/Firebase project: `<value>` *(optional — APK sideload via EAS is sufficient for testing)*
- Service-account/signing reference: `<secret>`
- Application ID: `<value>`

### Expo/EAS (selected)
- Account/project: `<value>`
- Token/reference: `<secret>`

## Admin bootstrap
- Owner/admin identity (email or external IdP subject): `<value>`
- Bootstrap mechanism: `<secure method>` *(default: `OWNER_EMAIL` env var on the server; first OTP login from that address is granted the `owner` role and audited)*

Never use a static password embedded in source code or mobile/web bundles.
