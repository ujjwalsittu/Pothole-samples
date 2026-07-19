import { useEffect, useRef, useState } from 'react';
import { fetchThumbBlob } from '../api/client';

/**
 * Authenticated, lazy-loaded sample thumbnail. Fetches the thumb as a blob
 * (Authorization header) once the element scrolls into view; falls back to
 * the media-type glyph when the thumb endpoint 404s or errors.
 */
export function Thumb({
  sampleId,
  mediaType,
  size = 'md',
}: {
  sampleId: string;
  mediaType: 'photo' | 'video';
  size?: 'sm' | 'md';
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFailed(false);
    // Cached in the client for the session — no revoke here.
    fetchThumbBlob(sampleId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, sampleId]);

  const glyph = mediaType === 'video' ? '🎬' : '📷';
  const cls = size === 'sm' ? 'thumb-mini' : 'thumb';
  return (
    <span ref={ref} className={`${cls} thumb-wrap`}>
      {url && !failed ? <img src={url} alt="" className="thumb-img" /> : glyph}
    </span>
  );
}
