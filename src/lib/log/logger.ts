import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
});

export function providerLogger(providerId: string) {
  return logger.child({ providerId });
}
