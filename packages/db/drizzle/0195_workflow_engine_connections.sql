CREATE TABLE "workflow_engine_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"config" jsonb NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"connected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_engine_connections_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "engine_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_engine_connections" ADD CONSTRAINT "workflow_engine_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_engine_connections" ADD CONSTRAINT "workflow_engine_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_engine_connection_id_workflow_engine_connections_id_fk" FOREIGN KEY ("engine_connection_id") REFERENCES "public"."workflow_engine_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_engine_connection_idx" ON "workflow_runs" USING btree ("engine_connection_id");