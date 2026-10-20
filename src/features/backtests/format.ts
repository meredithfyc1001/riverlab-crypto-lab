export const utc = (ms: number) =>
  new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC');
