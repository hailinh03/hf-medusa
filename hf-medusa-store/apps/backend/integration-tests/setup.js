// Jest setupFiles — runs before each test file. Minimal: pin timezone so
// date-window assertions are stable. (HTTP integration runner, when enabled,
// layers its own DB bootstrap on top — see docs/PLAN.md test infra note.)
process.env.TZ = "UTC";
