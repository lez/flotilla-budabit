import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {hexToBytes} from "nostr-tools/utils"

import {
  buildImportedCollaborationInventory,
  reconcileImportedCollaboration,
  type GitComment,
  type GitIssue,
  type GitPullRequest,
} from "@nostr-git/core"
import {
  drainImportedCollaborationOutbox,
  enqueueImportedCollaborationReplication,
  listImportedCollaborationOutbox,
} from "../../../packages/nostr-git-ui/src/lib/utils/imported-collaboration-outbox"
import {
  RepoCreationTransactionJournal,
  retryPendingRepoCreationCollaboration,
} from "../../../packages/nostr-git-ui/src/lib/utils/repo-creation-transaction"
import {isAcceptedRepoRootEvent} from "./repo-root-history"

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const originalStorage = globalThis.localStorage
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", {value: originalStorage})
  else Reflect.deleteProperty(globalThis, "localStorage")
})

const ownerSecret = "1".repeat(64)
const foreignSecret = "2".repeat(64)
const owner = getPublicKey(hexToBytes(ownerSecret))
const repoAddress = `30617:${owner}:repo`
const oid = (character: string) => character.repeat(40)
const signed = (kind: number, sourceKey: string, tags: string[][], secret = ownerSecret) =>
  finalizeEvent(
    {
      kind,
      content: "",
      created_at: 1,
      tags: [
        ["imported", ""],
        ["proxy", `https://github.com/acme/repo/${sourceKey}`, "github"],
        ["source-key", sourceKey],
        ["original_updated_at", "1"],
        ...tags,
      ],
    },
    hexToBytes(secret),
  )

const issue: GitIssue = {
  id: 1,
  number: 1,
  title: "Issue",
  body: "Body",
  state: "open",
  author: {login: "alice"},
  assignees: [],
  labels: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  url: "https://api.github.com/issues/1",
  htmlUrl: "https://github.com/acme/repo/issues/1",
  source: {
    provider: "github",
    objectType: "issue",
    objectId: "1",
    sourceKey: "github:issue:1",
    proxyUrl: "https://github.com/acme/repo/issues/1",
  },
}
const pullRequest = (sha = oid("a")): GitPullRequest => ({
  id: 2,
  number: 2,
  title: "PR",
  body: "Body",
  state: "open",
  merged: false,
  author: {login: "alice"},
  head: {ref: "feature", sha, repo: {name: "repo", owner: "alice"}},
  base: {ref: "main", sha: oid("b"), repo: {name: "repo", owner: "acme"}},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  url: "https://api.github.com/pulls/2",
  htmlUrl: "https://github.com/acme/repo/pull/2",
  diffUrl: "https://github.com/acme/repo/pull/2.diff",
  patchUrl: "https://github.com/acme/repo/pull/2.patch",
  source: {
    provider: "github",
    objectType: "pull-request",
    objectId: "2",
    sourceKey: "github:pull-request:2",
    proxyUrl: "https://github.com/acme/repo/pull/2",
  },
})
const comment = (id: number, parent?: number): GitComment =>
  ({
    id,
    kind: "inline",
    body: `Comment ${id}`,
    author: {login: "bob"},
    path: "file.ts",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    url: `https://api.github.com/comments/${id}`,
    htmlUrl: `https://github.com/acme/repo/pull/2#discussion_r${id}`,
    inReplyToId: parent,
    inReplyToSourceKey: parent ? `github:pull-request-review-comment:${parent}` : undefined,
    source: {
      provider: "github",
      objectType: "pull-request-review-comment",
      objectId: String(id),
      sourceKey: `github:pull-request-review-comment:${id}`,
      proxyUrl: `https://github.com/acme/repo/pull/2#discussion_r${id}`,
    },
  }) as GitComment

const inventory = (events: any[]) =>
  buildImportedCollaborationInventory({
    events,
    repoAddr: repoAddress,
    repoOwner: owner,
    maintainers: [],
  })

describe("trusted recurring forge sync workflow", () => {
  it("covers initial, no-op, changed-tip, and missing-reply reconciliation", () => {
    const initial = reconcileImportedCollaboration({
      inventory: inventory([]),
      platform: "github",
      issues: [issue],
      pullRequests: [pullRequest()],
      comments: [{rootSourceKey: "github:pull-request:2", comment: comment(10)}],
    })
    expect(initial.map(action => action.type)).toEqual([
      "create-issue",
      "set-current-status",
      "create-pull-request",
      "set-current-status",
      "create-comment",
    ])

    const issueRoot = signed(1621, "github:issue:1", [["a", repoAddress]])
    const prRoot = signed(1618, "github:pull-request:2", [
      ["a", repoAddress],
      ["c", oid("a")],
    ])
    const issueStatus = signed(1630, "github:issue:1:status", [
      ["a", repoAddress],
      ["e", issueRoot.id, "", "root"],
    ])
    const prStatus = signed(1630, "github:pull-request:2:status", [
      ["a", repoAddress],
      ["e", prRoot.id, "", "root"],
    ])
    const parent = signed(1111, "github:pull-request-review-comment:10", [
      ["q", repoAddress],
      ["E", prRoot.id],
    ])
    const existing = inventory([issueRoot, prRoot, issueStatus, prStatus, parent])

    expect(
      reconcileImportedCollaboration({
        inventory: existing,
        platform: "github",
        issues: [issue],
        pullRequests: [pullRequest()],
        comments: [{rootSourceKey: "github:pull-request:2", comment: comment(10)}],
      }),
    ).toEqual([])
    expect(
      reconcileImportedCollaboration({
        inventory: existing,
        platform: "github",
        issues: [],
        pullRequests: [pullRequest(oid("c"))],
        comments: [],
      }).filter(action => action.type === "update-pull-request"),
    ).toHaveLength(1)
    expect(
      reconcileImportedCollaboration({
        inventory: existing,
        platform: "github",
        issues: [],
        pullRequests: [],
        comments: [
          {rootSourceKey: "github:pull-request:2", comment: comment(10)},
          {rootSourceKey: "github:pull-request:2", comment: comment(11, 10)},
        ],
      }).map(action => action.sourceKey),
    ).toEqual(["github:pull-request-review-comment:11"])
  })

  it("rejects unauthorized imported claims while preserving native contribution", () => {
    const malicious = signed(1621, "github:issue:9", [["a", repoAddress]], foreignSecret)
    expect(inventory([malicious]).rootsBySourceKey.size).toBe(0)

    const native = finalizeEvent(
      {
        kind: 1621,
        content: "native",
        created_at: 1,
        tags: [
          ["a", repoAddress],
          ["subject", "Native"],
        ],
      },
      hexToBytes(foreignSecret),
    )
    expect(
      isAcceptedRepoRootEvent(native as any, [repoAddress], {repoOwner: owner, maintainers: []}),
    ).toBe(true)
  })

  it("recovers an interrupted exact event and keeps secondary rate limits retryable", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    })
    const event = signed(1621, "github:issue:1", [["a", repoAddress]])
    const journal = new RepoCreationTransactionJournal({
      id: "forge-sync:integration",
      operation: "import",
      ownerPubkey: owner,
      repoName: "repo",
    })
    journal.beginCollaboration()
    journal.recordPendingCollaborationEvent({
      sourceKey: "github:issue:1",
      event,
      canonicalRelayUrls: ["wss://canonical.example"],
    })
    const recovered = await retryPendingRepoCreationCollaboration({
      record: journal.record,
      publisher: vi.fn(),
      fetchRelayEvents: vi.fn().mockResolvedValue([event]),
    })
    expect(recovered.collaboration.pendingEvent).toBeUndefined()

    enqueueImportedCollaborationReplication({
      transactionId: journal.record.id,
      repoAddress,
      event,
      relays: ["wss://secondary.example"],
      now: 1,
    })
    await drainImportedCollaborationOutbox({
      now: 1,
      publisher: vi.fn().mockResolvedValue({
        event,
        ackedRelays: [],
        failedRelays: ["wss://secondary.example"],
        relayOutcomes: [
          {
            relay: "wss://secondary.example",
            status: "failure",
            detail: "rate-limited: retry after 60 seconds",
          },
        ],
      }),
    })
    expect(listImportedCollaborationOutbox()).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({id: event.id}),
        attempts: 1,
        nextAttemptAt: 60_001,
      }),
    ])
  })
})
