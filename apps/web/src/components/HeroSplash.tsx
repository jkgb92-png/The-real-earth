'use client';

/**
 * apps/web/src/components/HeroSplash.tsx
 *
 * Cinematic full-screen landing screen shown before the map loads.
 *
 * Features
 * --------
 *  - CSS star-field background (defined in globals.css)
 *  - Animated SVG Earth silhouette with orbital ring
 *  - Glowing headline + subtitle fade-in
 *  - "Explore →" CTA button with zoom-out transition
 *  - Auto-dismisses after AUTO_DISMISS_MS of inactivity
 */

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 3000;

export function HeroSplash({ onDismiss }: Props): React.ReactElement {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function dismiss() {
    if (exiting) return;
    setExiting(true);
    // Allow the CSS exit animation to play before unmounting
    setTimeout(onDismiss, 600);
  }

  // Auto-dismiss after inactivity
  useEffect(() => {
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset auto-dismiss timer on any interaction
  function resetTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
  }

  return (
    <div
      style={{
        ...overlay,
        animation: exiting
          ? 'splashZoomIn 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards'
          : 'fadeIn 0.8s ease-out forwards',
      }}
      onMouseMove={resetTimer}
      onTouchStart={resetTimer}
    >
      {/* Star field layer */}
      <div className="starfield" />

      {/* Centre content */}
      <div style={content}>
        {/* Animated Earth SVG */}
        <div style={earthWrapper}>
          {/* Outer glow ring */}
          <div style={earthGlowRing} />

          {/* Earth sphere */}
          <svg
            width="160"
            height="160"
            viewBox="0 0 160 160"
            style={{ animation: 'earthGlow 3s ease-in-out infinite' }}
          >
            <defs>
              <radialGradient id="earthGrad" cx="38%" cy="35%" r="65%">
                <stop offset="0%"  stopColor="#4fa3f7" />
                <stop offset="40%" stopColor="#1565c0" />
                <stop offset="80%" stopColor="#0a3d7c" />
                <stop offset="100%" stopColor="#030d1a" />
              </radialGradient>
              <radialGradient id="atmosphere" cx="50%" cy="50%" r="50%">
                <stop offset="85%" stopColor="transparent" />
                <stop offset="100%" stopColor="rgba(80,160,255,0.35)" />
              </radialGradient>
              <clipPath id="earthClip">
                <circle cx="80" cy="80" r="70" />
              </clipPath>
            </defs>

            {/* Ocean base */}
            <circle cx="80" cy="80" r="70" fill="url(#earthGrad)" />

            {/* Continents — simplified silhouettes */}
            <g clipPath="url(#earthClip)" style={{ animation: 'earthSpin 20s linear infinite' }}>
              {/* North America */}
              <ellipse cx="42" cy="58" rx="18" ry="14" fill="rgba(34,139,34,0.7)" transform="rotate(-15,42,58)" />
              {/* South America */}
              <ellipse cx="52" cy="95" rx="10" ry="16" fill="rgba(34,139,34,0.65)" transform="rotate(10,52,95)" />
              {/* Europe / Africa */}
              <ellipse cx="88" cy="62" rx="9" ry="12" fill="rgba(34,139,34,0.6)" />
              <ellipse cx="90" cy="88" rx="12" ry="18" fill="rgba(34,139,34,0.65)" transform="rotate(5,90,88)" />
              {/* Asia */}
              <ellipse cx="115" cy="52" rx="22" ry="14" fill="rgba(34,139,34,0.6)" transform="rotate(-8,115,52)" />
              {/* Australia */}
              <ellipse cx="122" cy="98" rx="9" ry="7" fill="rgba(34,139,34,0.55)" />
              {/* Polar ice caps */}
              <ellipse cx="80" cy="14" rx="24" ry="8" fill="rgba(255,255,255,0.5)" />
              <ellipse cx="80" cy="146" rx="20" ry="6" fill="rgba(255,255,255,0.4)" />
              {/* Cloud wisps */}
              <ellipse cx="60" cy="40" rx="15" ry="5" fill="rgba(255,255,255,0.25)" transform="rotate(-20,60,40)" />
              <ellipse cx="100" cy="75" rx="18" ry="4" fill="rgba(255,255,255,0.2)" transform="rotate(10,100,75)" />
            </g>

            {/* Atmospheric halo */}
            <circle cx="80" cy="80" r="70" fill="url(#atmosphere)" />

            {/* Specular highlight */}
            <ellipse cx="58" cy="50" rx="16" ry="10" fill="rgba(255,255,255,0.1)" transform="rotate(-30,58,50)" />
          </svg>

          {/* Orbital ring */}
          <svg
            width="220"
            height="220"
            viewBox="0 0 220 220"
            style={orbitalRingSvg}
          >
            <ellipse
              cx="110" cy="110" rx="100" ry="28"
              fill="none"
              stroke="rgba(80,160,255,0.35)"
              strokeWidth="1"
              strokeDasharray="8 4"
            />
            {/* ISS dot on orbital ring */}
            <circle r="4" fill="#3c82ff">
              <animateMotion
                dur="6s"
                repeatCount="indefinite"
                path="M 110,82 a100,28 0 1,1 0.001,0"
              />
            </circle>
          </svg>
        </div>

        {/* Title */}
        <h1 style={headline}>
          THE REAL EARTH
        </h1>

        {/* Subtitle */}
        <p style={subtitle}>
          High-resolution · Cloud-free · Live
        </p>

        {/* Decorative separator */}
        <div style={separator} />

        {/* CTA */}
        <button style={ctaButton} onClick={dismiss} type="button">
          Explore →
        </button>

        {/* Data pills */}
        <div style={pills}>
          <span style={pill}>🛰 Sentinel-2</span>
          <span style={pill}>🌍 NASA GIBS</span>
          <span style={pill}>📡 Live ISS</span>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'radial-gradient(ellipse at center, #0d1a3a 0%, #0a0a1a 70%)',
  overflow: 'hidden',
};

const content: React.CSSProperties = {
  position: 'relative',
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  animation: 'fadeInScale 1s ease-out 0.2s both',
};

const earthWrapper: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 220,
  height: 220,
  marginBottom: 8,
};

const earthGlowRing: React.CSSProperties = {
  position: 'absolute',
  width: 180,
  height: 180,
  borderRadius: '50%',
  background: 'transparent',
  boxShadow: '0 0 60px 20px rgba(50, 120, 255, 0.3)',
  animation: 'earthGlow 3s ease-in-out infinite',
};

const orbitalRingSvg: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
};

const headline: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(1.6rem, 5vw, 2.8rem)',
  fontWeight: 100,
  letterSpacing: '0.35em',
  color: '#ffffff',
  textShadow: '0 0 30px rgba(80, 160, 255, 0.6), 0 0 60px rgba(80, 160, 255, 0.3)',
  animation: 'fadeIn 1s ease-out 0.6s both',
};

const subtitle: React.CSSProperties = {
  margin: 0,
  fontSize: 'clamp(0.75rem, 2vw, 0.95rem)',
  fontWeight: 400,
  letterSpacing: '0.2em',
  color: 'rgba(150, 200, 255, 0.8)',
  textTransform: 'uppercase',
  animation: 'fadeIn 1s ease-out 0.9s both',
};

const separator: React.CSSProperties = {
  width: 60,
  height: 1,
  background: 'linear-gradient(90deg, transparent, rgba(80,160,255,0.5), transparent)',
  animation: 'fadeIn 1s ease-out 1s both',
};

const ctaButton: React.CSSProperties = {
  marginTop: 8,
  padding: '12px 36px',
  fontSize: '1rem',
  fontWeight: 600,
  letterSpacing: '0.12em',
  color: '#ffffff',
  background: 'linear-gradient(135deg, rgba(60,130,255,0.3) 0%, rgba(30,80,200,0.4) 100%)',
  border: '1px solid rgba(80,160,255,0.5)',
  borderRadius: 8,
  cursor: 'pointer',
  backdropFilter: 'blur(8px)',
  transition: 'all 0.2s ease',
  textShadow: '0 0 12px rgba(80,160,255,0.6)',
  boxShadow: '0 0 20px rgba(60,130,255,0.2)',
  animation: 'fadeIn 1s ease-out 1.2s both',
};

const pills: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'center',
  animation: 'fadeIn 1s ease-out 1.5s both',
};

const pill: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '0.7rem',
  letterSpacing: '0.06em',
  color: 'rgba(150,200,255,0.7)',
  border: '1px solid rgba(80,160,255,0.2)',
  borderRadius: 20,
  background: 'rgba(20,40,80,0.4)',
};
