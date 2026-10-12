import { describe, expect, it } from 'vitest';

import { FixedClock } from './clock';
import { fromLocal, isValidTimeZone, localDate, toZoned } from './timezone';

describe('timezone helpers', () => {
  it('accepts IANA zones and rejects offsets and junk', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('+05:00')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('converts local wall time to instants across DST', () => {
    // Berlin: CET (UTC+1) in winter, CEST (UTC+2) in summer.
    expect(fromLocal('2026-01-15', '09:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-01-15T08:00:00.000Z',
    );
    expect(fromLocal('2026-07-15', '09:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-07-15T07:00:00.000Z',
    );
    // 2026-03-29 02:30 does not exist in Berlin (clocks jump 02:00 → 03:00): moves forward.
    expect(fromLocal('2026-03-29', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    // 2026-10-25 02:30 happens twice in Berlin: the earlier (CEST) occurrence is used.
    expect(fromLocal('2026-10-25', '02:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('reads the local date of an instant', () => {
    const instant = new Date('2026-10-11T23:30:00Z');
    expect(localDate(instant, 'UTC')).toBe('2026-10-11');
    expect(localDate(instant, 'Asia/Karachi')).toBe('2026-10-12');
    expect(toZoned(instant, 'America/New_York').hour).toBe(19);
  });
});

describe('FixedClock', () => {
  it('stays fixed until moved', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z');
    const snapshot = clock.now();
    snapshot.setFullYear(2030);
    expect(clock.now().getFullYear()).toBe(2026);
  });
});
