import {describe, expect, it} from "vitest"

import {getRepoForgeSourceOptions, requireRepoForgeSyncScope} from "./repo-forge-sync"

const owner = "a".repeat(64)
const maintainer = "b".repeat(64)
const announcement = {
  id: "e".repeat(64),
  sig: "f".repeat(128),
  pubkey: owner,
  kind: 30617,
  created_at: 1,
  content: "",
  tags: [
    ["d", "repo"],
    ["maintainers", maintainer],
    ["web", "https://github.com/acme/repo", "javascript:bad"],
    ["clone", "https://github.com/acme/repo.git", "https://gitlab.com/acme/mirror.git"],
    ["relays", "wss://declared.example"],
  ],
} as any

describe("repository forge sync scope", () => {
  it("derives only compatible deduplicated announcement forge URLs", () => {
    expect(getRepoForgeSourceOptions(announcement)).toEqual([
      {url: "https://github.com/acme/repo", source: "web"},
      {url: "https://gitlab.com/acme/mirror", source: "clone"},
    ])
  })

  it.each([owner, maintainer])("accepts direct repository authority", viewerPubkey => {
    expect(
      requireRepoForgeSyncScope({
        announcement,
        expectedRepoAddress: `30617:${owner}:repo`,
        viewerPubkey,
        relayUrls: ["wss://declared.example"],
      }),
    ).toMatchObject({
      repoAddress: `30617:${owner}:repo`,
      ownerPubkey: owner,
      maintainerPubkeys: [maintainer],
    })
  })

  it("rejects foreign users, stale coordinates, and empty relay authority", () => {
    expect(() =>
      requireRepoForgeSyncScope({
        announcement,
        expectedRepoAddress: `30617:${owner}:repo`,
        viewerPubkey: "c".repeat(64),
        relayUrls: ["wss://declared.example"],
      }),
    ).toThrow("not authorized")
    expect(() =>
      requireRepoForgeSyncScope({
        announcement,
        expectedRepoAddress: `30617:${owner}:other`,
        viewerPubkey: owner,
        relayUrls: ["wss://declared.example"],
      }),
    ).toThrow("no longer matches")
    expect(() =>
      requireRepoForgeSyncScope({
        announcement,
        expectedRepoAddress: `30617:${owner}:repo`,
        viewerPubkey: owner,
        relayUrls: [],
      }),
    ).toThrow("no activity relays")
  })
})
