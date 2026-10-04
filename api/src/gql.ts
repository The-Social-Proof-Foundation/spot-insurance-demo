// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0
//
// Minimal GraphQL client for the chain indexer (myso-indexer-alt-graphql).
//
// This server is treated as strictly read-only: we never mutate it, we only
// enumerate on-chain objects by type and fetch their Move field JSON.

import { env } from "./env.js";

export class GraphQLError extends Error {
  constructor(
    message: string,
    readonly errors: unknown,
  ) {
    super(message);
    this.name = "GraphQLError";
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; [key: string]: unknown }>;
}

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(env.graphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new GraphQLError(
      `GraphQL unreachable at ${env.graphqlUrl}: ${(cause as Error).message}`,
      cause,
    );
  }

  if (!response.ok) {
    throw new GraphQLError(`GraphQL HTTP ${response.status} from ${env.graphqlUrl}`, null);
  }

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (payload.errors?.length) {
    throw new GraphQLError(payload.errors.map((e) => e.message).join("; "), payload.errors);
  }
  if (payload.data === undefined) {
    throw new GraphQLError("GraphQL returned no data", payload);
  }
  return payload.data;
}

export interface ObjectNode {
  address: string;
  /** Move struct fields as plain JSON (u64s arrive as decimal strings). */
  json: Record<string, unknown> | null;
  /** Fully-qualified Move type, e.g. `0x50c1::insurance::UnderwriterVault`. */
  typeRepr: string | null;
  ownerKind?: string | null;
}

interface ObjectsPage {
  objects: RawObjectsResult;
}

interface RawObjectsResult {
  nodes: Array<{
    address: string;
    asMoveObject: {
      contents: { json: Record<string, unknown> | null; type: { repr: string } } | null;
    } | null;
  }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const OBJECTS_PAGE_QUERY = /* GraphQL */ `
  query ObjectsPage($type: String!, $first: Int!, $after: String) {
    objects(filter: { type: $type }, first: $first, after: $after) {
      nodes {
        address
        asMoveObject {
          contents {
            json
            type { repr }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/**
 * Enumerate every object of a Move type, following cursors to completion.
 *
 * `type` may use the short package form (`0x50c1::module::Struct`), which is what
 * the repo's own E2E scripts use against this GraphQL server.
 */
export async function listObjectsByType(
  type: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<ObjectNode[]> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 40;
  const out: ObjectNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const data: ObjectsPage = await gql<ObjectsPage>(OBJECTS_PAGE_QUERY, {
      type,
      first: pageSize,
      after,
    });

    for (const node of data.objects.nodes) {
      out.push({
        address: node.address,
        json: node.asMoveObject?.contents?.json ?? null,
        typeRepr: node.asMoveObject?.contents?.type?.repr ?? null,
      });
    }

    if (!data.objects.pageInfo.hasNextPage) break;
    after = data.objects.pageInfo.endCursor;
    if (!after) break;
  }

  return out;
}

/** Fetch the first (or last) object of a Move type, or null when none exist. */
export async function firstObjectOfType(
  type: string,
  options: { last?: boolean } = {},
): Promise<ObjectNode | null> {
  const direction = options.last ? "last" : "first";
  const data: ObjectsPage = await gql<ObjectsPage>(
    /* GraphQL */ `
      query FirstObject($type: String!) {
        objects(filter: { type: $type }, ${direction}: 1) {
          nodes {
            address
            asMoveObject { contents { json type { repr } } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    { type },
  );
  const node = data.objects.nodes[0];
  if (!node) return null;
  return {
    address: node.address,
    json: node.asMoveObject?.contents?.json ?? null,
    typeRepr: node.asMoveObject?.contents?.type?.repr ?? null,
  };
}

/** Fetch a single object's Move JSON plus its owner kind. */
export async function getObjectJson(address: string): Promise<ObjectNode | null> {
  const data = await gql<{
    object: {
      address: string;
      owner: { __typename?: string } | null;
      asMoveObject: {
        contents: { json: Record<string, unknown> | null; type: { repr: string } } | null;
      } | null;
    } | null;
  }>(
    /* GraphQL */ `
      query ObjectJson($address: MySoAddress!) {
        object(address: $address) {
          address
          owner { __typename }
          asMoveObject { contents { json type { repr } } }
        }
      }
    `,
    { address },
  );

  if (!data.object) return null;
  return {
    address: data.object.address,
    json: data.object.asMoveObject?.contents?.json ?? null,
    typeRepr: data.object.asMoveObject?.contents?.type?.repr ?? null,
    ownerKind: data.object.owner?.__typename ?? null,
  };
}

/** Enumerate objects of a Move type owned by (transferred to) an address. */export async function ownedObjectsOfType(
  owner: string,
  type: string,
  options: { last?: boolean } = {},
): Promise<ObjectNode[]> {
  const direction = options.last ? "last" : "first";
  // NOTE: `address.objects` yields MoveObject nodes directly (no `asMoveObject` wrapper).
  const data = await gql<{
    address: {
      objects: {
        nodes: Array<{
          address: string;
          contents: { json: Record<string, unknown> | null; type: { repr: string } } | null;
        }>;
      };
    } | null;
  }>(
    /* GraphQL */ `
      query OwnedObjects($owner: MySoAddress!, $type: String!) {
        address(address: $owner) {
          objects(filter: { type: $type }, ${direction}: 5) {
            nodes {
              address
              contents { json type { repr } }
            }
          }
        }
      }
    `,
    { owner, type },
  );

  return (data.address?.objects.nodes ?? []).map((node) => ({
    address: node.address,
    json: node.contents?.json ?? null,
    typeRepr: node.contents?.type?.repr ?? null,
  }));
}

export interface ParsedEvent {
  typeRepr: string;
  /** Move struct name, e.g. `SpotMarketCreatedEvent`. */
  name: string;
  /** Move struct fields as plain JSON (u64s are decimal strings). */
  json: Record<string, unknown>;
}

/**
 * Fetch a transaction's events with parsed Move JSON.
 *
 * The SDK's `Event` type only carries raw BCS, so when the UI needs to show
 * *what happened* on chain we read the parsed form from the indexer's GraphQL.
 */
export async function transactionEvents(digest: string): Promise<ParsedEvent[]> {
  const data = await gql<{
    transaction: {
      effects: {
        events: {
          nodes: Array<{
            contents: { type: { repr: string }; json: Record<string, unknown> } | null;
          }>;
        };
      } | null;
    } | null;
  }>(
    /* GraphQL */ `
      query TransactionEvents($digest: String!) {
        transaction(digest: $digest) {
          effects {
            events {
              nodes {
                contents { type { repr } json }
              }
            }
          }
        }
      }
    `,
    { digest },
  );

  return (data.transaction?.effects?.events?.nodes ?? [])
    .map((node) => node.contents)
    .filter((contents): contents is { type: { repr: string }; json: Record<string, unknown> } =>
      Boolean(contents),
    )
    .map((contents) => ({
      typeRepr: contents.type.repr,
      name: contents.type.repr.split("::").pop() ?? "",
      json: contents.json,
    }));
}
