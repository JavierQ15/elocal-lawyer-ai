import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function shortHash(input: string, length = 8): string {
  return sha256(input).slice(0, length);
}

export function deterministicId(parts: Array<string | null | undefined>): string {
  return sha256(parts.map((part) => part ?? "").join("|"));
}
