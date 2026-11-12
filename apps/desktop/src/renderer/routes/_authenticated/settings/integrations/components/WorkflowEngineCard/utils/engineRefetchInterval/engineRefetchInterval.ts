export const PENDING_REFETCH_MS = 2_000;

export function engineRefetchInterval(
	data: { connection: { status: string } | null } | undefined,
): number | false {
	return data?.connection?.status === "pending" ? PENDING_REFETCH_MS : false;
}
