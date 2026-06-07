import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { jsonFail, jsonOk } from "../../shared/apiResponse";
import { debugError } from "../../shared/log";
import { type AuthVariables, requireAuth } from "../middleware/auth";
import { login, logout, me, register } from "../routes/auth";
import { readRunReadiness, readSettings, writeSettings } from "../routes/settings";
import { discoverChat, discoverRun } from "../../discover/routes";
import {
  getPendingFeedbackRoute,
  getSessionResumeStatus,
  getSessions,
  removeSession,
  resumeSession,
  startSession,
  streamSessionEvents,
  submitFeedback,
} from "../routes/sessions";
import { getHealth } from "../routes/wake";
import { getHealthDeps } from "../routes/health";

const app = new Hono();

const ALLOWED_ORIGINS = (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  "/api/*",
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  }),
  logger(),
);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return jsonFail(c, err.message, err.status);
  }

  debugError("api", "Unhandled request error", { path: c.req.path, method: c.req.method }, err);
  return jsonFail(c, "Internal server error.", 500);
});

app.notFound((c) =>
  jsonFail(c, `Not found: ${c.req.method} ${c.req.path}`, 404),
);

app.get("/", (c) =>
  jsonOk(c, {
    service: "polymarket-bot-api",
    status: "ok",
    health: "/health",
  }),
);

app.get("/health", getHealth);
app.post("/api/auth/register", register);
app.post("/api/auth/login", login);

const authed = new Hono<{ Variables: AuthVariables }>();
authed.use("*", requireAuth);
authed.post("/auth/logout", logout);
authed.get("/auth/me", me);
authed.get("/health/deps", getHealthDeps);
authed.get("/settings/readiness", readRunReadiness);
authed.get("/settings", readSettings);
authed.put("/settings", writeSettings);
authed.get("/sessions", getSessions);
authed.post("/discover/chat", discoverChat);
authed.post("/discover/run", discoverRun);
authed.post("/sessions/start", startSession);
authed.post("/sessions/:sessionId/feedback", submitFeedback);
authed.get("/sessions/:sessionId/feedback/pending", getPendingFeedbackRoute);
authed.get("/sessions/:sessionId/resume", getSessionResumeStatus);
authed.post("/sessions/:sessionId/resume", resumeSession);
authed.delete("/sessions/:sessionId", removeSession);
authed.get("/sessions/:sessionId/events", streamSessionEvents);

app.route("/api", authed);

export default app;
