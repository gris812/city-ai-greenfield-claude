import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms (draft)',
  description: 'Draft terms of use for the Telvey test programme.',
  alternates: { canonical: '/terms' },
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <article className="wrap prose">
      <p className="t-overline eyebrow">Legal</p>
      <h1 className="t-title1">Terms of use</h1>
      <div className="notice">
        <p>DRAFT — not legally reviewed. These terms cover the pre-launch test programme only and will be replaced before any public release.</p>
      </div>

      <h2>1. What Telvey is</h2>
      <p>
        Telvey is an audio companion that tells short stories about places around you. During testing it is provided free of charge, as is, and may change, break or be withdrawn at any time.
      </p>

      <h2>2. Driving</h2>
      <p>
        Your safety and compliance with traffic law are your responsibility. Set Telvey up before you start driving, do not handle your phone while driving, and follow local laws on device use. Drive
        mode is designed to reduce distraction; it does not make device use safe or legal in every situation.
      </p>

      <h2>3. Accuracy</h2>
      <p>
        Stories are generated from third-party sources and checked automatically, but they can still contain mistakes. Do not rely on Telvey for navigation, safety, opening hours or anything
        important. Always obey signs and local rules about where you may go.
      </p>

      <h2>4. Acceptable use</h2>
      <p>Do not misuse the service, attempt to break its security, overload it, or use it to harass others.</p>

      <h2>5. Test builds and feedback</h2>
      <p>Test builds are confidential unless we say otherwise. If you send feedback, we may use it to improve the product without obligation to you.</p>

      <h2>6. Liability</h2>
      <p>To the extent permitted by law, the test service is provided without warranties, and we are not liable for indirect or consequential losses arising from its use.</p>

      <h2>7. Changes</h2>
      <p>We will update these terms before launch. Continued use of a test build after a change means you accept the updated terms.</p>
    </article>
  );
}
