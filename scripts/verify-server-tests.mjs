// Explicit integration check; uses the local model fixture, then real Minecraft inside the runner.
process.env.MINEMOD_TEST_GAME_TESTS = 'true';
await import('./verify-creation-build.mjs');
