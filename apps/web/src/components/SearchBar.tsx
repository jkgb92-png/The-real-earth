'use client';

/**
 * apps/web/src/components/SearchBar.tsx
 *
 * Geocoding search bar (top-centre) — searches for places, countries, and
 * addresses using the Nominatim OpenStreetMap API (free, no API key required).
 *
 * Features
 * --------
 *  - Curated list of famous mountains and monuments shown on focus / filtered
 *    as the user types — no API call required for these results
 *  - Debounced input (350 ms) to minimise API calls
 *  - Dropdown list of up to 6 results with display name + type badge + icon
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
  /** Pre-defined zoom level override (local landmark entries only) */
  _zoom?: number;
  /** Emoji icon prefix shown in the result row (local landmark entries only) */
  _icon?: string;
}

interface Props {
  onSelect: (result: SearchResult) => void;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE_MS = 350;
const MAX_RESULTS = 6;

// ─── Curated Landmarks ────────────────────────────────────────────────────────
// Shown immediately when the search box is focused and empty, and filtered
// client-side as the user types (prepended before Nominatim results).
const LANDMARKS: NominatimResult[] = [
  // ── Mountains ──────────────────────────────────────────────────────────────
  { place_id: -1,  display_name: 'Mount Everest',         lat: '27.9881',   lon: '86.9250',   type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -2,  display_name: 'K2',                    lat: '35.8825',   lon: '76.5133',   type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -3,  display_name: 'Mont Blanc',            lat: '45.8326',   lon: '6.8652',    type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -4,  display_name: 'Kilimanjaro',           lat: '-3.0674',   lon: '37.3556',   type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -5,  display_name: 'Aconcagua',             lat: '-32.6532',  lon: '-70.0109',  type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -6,  display_name: 'Denali',                lat: '63.0695',   lon: '-151.0074', type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -7,  display_name: 'Matterhorn',            lat: '45.9766',   lon: '7.6586',    type: 'mountain',  class: 'natural', importance: 1, _zoom: 13, _icon: '⛰️' },
  { place_id: -8,  display_name: 'Mount Fuji',            lat: '35.3606',   lon: '138.7274',  type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -9,  display_name: 'Elbrus',                lat: '43.3499',   lon: '42.4453',   type: 'mountain',  class: 'natural', importance: 1, _zoom: 12, _icon: '⛰️' },
  { place_id: -10, display_name: 'Mount Olympus',         lat: '40.0862',   lon: '22.3583',   type: 'mountain',  class: 'natural', importance: 1, _zoom: 13, _icon: '⛰️' },
  // ── Volcanoes ──────────────────────────────────────────────────────────────
  { place_id: -11, display_name: 'Mount Vesuvius',        lat: '40.8213',   lon: '14.4260',   type: 'volcano',   class: 'natural', importance: 1, _zoom: 13, _icon: '🌋' },
  { place_id: -12, display_name: 'Mount Etna',            lat: '37.7510',   lon: '14.9934',   type: 'volcano',   class: 'natural', importance: 1, _zoom: 12, _icon: '🌋' },
  { place_id: -13, display_name: 'Stromboli',             lat: '38.7912',   lon: '15.2134',   type: 'volcano',   class: 'natural', importance: 1, _zoom: 13, _icon: '🌋' },
  // ── Natural Wonders ────────────────────────────────────────────────────────
  { place_id: -14, display_name: 'Grand Canyon',          lat: '36.1069',   lon: '-112.1129', type: 'canyon',    class: 'natural', importance: 1, _zoom: 11, _icon: '🏜️' },
  { place_id: -15, display_name: 'Niagara Falls',         lat: '43.0962',   lon: '-79.0377',  type: 'waterfall', class: 'natural', importance: 1, _zoom: 13, _icon: '💧' },
  { place_id: -16, display_name: 'Uluru',                 lat: '-25.3444',  lon: '131.0369',  type: 'natural',   class: 'natural', importance: 1, _zoom: 13, _icon: '🏜️' },
  { place_id: -17, display_name: 'Victoria Falls',        lat: '-17.9243',  lon: '25.8567',   type: 'waterfall', class: 'natural', importance: 1, _zoom: 13, _icon: '💧' },
  // ── Ancient Monuments ──────────────────────────────────────────────────────
  { place_id: -18, display_name: 'Pyramids of Giza',      lat: '29.9792',   lon: '31.1342',   type: 'monument',  class: 'historic', importance: 1, _zoom: 14, _icon: '🏛️' },
  { place_id: -19, display_name: 'Colosseum',             lat: '41.8902',   lon: '12.4922',   type: 'monument',  class: 'historic', importance: 1, _zoom: 16, _icon: '🏛️' },
  { place_id: -20, display_name: 'Parthenon',             lat: '37.9715',   lon: '23.7267',   type: 'monument',  class: 'historic', importance: 1, _zoom: 16, _icon: '🏛️' },
  { place_id: -21, display_name: 'Stonehenge',            lat: '51.1789',   lon: '-1.8262',   type: 'monument',  class: 'historic', importance: 1, _zoom: 15, _icon: '🏛️' },
  { place_id: -22, display_name: 'Machu Picchu',          lat: '-13.1631',  lon: '-72.5450',  type: 'monument',  class: 'historic', importance: 1, _zoom: 14, _icon: '🏛️' },
  { place_id: -23, display_name: 'Angkor Wat',            lat: '13.4125',   lon: '103.8670',  type: 'monument',  class: 'historic', importance: 1, _zoom: 14, _icon: '🏛️' },
  { place_id: -24, display_name: 'Chichén Itzá',          lat: '20.6843',   lon: '-88.5678',  type: 'monument',  class: 'historic', importance: 1, _zoom: 14, _icon: '🏛️' },
  { place_id: -25, display_name: 'Petra',                 lat: '30.3285',   lon: '35.4444',   type: 'monument',  class: 'historic', importance: 1, _zoom: 14, _icon: '🏛️' },
  { place_id: -26, display_name: 'Borobudur',             lat: '-7.6079',   lon: '110.2038',  type: 'monument',  class: 'historic', importance: 1, _zoom: 15, _icon: '🏛️' },
  { place_id: -27, display_name: 'Hagia Sophia',          lat: '41.0086',   lon: '28.9802',   type: 'monument',  class: 'historic', importance: 1, _zoom: 16, _icon: '🏛️' },
  { place_id: -28, display_name: 'Easter Island (Moai)',  lat: '-27.1127',  lon: '-109.3497', type: 'monument',  class: 'historic', importance: 1, _zoom: 13, _icon: '🗿' },
  // ── Modern Landmarks ───────────────────────────────────────────────────────
  { place_id: -29, display_name: 'Eiffel Tower',          lat: '48.8584',   lon: '2.2945',    type: 'landmark',  class: 'tourism', importance: 1, _zoom: 16, _icon: '🗼' },
  { place_id: -30, display_name: 'Statue of Liberty',     lat: '40.6892',   lon: '-74.0445',  type: 'landmark',  class: 'tourism', importance: 1, _zoom: 15, _icon: '🗽' },
  { place_id: -31, display_name: 'Big Ben',               lat: '51.5007',   lon: '-0.1246',   type: 'landmark',  class: 'tourism', importance: 1, _zoom: 16, _icon: '🕐' },
  { place_id: -32, display_name: 'Burj Khalifa',          lat: '25.1972',   lon: '55.2744',   type: 'landmark',  class: 'tourism', importance: 1, _zoom: 16, _icon: '🏙️' },
  { place_id: -33, display_name: 'Sydney Opera House',    lat: '-33.8568',  lon: '151.2153',  type: 'landmark',  class: 'tourism', importance: 1, _zoom: 16, _icon: '🎭' },
  { place_id: -34, display_name: 'Sagrada Família',       lat: '41.4036',   lon: '2.1744',    type: 'landmark',  class: 'tourism', importance: 1, _zoom: 16, _icon: '⛪' },
  { place_id: -35, display_name: 'Taj Mahal',             lat: '27.1751',   lon: '78.0422',   type: 'landmark',  class: 'tourism', importance: 1, _zoom: 15, _icon: '🕌' },
  { place_id: -36, display_name: 'Christ the Redeemer',   lat: '-22.9519',  lon: '-43.2105',  type: 'landmark',  class: 'tourism', importance: 1, _zoom: 15, _icon: '✝️' },
  { place_id: -37, display_name: 'Great Wall of China',   lat: '40.4319',   lon: '116.5704',  type: 'landmark',  class: 'tourism', importance: 1, _zoom: 14, _icon: '🧱' },
  { place_id: -38, display_name: 'Mount Rushmore',        lat: '43.8791',   lon: '-103.4591', type: 'landmark',  class: 'tourism', importance: 1, _zoom: 14, _icon: '🗿' },
  { place_id: -39, display_name: 'Alhambra',              lat: '37.1760',   lon: '-3.5881',   type: 'landmark',  class: 'tourism', importance: 1, _zoom: 16, _icon: '🏰' },
  { place_id: -40, display_name: 'Tower of London',       lat: '51.5081',   lon: '-0.0759',   type: 'landmark',  class: 'tourism', importance: 1, _zoom: 16, _icon: '🏰' },
];

/** Map Nominatim result type → appropriate map zoom level */
function resultZoom(result: NominatimResult): number {
  if (result._zoom !== undefined) return result._zoom;
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
    mountain: 'Mountain',
    volcano: 'Volcano',
    monument: 'Monument',
    landmark: 'Landmark',
    natural: 'Natural',
    waterfall: 'Waterfall',
    canyon: 'Canyon',
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

  /** Filter the local LANDMARKS list by query string (case-insensitive). */
  function matchLandmarks(q: string): NominatimResult[] {
    const lower = q.toLowerCase();
    return LANDMARKS.filter((l) => l.display_name.toLowerCase().includes(lower));
  }

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    // Immediately show matching local landmarks while the network request is in flight.
    const localMatches = matchLandmarks(q);
    if (localMatches.length > 0) {
      setResults(localMatches.slice(0, MAX_RESULTS));
      setOpen(true);
      setHighlighted(-1);
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

      // Merge: local landmarks first, then Nominatim results (no name duplicates),
      // capped at MAX_RESULTS.
      const localNames = new Set(localMatches.map((l) => l.display_name.toLowerCase()));
      const deduped = data.filter((d) => !localNames.has(d.display_name.toLowerCase()));
      const combined = [...localMatches, ...deduped].slice(0, MAX_RESULTS);

      setResults(combined);
      setOpen(combined.length > 0);
      setHighlighted(-1);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('[SearchBar] geocode error:', err);
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setResults/setOpen/setHighlighted are stable setter functions; matchLandmarks is a pure helper defined in component scope that doesn't close over any state
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
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, -1));
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

  /** Show featured landmarks when the input is focused but empty. */
  function handleFocus() {
    if (!query.trim()) {
      setResults(LANDMARKS.slice(0, MAX_RESULTS));
      setOpen(true);
      setHighlighted(-1);
    } else if (results.length > 0) {
      setOpen(true);
    }
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
          onFocus={handleFocus}
          placeholder="Search place, mountain, monument…"
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
        <ul
          style={dropdown}
          role="listbox"
          aria-label="Search results"
          onMouseLeave={() => setHighlighted(-1)}
        >
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
              onClick={() => handleSelect(r)}
            >
              <span style={resultName}>
                {r._icon && <span style={iconStyle}>{r._icon}</span>}
                {shortName(r.display_name)}
              </span>
              <span
                style={{
                  ...resultBadge,
                  ...(r._icon ? resultBadgeLandmark : {}),
                }}
              >
                {typeBadge(r)}
              </span>
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

/** Amber tint for locally-defined landmark badge to distinguish from geocoder results */
const resultBadgeLandmark: React.CSSProperties = {
  color: 'rgba(255,200,80,0.8)',
  background: 'rgba(255,160,0,0.1)',
  border: '1px solid rgba(255,160,0,0.25)',
};

const iconStyle: React.CSSProperties = {
  marginRight: 5,
  fontSize: '0.78rem',
};
