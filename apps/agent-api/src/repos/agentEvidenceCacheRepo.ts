// apps/agent-api/src/repos/agentEvidenceCacheRepo.ts

import type pg from "pg";
import {
  AgentRepoBase,
  normalizeDateOrNull,
  normalizeHash,
  normalizeJsonObject,
  normalizeLimit,
  normalizeOptionalString,
  normalizeProvider,
  normalizeRequiredString,
  normalizeUuid,
  randomUuid,
} from "./agentRepoUtils.js";

const CACHE_STATUS = new Set(["fresh", "stale", "invalid", "error"]);

export type AgentEvidenceCacheStatus = "fresh" | "stale" | "invalid" | "error";

export type AgentEvidenceCacheRow = Readonly<{
  id: string;
  cache_key: string;
  source_type: string;
  source_ref: string;
  status: AgentEvidenceCacheStatus;
  evidence_hash: string;
  evidence_payload: Record<string, unknown>;
  fetched_at: Date;
  expires_at: Date;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date | null;
  deleted_at: Date | null;
}>;

function normalizeCacheStatus(
  value: unknown,
  fallback: AgentEvidenceCacheStatus,
): AgentEvidenceCacheStatus {
  const s = String(value ?? fallback).trim();

  if (!CACHE_STATUS.has(s)) {
    throw new Error(`Invalid cache status: ${s}`);
  }

  return s as AgentEvidenceCacheStatus;
}

function normalizeCacheKey(value: unknown): string {
  const s = normalizeRequiredString(value, "cache_key", 512);

  if (s.length < 8) {
    throw new Error("cache_key must be at least 8 characters");
  }

  return s;
}

function normalizeSourceRef(value: unknown): string {
  return normalizeRequiredString(value, "source_ref", 512);
}

function normalizeFutureExpiresAt(value: unknown): string {
  const iso = normalizeDateOrNull(value, "expires_at");

  if (!iso) {
    throw new Error("expires_at is required");
  }

  return iso;
}

export class AgentEvidenceCacheRepo extends AgentRepoBase {
  constructor({ pool }: { pool: pg.Pool }) {
    super({
      pool,
      tableName: "evidence_cache",
    });
  }

  async getFreshByCacheKey(
    cacheKeyRaw: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentEvidenceCacheRow | null> {
    const cacheKey = normalizeCacheKey(cacheKeyRaw);

    const sql = `
      SELECT *
      FROM agent.evidence_cache
      WHERE cache_key = $1::text
        AND status = 'fresh'
        AND expires_at > now()
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentEvidenceCacheRow>(client, sql, [cacheKey]);
    return rows[0] ?? null;
  }

  async getAnyByCacheKey(
    cacheKeyRaw: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentEvidenceCacheRow | null> {
    const cacheKey = normalizeCacheKey(cacheKeyRaw);

    const sql = `
      SELECT *
      FROM agent.evidence_cache
      WHERE cache_key = $1::text
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentEvidenceCacheRow>(client, sql, [cacheKey]);
    return rows[0] ?? null;
  }

  async searchFresh(
    input: {
      query?: string | null;
      sourceType?: string | null;
      limit?: number | null;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentEvidenceCacheRow[]> {
    const query = normalizeOptionalString(input.query, "query", 256)?.toLowerCase() ?? null;
    const sourceType = input.sourceType ? normalizeProvider(input.sourceType, "evidence") : null;
    const limit = normalizeLimit(input.limit, 10);

    const sql = `
      SELECT *
      FROM agent.evidence_cache
      WHERE deleted_at IS NULL
        AND status = 'fresh'
        AND expires_at > now()
        AND ($1::text IS NULL OR source_type = $1::text)
        AND (
          $2::text IS NULL
          OR lower(cache_key) LIKE '%' || $2::text || '%'
          OR lower(source_ref) LIKE '%' || $2::text || '%'
          OR lower(evidence_payload::text) LIKE '%' || $2::text || '%'
        )
      ORDER BY fetched_at DESC, id DESC
      LIMIT $3::integer;
    `;

    const { rows } = await this.query<AgentEvidenceCacheRow>(client, sql, [
      sourceType,
      query,
      limit,
    ]);

    return rows;
  }

  async upsertFresh(
    input: {
      id?: string | null;
      cacheKey: string;
      sourceType: string;
      sourceRef: string;
      evidenceHash: string;
      evidencePayload: Record<string, unknown>;
      expiresAt: string | Date;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentEvidenceCacheRow> {
    const id = input.id ? normalizeUuid(input.id, "id") : randomUuid();
    const cacheKey = normalizeCacheKey(input.cacheKey);
    const sourceType = normalizeProvider(input.sourceType, "evidence");
    const sourceRef = normalizeSourceRef(input.sourceRef);
    const evidenceHash = normalizeHash(input.evidenceHash, "evidence_hash");
    const evidencePayload = normalizeJsonObject(input.evidencePayload, "evidence_payload");
    const expiresAt = normalizeFutureExpiresAt(input.expiresAt);
    const metadata = normalizeJsonObject(input.metadata, "metadata");
    const status = normalizeCacheStatus("fresh", "fresh");

    const sql = `
      INSERT INTO agent.evidence_cache (
        id,
        cache_key,
        source_type,
        source_ref,
        status,
        evidence_hash,
        evidence_payload,
        fetched_at,
        expires_at,
        metadata
      )
      VALUES (
        $1::uuid,
        $2::text,
        $3::text,
        $4::text,
        $5::agent.cache_status_domain,
        $6::text,
        $7::jsonb,
        now(),
        $8::timestamptz,
        $9::jsonb
      )
      ON CONFLICT (cache_key)
      WHERE deleted_at IS NULL
      DO UPDATE SET
        source_type = EXCLUDED.source_type,
        source_ref = EXCLUDED.source_ref,
        status = EXCLUDED.status,
        evidence_hash = EXCLUDED.evidence_hash,
        evidence_payload = EXCLUDED.evidence_payload,
        fetched_at = now(),
        expires_at = EXCLUDED.expires_at,
        error_code = NULL,
        error_message = NULL,
        metadata = agent.evidence_cache.metadata || EXCLUDED.metadata,
        deleted_at = NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentEvidenceCacheRow>(
      client,
      sql,
      [
        id,
        cacheKey,
        sourceType,
        sourceRef,
        status,
        evidenceHash,
        evidencePayload,
        expiresAt,
        metadata,
      ],
    );

    return rows[0];
  }

  async markError(
    input: {
      cacheKey: string;
      sourceType: string;
      sourceRef: string;
      evidenceHash: string;
      evidencePayload?: Record<string, unknown>;
      errorCode: string;
      errorMessage?: string | null;
      expiresAt: string | Date;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentEvidenceCacheRow> {
    const cacheKey = normalizeCacheKey(input.cacheKey);
    const sourceType = normalizeProvider(input.sourceType, "evidence");
    const sourceRef = normalizeSourceRef(input.sourceRef);
    const evidenceHash = normalizeHash(input.evidenceHash, "evidence_hash");
    const evidencePayload = normalizeJsonObject(input.evidencePayload, "evidence_payload");
    const errorCode = normalizeRequiredString(input.errorCode, "error_code", 128);
    const errorMessage = normalizeOptionalString(input.errorMessage, "error_message", 1024);
    const expiresAt = normalizeFutureExpiresAt(input.expiresAt);
    const metadata = normalizeJsonObject(input.metadata, "metadata");

    const sql = `
      INSERT INTO agent.evidence_cache (
        id,
        cache_key,
        source_type,
        source_ref,
        status,
        evidence_hash,
        evidence_payload,
        fetched_at,
        expires_at,
        error_code,
        error_message,
        metadata
      )
      VALUES (
        gen_random_uuid(),
        $1::text,
        $2::text,
        $3::text,
        'error',
        $4::text,
        $5::jsonb,
        now(),
        $6::timestamptz,
        $7::text,
        $8::text,
        $9::jsonb
      )
      ON CONFLICT (cache_key)
      WHERE deleted_at IS NULL
      DO UPDATE SET
        status = 'error',
        evidence_hash = EXCLUDED.evidence_hash,
        evidence_payload = EXCLUDED.evidence_payload,
        fetched_at = now(),
        expires_at = EXCLUDED.expires_at,
        error_code = EXCLUDED.error_code,
        error_message = EXCLUDED.error_message,
        metadata = agent.evidence_cache.metadata || EXCLUDED.metadata
      RETURNING *;
    `;

    const { rows } = await this.query<AgentEvidenceCacheRow>(
      client,
      sql,
      [
        cacheKey,
        sourceType,
        sourceRef,
        evidenceHash,
        evidencePayload,
        expiresAt,
        errorCode,
        errorMessage,
        metadata,
      ],
    );

    return rows[0];
  }
}