import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

// Social-share (Open Graph) image, rendered at build/request time — no binary asset needed.
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0c',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 20,
              backgroundColor: '#f97316',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Phone glyph (matches the site logo) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>{SITE_NAME}</div>
        </div>
        <div style={{ fontSize: 36, color: 'rgba(255,255,255,0.72)', marginTop: 28 }}>
          {SITE_TAGLINE}
        </div>
        <div style={{ fontSize: 26, color: '#f97316', marginTop: 18, fontWeight: 600 }}>
          Never miss a customer 
        </div>
      </div>
    ),
    { ...size },
  );
}
