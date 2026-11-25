export const timings = {
  strategy: 0,
  engine: 0,
  identity: 0,
  statistics: 0,
  seal: 0,
};
export type Stage = keyof typeof timings;
export function measure<T>(stage: Stage, action: () => T): T {
  const start = performance.now();
  const value = action();
  timings[stage] += performance.now() - start;
  return value;
}
