import { agentSchemaFile } from "./agentSqlPaths.js";

export type AgentMigrationDefinition = {
  id: number;
  file: string;
  description: string;
  downFile?: string;
};

export const AGENT_MIGRATIONS: AgentMigrationDefinition[] = [
  {
    id: 5,
    file: agentSchemaFile("005_agent_base.sql"),
    description: "Create base agent operational tables",
  },
  {
    id: 6,
    file: agentSchemaFile("006_agent_rls.sql"),
    description: "Enable RLS for agent operational tables",
  },
];