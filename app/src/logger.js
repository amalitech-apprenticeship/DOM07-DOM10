// The one shared logger for the whole bookstore. Every module that logs
// (server.js, the request logger, the error handler, the payment client)
// requires this file, so all log lines have the same JSON format.
//
// Why pino: it writes one JSON object per line to stdout, which Docker and
// CloudWatch can collect as-is, and OpenTelemetry can later add trace_id and
// span_id to every pino line automatically, with no changes here.
//
// The level comes from LOG_LEVEL (default "info"). Tests set LOG_LEVEL=silent
// before requiring the app, so test output stays clean.

const pino = require('pino');
const { loadConfig } = require('./config');

const logger = pino({
  level: loadConfig().logLevel,
  // Replaces pino's default pid/hostname with the field dashboards filter on.
  base: { service: 'bookstore' },
  // "level":"info" instead of "level":30, easier to read and to filter on in CloudWatch.
  formatters: { level: (label) => ({ level: label }) },
  // ISO time ("2026-11-23T10:00:00.000Z") instead of epoch milliseconds.
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = { logger };
