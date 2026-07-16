'use client';

import { useEffect, useRef } from 'react';

/**
 * Single cinematic hero loop — Tesla-style.
 *
 * Bandwidth model (why this is cheap):
 *  - ONE clip, played on the native `loop` attribute. The browser downloads it
 *    once and replays from the in-memory media buffer — every loop after the
 *    first is ZERO network. (The old version swapped `video.src` across 10 files
 *    every ~5s and called `video.load()`, which re-fetched bodies forever.)
 *  - `src` is a content-hashed asset URL (/_next/static/media/…) which Vercel
 *    serves `immutable` — so across visits the browser reuses the cached file and
 *    a new encode (new hash) busts it automatically. No stale-cache trap.
 *
 * We only pause playback (never re-fetch) when there's no reason to run: the tab
 * is hidden or the hero is scrolled off-screen. That's a CPU/battery win;
 * bandwidth is already handled by native loop + immutable caching.
 */
export default function HeroVideo({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Respect reduced-motion / metered connections: poster only, never fetch the
    // video. `src` is set here (not in JSX) so these users download nothing.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (reducedMotion || nav.connection?.saveData === true) return;

    video.src = src;
    video.load();

    let onScreen = true;
    const sync = () => {
      if (onScreen && !document.hidden) video.play().catch(() => {});
      else video.pause();
    };
    sync();

    document.addEventListener('visibilitychange', sync);
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0.01 },
    );
    io.observe(video);

    return () => {
      document.removeEventListener('visibilitychange', sync);
      io.disconnect();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-cover"
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
