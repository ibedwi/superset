import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { LuCopy } from "react-icons/lu";

export function CopyButton({ text }: { text: string }) {
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Copy"
			onClick={() => {
				navigator.clipboard.writeText(text).then(
					() => toast.success("Copied"),
					() => toast.error("Couldn't copy"),
				);
			}}
		>
			<LuCopy className="size-3" />
		</Button>
	);
}
