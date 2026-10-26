/** Exponential backoff with jitter: 2 s, 4 s, 8 s … capped at 10 minutes. */
export function backoffDelay(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(10 * 60_000, 2000 * 2 ** Math.max(0, attempts - 1))
  return Math.round(base * (0.75 + random() * 0.5))
}
