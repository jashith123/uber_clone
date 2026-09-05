import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Place } from '../lib/types';

interface Props {
  value: string;
  placeholder: string;
  near?: [number, number] | null;
  onChange: (text: string) => void;
  onSelect: (place: Place) => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  icon: 'pickup' | 'stop' | 'dropoff';
  trailing?: React.ReactNode;
}

type Suggestion = Place & { source?: 'recent' | 'popular' | 'common' | 'search' };

const SOURCE_LABEL: Record<string, string> = { recent: 'Recent', popular: 'Popular', common: 'Well-known places', search: 'Search results' };
const SOURCE_ICON: Record<string, string> = { recent: '🕒', popular: '🔥', common: '⭐', search: '📍' };

const closeTo = (a: Place, b: Place) => Math.abs(a.lat - b.lat) < 0.0007 && Math.abs(a.lng - b.lng) < 0.0007;

/**
 * Place picker.
 *  - On focus (before typing): the user's recent places, popular places and landmarks.
 *  - Every keystroke: that list is filtered instantly on the server.
 *  - From 3 characters: full address search (Nominatim) is merged in below.
 */
export default function PlaceSearch({ value, placeholder, near, onChange, onSelect, onFocus, autoFocus, icon, trailing }: Props) {
  const [local, setLocal] = useState<Suggestion[]>([]);
  const [remote, setRemote] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const localTimer = useRef<number | undefined>(undefined);
  const remoteTimer = useRef<number | undefined>(undefined);
  const localAbort = useRef<AbortController | null>(null);
  const remoteAbort = useRef<AbortController | null>(null);

  // Instant, locally-filtered suggestions (works from zero characters).
  useEffect(() => {
    if (!open) return;
    window.clearTimeout(localTimer.current);
    localTimer.current = window.setTimeout(async () => {
      localAbort.current?.abort();
      const ctrl = new AbortController();
      localAbort.current = ctrl;
      try {
        const { results } = await api<{ results: Suggestion[] }>(`/geo/suggest?q=${encodeURIComponent(value.trim())}`, { signal: ctrl.signal });
        setLocal(results);
      } catch {
        /* aborted or offline */
      }
    }, 80);
    return () => window.clearTimeout(localTimer.current);
  }, [value, open]);

  // Full address search once there is enough to search for.
  useEffect(() => {
    window.clearTimeout(remoteTimer.current);
    if (!open || value.trim().length < 3) {
      setRemote([]);
      setSearching(false);
      return;
    }
    remoteTimer.current = window.setTimeout(async () => {
      remoteAbort.current?.abort();
      const ctrl = new AbortController();
      remoteAbort.current = ctrl;
      setSearching(true);
      try {
        const q = new URLSearchParams({ q: value.trim() });
        if (near) {
          q.set('lat', String(near[0]));
          q.set('lng', String(near[1]));
        }
        const { results } = await api<{ results: Place[] }>(`/geo/geocode?${q}`, { signal: ctrl.signal });
        setRemote(results.map((r) => ({ ...r, source: 'search' as const })));
      } catch {
        /* aborted or failed */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 400);
    return () => window.clearTimeout(remoteTimer.current);
  }, [value, open, near]);

  const merged: Suggestion[] = [...local, ...remote.filter((r) => !local.some((l) => closeTo(l, r)))];
  const groups = merged.reduce<Record<string, Suggestion[]>>((acc, s) => {
    const k = s.source || 'search';
    (acc[k] ||= []).push(s);
    return acc;
  }, {});
  const show = open && (merged.length > 0 || searching);

  return (
    <div className="search">
      <div className="search-row">
        <span className={`dot dot-${icon}`} />
        <input
          className="search-input"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            onFocus?.();
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        />
        {value && (
          <button
            type="button"
            className="icon-btn"
            title="Clear"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('');
              setOpen(true);
            }}
          >
            ✕
          </button>
        )}
        {trailing}
      </div>
      {show && (
        <ul className="search-results">
          {(['recent', 'popular', 'common', 'search'] as const).flatMap((k) =>
            groups[k]?.length
              ? [
                  <li key={`h-${k}`} className="search-group">
                    {SOURCE_LABEL[k]}
                  </li>,
                  ...groups[k].map((r) => (
                    <li
                      key={`${k}-${r.lat},${r.lng}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(r);
                        setOpen(false);
                      }}
                    >
                      <span className="search-pin">{SOURCE_ICON[k]}</span>
                      <span>
                        <strong>{r.name}</strong>
                        <small>{r.label}</small>
                      </span>
                    </li>
                  )),
                ]
              : [],
          )}
          {searching && <li className="search-hint">Searching addresses…</li>}
        </ul>
      )}
    </div>
  );
}
