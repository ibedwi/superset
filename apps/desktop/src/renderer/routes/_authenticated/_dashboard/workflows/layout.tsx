import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dashboard/workflows")({
	component: WorkflowsLayout,
});

function WorkflowsLayout() {
	return <Outlet />;
}
