// apps/agent-api/src/repos/agentRepos.ts

import type { Pool } from "pg";
import { AgentActionRepo } from "./agentActionRepo.js";
import { AgentQuoteRepo } from "./agentQuoteRepo.js";
import { AgentPaymentRepo } from "./agentPaymentRepo.js";
import { AgentReceiptRepo } from "./agentReceiptRepo.js";
import { AgentEvidenceCacheRepo } from "./agentEvidenceCacheRepo.js";
import { AgentMcpRequestRepo } from "./agentMcpRequestRepo.js";

export type AgentRepos = Readonly<{
  actions: AgentActionRepo;
  quotes: AgentQuoteRepo;
  payments: AgentPaymentRepo;
  receipts: AgentReceiptRepo;
  evidenceCache: AgentEvidenceCacheRepo;
  mcpRequests: AgentMcpRequestRepo;
}>;

export function createAgentRepos(pool: Pool): AgentRepos {
  return Object.freeze({
    actions: new AgentActionRepo({ pool }),
    quotes: new AgentQuoteRepo({ pool }),
    payments: new AgentPaymentRepo({ pool }),
    receipts: new AgentReceiptRepo({ pool }),
    evidenceCache: new AgentEvidenceCacheRepo({ pool }),
    mcpRequests: new AgentMcpRequestRepo({ pool }),
  });
}