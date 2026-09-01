import { describe, expect, it, vi } from "vitest";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";

import {
  deliverImportedPullRequestEvent,
  signTrustedImportedEvent,
} from "./imported-collaboration-delivery";

const secret = "1".repeat(64);
const pubkey = getPublicKey(hexToBytes(secret));
const unsigned = {
  kind: 1618,
  content: "PR",
  created_at: 1,
  tags: [
    ["imported", ""],
    ["c", "a".repeat(40)],
  ],
};
const signEvent = async (event: typeof unsigned) => finalizeEvent(event, hexToBytes(secret));

describe("trusted imported collaboration delivery", () => {
  it("signs, prepares, pushes, verifies, then publishes a PR", async () => {
    const calls: string[] = [];

    await deliverImportedPullRequestEvent({
      event: unsigned,
      expectedSigner: pubkey,
      trustedPubkeys: [pubkey],
      signEvent: async (event) => {
        calls.push("sign");
        return signEvent(event as typeof unsigned);
      },
      prepareRef: async () => {
        calls.push("prepare");
      },
      pushRef: async () => {
        calls.push("push");
      },
      verifyRef: async () => {
        calls.push("verify");
      },
      publishEvent: async () => {
        calls.push("publish");
      },
    });

    expect(calls).toEqual(["sign", "prepare", "push", "verify", "publish"]);
  });

  it("does not publish after ref verification fails", async () => {
    const publishEvent = vi.fn();

    await expect(
      deliverImportedPullRequestEvent({
        event: unsigned,
        expectedSigner: pubkey,
        trustedPubkeys: [pubkey],
        signEvent: (event) => signEvent(event as typeof unsigned),
        prepareRef: async () => undefined,
        pushRef: async () => undefined,
        verifyRef: async () => {
          throw new Error("wrong advertised OID");
        },
        publishEvent,
      })
    ).rejects.toThrow("wrong advertised OID");
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized or unexpected signer", async () => {
    await expect(
      signTrustedImportedEvent({
        event: unsigned,
        expectedSigner: pubkey,
        trustedPubkeys: [],
        signEvent: (event) => signEvent(event as typeof unsigned),
      })
    ).rejects.toThrow("not authorized");

    await expect(
      signTrustedImportedEvent({
        event: unsigned,
        expectedSigner: "2".repeat(64),
        trustedPubkeys: ["2".repeat(64)],
        signEvent: (event) => signEvent(event as typeof unsigned),
      })
    ).rejects.toThrow("invalid or unexpected");
  });
});
