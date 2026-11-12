import { DetailSection } from "../../../DetailSection";
import { prettyJson } from "../../utils/stepData";
import { CopyButton } from "../CopyButton";

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
	const text = prettyJson(value);
	return (
		<DetailSection
			label={label}
			tone="mono"
			action={<CopyButton text={text} />}
		>
			{text}
		</DetailSection>
	);
}
