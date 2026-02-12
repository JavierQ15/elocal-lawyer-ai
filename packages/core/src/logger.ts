import pino, { type Logger } from "pino";

export function createLogger(verbose = false): Logger {
  return pino({
    level: verbose ? "debug" : process.env.LOG_LEVEL ?? "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
