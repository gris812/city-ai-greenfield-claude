import { ImageResponse } from 'next/og';
import { WORDMARK_PATHS, WORDMARK_TRANSFORM, WORDMARK_VIEWBOX } from '@/components/brand-paths';

export const alt = 'Telvey — a local companion for wherever you are. Knows when to talk, and when to stay quiet.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function svgData(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export default function OpengraphImage() {
  const mark = svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M66.6 22.58 A38 38 0 0 0 22 60 L22 98 L60 98 A38 38 0 0 0 96.14 48.26" fill="none" stroke="#F7F4EE" stroke-width="13.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="60" cy="60" r="12" fill="#FF6A4D"/></svg>`,
  );
  const word = svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK_VIEWBOX}"><g transform="${WORDMARK_TRANSFORM}" fill="#F7F4EE">${WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`,
  );
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#0B3942', padding: 72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={96} height={96} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={word} width={270} height={99} alt="" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 64, color: '#F7F4EE', fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5 }}>A local companion for wherever you are.</div>
          <div style={{ fontSize: 34, color: '#8DBBC2' }}>Knows when to talk, and when to stay quiet.</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ display: 'flex', background: '#FFC857', color: '#131A1D', fontSize: 24, fontWeight: 700, padding: '8px 18px', borderRadius: 999 }}>In field testing</div>
        </div>
      </div>
    ),
    size,
  );
}
