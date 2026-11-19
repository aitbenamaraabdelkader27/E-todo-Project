import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatTime,
  localDate,
  localDateTime,
  localDayBounds,
  localToInstant,
  todayInZone,
} from '../shared/time';

describe('explicit IANA time zones', () => {
  it('converts wall-clock time without using the server time zone', () => {
    expect(localToInstant('2026-11-04', '09:30', 'Europe/Paris')).toBe('2026-11-04T08:30:00Z');
    expect(localToInstant('2026-11-04', '09:30', 'America/New_York')).toBe('2026-11-04T14:30:00Z');
  });

  it('returns local date and minute, including date rollovers across UTC midnight', () => {
    expect(localDateTime('2026-11-04T23:30:00Z', 'Europe/Paris')).toEqual({
      date: '2026-11-05',
      time: '00:30',
    });
    expect(localDate('2026-11-04T01:00:00Z', 'America/New_York')).toBe('2026-11-03');
    expect(formatTime('2026-11-04T08:30:59Z', 'Europe/Paris')).toBe('09:30');
  });

  it('rejects nonexistent local times during the spring-forward gap', () => {
    expect(() => localToInstant('2026-03-29', '02:30', 'Europe/Paris')).toThrow(RangeError);
    expect(() => localToInstant('2026-03-29', '02:30', 'Europe/Paris')).toThrow(/does not exist/);
    expect(() => localToInstant('2026-03-29', '02:30', 'Europe/Paris', 'earlier')).toThrow(
      /does not exist/,
    );
    expect(() => localToInstant('2026-03-29', '02:30', 'Europe/Paris', 'later')).toThrow(
      /does not exist/,
    );
  });

  it('rejects ambiguous times unless the repeated occurrence is explicitly chosen', () => {
    expect(() => localToInstant('2026-10-25', '02:30', 'Europe/Paris')).toThrow(RangeError);
    expect(() => localToInstant('2026-10-25', '02:30', 'Europe/Paris')).toThrow(/occurs twice/);
    expect(localToInstant('2026-10-25', '02:30', 'Europe/Paris', 'earlier')).toBe(
      '2026-10-25T00:30:00Z',
    );
    expect(localToInstant('2026-10-25', '02:30', 'Europe/Paris', 'later')).toBe(
      '2026-10-25T01:30:00Z',
    );
  });

  it('uses calendar days rather than adding 24 hours across daylight savings', () => {
    const spring = localDayBounds('2026-03-29', 'Europe/Paris');
    const fall = localDayBounds('2026-10-25', 'Europe/Paris');
    expect(spring.start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(spring.end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25);
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  it('handles leap days and validates malformed dates, times and time zones', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(() => addDays('2026-02-30', 1)).toThrow();
    expect(() => addDays('2026-11-04', 0.5)).toThrow();
    expect(() => localToInstant('2026-11-04', '25:00', 'UTC')).toThrow();
    expect(() => localDayBounds('2026-11-04', 'Unknown/Zone')).toThrow();
  });

  it('returns today as a calendar date in the requested zone', () => {
    expect(todayInZone('Europe/Paris')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Kiritimati',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(todayInZone('Pacific/Kiritimati')).toBe(expected);
  });
});
