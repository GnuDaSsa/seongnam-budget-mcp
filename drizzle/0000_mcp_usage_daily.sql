CREATE TABLE `mcp_usage_daily` (
	`day` text NOT NULL,
	`source` text NOT NULL,
	`outcome` text NOT NULL,
	`calls` integer NOT NULL,
	PRIMARY KEY(`day`, `source`, `outcome`),
	CONSTRAINT "valid_source" CHECK("mcp_usage_daily"."source" IN ('benchmark', 'unclassified')),
	CONSTRAINT "valid_outcome" CHECK("mcp_usage_daily"."outcome" IN ('success', 'error')),
	CONSTRAINT "valid_calls" CHECK(typeof("mcp_usage_daily"."calls") = 'integer' AND "mcp_usage_daily"."calls" > 0)
);
