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

export default function PlaceSearch({ value, placeholder, near, onChange, onSelect, onFocus, autoFocus, icon, trailing }: Props) {
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!open || value.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setLoading(true);
      try {
        const q = new URLSearchParams({ q: value.trim() });
        if (near) {
          q.set('lat', String(near[0]));
          q.set('lng', String(near[1]));
        }
        const { results } = await api<{ results: Place[] }>(`/geo/geocode?${q}`, { signal: ctrl.signal });
        setResults(results);
      } catch {
        /* aborted or failed */
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [value, open, near]);

  return (
    <div className="search">
      <div className="search-row">
        <span className={`dot dot-${icon}`} />
        <input
          className="search-input"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
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
        {trailing}
      </div>
      {open && (loading || results.length > 0) && (
        <ul className="search-results">
          {loading && results.length === 0 && <li className="search-hint">Searching…</li>}
          {results.map((r) => (
            <li
              key={`${r.lat},${r.lng}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(r);
                setOpen(false);
              }}
            >
              <span className="search-pin">📍</span>
              <span>
                <strong>{r.name}</strong>
                <small>{r.label}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
