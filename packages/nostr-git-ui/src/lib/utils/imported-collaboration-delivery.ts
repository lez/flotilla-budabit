import type { NostrEvent } from "@nostr-git/core";
import { verifyEvent } from "nostr-tools";

export const signTrustedImportedEvent = async ({
  event,
  expectedSigner,
  trustedPubkeys,
  signEvent,
}: {
  event: Omit<NostrEvent, "id" | "sig" | "pubkey">;
  expectedSigner: string;
  trustedPubkeys: Iterable<string>;
  signEvent: (event: Omit<NostrEvent, "id" | "sig" | "pubkey">) => Promise<NostrEvent>;
}) => {
  if (!new Set(trustedPubkeys).has(expectedSigner)) {
    throw new Error("Active signer is not authorized to import forge data");
  }
  const signed = await signEvent(event);
  if (signed.pubkey !== expectedSigner || !verifyEvent(signed)) {
    throw new Error("Active signer returned an invalid or unexpected imported event");
  }
  return signed;
};

export const deliverImportedPullRequestEvent = async ({
  event,
  expectedSigner,
  trustedPubkeys,
  signEvent,
  prepareRef,
  pushRef,
  verifyRef,
  publishEvent,
}: {
  event: Omit<NostrEvent, "id" | "sig" | "pubkey">;
  expectedSigner: string;
  trustedPubkeys: Iterable<string>;
  signEvent: (event: Omit<NostrEvent, "id" | "sig" | "pubkey">) => Promise<NostrEvent>;
  prepareRef: (event: NostrEvent) => Promise<void>;
  pushRef: (event: NostrEvent) => Promise<void>;
  verifyRef: (event: NostrEvent) => Promise<void>;
  publishEvent: (event: NostrEvent) => Promise<void>;
}) => {
  const signed = await signTrustedImportedEvent({
    event,
    expectedSigner,
    trustedPubkeys,
    signEvent,
  });
  await prepareRef(signed);
  await pushRef(signed);
  await verifyRef(signed);
  await publishEvent(signed);
  return signed;
};
