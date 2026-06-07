# Vera Anchor Explorer Agent

A Hedera-powered MCP/x402 proof agent for searching public evidence, verifying HCS proof chains, and exporting deterministic proof bundles after wallet-gated HBAR payment.

Built for the **Hedera AI Agent Bounty — Week 3: MCP or x402 Agent**.

---

## What It Does

Vera Anchor Explorer Agent moves users from natural-language evidence discovery to reviewer-ready proof export.

Users can:

1. Ask plain-language questions about public Vera Anchor evidence
2. Search across CIPHER results, SAGE results, datasets, proof cards, and HCS references
3. Select a normalized public evidence record
4. Inspect proof-chain and HCS/Mirror metadata
5. Create an exact HBAR payment requirement
6. Pay externally with a wallet
7. Verify the payment on Hedera Mirror Node
8. Generate a deterministic proof bundle / trust report receipt

**Core product loop:**

```
Free inspection → selected evidence → HCS/Mirror verification → exact HBAR payment → deterministic proof export
```

---

## Why It Matters

Scientific, computational, and dataset-derived outputs are often hard to independently review. Vera Anchor Explorer Agent makes those records easier to inspect by combining structured public evidence records, deterministic retrieval and scoring, Hedera HCS receipt metadata, Mirror Node verification, MCP audit trails, and reviewer-friendly bundle generation.

The goal is not only to let an AI agent use Hedera — each agent action is bounded, deterministic, auditable, and safe for a multi-tenant production setting.

---

## Bounty Category

**Week 3: MCP or x402 Agent**

This project combines both patterns:

- **MCP-style tool surface** — controlled agent operations with strict schemas and audit trails
- **x402-style exact-payment action flow** — payment-gated proof export requiring explicit wallet consent

---

## Architecture

```
Vite frontend
  └── agent-api
        ├── Explorer Agent planner
        ├── Evidence retrieval service
        ├── Restricted Hedera read/verify adapter
        ├── MCP tool execution layer
        ├── MCP audit service
        ├── Quote/payment requirement service
        ├── Proof export execution service
        ├── PostgreSQL audit/action state
        └── Hedera Mirror Node / HCS metadata
```

| Layer | Responsibility |
|---|---|
| **Frontend** | Interactive explorer UI, evidence cards, proof inspector, payment/export flow |
| **Agent API** | Deterministic query planner, retrieval, policy checks, MCP tools, audits, payment verification, export execution |
| **MCP layer** | Small controlled tool surface for external/agent invocation |
| **Hedera adapter** | Restricted Mirror/HCS read and verification operations |
| **Payment/export layer** | Quote creation, exact HBAR requirement, Mirror verification, deterministic receipt generation |

---

## Hedera Integration

The backend exposes a deterministic Explorer Agent API rather than raw Hedera Agent Kit tools. Integration is isolated through a restricted adapter for:

```
@hashgraph/hedera-agent-kit
@hashgraph/hedera-agent-kit-mcp
```

Capabilities:

- Hedera network configuration and runtime status reporting
- Mirror Node transaction reads
- HCS message reads and receipt verification
- Exact HBAR payment requirement generation
- Mirror-based payment verification
- Policy gates for all write operations

The design intentionally avoids raw Agent Kit client exposure, arbitrary tool execution, autonomous transfers, and backend user private-key handling.

---

## MCP Tool Surface

Six tools are exposed over JSON-RPC stdio, each with strict Zod input schemas:

| Tool | Purpose |
|---|---|
| `vera.search_evidence` | Search normalized public evidence records |
| `vera.preview_evidence` | Load a selected evidence record by subject type and ID |
| `vera.create_proof_bundle_quote` | Create a payment-gated export action |
| `vera.get_payment_requirements` | Return exact HBAR transfer requirements |
| `vera.execute_proof_bundle_export` | Verify payment and execute export |
| `vera.get_receipt` | Retrieve a completed proof/export receipt |

---

## x402-Style Payment Flow

Search and inspection are free. Payment is required only for durable proof bundle generation.

```
1. User selects evidence
2. Backend creates quote/action
3. Backend returns exact HBAR payment requirement
4. User signs payment externally with wallet
5. User submits transaction ID and payer account
6. Backend verifies transaction on Mirror Node
7. Backend executes deterministic proof export
8. Backend returns receipt
```

---

## Safety and Policy Model

**Allowed by default:**

- Agent status, public evidence search, evidence preview
- Proof-chain explanation
- Mirror transaction and HCS message reads
- HCS receipt verification
- Payment requirement description and transaction verification (when enabled)

**Denied or gated:**

- Autonomous user fund transfers
- Arbitrary Agent Kit tool execution or raw client exposure
- Backend user private-key intake
- Mainnet writes (unless explicitly enabled via env flag)
- HCS receipt anchoring (unless explicitly enabled)
- Write submission without human approval

---

## Deterministic Audit Model

Every MCP tool call is wrapped in an audit service that records the tool name, input hash, output hash, action/request/session IDs, client reference, actor/org context, latency, terminal state, and sanitized error metadata.

Inputs and outputs are hashed using canonical JSON + SHA3-512, keeping tool execution reviewable without relying on natural-language agent responses.

---

## Query Planning and Retrieval

```
Raw user language
  → normalized query terms
  → search candidates
  → live evidence attempts
  → broad fallback
  → deterministic local matching
  → scoring and ranking
  → structured evidence cards
```

Domain-bearing terms (disease names, tissues, donor IDs, dataset keys, platform terms) are preserved; generic routing language is stripped. Retrieval uses bounded limits and runtime budgets for predictable behavior under load.

---

## Proof-Chain Verification

The proof inspector surfaces structured verification data including subject type and ID, evidence title, network, HCS transaction and topic IDs, Mirror transaction result, consensus timestamp, sequence number, running hash, payer account ID, and verification warnings.

The agent verifies receipt-level metadata only — it does not decrypt private payloads or request private keys.

---

## Repository Structure

```
apps/agent-api/src/
  mcp/
    mcpSchemas.ts
    mcpTools.ts
  services/
    mcpAuditService.ts
    evidenceService.ts
    explorerAgentService.ts
    hederaAgentService.ts
    paymentRequirementService.ts
    proofExecutionService.ts
  hedera/
    hederaAgentKitClient.ts
    hederaAgentKitPolicy.ts
    hederaAgentKitReadAdapter.ts

src/
  App.jsx
  components/
    AgentQueryPanel.tsx
    ProofChainInspector.tsx
    ProofExportPaymentPanel.tsx
  api/
    explorerAgent.ts
    agentApiClient.ts
```

---

## Environment Variables

**Backend (`apps/agent-api/.env`):**

```bash
HEDERA_NETWORK=testnet
HEDERA_AGENT_PAYMENT_VERIFICATION_MODE=mirror

HEDERA_OPERATOR_ACCOUNT_ID=0.0.xxxxx
HEDERA_OPERATOR_PRIVATE_KEY=...
HEDERA_TREASURY_ACCOUNT_ID=0.0.xxxxx

HEDERA_AGENT_MAINNET_WRITES_ENABLED=false
HEDERA_AGENT_HCS_RECEIPT_ANCHORING_ENABLED=false
HEDERA_AGENT_USER_WRITES_ENABLED=false

AGENT_DATABASE_URL=postgres://...
VERA_PUBLIC_SITE_URL=https://veraanchor.com
```

**Frontend (`.env`):**

```bash
VITE_AGENT_API_BASE_URL=http://localhost:5001
VITE_HEDERA_NETWORK=testnet
VITE_WALLETCONNECT_PROJECT_ID=...
```

> Do not commit private keys, operator credentials, or production secrets.


## Live Demo — Judge Walkthrough

**Recommended path:**

1. Open the deployed app
2. Click **Run demo path**
3. Review the agent answer and selected evidence
4. Inspect the proof-chain panel
5. Review the exact HBAR payment requirement
6. Optionally submit a testnet payment transaction ID to verify and export

**Alternative — manual queries:**

- `Find latest CIPHER results`
- `Find SAGE results for human cerebellum`
- `Find anchored datasets`
- `Find evidence for glioblastoma`

Then choose **Use this record** on an evidence card and step through the proof-chain and payment panels.

---

## Testnet Demo Checklist

```
[ ] Frontend loads without console-blocking errors
[ ] Browser title reads "Vera Anchor Explorer Agent"
[ ] Demo path runs end-to-end
[ ] Agent returns a structured answer
[ ] Evidence cards can be selected
[ ] Proof inspector shows real metadata (no fake null data)
[ ] Payment quote displays exact HBAR amount, recipient, memo, and expiry
[ ] Payment verification path accepts Hedera transaction ID format
[ ] GitHub repo is public
[ ] Hedera Agent Kit feedback issue is linked in the bounty submission
```

---

## Known Limitations

- The demo uses public Vera Anchor evidence surfaces and testnet-oriented flows
- HCS verification returns receipt-level metadata; encrypted payload contents are not decrypted
- Write operations are intentionally gated unless explicitly enabled via environment flags
- The proof export flow produces deterministic reviewer artifacts, not arbitrary agent execution

---

## Ownership and License

Copyright © 2026 Vera Anchor. All rights reserved.

This repository and its contents are owned by Vera Anchor and are provided for review, demonstration, and evaluation purposes only.

No license is granted to copy, modify, distribute, sublicense, sell, resell, commercialize, host as a competing service, or otherwise use this software or any substantial portion of it without prior written permission from Vera Anchor.

You may view the source code solely for the purpose of evaluating the Vera Anchor Explorer Agent bounty submission. Any other use requires explicit written authorization from Vera Anchor.

Third-party packages, libraries, SDKs, and dependencies used by this project remain subject to their respective licenses.