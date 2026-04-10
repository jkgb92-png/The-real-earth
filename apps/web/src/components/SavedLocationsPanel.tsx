'use client';

/**
 * apps/web/src/components/SavedLocationsPanel.tsx
 *
 * Collapsible panel (bottom-right) for saving and returning to named map views.
 * Locations are persisted in localStorage by the parent (EarthWebMap).
 *
 * Clicking a saved entry fires onFlyTo so the map animates to that view.
 * "Save current view" uses the map's current centre + zoom, not device GPS.
 */

import React, { useState } from 'react';

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zoom: number;
}

interface Props {
  locations: SavedLocation[];
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
  onFlyTo: (location: SavedLocation) => void;
}

export function SavedLocationsPanel({ locations, onAdd, onRemove, onFlyTo }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [inputValue, setInputValue] = useState('');

  function handleAdd() {
    const name = inputValue.trim();
    if (!name) return;
    onAdd(name);
    setInputValue('');
    setAdding(false);
  }

  function handleCancelAdd() {
    setAdding(false);
    setInputValue('');
  }

  return (
    <div style={{ ...panel, animation: 'slideInRight 0.5s cubic-bezier(0.22,1,0.36,1) 1.3s both' }}>
      {/* Header */}
      <div style={header}>
        <span style={sectionLabel}>📍 SAVED VIEWS</span>
        <button style={collapseBtn} onClick={() => setCollapsed((c) => !c)} type="button">
          {collapsed ? '▸' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div style={content}>
          {locations.length === 0 && !adding && (
            <div style={empty}>No saved views yet</div>
          )}

          {/* Saved location rows */}
          <div style={listWrap}>
            {locations.map((loc) => (
              <div key={loc.id} style={locRow}>
                <button
                  style={flyBtn}
                  onClick={() => onFlyTo(loc)}
                  title={`Return to ${loc.name}`}
                  type="button"
                >
                  <span style={locName}>{loc.name}</span>
                  <span style={locCoords}>
                    {Math.abs(loc.lat).toFixed(2)}°{loc.lat >= 0 ? 'N' : 'S'}{' '}
                    {Math.abs(loc.lon).toFixed(2)}°{loc.lon >= 0 ? 'E' : 'W'}
                    {' · '}z{loc.zoom.toFixed(1)}
                  </span>
                </button>
                <button
                  style={removeBtn}
                  onClick={() => onRemove(loc.id)}
                  title="Remove"
                  type="button"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Inline name input */}
          {adding && (
            <div style={addRow}>
              <input
                style={nameInput}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') handleCancelAdd();
                }}
                placeholder="Name this view…"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                maxLength={32}
              />
              <button style={confirmBtn} onClick={handleAdd} title="Save" type="button">
                ✓
              </button>
              <button style={cancelBtn} onClick={handleCancelAdd} title="Cancel" type="button">
                ✕
              </button>
            </div>
          )}

          {!adding && (
            <button style={addBtn} onClick={() => setAdding(true)} type="button">
              + Save current view
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const panel: React.CSSProperties = {
  position: 'absolute',
  bottom: 40,
  right: 16,
  width: 190,
  background: 'rgba(8,12,30,0.82)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(80,160,255,0.18)',
  borderRadius: 12,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  zIndex: 10,
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 6,
};

const sectionLabel: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  letterSpacing: '0.15em',
  color: 'rgba(150,200,255,0.5)',
};

const collapseBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'rgba(150,200,255,0.6)',
  cursor: 'pointer',
  fontSize: '0.7rem',
  padding: '2px 4px',
};

const content: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const listWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 200,
  overflowY: 'auto',
};

const empty: React.CSSProperties = {
  fontSize: '0.65rem',
  color: 'rgba(150,200,255,0.35)',
  textAlign: 'center',
  padding: '8px 0',
  fontStyle: 'italic',
};

const locRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 4,
};

const flyBtn: React.CSSProperties = {
  flex: 1,
  background: 'rgba(80,160,255,0.07)',
  border: '1px solid rgba(80,160,255,0.15)',
  borderRadius: 6,
  cursor: 'pointer',
  padding: '5px 7px',
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const locName: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'rgba(255,255,255,0.9)',
  fontFamily: 'ui-monospace, "Cascadia Code", monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const locCoords: React.CSSProperties = {
  fontSize: '0.56rem',
  color: 'rgba(150,200,255,0.5)',
  fontFamily: 'ui-monospace, "Cascadia Code", monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const removeBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid rgba(255,80,80,0.2)',
  borderRadius: 5,
  color: 'rgba(255,100,100,0.55)',
  cursor: 'pointer',
  fontSize: '0.6rem',
  width: 22,
  flexShrink: 0,
  alignSelf: 'stretch',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const addRow: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'center',
  marginTop: 2,
};

const nameInput: React.CSSProperties = {
  flex: 1,
  background: 'rgba(80,160,255,0.1)',
  border: '1px solid rgba(80,160,255,0.35)',
  borderRadius: 5,
  color: 'rgba(255,255,255,0.9)',
  fontSize: '0.65rem',
  padding: '4px 6px',
  outline: 'none',
  fontFamily: 'ui-monospace, "Cascadia Code", monospace',
  minWidth: 0,
};

const confirmBtn: React.CSSProperties = {
  background: 'rgba(60,130,255,0.2)',
  border: '1px solid rgba(60,130,255,0.4)',
  borderRadius: 5,
  color: 'rgba(100,180,255,0.9)',
  cursor: 'pointer',
  fontSize: '0.65rem',
  width: 22,
  height: 26,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const cancelBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid rgba(255,80,80,0.2)',
  borderRadius: 5,
  color: 'rgba(255,100,100,0.6)',
  cursor: 'pointer',
  fontSize: '0.6rem',
  width: 22,
  height: 26,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const addBtn: React.CSSProperties = {
  width: '100%',
  background: 'rgba(60,130,255,0.08)',
  border: '1px dashed rgba(80,160,255,0.28)',
  borderRadius: 6,
  color: 'rgba(150,200,255,0.65)',
  cursor: 'pointer',
  fontSize: '0.62rem',
  padding: '5px',
  marginTop: 2,
};
