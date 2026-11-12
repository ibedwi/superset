/** Step input and output are untyped jsonb; these read them without trusting the shape. */
export function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function stringField(value: unknown, key: string): string | null {
	const field = asRecord(value)?.[key];
	return typeof field === "string" ? field : null;
}

export function numberField(value: unknown, key: string): number | null {
	const field = asRecord(value)?.[key];
	return typeof field === "number" ? field : null;
}

export function stringListField(value: unknown, key: string): string[] {
	const field = asRecord(value)?.[key];
	return Array.isArray(field)
		? field.filter((item): item is string => typeof item === "string")
		: [];
}

export function hasField(value: unknown, key: string): boolean {
	const record = asRecord(value);
	return record !== null && record[key] !== undefined;
}

export function prettyJson(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? String(value);
}
