import type { NostrEvent } from "@nostr-git/core";
import { normalizeRelayUrl } from "@nostr-git/core/utils";

import { extractPublishRelayAck, type PublishRepoEvent } from "./grasp-pipeline.js";

const PREFIX = "nostr-git:collaboration-outbox:v1:";

export type ImportedCollaborationOutboxRecord = {
  version: 1;
  id: string;
  transactionId: string;
  repoAddress: string;
  event: NostrEvent;
  relay: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number;
  lastOutcome?: { status: string; detail: string };
};

const getStorage = () => (typeof localStorage === "undefined" ? undefined : localStorage);

const safeRelay = (value: string) => {
  const url = new URL(value);
  if (url.username || url.password || url.search) {
    throw new Error("Replication relay URLs cannot contain credentials");
  }
  return normalizeRelayUrl(value);
};

const key = (id: string) => `${PREFIX}${encodeURIComponent(id)}`;

export const listImportedCollaborationOutbox = (): ImportedCollaborationOutboxRecord[] => {
  const storage = getStorage();
  if (!storage) return [];
  const records: ImportedCollaborationOutboxRecord[] = [];
  for (let index = 0; index < storage.length; index++) {
    const itemKey = storage.key(index);
    if (!itemKey?.startsWith(PREFIX)) continue;
    try {
      const record = JSON.parse(storage.getItem(itemKey) || "");
      if (record?.version === 1 && record.event?.id && record.relay) records.push(record);
    } catch {
      storage.removeItem(itemKey);
    }
  }
  return records.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.id.localeCompare(b.id));
};

const put = (record: ImportedCollaborationOutboxRecord) => {
  const storage = getStorage();
  if (!storage) throw new Error("localStorage is unavailable");
  storage.setItem(key(record.id), JSON.stringify(record));
};

export const enqueueImportedCollaborationReplication = ({
  transactionId,
  repoAddress,
  event,
  relays,
  now = Date.now(),
}: {
  transactionId: string;
  repoAddress: string;
  event: NostrEvent;
  relays: string[];
  now?: number;
}) => {
  const existing = new Map(listImportedCollaborationOutbox().map((record) => [record.id, record]));
  for (const relayValue of relays) {
    const relay = safeRelay(relayValue);
    const id = `${event.id}:${relay}`;
    if (existing.has(id)) continue;
    put({
      version: 1,
      id,
      transactionId,
      repoAddress,
      event,
      relay,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
    });
  }
  return listImportedCollaborationOutbox();
};

export const classifyImportedRelayOutcome = (outcome: { status: string; detail: string }) => {
  const accepted = outcome.status === "success";
  const rateLimited = /rate[- ]limited/i.test(outcome.detail);
  const retryable = rateLimited || ["timeout", "aborted", "unknown"].includes(outcome.status);
  const seconds = Number(
    outcome.detail.match(/(?:retry[- ]after[=: ]*|\b)(\d+)\s*s(?:ec(?:ond)?s?)?/i)?.[1]
  );
  return {
    accepted,
    rateLimited,
    retryable,
    retryAfterMs: seconds > 0 ? seconds * 1000 : undefined,
  };
};

export const drainImportedCollaborationOutbox = async ({
  publisher,
  now = Date.now(),
  maxItems = 20,
}: {
  publisher: PublishRepoEvent;
  now?: number;
  maxItems?: number;
}) => {
  const storage = getStorage();
  if (!storage) return { delivered: 0, pending: 0, terminalFailures: 0 };
  let delivered = 0;
  let terminalFailures = 0;
  const due = listImportedCollaborationOutbox()
    .filter((record) => record.nextAttemptAt <= now)
    .slice(0, maxItems);
  for (const record of due) {
    const result = await publisher(record.event, { relays: [record.relay] });
    if (result.event.id !== record.event.id)
      throw new Error("Replication publisher changed event identity");
    const ack = extractPublishRelayAck(result);
    const outcome = ack.relayOutcomes?.find(
      (item) => normalizeRelayUrl(item.relay) === record.relay
    ) || {
      relay: record.relay,
      status: "unknown",
      detail: "No explicit relay outcome",
    };
    const classification = classifyImportedRelayOutcome(outcome);
    if (classification.accepted) {
      storage.removeItem(key(record.id));
      delivered += 1;
      continue;
    }
    if (!classification.retryable) {
      storage.removeItem(key(record.id));
      terminalFailures += 1;
      continue;
    }
    const attempts = record.attempts + 1;
    const delay = Math.max(
      classification.retryAfterMs || (classification.rateLimited ? 60_000 : 0),
      Math.min(60_000 * 2 ** Math.min(attempts - 1, 6), 3_600_000)
    );
    put({
      ...record,
      attempts,
      updatedAt: now,
      nextAttemptAt: now + delay,
      lastOutcome: { status: outcome.status, detail: outcome.detail },
    });
  }
  return {
    delivered,
    pending: listImportedCollaborationOutbox().length,
    terminalFailures,
  };
};
