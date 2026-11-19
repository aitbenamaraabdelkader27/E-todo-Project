import { Temporal } from '@js-temporal/polyfill';

/** An IANA time zone is always explicit; host/browser time zones are never used. */
export function localDayBounds(date: string, timezone: string): { start: Date; end: Date } {
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime(timezone);
  const end = day.add({ days: 1 }).toZonedDateTime(timezone);
  return { start: new Date(start.epochMilliseconds), end: new Date(end.epochMilliseconds) };
}

/**
 * Convert a wall-clock time to a UTC instant. DST gaps are rejected. Repeated
 * times are rejected unless the caller explicitly selects the earlier or later
 * occurrence; silently guessing would make drag/drop save the wrong instant.
 */
export function localToInstant(
  date: string,
  time: string,
  timezone: string,
  occurrence: 'reject' | 'earlier' | 'later' = 'reject',
): string {
  const local = Temporal.PlainDate.from(date).toPlainDateTime(Temporal.PlainTime.from(time));
  // Resolve once to distinguish a missing hour from a repeated hour. Temporal's
  // native rejection message uses the same wording for both transitions.
  const earlier = local.toZonedDateTime(timezone, { disambiguation: 'earlier' });
  if (!earlier.toPlainDateTime().equals(local)) {
    throw new RangeError(
      'This local time does not exist because the clocks move forward. Choose another time.',
    );
  }
  if (occurrence === 'reject') {
    const later = local.toZonedDateTime(timezone, { disambiguation: 'later' });
    if (earlier.epochMilliseconds !== later.epochMilliseconds) {
      throw new RangeError(
        'This local time occurs twice because the clocks move back. Choose the first or second occurrence.',
      );
    }
  }
  const zoned =
    occurrence === 'later' ? local.toZonedDateTime(timezone, { disambiguation: 'later' }) : earlier;
  if (!zoned.toPlainDateTime().equals(local)) {
    throw new RangeError(
      'This local time does not exist because the clocks move forward. Choose another time.',
    );
  }
  return zoned.toInstant().toString();
}

export function todayInZone(timezone: string): string {
  return Temporal.Now.plainDateISO(timezone).toString();
}

export function addDays(date: string, delta: number): string {
  if (!Number.isInteger(delta)) throw new RangeError('Day offset must be an integer.');
  return Temporal.PlainDate.from(date).add({ days: delta }).toString();
}

export function formatTime(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });
}

export function localDate(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

export function localDateTime(instant: string, timezone: string): { date: string; time: string } {
  return { date: localDate(instant, timezone), time: formatTime(instant, timezone) };
}
