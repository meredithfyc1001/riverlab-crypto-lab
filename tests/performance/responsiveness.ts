export function responsiveness() {
  let last = performance.now(),
    maxMainTimerGapMs = 0,
    maxMainHeapBytes = 0,
    ticks = 0;
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  function tick() {
    const t = performance.now();
    maxMainTimerGapMs = Math.max(maxMainTimerGapMs, t - last);
    maxMainHeapBytes = Math.max(
      maxMainHeapBytes,
      perf.memory?.usedJSHeapSize ?? 0,
    );
    ticks++;
    last = t;
  }
  const timer = setInterval(tick, 20);
  return () => {
    tick();
    clearInterval(timer);
    return {
      maxMainTimerGapMs: Math.round(maxMainTimerGapMs),
      maxMainHeapBytes,
      ticks,
    };
  };
}
