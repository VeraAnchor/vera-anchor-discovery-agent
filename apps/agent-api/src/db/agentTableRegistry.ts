import { agentSchemaFile } from "./agentSqlPaths.js";

export const AGENT_PRE_TABLE_SQL = {
  schema: {
    name: "agent_schema",
    schema: agentSchemaFile("001_agent_schema.sql"),
  },
  domains: {
    name: "agent_domains",
    schema: agentSchemaFile("002_agent_domains.sql"),
  },
  functions: {
    name: "agent_functions",
    schema: agentSchemaFile("003_agent_functions.sql"),
  },
} as const;

export const AGENT_TABLES = {
  MIGRATIONS: {
    name: "migrations",
    pgSchema: "agent",
    schema: agentSchemaFile("004_agent_migrations.sql"),
  },
} as const;