import type { Metadata } from 'next';
import { config } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the Telvey team: field testing, partnerships, press and privacy requests.',
  alternates: { canonical: '/contact' },
};

const TOPICS = [
  { title: 'Field testing', body: 'Walk or drive a lot, especially in New York, Chicago, San Francisco or on U.S. interstates? We would love your help.', subject: 'Field testing' },
  { title: 'Partnerships', body: 'Tourism boards, scenic byways, fleets and in-car audio.', subject: 'Partnership' },
  { title: 'Privacy requests', body: 'Access or deletion requests. You can also delete your data yourself in the app’s Settings.', subject: 'Privacy request' },
  { title: 'Press', body: 'Background, screenshots and interviews.', subject: 'Press' },
];

export default function ContactPage() {
  const email = config.contactEmail;
  return (
    <article className="wrap prose">
      <p className="t-overline eyebrow">Contact</p>
      <h1 className="t-title1">Talk to the people behind the guide.</h1>
      <p>We read everything. We are a small team in field testing, so replies can take a few days.</p>
      {email ? null : (
        <div className="notice">
          <p>A public contact address has not been configured for this deployment yet (NEXT_PUBLIC_CONTACT_EMAIL).</p>
        </div>
      )}
      <ul className="contact-list" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12, marginTop: 24 }}>
        {TOPICS.map((t) => (
          <li key={t.title} className="card" style={{ padding: '18px 20px', display: 'grid', gap: 6 }}>
            <strong style={{ color: 'var(--text)' }}>{t.title}</strong>
            <span>{t.body}</span>
            {email ? (
              <a href={`mailto:${email}?subject=${encodeURIComponent(`Telvey: ${t.subject}`)}`} style={{ color: 'var(--accent-text)', fontWeight: 600 }}>
                {email}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </article>
  );
}
