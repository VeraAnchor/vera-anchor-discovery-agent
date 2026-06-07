// apps/agent-api/src/scripts/testExplorerPublicClient.ts

import { config } from "../config.js";
import { getExplorerJson } from "../explorer/explorerPublicClient.js";

const datasetKey =
  "4edd2d2d-6617-4ff7-aad9-b2e5cda6e581.sage.cellxgene.human_cerebellum_whole.visium.filtered_log1p.top3000.spatial.v1";

function print(label: string, value: unknown): void {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  print("config", {
    veraPublicApiBaseUrl: config.veraPublicApiBaseUrl,
    explorerLiveEvidenceEnabled: config.explorerLiveEvidenceEnabled,
    explorerApiTimeoutMs: config.explorerApiTimeoutMs,
    explorerApiMaxResponseBytes: config.explorerApiMaxResponseBytes,
    explorerApiUserAgent: config.explorerApiUserAgent,
    hasExplorerApiKey: Boolean(config.explorerApiKey),
  });

  const health = await getExplorerJson("/health");
  print("health", health);

  const dataset = await getExplorerJson(`/datasets/${encodeURIComponent(datasetKey)}`);
  print("dataset_preview", {
    isObject: Boolean(dataset && typeof dataset === "object" && !Array.isArray(dataset)),
    dataset_key:
      dataset && typeof dataset === "object" && !Array.isArray(dataset)
        ? (dataset as Record<string, unknown>).dataset_key
        : null,
    hcs_transaction_id:
      dataset && typeof dataset === "object" && !Array.isArray(dataset)
        ? (dataset as Record<string, unknown>).hcs_transaction_id
        : null,
    hcs_topic_id:
      dataset && typeof dataset === "object" && !Array.isArray(dataset)
        ? (dataset as Record<string, unknown>).hcs_topic_id
        : null,
    anchor_mirror_verified:
      dataset && typeof dataset === "object" && !Array.isArray(dataset)
        ? (dataset as Record<string, unknown>).anchor_mirror_verified
        : null,
  });
}

main().catch((err) => {
  console.error("\n--- error ---");
  console.error(err);
  process.exit(1);
});