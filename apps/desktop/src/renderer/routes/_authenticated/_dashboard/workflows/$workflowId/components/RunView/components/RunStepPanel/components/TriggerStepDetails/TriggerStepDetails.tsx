import { formatDateTime } from "@superset/i18n/format";
import type { RunCause } from "../../../../../../../utils/runStatus";
import { KeyValueList } from "../../../KeyValueList";
import { CAUSE_TEXT } from "../../../RunHeader";
import { JsonBlock } from "../JsonBlock";

interface TriggerStepDetailsProps {
	cause: RunCause;
	scheduledFor: Date | string | null;
	payload: unknown;
}

export function TriggerStepDetails({
	cause,
	scheduledFor,
	payload,
}: TriggerStepDetailsProps) {
	return (
		<>
			<KeyValueList
				items={[
					{ label: "Cause", value: CAUSE_TEXT[cause] },
					...(scheduledFor
						? [
								{
									label: "Scheduled for",
									value: formatDateTime(new Date(scheduledFor)),
								},
							]
						: []),
				]}
			/>
			{payload === null || payload === undefined ? (
				<p className="text-xs text-muted-foreground">
					This run started without a payload.
				</p>
			) : (
				<JsonBlock label="Payload" value={payload} />
			)}
		</>
	);
}
