import { z } from "zod";

const blankToUndefined = (value: string | undefined) => value || undefined;

function optionalText(max: number) {
	return z.string().trim().max(max).optional().transform(blankToUndefined);
}

const pem = optionalText(32_768).refine(
	(value) => value === undefined || value.includes("-----BEGIN"),
	"Expected a PEM block that starts with -----BEGIN",
);

export const inngestConnectInput = z.object({
	provider: z.literal("inngest"),
	eventKey: z.string().trim().min(1).max(512),
	signingKey: z.string().trim().min(1).max(512),
	/** Only for a self-hosted Inngest server; empty means Inngest Cloud. */
	baseUrl: optionalText(2048).refine(
		(value) => value === undefined || URL.canParse(value),
		"Expected a URL",
	),
});

export const temporalConnectInput = z
	.object({
		provider: z.literal("temporal"),
		/** host:port, without a scheme. */
		address: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.refine(
				(value) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value),
				"Use host:port without a scheme",
			),
		namespace: z.string().trim().min(1).max(255),
		tls: z.boolean(),
		serverName: optionalText(255),
		apiKey: optionalText(4096),
		clientCertPem: pem,
		clientKeyPem: pem,
		serverRootCaPem: pem,
	})
	.superRefine((value, context) => {
		const hasCertificate = value.clientCertPem || value.clientKeyPem;
		if (Boolean(value.clientCertPem) !== Boolean(value.clientKeyPem)) {
			context.addIssue({
				code: "custom",
				path: ["clientKeyPem"],
				message: "A client certificate needs both the certificate and the key",
			});
		}
		if (value.apiKey && hasCertificate) {
			context.addIssue({
				code: "custom",
				path: ["apiKey"],
				message: "Use either an API key or a client certificate, not both",
			});
		}
		const needsTls =
			value.apiKey ||
			hasCertificate ||
			value.serverRootCaPem ||
			value.serverName;
		if (needsTls && !value.tls) {
			context.addIssue({
				code: "custom",
				path: ["tls"],
				message:
					"TLS must be on when an API key, a certificate, a CA or a server name is set",
			});
		}
	});

export const connectInput = z.discriminatedUnion("provider", [
	inngestConnectInput,
	temporalConnectInput,
]);

export type WorkflowEngineConnectInput = z.input<typeof connectInput>;
export type ParsedWorkflowEngineConnectInput = z.output<typeof connectInput>;
