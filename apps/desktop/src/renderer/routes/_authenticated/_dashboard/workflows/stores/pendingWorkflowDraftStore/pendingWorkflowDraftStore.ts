import type { DraftWorkflowGraph } from "@superset/shared/workflow-graph";
import { create } from "zustand";

interface PendingWorkflowDraftState {
	drafts: Record<string, DraftWorkflowGraph>;
	setDraft: (workflowId: string, graph: DraftWorkflowGraph) => void;
	takeDraft: (workflowId: string) => DraftWorkflowGraph | null;
}

/** In memory only: a generated graph waits here until its editor opens. */
export const usePendingWorkflowDraftStore = create<PendingWorkflowDraftState>()(
	(set, get) => ({
		drafts: {},
		setDraft: (workflowId, graph) =>
			set((state) => ({ drafts: { ...state.drafts, [workflowId]: graph } })),
		takeDraft: (workflowId) => {
			const draft = get().drafts[workflowId] ?? null;
			if (draft) {
				set((state) => {
					const { [workflowId]: _taken, ...rest } = state.drafts;
					return { drafts: rest };
				});
			}
			return draft;
		},
	}),
);
