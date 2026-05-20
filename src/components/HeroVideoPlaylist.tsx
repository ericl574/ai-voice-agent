'use client';

import { useEffect, useRef } from 'react';

const DISPLAY_MS = 4500;
const FADE_MS = 700;

export default function HeroVideoPlaylist({ videos }: { videos: string[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || videos.length === 0) return;

    indexRef.current = 0;
    video.src = videos[0];
    video.load();
    video.play().catch(() => {});

    if (videos.length === 1) return;

    let switchTimer: ReturnType<typeof setTimeout> | null = null;

    const interval = setInterval(() => {
      video.style.transition = `opacity ${FADE_MS}ms ease-in-out`;
      video.style.opacity = '0';

      switchTimer = setTimeout(() => {
        indexRef.current = (indexRef.current + 1) % videos.length;
        video.src = videos[indexRef.current];
        video.load();
        video.play().catch(() => {});
        video.style.opacity = '1';
        switchTimer = null;
      }, FADE_MS);
    }, DISPLAY_MS + FADE_MS);

    return () => {
      clearInterval(interval);
      if (switchTimer) clearTimeout(switchTimer);
    };
  }, [videos]);

  if (videos.length === 0) return null;

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-cover"
      style={{ opacity: 1, transition: `opacity ${FADE_MS}ms ease-in-out` }}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
