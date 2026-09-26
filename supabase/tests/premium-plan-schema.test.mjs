// Node's test runner isolates this production-schema suite in its own process.
process.env.PAYANAM_TEST_SUBSCRIPTION_SCHEMA = 'plan';
await import('./premium-upgrade.test.mjs');
