'use client';

// Root-level error boundary. Catches errors from the root layout / anything a nested error.tsx does
// not, so a pilot user never sees a raw crash/stack trace. A global-error MUST render its own
// <html>/<body>. Inline styles only (it renders outside the normal layout + global CSS).
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f9fafb',
          color: '#1f2937',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 420 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#f97316',
              margin: '0 auto 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: '0 0 1.25rem', lineHeight: 1.5 }}>
            FrontDesk hit an unexpected error. Your data is safe — please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#f97316',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '0.6rem 1.25rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
