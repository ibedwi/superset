import { formatNumber } from "@superset/i18n/format";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { cn } from "@superset/ui/utils";
import { type ReactNode, useEffect, useId, useState } from "react";

interface BoundedNumberFieldProps {
	label: ReactNode;
	value: number;
	min: number;
	max: number;
	defaultValue: number;
	unit?: ReactNode;
	hint?: ReactNode;
	onChange: (value: number) => void;
	disabled: boolean;
}

/**
 * Keeps an out-of-range entry visible with an error, instead of silently
 * replacing it with the default. Only valid values reach `onChange`.
 */
export function BoundedNumberField({
	label,
	value,
	min,
	max,
	defaultValue,
	unit,
	hint,
	onChange,
	disabled,
}: BoundedNumberFieldProps) {
	const id = useId();
	const [draft, setDraft] = useState(String(value));
	const [touched, setTouched] = useState(false);
	useEffect(() => setDraft(String(value)), [value]);

	const parsed = Number(draft.trim());
	const valid = /^\d+$/.test(draft.trim()) && parsed >= min && parsed <= max;
	const showError = touched && !valid;
	const minText = formatNumber(min);
	const maxText = formatNumber(max);
	const defaultText = formatNumber(defaultValue);

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<div className="relative">
				<Input
					id={id}
					inputMode="numeric"
					value={draft}
					onChange={(event) => {
						const next = event.target.value;
						setDraft(next);
						const nextNumber = Number(next.trim());
						if (
							/^\d+$/.test(next.trim()) &&
							nextNumber >= min &&
							nextNumber <= max
						) {
							onChange(nextNumber);
						}
					}}
					onBlur={() => setTouched(true)}
					aria-invalid={showError}
					disabled={disabled}
					className={cn(unit && "pr-20")}
				/>
				{unit && (
					<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
						{unit}
					</span>
				)}
			</div>
			{showError ? (
				<p className="text-xs text-destructive">
					Enter a whole number from {minText} to {maxText}. Default:{" "}
					{defaultText}.
				</p>
			) : (
				hint && <p className="text-xs text-muted-foreground">{hint}</p>
			)}
		</div>
	);
}
