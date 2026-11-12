import { isIP } from "node:net";

/**
 * HTTP nodes carry user-written URLs and run from inside our network, so a
 * request must never reach loopback, private, link-local, or metadata
 * addresses. The lookup is injectable for tests.
 */
export type ResolveHost = (hostname: string) => Promise<string[]>;

export function isForbiddenAddress(address: string): boolean {
	const kind = isIP(address);
	if (kind === 4) return isForbiddenV4(address);
	if (kind === 6) return isForbiddenV6(address);
	return true;
}

function isForbiddenV4(address: string): boolean {
	const parts = address.split(".").map(Number);
	const [a, b] = parts as [number, number];
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	return a >= 224;
}

function isForbiddenV6(address: string): boolean {
	const lower = address.toLowerCase();
	if (lower === "::" || lower === "::1") return true;
	// Unique-local fc00::/7, link-local fe80::/10.
	if (
		/^f[cd]/.test(lower) ||
		lower.startsWith("fe8") ||
		lower.startsWith("fe9") ||
		lower.startsWith("fea") ||
		lower.startsWith("feb")
	) {
		return true;
	}
	// IPv4-mapped: judge the embedded v4.
	const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped?.[1]) return isForbiddenV4(mapped[1]);
	return false;
}

async function assertResolvesPublic(args: {
	hostname: string;
	resolveHost: ResolveHost;
}): Promise<void> {
	const { hostname, resolveHost } = args;
	const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
	if (addresses.length === 0) {
		throw new Error(`Could not resolve host: ${hostname}`);
	}
	for (const address of addresses) {
		if (isForbiddenAddress(address)) {
			throw new Error(`URL resolves to a forbidden address: ${hostname}`);
		}
	}
}

export async function assertPublicUrl(args: {
	url: string;
	resolveHost: ResolveHost;
}): Promise<URL> {
	let url: URL;
	try {
		url = new URL(args.url);
	} catch {
		throw new Error(`Invalid URL: ${args.url}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported protocol: ${url.protocol}`);
	}
	await assertResolvesPublic({
		hostname: url.hostname.replace(/^\[|\]$/g, ""),
		resolveHost: args.resolveHost,
	});
	return url;
}

export async function assertPublicHost(args: {
	host: string;
	resolveHost: ResolveHost;
}): Promise<void> {
	const hostname = args.host.trim().replace(/^\[|\]$/g, "");
	if (!hostname) throw new Error("Host is empty");
	await assertResolvesPublic({ hostname, resolveHost: args.resolveHost });
}

/** Host part of "host", "host:port", "[::1]:port" or a bare IPv6 address. */
export function hostFromAddress(address: string): string {
	const trimmed = address.trim();
	const bracketed = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
	if (bracketed?.[1]) return bracketed[1];
	if (isIP(trimmed) === 6) return trimmed;
	return trimmed.replace(/:\d+$/, "");
}
