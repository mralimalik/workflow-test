import { Temporal } from 'temporal-polyfill';

/** True for IANA zone names the runtime knows (`Europe/Berlin`); false for offsets or junk. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date-time of an instant in a zone. */
export function toZoned(instant: Date, timeZone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(timeZone);
}

/**
 * The instant at which a local date and wall time occurs in a zone. Uses `compatible`
 * disambiguation: a time skipped by a DST jump moves forward; a repeated time takes the
 * earlier occurrence.
 */
export function fromLocal(date: string, time: string, timeZone: string): Date {
  const zoned = Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timeZone, {
    disambiguation: 'compatible',
  });
  return new Date(zoned.epochMilliseconds);
}

/** Today's calendar date (`YYYY-MM-DD`) in a zone. */
export function localDate(instant: Date, timeZone: string): string {
  return toZoned(instant, timeZone).toPlainDate().toString();
}
