import { afterEach, describe, expect, it, vi } from "vitest";

import {
  drainImportedCollaborationOutbox,
  enqueueImportedCollaborationReplication,
  listImportedCollaborationOutbox,
} from "./imported-collaboration-outbox";

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const original = globalThis.localStorage;
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", { value: original });
  else Reflect.deleteProperty(globalThis, "localStorage");
});

const event = {
  id: "e".repeat(64),
  sig: "s".repeat(128),
  pubkey: "f".repeat(64),
  kind: 1621,
  created_at: 1,
  tags: [],
  content: "",
};

describe("imported collaboration replication outbox", () => {
  it("deduplicates exact event/relay deliveries and rejects credential URLs", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    enqueueImportedCollaborationReplication({
      transactionId: "tx",
      repoAddress: "30617:owner:repo",
      event,
      relays: ["wss://relay.example", "wss://relay.example/"],
      now: 1,
    });
    expect(listImportedCollaborationOutbox()).toHaveLength(1);
    expect(() =>
      enqueueImportedCollaborationReplication({
        transactionId: "tx",
        repoAddress: "repo",
        event,
        relays: ["wss://user:secret@relay.example"],
      })
    ).toThrow("credentials");
  });

  it("retains rate-limited exact events with durable backoff then removes them on ACK", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    enqueueImportedCollaborationReplication({
      transactionId: "tx",
      repoAddress: "repo",
      event,
      relays: ["wss://relay.example"],
      now: 1,
    });
    const rateLimited = vi.fn().mockResolvedValue({
      event,
      ackedRelays: [],
      failedRelays: ["wss://relay.example"],
      relayOutcomes: [
        {
          relay: "wss://relay.example",
          status: "failure",
          detail: "rate-limited: retry after 90 seconds",
        },
      ],
    });
    expect(await drainImportedCollaborationOutbox({ publisher: rateLimited, now: 1 })).toEqual({
      delivered: 0,
      pending: 1,
      terminalFailures: 0,
    });
    const [pending] = listImportedCollaborationOutbox();
    expect(pending.event.id).toBe(event.id);
    expect(pending.nextAttemptAt).toBe(90_001);
    expect(rateLimited).toHaveBeenCalledTimes(1);

    const success = vi.fn().mockResolvedValue({
      event,
      ackedRelays: ["wss://relay.example"],
      failedRelays: [],
      relayOutcomes: [{ relay: "wss://relay.example", status: "success", detail: "saved" }],
    });
    expect(await drainImportedCollaborationOutbox({ publisher: success, now: 90_001 })).toEqual({
      delivered: 1,
      pending: 0,
      terminalFailures: 0,
    });
  });
});
