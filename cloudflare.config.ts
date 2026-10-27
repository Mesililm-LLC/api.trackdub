import { bindings, defineConfig, defineWorker } from "cf/config";

/**
 * Secret-like files are not read by `cf` and are not part of this file:
 * .dev.vars, .dev.vars.docs-rag, .dev.vars.docs-rag.env, .dev.vars.example.
 * `cf dev` still loads .dev.vars locally.
 *
 * D1 migrations metadata (`migrations_dir` in Wrangler) is not part of
 * cloudflare.config.ts. Apply migrations with the directory flag instead:
 *   cf d1 migrations apply 073c0238-db61-40d3-b1ee-3e7555493a72 --dir drizzle
 *   cf d1 migrations apply f95337b1-aff5-455d-a0f9-3293211b1727 --dir drizzle-activation
 * @see https://developers.cloudflare.com/cf/wrangler/migrate/#d1-migrations
 *
 * One config file defines one Worker per evaluation. Select the activation
 * Workers with `--mode activation` / `--mode activation-staging`; the default
 * mode deploys the portal API.
 */

const accountId = "21cac5947e11018d571c18792118b8b0";

const portalWorker = defineWorker({
	name: "trackdub-api",
	compatibilityDate: "2025-08-01",
	compatibilityFlags: [
		"nodejs_compat",
	],
	entrypoint: "src/index.ts",
	workersDev: false,
	observability: {
		enabled: true,
	},
	domains: [
		"api.trackdub.com",
	],
	env: {
		APP_ENV: bindings.text("production"),
		PORTAL_ORIGIN: bindings.text("https://portal.trackdub.com"),
		DB: bindings.d1({
			name: "trackdub_api",
			id: "073c0238-db61-40d3-b1ee-3e7555493a72",
		}),
		MEDIA: bindings.r2({
			name: "trackdub-media",
		}),
		CF_VERSION_METADATA: bindings.versionMetadata(),
		BETTER_AUTH_SECRET: bindings.secret(),
		ADMIN_API_TOKEN: bindings.secret(),
	},
});

const activationWorker = defineWorker({
	name: "trackdub-activation",
	compatibilityDate: "2026-07-01",
	compatibilityFlags: [
		"nodejs_compat",
	],
	entrypoint: "src/activation/index.ts",
	workersDev: false,
	observability: {
		enabled: true,
	},
	domains: [
		"activate.trackdub.com",
	],
	env: {
		APP_ENV: bindings.text("production"),
		ACTIVATION_ISSUER: bindings.text("https://activate.trackdub.com"),
		ACTIVATION_AUDIENCE: bindings.text("trackdub-license-prod"),
		SIGNING_KEY_ID: bindings.text("trackdub-prod-2026-08b"),
		DB: bindings.d1({
			name: "trackdub_activation",
			id: "f95337b1-aff5-455d-a0f9-3293211b1727",
		}),
		SIGNING_KEY: bindings.secret(),
		ADMIN_API_TOKEN: bindings.secret(),
	},
});

const activationStagingWorker = defineWorker({
	name: "trackdub-activation-staging",
	compatibilityDate: "2026-07-01",
	compatibilityFlags: [
		"nodejs_compat",
	],
	entrypoint: "src/activation/index.ts",
	workersDev: false,
	observability: {
		enabled: true,
	},
	domains: [
		"activate.trackdub.dev",
	],
	env: {
		APP_ENV: bindings.text("staging"),
		ACTIVATION_ISSUER: bindings.text("https://activate.trackdub.dev"),
		ACTIVATION_AUDIENCE: bindings.text("trackdub-license-staging"),
		SIGNING_KEY_ID: bindings.text("trackdub-staging-2026-09"),
		ALLOW_DEV_LICENSES: bindings.text("true"),
		DB: bindings.d1({
			name: "trackdub_activation_staging",
			id: "d694b5d9-3c04-4534-a9cd-6892967fb5ee",
		}),
		SIGNING_KEY: bindings.secret(),
		ADMIN_API_TOKEN: bindings.secret(),
	},
});

const activationLocalWorker = defineWorker({
	name: "trackdub-activation-local",
	compatibilityDate: "2026-07-01",
	compatibilityFlags: [
		"nodejs_compat",
	],
	entrypoint: "src/activation/index.ts",
	workersDev: false,
	env: {
		APP_ENV: bindings.text("development"),
		ACTIVATION_ISSUER: bindings.text("trackdub://dev-activation"),
		ACTIVATION_AUDIENCE: bindings.text("trackdub-license-dev"),
		SIGNING_KEY_ID: bindings.text("dev-2026-07"),
		ALLOW_DEV_LICENSES: bindings.text("true"),
		DB: bindings.d1({
			name: "trackdub_activation",
			id: "f95337b1-aff5-455d-a0f9-3293211b1727",
		}),
		SIGNING_KEY: bindings.secret(),
		ADMIN_API_TOKEN: bindings.secret(),
	},
});

export default defineConfig(({ mode }) => {
	switch (mode) {
		case "activation":
			return { accountId, worker: activationWorker };
		case "activation-staging":
			return { accountId, worker: activationStagingWorker };
		case "activation-local":
			return { accountId, worker: activationLocalWorker };
		default:
			return { accountId, worker: portalWorker };
	}
});
