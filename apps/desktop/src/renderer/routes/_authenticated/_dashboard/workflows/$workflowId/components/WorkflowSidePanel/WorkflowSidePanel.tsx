import type { ReactNode } from "react";
import { ResizablePanel } from "renderer/screens/main/components/ResizablePanel";
import {
	DEFAULT_WORKFLOW_SIDE_PANEL_WIDTH,
	MAX_WORKFLOW_SIDE_PANEL_WIDTH,
	MIN_WORKFLOW_SIDE_PANEL_WIDTH,
	useWorkflowSidePanelStore,
} from "../../stores/workflowSidePanelStore";

export function WorkflowSidePanel({ children }: { children: ReactNode }) {
	const width = useWorkflowSidePanelStore((s) => s.width);
	const setWidth = useWorkflowSidePanelStore((s) => s.setWidth);
	return (
		<ResizablePanel
			width={width}
			onWidthChange={setWidth}
			minWidth={MIN_WORKFLOW_SIDE_PANEL_WIDTH}
			maxWidth={MAX_WORKFLOW_SIDE_PANEL_WIDTH}
			handleSide="left"
			commitOnRelease
			onDoubleClickHandle={() => setWidth(DEFAULT_WORKFLOW_SIDE_PANEL_WIDTH)}
		>
			{children}
		</ResizablePanel>
	);
}
