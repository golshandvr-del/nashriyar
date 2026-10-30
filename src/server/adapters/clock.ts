// Portable time source (ADR-001). Domain code reads time through `nowIso()` in lib/util, which uses this clock,
// so tests or a future scheduler can freeze/shift time without touching business logic.

export interface Clock {
  now(): number // epoch milliseconds
}

export const systemClock: Clock = { now: () => Date.now() }

let current: Clock = systemClock

export const getClock = (): Clock => current

/** Replace the clock (tests, demo time-travel). Pass nothing to restore the system clock. */
export function setClock(c: Clock = systemClock): void {
  current = c
}

/** Fixed clock helper for tests: `setClock(fixedClock('2026-01-01T00:00:00Z'))`. */
export const fixedClock = (iso: string): Clock => {
  const t = new Date(iso).getTime()
  return { now: () => t }
}
