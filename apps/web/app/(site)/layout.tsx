import Link from 'next/link';
import './site.css';
import { Lockup } from '@/components/brand';
import { config } from '@/lib/config';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap site-header-row">
          <Link href="/" className="site-logo" aria-label="Telvey home">
            <Lockup height={26} />
          </Link>
          <nav aria-label="Primary" className="site-nav">
            <Link href="/#how">How it works</Link>
            <Link href="/#guides">Guides</Link>
            <Link href="/#modes">Walking &amp; driving</Link>
            <Link href="/#faq">FAQ</Link>
          </nav>
          <Link href="/app" className="btn btn-primary btn-sm site-cta">
            Try the web demo
          </Link>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div className="footer-brand">
            <Lockup height={24} />
            <p className="t-body-sm muted">A local companion for wherever you are. Knows when to talk, and when to stay quiet.</p>
            <p className="t-caption muted-3">In field testing. Not yet launched. “Telvey” is a working name.</p>
          </div>
          <nav aria-label="Product" className="footer-col">
            <p className="t-overline muted-3">Product</p>
            <Link href="/app">Web demo</Link>
            <Link href="/#guides">Guides</Link>
            <Link href="/#availability">Availability</Link>
            <Link href="/#faq">FAQ</Link>
          </nav>
          <nav aria-label="Company" className="footer-col">
            <p className="t-overline muted-3">Company</p>
            <Link href="/contact">Contact</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms (draft)</Link>
          </nav>
        </div>
        <div className="wrap footer-base t-caption muted-3">
          <span>© {new Date().getFullYear()} Telvey (working name)</span>
          <span>
            Map data © OpenStreetMap contributors · Build <span className="mono">{config.buildSha.slice(0, 7)}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
