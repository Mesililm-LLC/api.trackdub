import { Hono } from "hono";
import { requestId, requestLogging, onError } from "@/activation/middleware";
import { activate } from "@/activation/routes/activate";
import { reactivate } from "@/activation/routes/reactivate";
import { deactivate } from "@/activation/routes/deactivate";
import { status } from "@/activation/routes/status";
import { admin } from "@/activation/routes/admin";
import type { ActivationEnv } from "@/activation/types";

/**
 * Activation Worker entrypoint — deployed separately from the portal API
 * (see wrangler.activation.jsonc / wrangler.activation.staging.jsonc), with
 * its own D1 and its own SIGNING_KEY, so a bug in a portal route can never
 * reach the license signing key. See docs/ACTIVATION-CONTRACT.md for the
 * desktop wire contract this Worker implements.
 *
 * No CORS layer: every route here is called by the desktop app's HttpClient
 * or by an operator's curl/admin tool, never by a browser page.
 */
const app = new Hono<ActivationEnv>();

app.use("*", requestId);
app.use("*", requestLogging);

app.route("/activate", activate);
app.route("/reactivate", reactivate);
app.route("/deactivate", deactivate);
app.route("/status", status);
app.route("/admin", admin);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError(onError);

export default app;
