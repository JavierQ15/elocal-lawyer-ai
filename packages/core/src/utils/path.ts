import path from "node:path";

export function sanitizePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function toPosixPath(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}
