export function getUtcDateAtMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function shiftUtcDays(baseDate: Date, days: number): Date {
  const midnight = getUtcDateAtMidnight(baseDate);
  midnight.setUTCDate(midnight.getUTCDate() + days);
  return midnight;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
