import { useState, useRef, useEffect } from 'react';

export function useAnimatedNumber(target: number, duration = 800): number {
  const [current, setCurrent] = useState(target);
  const animFrame = useRef(0);
  const startTime = useRef(0);
  const startValue = useRef(target);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (target === prevTarget.current) return;

    cancelAnimationFrame(animFrame.current);

    startValue.current = current;
    prevTarget.current = target;
    startTime.current = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      setCurrent(startValue.current + (target - startValue.current) * eased);

      if (progress < 1) {
        animFrame.current = requestAnimationFrame(tick);
      }
    }

    animFrame.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animFrame.current);
  }, [target, duration]);

  return current;
}
