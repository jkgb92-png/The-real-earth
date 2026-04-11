/**
 * packages/map-core/src/useSwipeCompare.ts
 *
 * Minimal hook that manages the horizontal split position (0–100 %) for
 * a side-by-side "Time-Machine" swipe compare view.
 *
 * The same hook is used by both the web (CSS clip-path) and mobile
 * (PanResponder width-clip) SwipeCompare implementations.
 */

import { useCallback, useState } from 'react';

export interface SwipeCompareState {
  /** Current divider position as a percentage of container width (0–100). */
  position: number;
  /** Update the divider position, clamped to [0, 100]. */
  setPosition: (pos: number) => void;
}

export function useSwipeCompare(initialPosition = 50): SwipeCompareState {
  const [position, setRaw] = useState<number>(initialPosition);

  const setPosition = useCallback((pos: number) => {
    setRaw(Math.max(0, Math.min(100, pos)));
  }, []);

  return { position, setPosition };
}
