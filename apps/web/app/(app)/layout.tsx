import type { Metadata, Viewport } from 'next';
import { CompanionProvider } from '@/components/app/CompanionProvider';
import './app.css';

export const metadata: Metadata = {
  title: 'Web demo',
  description: 'Telvey WebApp: simulated walks and drives with the real decision engine, or your own location.',
  appleWebApp: { capable: true, title: 'Telvey', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0F4C5C',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <CompanionProvider>{children}</CompanionProvider>;
}
