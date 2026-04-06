'use client';

/**
 * apps/web/src/components/AnimatedMount.tsx
 *
 * Wraps a page with a splash screen that transitions into the main content.
 *
 * Flow:
 *  1. Render `splash` prop (HeroSplash) on top of the main content.
 *  2. When splash calls onDismiss, hide the splash and reveal children
 *     with a zoom-in animation.
 */

import React, { useState } from 'react';

interface Props {
  splash: React.ReactElement<{ onDismiss: () => void }>;
  children: React.ReactNode;
}

export function AnimatedMount({ splash, children }: Props): React.ReactElement {
  const [showSplash, setShowSplash] = useState(true);
  const [mapVisible, setMapVisible] = useState(false);

  function handleDismiss() {
    setShowSplash(false);
    setMapVisible(true);
  }

  return (
    <>
      {/* Main content — animates in when splash dismisses */}
      <div
        style={{
          width: '100%',
          height: '100%',
          animation: mapVisible
            ? 'mapZoomIn 0.6s cubic-bezier(0.22,1,0.36,1) forwards'
            : undefined,
          opacity: mapVisible ? 1 : 0,
        }}
      >
        {children}
      </div>

      {/* Splash overlay */}
      {showSplash &&
        React.cloneElement(splash, { onDismiss: handleDismiss })}
    </>
  );
}
