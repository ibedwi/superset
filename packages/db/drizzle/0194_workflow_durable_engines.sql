CREATE TABLE "workflow_run_checkpoints" (
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_checkpoints_run_id_key_pk" PRIMARY KEY("run_id","key")
);
--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD COLUMN "external_ref" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "engine" text DEFAULT 'temporal' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "engine_run_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_run_checkpoints" ADD CONSTRAINT "workflow_run_checkpoints_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_postgres_claim_idx" ON "workflow_runs" USING btree ("created_at") WHERE engine = 'postgres' AND status IN ('pending', 'running');