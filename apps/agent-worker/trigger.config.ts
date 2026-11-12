import { defineConfig } from "@trigger.dev/sdk";
import { requireEnv } from "./src/config/requireEnv";

export default defineConfig({
	project: requireEnv({ env: process.env, name: "TRIGGER_PROJECT_REF" }),
	runtime: "node-24",
	dirs: ["./src/engines/trigger/tasks"],
	maxDuration: 24 * 60 * 60,
});
