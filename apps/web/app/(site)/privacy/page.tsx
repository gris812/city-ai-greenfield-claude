import type { Metadata } from 'next';
import Link from 'next/link';
import { config } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How Telvey handles location, voice and usage data: guest-first, no precise-location retention, deletion at any time.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <article className="wrap prose">
      <p className="t-overline eyebrow">Legal</p>
      <h1 className="t-title1">Privacy policy</h1>
      <p className="t-caption muted-3">Pre-launch version · last updated 27 September 2026</p>
      <div className="notice">
        <p>Telvey is in field testing and has not launched. This policy describes how the product is built to handle data today. It will be reviewed by counsel before launch.</p>
      </div>

      <h2>The short version</h2>
      <ul>
        <li>You can use Telvey as a guest. No account, name or email is needed.</li>
        <li>Your precise location is used live, in memory, to decide what is around you. It is not stored in our analytics.</li>
        <li>Analytics keep only a coarse area of about 5 km and whether you were walking or driving.</li>
        <li>Your route is never kept unless you explicitly turn on “save my journey”.</li>
        <li>You can delete your data at any time from Settings in the app.</li>
      </ul>

      <h2>Location</h2>
      <p>
        While a session is active, the app sends your position, heading and speed to our server so it can decide what is nearby or ahead. Precise coordinates are processed in memory and kept only
        as a short rolling window for the active session. When we record usage events for analytics, location is reduced to a geohash of precision 5 (a cell of roughly 5 × 5 km) together with your
        movement type (for example walking or highway driving). Raw location traces are not retained unless you opt in to saving a journey.
      </p>
      <p>Aggregate location reports in our admin console only show areas with at least five sessions, so individual trips cannot be singled out.</p>

      <h2>Voice</h2>
      <p>
        When you tap the microphone, your speech is turned into text so the guide can answer. In the web demo this uses your browser’s built-in speech recognition, which may be processed by your
        browser vendor under their own terms. You can always type instead. We do not keep audio recordings of your voice.
      </p>

      <h2>What we store, and for how long</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Why</th>
              <th scope="col">Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Journey memory (places already discussed, skips, talkativeness)</td>
              <td>So the guide does not repeat itself and can refer back to earlier places</td>
              <td>90 days for guests, or until you delete it</td>
            </tr>
            <tr>
              <td>Usage events (stories started, skipped, questions asked; coarse area and movement type)</td>
              <td>Product quality and reliability</td>
              <td>13 months</td>
            </tr>
            <tr>
              <td>Cost records for third-party services, per session</td>
              <td>Keeping the service affordable and within budget</td>
              <td>25 months</td>
            </tr>
            <tr>
              <td>Account email (only if you create an optional account)</td>
              <td>Sign-in with a one-time code</td>
              <td>Until you delete your account</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Service providers</h2>
      <p>
        To find places, fetch facts and produce speech, Telvey calls third-party services (map and place data, encyclopedic knowledge sources, language models, and text-to-speech or speech-to-text
        services). They receive only what a request needs, for example a coarse search area or the text of a story to be spoken. The final list of providers will be published here before launch.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>Delete your data:</strong> in the app, open Settings and choose “Delete my data”. This removes your guest or account history from our servers and clears data stored in your browser.
        </li>
        <li>
          <strong>Location permission:</strong> the web demo works entirely without your location (it can simulate a trip). Real location is only requested when you ask for it.
        </li>
        <li>
          <strong>No advertising:</strong> we do not sell your data or use it for advertising.
        </li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions or requests: {config.contactEmail ? <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a> : <Link href="/contact">contact page</Link>}.
      </p>
    </article>
  );
}
