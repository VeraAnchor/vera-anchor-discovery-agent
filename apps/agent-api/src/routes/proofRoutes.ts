import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getProofReceipt } from "../services/proofExecutionService.js";

const ProofParamsSchema = z.object({
  receiptId: z.string().min(1).max(128),
});

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortHash(value: unknown, head = 18, tail = 12): string {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

function sendHtml(reply: FastifyReply, html: string) {
  return reply
    .header("content-type", "text/html; charset=utf-8")
    .send(html);
}

export async function proofRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/receipts/:receiptId",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = ProofParamsSchema.parse(req.params);
      const receipt = getProofReceipt(params.receiptId);

      if (!receipt) {
        return reply.code(404).send({
          error: "not_found",
          message: "receipt_not_found",
        });
      }

      return reply.send(receipt);
    }
  );

  app.get(
    "/proof-bundles/:receiptId",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = ProofParamsSchema.parse(req.params);
      const receipt = getProofReceipt(params.receiptId);

      if (!receipt) {
        return reply
          .code(404)
          .header("content-type", "text/html; charset=utf-8")
          .send("Proof bundle not found");
      }

      return sendHtml(reply, `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Vera Anchor Discovery Agent Proof Bundle</title>
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>
              :root {
                color-scheme: dark;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: #020617;
                color: #e5e7eb;
              }
              body {
                margin: 0;
                padding: 32px;
                background:
                  radial-gradient(circle at top left, rgba(34,211,238,0.12), transparent 34rem),
                  radial-gradient(circle at bottom right, rgba(16,185,129,0.10), transparent 34rem),
                  #020617;
              }
              .shell {
                max-width: 1080px;
                margin: 0 auto;
              }
              .card {
                border: 1px solid rgba(148,163,184,0.28);
                border-radius: 24px;
                background: rgba(15,23,42,0.82);
                box-shadow: 0 24px 90px rgba(0,0,0,0.28);
                padding: 24px;
              }
              .eyebrow {
                color: #67e8f9;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.12em;
                text-transform: uppercase;
              }
              h1 {
                margin: 8px 0 10px;
                font-size: 30px;
                line-height: 1.1;
              }
              .muted {
                color: #94a3b8;
              }
              .facts {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 12px;
                margin: 20px 0;
              }
              .fact {
                border: 1px solid rgba(148,163,184,0.22);
                border-radius: 16px;
                background: rgba(2,6,23,0.42);
                padding: 14px;
              }
              .label {
                color: #94a3b8;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.09em;
                font-weight: 700;
              }
              .value {
                margin-top: 6px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 12px;
                overflow-wrap: anywhere;
              }
              pre {
                margin-top: 18px;
                max-height: 560px;
                overflow: auto;
                border: 1px solid rgba(148,163,184,0.22);
                border-radius: 16px;
                background: rgba(2,6,23,0.72);
                padding: 16px;
                font-size: 12px;
                line-height: 1.55;
              }
              a {
                color: #67e8f9;
              }
            </style>
          </head>
          <body>
            <main class="shell">
              <section class="card">
                <div class="eyebrow">Vera Anchor Discovery Agent</div>
                <h1>Proof Bundle</h1>
                <p class="muted">Deterministic paid proof export generated by the MCP/x402 bounty agent.</p>

                <div class="facts">
                  <div class="fact">
                    <div class="label">Receipt</div>
                    <div class="value">${htmlEscape(receipt.id)}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Bundle hash</div>
                    <div class="value">${htmlEscape(receipt.proof_bundle_hash)}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Short hash</div>
                    <div class="value">${htmlEscape(shortHash(receipt.proof_bundle_hash))}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Created</div>
                    <div class="value">${htmlEscape(receipt.created_at)}</div>
                  </div>
                </div>

                <p>
                  <a href="/proof-cards/${encodeURIComponent(receipt.id)}">Open proof card</a>
                  &middot;
                  <a href="/v1/receipts/${encodeURIComponent(receipt.id)}">Open receipt JSON</a>
                </p>

                <pre>${htmlEscape(JSON.stringify(receipt.proof_bundle, null, 2))}</pre>
              </section>
            </main>
          </body>
        </html>
      `);
    }
  );

  app.get(
    "/proof-cards/:receiptId",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = ProofParamsSchema.parse(req.params);
      const receipt = getProofReceipt(params.receiptId);

      if (!receipt) {
        return reply
          .code(404)
          .header("content-type", "text/html; charset=utf-8")
          .send("Proof card not found");
      }

      const proofCard = receipt.proof_card as Record<string, unknown>;

      return sendHtml(reply, `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Vera Anchor Discovery Agent Proof Card</title>
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>
              :root {
                color-scheme: dark;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: #020617;
                color: #e5e7eb;
              }
              body {
                margin: 0;
                padding: 32px;
                background:
                  radial-gradient(circle at top left, rgba(16,185,129,0.16), transparent 34rem),
                  radial-gradient(circle at bottom right, rgba(34,211,238,0.12), transparent 34rem),
                  #020617;
              }
              .shell {
                max-width: 880px;
                margin: 0 auto;
              }
              .card {
                overflow: hidden;
                border: 1px solid rgba(16,185,129,0.32);
                border-radius: 28px;
                background: rgba(15,23,42,0.86);
                box-shadow: 0 24px 90px rgba(16,185,129,0.10);
              }
              .header {
                border-bottom: 1px solid rgba(16,185,129,0.22);
                padding: 24px;
              }
              .eyebrow {
                color: #6ee7b7;
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 0.12em;
                text-transform: uppercase;
              }
              h1 {
                margin: 8px 0 10px;
                font-size: 32px;
                line-height: 1.1;
              }
              .status {
                display: inline-flex;
                margin-top: 10px;
                border: 1px solid rgba(16,185,129,0.28);
                border-radius: 999px;
                background: rgba(16,185,129,0.10);
                color: #a7f3d0;
                padding: 6px 10px;
                font-size: 12px;
                font-weight: 700;
              }
              .body {
                display: grid;
                gap: 12px;
                padding: 24px;
              }
              .fact {
                border: 1px solid rgba(148,163,184,0.22);
                border-radius: 16px;
                background: rgba(2,6,23,0.42);
                padding: 14px;
              }
              .label {
                color: #94a3b8;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.09em;
                font-weight: 700;
              }
              .value {
                margin-top: 6px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 12px;
                overflow-wrap: anywhere;
              }
              .desc {
                color: #94a3b8;
                line-height: 1.6;
              }
              .tags {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 12px;
              }
              .tag {
                border: 1px solid rgba(34,211,238,0.22);
                border-radius: 999px;
                background: rgba(34,211,238,0.08);
                color: #a5f3fc;
                padding: 5px 9px;
                font-size: 12px;
                font-weight: 700;
              }
              a {
                color: #67e8f9;
              }
            </style>
          </head>
          <body>
            <main class="shell">
              <section class="card">
                <div class="header">
                  <div class="eyebrow">Verified with Vera Anchor</div>
                  <h1>${htmlEscape(proofCard.title || "Vera Anchor Proof Card")}</h1>
                  <div class="desc">${htmlEscape(proofCard.description || "")}</div>
                  <div class="status">${htmlEscape(proofCard.status || "Reviewable")}</div>
                  <div class="tags">
                    ${Array.isArray(proofCard.tags)
                      ? proofCard.tags.map((tag) => `<span class="tag">${htmlEscape(tag)}</span>`).join("")
                      : ""}
                  </div>
                </div>

                <div class="body">
                  <div class="fact">
                    <div class="label">Subject</div>
                    <div class="value">${htmlEscape(proofCard.subject || "")}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Type</div>
                    <div class="value">${htmlEscape(proofCard.type || "")}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Proof bundle hash</div>
                    <div class="value">${htmlEscape(proofCard.proofBundleHash || receipt.proof_bundle_hash)}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Proof card hash</div>
                    <div class="value">${htmlEscape(proofCard.proofCardHash || receipt.proof_card_hash || "")}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Public anchor</div>
                    <div class="value">${htmlEscape(proofCard.anchorId || "-")}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Network</div>
                    <div class="value">${htmlEscape(proofCard.network || "")}</div>
                  </div>
                  <div class="fact">
                    <div class="label">Review link</div>
                    <div class="value">
                      <a href="${htmlEscape(proofCard.verifyUrl || "#")}">${htmlEscape(proofCard.verifyUrl || "")}</a>
                    </div>
                  </div>
                  <p>
                    <a href="/proof-bundles/${encodeURIComponent(receipt.id)}">Open proof bundle</a>
                    &middot;
                    <a href="/v1/receipts/${encodeURIComponent(receipt.id)}">Open receipt JSON</a>
                  </p>
                </div>
              </section>
            </main>
          </body>
        </html>
      `);
    }
  );
}