/**
 * Ephemeral ECDSA P-256 keypair used only by activation Worker tests. Kept in
 * its own plain module (no vite/vitest-pool-workers imports) so it can be
 * safely imported both by vitest.activation.config.ts (Node build context)
 * and by test files that run inside the workerd runtime — importing anything
 * that pulls in Node-only build tooling from inside workerd fails to resolve
 * (`node:process` via chalk, transitively).
 *
 * Never a real credential; signs nothing outside the test run.
 */
export const TEST_SIGNING_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgoLohAHcWh3lBsz6K
kGDhgyo8qPvuabF9cANH8OO45lShRANCAASnw0kyWyz6RBdsuJARowIyrKDJI6MF
xRR/FXWhi4w0vR8+FNlnJkjvJTMTTQXcfgQIvXjsjKReFH3HM6fDaI3P
-----END PRIVATE KEY-----`;

export const TEST_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEp8NJMlss+kQXbLiQEaMCMqygySOj
BcUUfxV1oYuMNL0fPhTZZyZI7yUzE00F3H4ECL147IykXhR9xzOnw2iNzw==
-----END PUBLIC KEY-----`;
