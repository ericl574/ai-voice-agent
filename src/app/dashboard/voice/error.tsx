'use client';

// Route-level error boundary for the voice page. Catches render-time exceptions so an operator
// sees a recover button instead of a blank screen. The dashboard layout (sidebar) stays mounted.
// Async/event-handler errors are handled inline in page.tsx, not here (React boundaries only
// catch render/lifecycle throws).

import { useEffect } from 'react';

export default function VoiceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[FD debug] voice page render error:', error);
  }, [error]);

  return (
    <div className="fd-card" style={{ maxWidth: 480, margin: '4rem auto', textAlign: 'center' }}>
      <p className="fd-eyebrow">Voice test</p>
      <h2 className="fd-display" style={{ marginTop: '0.5rem' }}>
        Something went wrong
      </h2>
      <p style={{ marginTop: '0.75rem', color: 'var(--ink-soft, var(--ink))' }}>
        The voice page hit an unexpected error. Your last call was not affected. You can reload the
        page and try again.
      </p>
      <button className="fd-btn" style={{ marginTop: '1.5rem' }} onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
