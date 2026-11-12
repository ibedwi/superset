import { open, seal } from "../../secret-box";

function aadFor(organizationId: string): string {
	return `workflow-engine-connection:${organizationId}`;
}

export function sealCredentials(args: {
	organizationId: string;
	credentials: unknown;
}): string {
	return seal(JSON.stringify(args.credentials), aadFor(args.organizationId));
}

export function openCredentials(args: {
	organizationId: string;
	sealed: string;
}): unknown {
	return JSON.parse(open(args.sealed, aadFor(args.organizationId)));
}
