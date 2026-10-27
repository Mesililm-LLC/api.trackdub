import { bindings, defineConfig } from "cf/config";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars, .dev.vars.docs-rag, .dev.vars.docs-rag.env, .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

/**
 * This migration needs manual work. Resolve every TODO in this file, then remove the error below.
 */
/**
 * TODO(@cloudflare): cf migrate: d1_databases.0: The options `migrations_dir` at `d1_databases.0` require manual migration.
 */
throw new Error("Migration incomplete. Resolve every cf migrate TODO in `cloudflare.config.ts`.");

export default defineConfig({
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
		},
		/**
		 * TODO(@cloudflare): cf migrate: The options `migrations_dir` at `d1_databases.0` require manual migration.
		 */
	},
});
