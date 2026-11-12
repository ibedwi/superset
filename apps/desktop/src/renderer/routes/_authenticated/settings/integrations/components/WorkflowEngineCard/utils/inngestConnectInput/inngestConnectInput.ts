export interface InngestFormState {
	eventKey: string;
	signingKey: string;
	baseUrl: string;
}

export type InngestFormIssue = "eventKey" | "signingKey" | "baseUrl";

export const EMPTY_INNGEST_FORM: InngestFormState = {
	eventKey: "",
	signingKey: "",
	baseUrl: "",
};

export function inngestFormIssue(
	form: InngestFormState,
): InngestFormIssue | null {
	if (!form.eventKey.trim()) return "eventKey";
	if (!form.signingKey.trim()) return "signingKey";
	const baseUrl = form.baseUrl.trim();
	if (baseUrl && !URL.canParse(baseUrl)) return "baseUrl";
	return null;
}

export function buildInngestConnectInput(form: InngestFormState) {
	const baseUrl = form.baseUrl.trim();
	return {
		provider: "inngest" as const,
		eventKey: form.eventKey.trim(),
		signingKey: form.signingKey.trim(),
		...(baseUrl ? { baseUrl } : {}),
	};
}
