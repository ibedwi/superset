import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_WORKFLOW_SIDE_PANEL_WIDTH = 360;
export const MIN_WORKFLOW_SIDE_PANEL_WIDTH = 300;
export const MAX_WORKFLOW_SIDE_PANEL_WIDTH = 720;

interface WorkflowSidePanelState {
	width: number;
	setWidth: (width: number) => void;
}

export const useWorkflowSidePanelStore = create<WorkflowSidePanelState>()(
	persist(
		(set) => ({
			width: DEFAULT_WORKFLOW_SIDE_PANEL_WIDTH,
			setWidth: (width) =>
				set({
					width: Math.max(
						MIN_WORKFLOW_SIDE_PANEL_WIDTH,
						Math.min(MAX_WORKFLOW_SIDE_PANEL_WIDTH, width),
					),
				}),
		}),
		{
			name: "workflow-side-panel-state",
			version: 1,
			partialize: (state) => ({ width: state.width }),
		},
	),
);
