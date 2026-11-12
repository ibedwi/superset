export function firstLine(text: string, maxLength?: number): string {
	const line =
		text
			.split("\n")
			.map((part) => part.trim())
			.find(Boolean) ?? "";
	if (maxLength === undefined || line.length <= maxLength) return line;
	return `${line.slice(0, maxLength - 1).trimEnd()}…`;
}
