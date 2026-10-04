// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Canonical claim identity — a faithful TypeScript port of
// `myso-spot-oracle/src/review/outcome_identity.rs` and `canonicalize.rs`.
//
// The real oracle derives two hashes by SHA-256 over *compact serde JSON* using
// the Rust struct's declaration order (not alphabetically sorted) and omits
// `None` optional fields:
//
//   semantic_claim_hash = SHA256(json(OutcomeIdentityFields))
//   market_key_hash     = SHA256(json(OutcomeMarketKey { identity, deadline_day?, betting_options }))
//
// `market_key_hash` is the on-chain dedup key (`SpotClaimRegistry.markets_by_key_hash`),
// so two posts resolving to the same claim + the same day + the same options
// collapse into ONE market. The Move contract rejects duplicates with
// `EMarketExists`. Reproducing the derivation here makes that behaviour
// demonstrable rather than accidental.

import { createHash } from "node:crypto";

export type OutcomeType = "binary" | "multi_choice" | "scalar";
export type ClaimCategory =
  | "unsupported"
  | "price_threshold"
  | "release_published"
  | "event_occurrence"
  | "custom_http";
export type ComparisonOp = "lt" | "lte" | "gt" | "gte" | "eq" | "neq";

/** Declaration order matters — it defines JSON key order and therefore the hash. */
export interface OutcomeIdentityFields {
  entity_ref?: string;
  competition_ref?: string;
  event_ref?: string;
  metric_ref?: string;
  predicate: string;
  object: string;
  metric?: string;
  comparison?: ComparisonOp;
  threshold?: string;
  outcome_type: OutcomeType;
  claim_category: ClaimCategory;
  suggested_sources: string[];
}

export interface OutcomeMarketKey {
  identity: OutcomeIdentityFields;
  deadline_day?: string;
  betting_options: string[];
}

/** Serialize omitting undefined keys, matching serde's `skip_serializing_if = "Option::is_none"`. */
function compactJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const entries = Object.entries(inner as Record<string, unknown>).filter(
        ([, entry]) => entry !== undefined && entry !== null,
      );
      return Object.fromEntries(entries);
    }
    return inner;
  });
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashIdentity(identity: OutcomeIdentityFields): string {
  return sha256Hex(compactJson(identity));
}

export function hashMarketKey(key: OutcomeMarketKey): string {
  return sha256Hex(compactJson(key));
}

/** `YYYY-MM-DD` UTC bucket, mirroring `deadline_day_bucket`. */
export function deadlineDayBucket(deadlineMs: number): string {
  return new Date(deadlineMs).toISOString().slice(0, 10);
}

export function hexToBytes(value: string): Uint8Array {
  const clean = value.trim().replace(/^0x/i, "");
  const padded = clean.length % 2 === 0 ? clean : `0${clean}`;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const ASSET_ALIASES: Record<string, string> = { btc: "bitcoin", eth: "ethereum", sol: "solana" };

/** Port of `normalize_asset`: lowercase plus known ticker aliases. */
export function normalizeAsset(value: string): string {
  const lower = value.trim().toLowerCase();
  for (const [alias, canonical] of Object.entries(ASSET_ALIASES)) {
    if (lower === alias || lower.includes(alias)) return canonical;
  }
  return lower;
}

/** Port of `slugify_entity`: lowercase, non-alphanumeric to `_`, collapsed. */
export function slugifyEntity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .split("_")
    .filter(Boolean)
    .join("_");
}

/** Port of the `infer_comparison` keyword table. */
export function inferComparison(text: string): ComparisonOp | undefined {
  const lower = text.toLowerCase();
  if (/\b(above|exceed|greater)\b/.test(lower)) return "gt";
  if (/\b(below|under|less)\b/.test(lower)) return "lt";
  return undefined;
}

/** Strip filler so the leading tokens describe the subject rather than the sentence. */
const LEADING_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "will",
  "is",
  "are",
  "was",
  "were",
  "in",
  "on",
  "by",
  "at",
  "of",
]);

/** The subject of a claim: its leading meaningful tokens. */
export function subjectRef(claimText: string): string {
  const words = claimText
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !LEADING_STOPWORDS.has(word));
  return slugifyEntity(meaningful.slice(0, 3).join(" ")) || slugifyEntity(words.slice(0, 3).join(" "));
}

/**
 * Build an identity for a free-text claim.
 *
 * The real oracle fills these fields from an LLM extraction over the post plus
 * trusted sources. The demo uses a deterministic stub instead — but the result
 * must still be *claim-specific*, because `semantic_claim_hash` is the on-chain
 * dedup key: if two different claims hashed to the same identity, the second
 * `register_spot_claim` would abort with `EClaimExists`.
 *
 * So the normalized claim text is carried in `object` and the leading subject in
 * `entity_ref`. Same wording => same market (the dedup demo); different wording
 * => a distinct market.
 */
export function identityFromClaimText(
  claimText: string,
  options: {
    entityRef?: string;
    eventRef?: string;
    predicate?: string;
    object?: string;
    comparison?: ComparisonOp;
    threshold?: string;
    claimCategory?: ClaimCategory;
    suggestedSources?: string[];
    suggestedOptions?: string[];
  } = {},
): OutcomeIdentityFields {
  const text = claimText.trim().replace(/\s+/g, " ");
  const normalized = slugifyEntity(text).slice(0, 120);
  return {
    entity_ref: options.entityRef ?? subjectRef(text),
    event_ref: options.eventRef,
    predicate: (options.predicate ?? "resolve").trim().toLowerCase(),
    object: (options.object ?? normalized).trim().toLowerCase(),
    comparison: options.comparison ?? inferComparison(text),
    threshold: options.threshold,
    outcome_type: "binary",
    claim_category: options.claimCategory ?? "event_occurrence",
    suggested_sources: [...(options.suggestedSources ?? [])].sort(),
  };
}

export interface DerivedClaim {
  identity: OutcomeIdentityFields;
  marketKey: OutcomeMarketKey;
  semanticClaimHashHex: string;
  marketKeyHashHex: string;
  identityJson: string;
  marketKeyJson: string;
}

/**
 * Derive the on-chain hashes for a claim.
 *
 * Options are sorted + deduped before hashing, exactly like
 * `build_outcome_market_key`, so `["Yes","No"]` and `["No","Yes"]` produce the
 * same market.
 */
export function deriveClaim(
  claimText: string,
  resolutionAtMs: number,
  bettingOptions: string[],
  identityOptions: Parameters<typeof identityFromClaimText>[1] = {},
): DerivedClaim {
  const identity = identityFromClaimText(claimText, identityOptions);
  const options = [...new Set(bettingOptions.map((option) => option.trim()))].sort();

  const marketKey: OutcomeMarketKey = {
    identity,
    deadline_day: deadlineDayBucket(resolutionAtMs),
    betting_options: options,
  };

  return {
    identity,
    marketKey,
    semanticClaimHashHex: hashIdentity(identity),
    marketKeyHashHex: hashMarketKey(marketKey),
    identityJson: compactJson(identity),
    marketKeyJson: compactJson(marketKey),
  };
}
