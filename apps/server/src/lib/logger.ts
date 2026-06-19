import pino from "pino";

const level = (process.env.LOG_LEVEL ?? "info") as pino.LevelWithSilent;
const isDev = process.env.NODE_ENV !== "production";

export const logger = isDev
  ? pino({ level }, pino.transport({ target: "pino-pretty", options: { colorize: true } }))
  : pino({ level });