import { useState, useRef, useEffect } from 'react';

export function useAnimatedNumber(target: number, duration = 800): number {
  const [current, setCurrent] = useState(target);
  const animFrame = useRef(0);
  const startTime = useRef(0);
  const startValue = useRef<number | null>(null);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (target === prevTarget.current) return;

    cancelAnimationFrame(animFrame.current);

    prevTarget.current = target;
    startTime.current = performance.now();
    startValue.current = null;

    function tick(now: number) {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      setCurrent(prevCurrent => {
        if (startValue.current === null) {
          startValue.current = prevCurrent;
        }
        const from = startValue.current;
        return from + (target - from) * eased;
      });

      if (progress < 1) {
        animFrame.current = requestAnimationFrame(tick);
      }
    }

    animFrame.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animFrame.current);
  }, [target, duration]);

  return current;
}
