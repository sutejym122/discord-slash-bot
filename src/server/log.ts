type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const order: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Keys whose values are credentials or carry them. Matched case-insensitively anywhere in
// a nested field object, so a careless `log.info("x", { payload })` still stays safe.
const SECRET_KEY = /token|secret|password|authorization|cookie|webhook|url|key$/i;
const SAFE_KEYS = new Set(["path", "route"]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    // Drizzle wraps driver errors as "Failed query: ..." with the real reason in `cause`.
    const cause = value.cause instanceof Error ? value.cause.message : undefined;
    return { name: value.name, message: value.message, ...(cause ? { cause } : {}) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) && !SAFE_KEYS.has(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return order[level] ?? order.info;
}

function write(level: Level, msg: string, fields?: Fields) {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ...(fields ? (redact(fields) as Fields) : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

function make(base: Fields): Logger {
  return {
    debug: (m, f) => write("debug", m, { ...base, ...f }),
    info: (m, f) => write("info", m, { ...base, ...f }),
    warn: (m, f) => write("warn", m, { ...base, ...f }),
    error: (m, f) => write("error", m, { ...base, ...f }),
    child: (f) => make({ ...base, ...f }),
  };
}

export const log = make({});
