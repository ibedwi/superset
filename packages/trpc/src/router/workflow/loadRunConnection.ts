import type { WorkflowEngineConnection } from "@superset/shared/workflow-engine";
import {
	connectionFromRow,
	findConnectionRowById,
} from "../../lib/workflow-engine/connections";

/** A run is canceled in the account that holds it, never in the deployment's. */
export async function loadRunConnection(
	connectionId: string | null,
): Promise<WorkflowEngineConnection | null> {
	if (!connectionId) return null;
	const row = await findConnectionRowById({ id: connectionId });
	return row ? connectionFromRow(row) : null;
}
