export type TemporalAuthentication = "api_key" | "client_certificate" | "none";

export interface TemporalFormState {
	address: string;
	namespace: string;
	authentication: TemporalAuthentication;
	apiKey: string;
	clientCertPem: string;
	clientKeyPem: string;
	serverRootCaPem: string;
	tls: boolean;
	serverName: string;
}

export type TemporalFormIssue =
	| "address"
	| "namespace"
	| "apiKey"
	| "clientCertPem"
	| "clientKeyPem"
	| "serverRootCaPem"
	| "serverNameNeedsTls";

export const EMPTY_TEMPORAL_FORM: TemporalFormState = {
	address: "",
	namespace: "",
	authentication: "api_key",
	apiKey: "",
	clientCertPem: "",
	clientKeyPem: "",
	serverRootCaPem: "",
	tls: true,
	serverName: "",
};

export function temporalTlsLocked(authentication: TemporalAuthentication) {
	return authentication !== "none";
}

function effectiveTls(form: TemporalFormState) {
	return temporalTlsLocked(form.authentication) || form.tls;
}

const hasPemHeader = (value: string) => value.includes("-----BEGIN");

export function temporalFormIssue(
	form: TemporalFormState,
): TemporalFormIssue | null {
	const address = form.address.trim();
	if (!address || /^[a-z][a-z0-9+.-]*:\/\//i.test(address)) return "address";
	if (!form.namespace.trim()) return "namespace";
	if (form.authentication === "api_key" && !form.apiKey.trim()) return "apiKey";
	if (form.authentication === "client_certificate") {
		if (!hasPemHeader(form.clientCertPem.trim())) return "clientCertPem";
		if (!hasPemHeader(form.clientKeyPem.trim())) return "clientKeyPem";
		const ca = form.serverRootCaPem.trim();
		if (ca && !hasPemHeader(ca)) return "serverRootCaPem";
	}
	if (form.serverName.trim() && !effectiveTls(form))
		return "serverNameNeedsTls";
	return null;
}

export function buildTemporalConnectInput(form: TemporalFormState) {
	const serverName = form.serverName.trim();
	const ca = form.serverRootCaPem.trim();
	return {
		provider: "temporal" as const,
		address: form.address.trim(),
		namespace: form.namespace.trim(),
		tls: effectiveTls(form),
		...(serverName ? { serverName } : {}),
		...(form.authentication === "api_key"
			? { apiKey: form.apiKey.trim() }
			: {}),
		...(form.authentication === "client_certificate"
			? {
					clientCertPem: form.clientCertPem.trim(),
					clientKeyPem: form.clientKeyPem.trim(),
					...(ca ? { serverRootCaPem: ca } : {}),
				}
			: {}),
	};
}
