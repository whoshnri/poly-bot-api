import "../load-env";
import app from "./server/app";

const port = Number(8443);

import { debugError, debugLog, getLogConfig } from "../shared/log";

const REQUIRED_ENV = ["DATABASE_URL"] as const;
const OPTIONAL_ENV = [
  "CONFIG_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "WAKE_API_TOKEN",
  "POLY_API_KEY",
  "FRONTEND_ORIGIN",
  "TAVILY_API_KEY",
  "GRAPH_RECURSION_LIMIT",
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    debugError("startup", `Required env var "${key}" is not set`, {});
  } else {
    debugLog("startup-env", `${key} is set`, {});
  }
}

for (const key of OPTIONAL_ENV) {
  debugLog("startup-env", process.env[key] ? `${key} is set` : `${key} is not set`, {
    optional: true,
  });
}

if (process.env.DEBUG === "true") {
  debugLog("startup-env", "DEBUG mode is ON", {});
}

const logConfig = getLogConfig();
debugLog("startup-env", "Logging configured", {
  minLevel: logConfig.minLevel,
  logEvents: logConfig.logEvents,
});

debugLog("startup", `Server running on http://localhost:${port}`, {});

export default {
  port,
  idleTimeout: 255,
  fetch: app.fetch,
};
