import { bindings, defineConfig } from "cf/config";

/**
 * Secret-like files are not read by `cf` and are not part of this file:
 * .dev.vars, .dev.vars.docs-rag, .dev.vars.docs-rag.env, .dev.vars.example.
 * `cf dev` still loads .dev.vars locally.
 *
 * D1 migrations metadata (`migrations_dir` in Wrangler) is not part of
 * cloudflare.config.ts. Apply migrations with the directory flag instead:
 *   cf d1 migrations apply 073c0238-db61-40d3-b1ee-3e7555493a72 --dir drizzle
 * @see https://developers.cloudflare.com/cf/wrangler/migrate/#d1-migrations
 */

export default defineConfig({
	accountId: "21cac5947e11018d571c18792118b8b0",
	worker: {
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
	},
});
