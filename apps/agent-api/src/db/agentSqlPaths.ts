import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SQL_FILE_NAME_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/i;

export function getAgentSchemaDir(): string {
  const configured = process.env.AGENT_SCHEMA_DIR?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  const appRoot = resolveAgentApiRoot();

  return path.join(appRoot, "src", "db", "schemas");
}

export function agentSchemaFile(fileName: string): string {
  if (!SQL_FILE_NAME_PATTERN.test(fileName)) {
    throw new Error(`Invalid agent schema file name: ${fileName}`);
  }

  return path.join(getAgentSchemaDir(), fileName);
}

export function assertAgentSchemaDirReady(): void {
  const dir = getAgentSchemaDir();

  if (!fs.existsSync(dir)) {
    throw new Error(
      [
        `Agent schema directory missing: ${dir}`,
        `Set AGENT_SCHEMA_DIR to the runtime schema directory if the default package-relative path is not valid.`,
      ].join("\n"),
    );
  }

  const stat = fs.statSync(dir);

  if (!stat.isDirectory()) {
    throw new Error(`Agent schema path is not a directory: ${dir}`);
  }
}

function resolveAgentApiRoot(): string {
  const candidates = [
    // Compiled runtime: /repo/apps/agent-api/dist/db -> /repo/apps/agent-api
    path.resolve(__dirname, "..", ".."),

    // Source/runtime tools: /repo/apps/agent-api/src/db -> /repo/apps/agent-api
    path.resolve(__dirname, "..", ".."),

    // Fallback for cases where cwd is already apps/agent-api.
    process.cwd(),

    // Fallback for monorepo root cwd.
    path.resolve(process.cwd(), "apps", "agent-api"),
  ];

  for (const candidate of candidates) {
    if (isAgentApiRoot(candidate)) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), "apps", "agent-api");
}

function isAgentApiRoot(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "src", "db", "schemas"))
  );
}