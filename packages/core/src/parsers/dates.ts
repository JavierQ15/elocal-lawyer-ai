const BOE_DATE_REGEX = /^\d{8}$/;
const BOE_DATETIME_REGEX = /^\d{8}T\d{6}Z$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function parseBoeDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (!BOE_DATE_REGEX.test(value)) {
    throw new Error(`Invalid BOE date format: ${value}`);
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10) - 1;
  const day = Number.parseInt(value.slice(6, 8), 10);

  return new Date(Date.UTC(year, month, day));
}

export function parseBoeDateTime(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (!BOE_DATETIME_REGEX.test(value)) {
    throw new Error(`Invalid BOE datetime format: ${value}`);
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10) - 1;
  const day = Number.parseInt(value.slice(6, 8), 10);
  const hour = Number.parseInt(value.slice(9, 11), 10);
  const minute = Number.parseInt(value.slice(11, 13), 10);
  const second = Number.parseInt(value.slice(13, 15), 10);

  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

export function boeDateToIso(value: string | null | undefined): string | null {
  const parsed = parseBoeDate(value);
  return parsed ? parsed.toISOString() : null;
}

export function boeDateTimeToIso(value: string | null | undefined): string | null {
  const parsed = parseBoeDateTime(value);
  return parsed ? parsed.toISOString() : null;
}

export function normalizeCliDateToBoe(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!ISO_DATE_REGEX.test(value)) {
    throw new Error(`Date must have format YYYY-MM-DD. Received: ${value}`);
  }
  return value.replace(/-/g, "");
}

export function formatDateToBoe(value: Date): string {
  const y = value.getUTCFullYear().toString().padStart(4, "0");
  const m = (value.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = value.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

export function formatDateToIsoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function coerceNullableDate(value: Date | null): Date | null {
  return value ? new Date(value.getTime()) : null;
}
