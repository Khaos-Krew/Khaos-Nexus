'use strict';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name || 'Error',
    message: String(error.message || error),
    code: error.code || undefined,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  };
}

function createLogger({ service = 'nexus-sentinel', level = 'info', sink = console } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(logLevel, message, fields = {}) {
    if ((LEVELS[logLevel] ?? LEVELS.info) < threshold) return;
    const record = {
      ts: new Date().toISOString(),
      level: logLevel,
      service,
      message,
      ...fields,
    };
    if (record.error instanceof Error) record.error = serializeError(record.error);
    const line = JSON.stringify(record);
    const target = logLevel === 'error' ? 'error' : logLevel === 'warn' ? 'warn' : 'log';
    sink[target](line);
  }

  return Object.freeze({
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child(fields = {}) {
      return Object.freeze({
        debug: (message, extra) => write('debug', message, { ...fields, ...extra }),
        info: (message, extra) => write('info', message, { ...fields, ...extra }),
        warn: (message, extra) => write('warn', message, { ...fields, ...extra }),
        error: (message, extra) => write('error', message, { ...fields, ...extra }),
      });
    },
  });
}

module.exports = { createLogger, serializeError };
