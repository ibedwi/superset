import type { WorkflowEngine } from "../types";

export const postgresWorkflowEngine: WorkflowEngine = {
	id: "postgres",
	start: async () => ({}),
	cancel: async () => {},
};
