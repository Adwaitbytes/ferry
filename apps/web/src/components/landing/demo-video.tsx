'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** The 20 second loop recorded from the real product. Autoplays only without reduced motion. */
export function DemoVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    video.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) void video.play().then(() => setPlaying(true));
    else {
      video.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-border-hairline bg-surface-1 shadow-3">
      <video ref={ref} src={src} muted loop playsInline preload="metadata" className="block aspect-[4/3] w-full object-cover" aria-label="Ferry demo: rescue, carry and verify" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause demo' : 'Play demo'}
        className="absolute bottom-3 left-3 inline-flex size-9 items-center justify-center rounded-full bg-surface-2 text-text-primary shadow-2 hover:bg-surface-3"
      >
        {playing ? <Pause size={16} strokeWidth={1.75} aria-hidden="true" /> : <Play size={16} strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </div>
  );
}
