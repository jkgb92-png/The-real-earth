'use client';

/**
 * apps/web/src/components/SearchBar.tsx
 *
 * Geocoding search bar (top-centre) — searches for places, countries, and
 * addresses using the Nominatim OpenStreetMap API (free, no API key required).
 *
 * Features
 * --------
 *  - Debounced input (350 ms) to minimise API calls
 *  - Dropdown list of up to 6 results with display name + type badge
 *  - Keyboard navigation: ↑ ↓ to move selection, Enter to confirm, Escape to close
 *  - Fires onSelect({ lat, lon, zoom }) so the parent can fly the map to the result
 *  - Fully self-contained; no external dependencies beyond React
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface SearchResult {
  lat: number;
  lon: number;
  /** Zoom level appropriate for the result type (country=4, city=10, address=14) */
  zoom: number;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  importance: number;
  addresstype?: string;
}

interface Props {
  onSelect: (result: SearchResult) => void;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE_MS = 350;
const MAX_RESULTS = 6;

/** Map Nominatim result type → appropriate map zoom level */
function resultZoom(result: NominatimResult): number {
  const t = result.addresstype ?? result.type;
  if (['country', 'continent'].includes(t)) return 4;
  if (['state', 'region', 'province'].includes(t)) return 6;
  if (['county', 'district', 'municipality'].includes(t)) return 8;
  if (['city', 'town', 'village'].includes(t)) return 10;
  if (['suburb', 'neighbourhood', 'quarter'].includes(t)) return 13;
  return 14; // street / address / POI
}

/** Shorten a Nominatim display_name for readability */
function shortName(display: string): string {
  const parts = display.split(', ');
  return parts.slice(0, 3).join(', ');
}

/** Type badge label */
function typeBadge(result: NominatimResult): string {
  const t = result.addresstype ?? result.type;
  const map: Record<string, string> = {
    country: 'Country',
    state: 'State',
    city: 'City',
    town: 'Town',
    village: 'Village',
    suburb: 'Suburb',
    neighbourhood: 'Neighbourhood',
    quarter: 'Quarter',
    county: 'County',
    district: 'District',
    municipality: 'Municipality',
    province: 'Province',
    region: 'Region',
  };
  return map[t] ?? result.class ?? 'Place';
}

export function SearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    try {
      const url = new URL(NOMINATIM_URL);
      url.searchParams.set('q', q);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', String(MAX_RESULTS));
      url.searchParams.set('addressdetails', '0');
      url.searchParams.set('extratags', '0');

      const res = await fetch(url.toString(), {
        signal: abortRef.current.signal,
        headers: { 'Accept-Language': 'en' },
      });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const data: NominatimResult[] = await res.json();
      setResults(data);
      setOpen(data.length > 0);
      setHighlighted(-1);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[SearchBar] geocode error:', err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelect(result: NominatimResult) {
    onSelect({
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      zoom: resultZoom(result),
    });
    setQuery(shortName(result.display_name));
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = highlighted >= 0 ? highlighted : 0;
      if (results[idx]) handleSelect(results[idx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function handleClear() {
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} style={wrapper}>
      {/* Search input row */}
      <div style={inputRow}>
        <span style={searchIcon} aria-hidden>🔍</span>
        <input
          ref={inputRef}
          style={inputStyle}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search place, country or address…"
          aria-label="Search location"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <span style={spinner} aria-hidden>⟳</span>}
        {query && !loading && (
          <button style={clearBtn} onClick={handleClear} type="button" aria-label="Clear search">
            ✕
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <ul style={dropdown} role="listbox" aria-label="Search results">
          {results.map((r, i) => (
            <li
              key={r.place_id}
              style={{
                ...dropdownItem,
                ...(i === highlighted ? dropdownItemHL : {}),
              }}
              role="option"
              aria-selected={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onMouseLeave={() => setHighlighted(-1)}
              onClick={() => handleSelect(r)}
            >
              <span style={resultName}>{shortName(r.display_name)}</span>
              <span style={resultBadge}>{typeBadge(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const wrapper: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 340,
  zIndex: 20,
  animation: 'slideInDown 0.45s cubic-bezier(0.22,1,0.36,1) 0.8s both',
};

const inputRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(8,12,30,0.88)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(80,160,255,0.22)',
  borderRadius: 10,
  padding: '7px 10px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
};

const searchIcon: React.CSSProperties = {
  fontSize: '0.85rem',
  flexShrink: 0,
  opacity: 0.7,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'none',
  border: 'none',
  outline: 'none',
  color: 'rgba(255,255,255,0.92)',
  fontSize: '0.8rem',
  fontFamily: 'ui-monospace, "Cascadia Code", monospace',
  letterSpacing: '0.02em',
  minWidth: 0,
};

const spinner: React.CSSProperties = {
  fontSize: '0.85rem',
  color: 'rgba(100,180,255,0.6)',
  animation: 'spin 0.8s linear infinite',
  flexShrink: 0,
};

const clearBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'rgba(150,200,255,0.5)',
  cursor: 'pointer',
  fontSize: '0.65rem',
  padding: '0 2px',
  flexShrink: 0,
  lineHeight: 1,
};

const dropdown: React.CSSProperties = {
  listStyle: 'none',
  margin: '4px 0 0',
  padding: 0,
  background: 'rgba(8,12,30,0.95)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(80,160,255,0.22)',
  borderRadius: 10,
  overflow: 'hidden',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
};

const dropdownItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 12px',
  cursor: 'pointer',
  transition: 'background 0.12s',
  borderBottom: '1px solid rgba(80,160,255,0.07)',
};

const dropdownItemHL: React.CSSProperties = {
  background: 'rgba(60,130,255,0.15)',
};

const resultName: React.CSSProperties = {
  fontSize: '0.73rem',
  color: 'rgba(255,255,255,0.88)',
  fontFamily: 'ui-monospace, "Cascadia Code", monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
};

const resultBadge: React.CSSProperties = {
  fontSize: '0.56rem',
  color: 'rgba(100,180,255,0.65)',
  background: 'rgba(60,130,255,0.12)',
  border: '1px solid rgba(60,130,255,0.2)',
  borderRadius: 4,
  padding: '1px 5px',
  flexShrink: 0,
  letterSpacing: '0.05em',
  fontFamily: 'ui-monospace, monospace',
  textTransform: 'uppercase',
};
