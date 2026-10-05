import Link from 'next/link';
import { DriveHud, ListeningSheet, NowPlayingCard, PhoneFrame, QuietCard } from '@/components/companion/Companion';
import { MapSketch } from '@/components/site/MapSketch';
import { config } from '@/lib/config';
import { getShowcase } from '@/lib/showcase';

export const dynamic = 'force-static';

const STEPS = [
  {
    n: '01',
    title: 'Notices what’s around, and ahead',
    body: 'Your position, heading and pace tell Telvey what is near you on foot, or what is coming up down the road. There is no city list and no fixed tour: it starts from wherever you are.',
  },
  {
    n: '02',
    title: 'Decides whether the moment is worth it',
    body: 'Most moments are not worth an interruption. Telvey weighs how notable a place is, when you will pass it and how recently it spoke. Staying quiet is the default.',
  },
  {
    n: '03',
    title: 'Tells a grounded story',
    body: 'Stories are built from sourced facts about that exact place and checked before they are read aloud. When the facts are thin, you get a one-line heads-up, not an invented tale.',
  },
  {
    n: '04',
    title: 'Listens when you speak',
    body: 'Interrupt at any time. Ask what that building is, say “skip”, “quieter” or “find coffee”. It picks up where it left off, or lets the story go if you have moved on.',
  },
];

const GUIDES = [
  {
    id: 'ida' as const,
    name: 'Ida',
    tagline: 'The unhurried storyteller who has time for every street.',
    traits: ['People, origins and everyday life', 'Connects what you see to places you passed earlier', 'Warm, patient, gentle humour'],
    line: 'Hello, I’m Ida. I’ll keep you company while you go. When something around us has a story worth telling, I’ll tell it; otherwise I’ll let you enjoy the quiet.',
    ru: 'Я немного помолчу. Позовите меня по имени, если захотите.',
    quiet: 'I’ll keep quiet for a while. Just say my name if you’d like me.',
  },
  {
    id: 'emil' as const,
    name: 'Emil',
    tagline: 'The sharp-eyed observer who gets to the point.',
    traits: ['Hidden details, numbers, architecture', 'Shorter stories, crisp sign-offs', 'Dry, wry, never snide'],
    line: 'Emil here. I’ll speak up when there’s something worth hearing, and stay out of your way when there isn’t.',
    ru: 'Молчу. Заговорю, только если будет что-то стоящее.',
    quiet: 'Going quiet. I’ll only pipe up for something good.',
  },
];

const FAQ = [
  {
    q: 'Is Telvey available where I live?',
    a: 'Telvey is global by design: it has no list of supported cities and works from wherever you are, using global place and knowledge sources. It has not launched yet. We are field testing in New York, Chicago, San Francisco and on U.S. interstates first because they cover the hardest cases: dense downtowns, museum districts, big landmarks and long, sparse highway runs.',
  },
  {
    q: 'Does it talk all the time?',
    a: 'No. Silence is a feature. Telvey only speaks when a place is notable enough and the timing works, and it leaves gaps between stories. On a quiet highway it can stay silent for a long time, which is the intended behaviour. You can make it quieter or chattier at any time.',
  },
  {
    q: 'Is it safe to use while driving?',
    a: 'Drive mode is designed to keep your eyes on the road: it is audio-first, never asks you questions, never needs a tap to keep going, and shows one large voice button on a dark, high-contrast screen. It turns on automatically when you are driving. Set it up before you set off and always follow local laws. This is a design principle, not a safety certification.',
  },
  {
    q: 'Where do the stories come from? Can the guide make things up?',
    a: 'Each story is assembled from facts about that specific place, with their sources recorded, and it is checked before playback: names, years and numbers must appear in the source facts. If a check fails, Telvey falls back to a plain version built only from those facts. If there is too little information, you get a short heads-up instead of a story.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. Telvey is guest-first: you can start without signing up. An optional account only exists to keep your history across devices.',
  },
  {
    q: 'What happens to my location?',
    a: 'Your precise position is used in memory during your session to decide what is nearby. Analytics only keep a coarse area of roughly 5 km and whether you were walking or driving. Your route is not stored unless you explicitly choose to save a journey, and you can delete your data at any time. See the privacy policy for details.',
  },
  {
    q: 'Can I ask it questions?',
    a: 'Yes. Tap the microphone (or hold it to talk) and ask about what you are looking at, ask for something nearby, or tell it to skip, pause or be quieter. Answers come from the same sourced facts.',
  },
  {
    q: 'Which languages does it speak?',
    a: 'English and Russian are being tested now.',
  },
  {
    q: 'How much will it cost?',
    a: 'Pricing has not been set. Testing is free, and the plan is that you can use Telvey properly as a guest before anything asks you to pay or sign up.',
  },
];

function EarlyAccessLink({ className }: { className: string }) {
  const href = config.earlyAccess.signup ?? (config.contactEmail ? `mailto:${config.contactEmail}?subject=Telvey%20early%20access` : '/contact');
  return (
    <a href={href} className={className}>
      Get early access
    </a>
  );
}

export default function HomePage() {
  const sc = getShowcase();
  return (
    <>
      {/* ── Hero */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="chip chip-brand chip-dot hero-chip">In field testing · not yet launched</p>
            <h1 className="t-display">A local companion for wherever you are.</h1>
            <p className="hero-lede">
              Telvey notices what is around you and what is ahead, and tells a short story grounded in real sources, only when a moment is worth it. Walk a city block or drive an
              interstate: it <em>knows when to talk, and when to stay quiet.</em>
            </p>
            <div className="hero-ctas">
              <Link href="/app" className="btn btn-primary">
                Try the web demo
              </Link>
              <EarlyAccessLink className="btn btn-ghost" />
            </div>
            <p className="t-caption muted">The web demo simulates a walk or a drive in your browser. No sign-up, no location needed.</p>
          </div>
          <div className="hero-device">
            <PhoneFrame label="The real Now Telling card, rendered from a simulated replay (fixture data).">
              <div className="phone-map">
                <MapSketch variant="walk" />
                <span className="chip chip-sim phone-sim">Simulated location</span>
              </div>
              <div className="phone-sheet">{sc.walking ? <NowPlayingCard view={sc.walking} compact /> : null}</div>
            </PhoneFrame>
          </div>
        </div>
      </section>

      {/* ── How it works */}
      <section id="how" className="section">
        <div className="wrap">
          <p className="t-overline eyebrow">How it works</p>
          <h2 className="t-title1 section-title">Four decisions, made every few seconds.</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n} className="step">
                <span className="step-n mono">{s.n}</span>
                <h3 className="t-headline">{s.title}</h3>
                <p className="muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Guides */}
      <section id="guides" className="section section-sand">
        <div className="wrap">
          <p className="t-overline eyebrow">Guides</p>
          <h2 className="t-title1 section-title">Same facts, different company.</h2>
          <p className="section-lede muted">
            Pick the voice that suits the trip. Both guides tell only what the sources support. They differ in what they notice, how long they talk and how they sound.
          </p>
          <div className="guides">
            {GUIDES.map((g) => (
              <article key={g.id} className="guide-card" data-guide={g.id}>
                <div className="guide-art">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="guide-scene" src={`/guides/${g.id}/scene.svg`} alt={g.id === 'ida' ? 'Illustration of Ida on a low-rise street at golden hour' : 'Illustration of Emil beside a highway at dusk'} loading="lazy" />
                </div>
                <div className="guide-body">
                  <h3 className="t-title2">{g.name}</h3>
                  <p className="guide-tagline">{g.tagline}</p>
                  <ul className="guide-traits">
                    {g.traits.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <blockquote className="guide-quote">
                    <p>“{g.line}”</p>
                  </blockquote>
                  <p className="guide-alt t-body-sm muted">
                    <span className="t-overline">When you ask for quiet</span>
                    <br />“{g.quiet}” <span lang="ru">· «{g.ru}»</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Walking vs driving */}
      <section id="modes" className="section">
        <div className="wrap">
          <p className="t-overline eyebrow">Walking &amp; driving</p>
          <h2 className="t-title1 section-title">On foot it looks around. At the wheel it looks ahead.</h2>
          <p className="section-lede muted">You never pick a mode. Telvey notices when you start driving, when you park and when you walk off, and adapts in the same session.</p>
          <div className="modes">
            <article className="mode card">
              <p className="t-overline muted-3">On foot</p>
              <h3 className="t-title2">Around you</h3>
              <ul className="ticks">
                <li>Looks at what is near you, in every direction</li>
                <li>Stories of up to about two minutes, with the text on screen</li>
                <li>The place being described is highlighted on the map</li>
                <li>Ask follow-up questions or for something nearby</li>
              </ul>
            </article>
            <article className="mode mode-drive">
              <p className="t-overline">At the wheel</p>
              <h3 className="t-title2">Down the road</h3>
              <ul className="ticks">
                <li>Looks along your route or heading, and ignores what is behind you</li>
                <li>Big landmarks and towns can be announced miles ahead</li>
                <li>Shorter stories, timed to finish before you pass</li>
                <li>Never asks you a question and never needs a tap</li>
                <li>One big voice button on a dark, high-contrast screen</li>
              </ul>
            </article>
          </div>
          <div className="silence card">
            <div>
              <p className="t-overline eyebrow">Silence is a feature</p>
              <h3 className="t-title2">Long quiet stretches are the product working.</h3>
              <p className="muted">
                On an empty highway the right thing to say is usually nothing. Telvey keeps listening for a place worth your attention and does not fill the gap with trivia.
              </p>
            </div>
            {sc.interstate ? (
              <dl className="silence-stats" aria-label="Simulated interstate replay">
                <div>
                  <dt>Simulated drive</dt>
                  <dd>{sc.interstate.minutes} min</dd>
                </div>
                <div>
                  <dt>Stories told</dt>
                  <dd>{sc.interstate.stories}</dd>
                </div>
                <div>
                  <dt>Time spent quiet</dt>
                  <dd>{sc.interstate.quietPct}%</dd>
                </div>
                <div>
                  <dt>Longest quiet stretch</dt>
                  <dd>{sc.interstate.longestQuietMin} min</dd>
                </div>
                <p className="t-caption muted-3 silence-note">
                  From a deterministic replay of a synthetic trace over test fixtures, run through the production decision engine. Not a field measurement.
                </p>
              </dl>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Real UI */}
      <section id="see" className="section section-sand">
        <div className="wrap">
          <p className="t-overline eyebrow">The interface</p>
          <h2 className="t-title1 section-title">Mostly out of your way.</h2>
          <p className="section-lede muted">These are the WebApp’s own components, rendered here. Try them live in the web demo.</p>
          <div className="devices">
            <PhoneFrame label="Quiet stretch: nothing worth interrupting for.">
              <div className="phone-map">
                <MapSketch variant="quiet" />
              </div>
              <div className="phone-sheet">
                <QuietCard guideName="Ida" />
              </div>
            </PhoneFrame>
            <PhoneFrame label="Tap the mic to interrupt. The story pauses and resumes." theme="dark">
              <ListeningSheet inline transcript="What’s that building with the lions?" />
            </PhoneFrame>
            <PhoneFrame label="Drive mode: one line, one button. Switches on by itself." theme="drive">
              <div className="phone-map phone-map-short">
                <MapSketch variant="drive" />
              </div>
              <div className="phone-drive">
                <DriveHud hero={sc.driving?.hero ?? 'Town ahead'} secondary={sc.driving?.secondary ?? 'Emil · short story'} simulated speaking />
              </div>
            </PhoneFrame>
          </div>
        </div>
      </section>

      {/* ── Availability */}
      <section id="availability" className="section">
        <div className="wrap avail">
          <div>
            <p className="t-overline eyebrow">Availability</p>
            <h2 className="t-title1 section-title">Global by design. Field testing first in New York, Chicago, San Francisco and on U.S. interstates.</h2>
            <p className="muted">
              These are test grounds, not a coverage map. Telvey has not launched yet, and there are no public app store releases. If you would like to help test it, get in touch.
            </p>
          </div>
          <ul className="avail-list">
            <li className="avail-item">
              <span className="chip chip-ok">Available now</span>
              <div>
                <h3 className="t-headline">Web demo</h3>
                <p className="t-body-sm muted">Simulated walks and drives in your browser, running the same decision engine as the app.</p>
              </div>
              <Link className="btn btn-primary btn-sm" href="/app">
                Open
              </Link>
            </li>
            <li className="avail-item">
              <span className="chip chip-warn">Test builds</span>
              <div>
                <h3 className="t-headline">Android</h3>
                <p className="t-body-sm muted">Invite-only test builds for field testers.</p>
              </div>
              {config.earlyAccess.android ? (
                <a className="btn btn-ghost btn-sm" href={config.earlyAccess.android}>
                  Get the build
                </a>
              ) : (
                <EarlyAccessLink className="btn btn-ghost btn-sm" />
              )}
            </li>
            <li className="avail-item">
              <span className="chip">Not yet</span>
              <div>
                <h3 className="t-headline">iPhone</h3>
                <p className="t-body-sm muted">An iOS test build is not available yet.</p>
              </div>
              {config.earlyAccess.ios ? (
                <a className="btn btn-ghost btn-sm" href={config.earlyAccess.ios}>
                  Join the test
                </a>
              ) : null}
            </li>
            <li className="avail-item">
              <span className="chip chip-brand">Testing</span>
              <div>
                <h3 className="t-headline">Languages</h3>
                <p className="t-body-sm muted">English and Russian.</p>
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* ── FAQ */}
      <section id="faq" className="section section-sand">
        <div className="wrap faq-wrap">
          <div>
            <p className="t-overline eyebrow">FAQ</p>
            <h2 className="t-title1 section-title">Questions, answered briefly.</h2>
            <p className="muted">
              Something else? <Link href="/contact">Contact us</Link>.
            </p>
          </div>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{f.q}</summary>
                <p className="muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section cta-band">
        <div className="wrap cta-inner">
          <h2 className="t-title1">Hear what the next block has to say.</h2>
          <div className="hero-ctas">
            <Link href="/app" className="btn btn-accent">
              Try the web demo
            </Link>
            <EarlyAccessLink className="btn cta-ghost" />
          </div>
        </div>
      </section>
    </>
  );
}
