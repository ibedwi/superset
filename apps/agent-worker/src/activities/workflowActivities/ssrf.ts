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
	if (/^f[cd]/.test(lower) || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
		return true;
	}
	// IPv4-mapped: judge the embedded v4.
	const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped?.[1]) return isForbiddenV4(mapped[1]);
	return false;
}

export async function assertPublicUrl(
	rawUrl: string,
	resolve: ResolveHost,
): Promise<URL> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid URL: ${rawUrl}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported protocol: ${url.protocol}`);
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
	if (addresses.length === 0) {
		throw new Error(`Could not resolve host: ${hostname}`);
	}
	for (const address of addresses) {
		if (isForbiddenAddress(address)) {
			throw new Error(`URL resolves to a forbidden address: ${hostname}`);
		}
	}
	return url;
}
