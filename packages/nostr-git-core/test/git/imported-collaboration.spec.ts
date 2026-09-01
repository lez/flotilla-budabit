import {describe, expect, it} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {hexToBytes} from "nostr-tools/utils"

import type {Comment, Issue, PullRequest} from "../../src/api/api.js"
import {
  buildImportedCollaborationInventory,
  reconcileImportedCollaboration,
} from "../../src/git/imported-collaboration.js"

const ownerKey = "1".repeat(64)
const maintainerKey = "2".repeat(64)
const foreignKey = "3".repeat(64)
const owner = getPublicKey(hexToBytes(ownerKey))
const maintainer = getPublicKey(hexToBytes(maintainerKey))
const repoAddr = `30617:${owner}:repo`

const importedEvent = ({
  kind,
  sourceKey,
  proxy = `https://github.com/owner/repo/${sourceKey}`,
  tags = [],
  secret = ownerKey,
  createdAt = 1,
}: {
  kind: number
  sourceKey: string
  proxy?: string
  tags?: string[][]
  secret?: string
  createdAt?: number
}) =>
  finalizeEvent(
    {
      kind,
      content: "",
      created_at: createdAt,
      tags: [
        ["imported", ""],
        ["proxy", proxy, "github"],
        ["source-key", sourceKey],
        ["original_updated_at", String(createdAt)],
        ...tags,
      ],
    },
    hexToBytes(secret),
  )

const issue = (state: "open" | "closed" = "open"): Issue => ({
  id: 1,
  number: 1,
  title: "Issue",
  body: "Body",
  state,
  author: {login: "alice"},
  source: {
    provider: "github",
    objectType: "issue",
    objectId: "1",
    sourceKey: "github:issue:1",
    proxyUrl: "https://github.com/owner/repo/issues/1",
  },
  assignees: [],
  labels: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  url: "https://api.github.com/issues/1",
  htmlUrl: "https://github.com/owner/repo/issues/1",
})

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  id: 2,
  number: 2,
  title: "PR",
  body: "Body",
  state: "open",
  author: {login: "alice"},
  source: {
    provider: "github",
    objectType: "pull-request",
    objectId: "2",
    sourceKey: "github:pull-request:2",
    proxyUrl: "https://github.com/owner/repo/pull/2",
  },
  head: {ref: "feature", sha: "a".repeat(40), repo: {name: "repo", owner: "alice"}},
  base: {ref: "main", sha: "b".repeat(40), repo: {name: "repo", owner: "owner"}},
  merged: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  url: "https://api.github.com/pulls/2",
  htmlUrl: "https://github.com/owner/repo/pull/2",
  diffUrl: "https://github.com/owner/repo/pull/2.diff",
  patchUrl: "https://github.com/owner/repo/pull/2.patch",
  ...overrides,
})

const comment = (id: number, parent?: number): Comment => ({
  id,
  kind: "inline",
  body: `Comment ${id}`,
  author: {login: "bob"},
  source: {
    provider: "github",
    objectType: "pull-request-review-comment",
    objectId: String(id),
    sourceKey: `github:pull-request-review-comment:${id}`,
    proxyUrl: `https://github.com/owner/repo/pull/2#discussion_r${id}`,
  },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  url: `https://api.github.com/comments/${id}`,
  htmlUrl: `https://github.com/owner/repo/pull/2#discussion_r${id}`,
  inReplyToId: parent,
  inReplyToSourceKey: parent ? `github:pull-request-review-comment:${parent}` : undefined,
})

describe("trusted imported collaboration inventory", () => {
  it("admits only signed owner or direct-maintainer events in the exact repository", () => {
    const ownerRoot = importedEvent({
      kind: 1621,
      sourceKey: "github:issue:1",
      tags: [["a", repoAddr]],
    })
    const maintainerRoot = importedEvent({
      kind: 1618,
      sourceKey: "github:pull-request:2",
      secret: maintainerKey,
      tags: [
        ["a", repoAddr],
        ["c", "a".repeat(40)],
      ],
    })
    const foreignRoot = importedEvent({
      kind: 1621,
      sourceKey: "github:issue:3",
      secret: foreignKey,
      tags: [["a", repoAddr]],
    })
    const wrongRepo = importedEvent({
      kind: 1621,
      sourceKey: "github:issue:4",
      tags: [["a", `30617:${owner}:other`]],
    })
    const invalid = {...ownerRoot, id: "0".repeat(64)}

    const inventory = buildImportedCollaborationInventory({
      events: [ownerRoot, maintainerRoot, foreignRoot, wrongRepo, invalid],
      repoAddr,
      repoOwner: owner,
      maintainers: [maintainer],
    })

    expect(Array.from(inventory.rootsBySourceKey.keys()).sort()).toEqual([
      "github:issue:1",
      "github:pull-request:2",
    ])
  })

  it("rejects incomplete proxy metadata and chooses duplicate claims deterministically", () => {
    const older = importedEvent({
      kind: 1621,
      sourceKey: "github:issue:1",
      tags: [["a", repoAddr]],
      createdAt: 1,
    })
    const newer = importedEvent({
      kind: 1621,
      sourceKey: "github:issue:1",
      tags: [["a", repoAddr]],
      createdAt: 2,
    })
    const missingProxy = finalizeEvent(
      {
        kind: 1621,
        content: "",
        created_at: 3,
        tags: [
          ["a", repoAddr],
          ["imported", ""],
          ["source-key", "github:issue:3"],
        ],
      },
      hexToBytes(ownerKey),
    )

    const inventory = buildImportedCollaborationInventory({
      events: [newer, older, missingProxy],
      repoAddr,
      repoOwner: owner,
      maintainers: [],
    })

    expect(inventory.rootsBySourceKey.get("github:issue:1")?.id).toBe(newer.id)
    expect(inventory.rootsBySourceKey.has("github:issue:3")).toBe(false)
  })
})

describe("imported collaboration reconciliation", () => {
  const buildInventory = (events: ReturnType<typeof importedEvent>[]) =>
    buildImportedCollaborationInventory({
      events,
      repoAddr,
      repoOwner: owner,
      maintainers: [maintainer],
    })

  it("keeps an existing root while planning only its missing child", () => {
    const root = importedEvent({
      kind: 1621,
      sourceKey: "github:issue:1",
      tags: [["a", repoAddr]],
    })
    const status = importedEvent({
      kind: 1630,
      sourceKey: "github:issue:1",
      tags: [
        ["a", repoAddr],
        ["e", root.id, "", "root"],
      ],
    })
    const actions = reconcileImportedCollaboration({
      inventory: buildInventory([root, status]),
      platform: "github",
      issues: [issue()],
      pullRequests: [],
      comments: [{rootSourceKey: "github:issue:1", comment: comment(10)}],
    })

    expect(actions.map(action => action.type)).toEqual(["create-comment"])
  })

  it("emits one update for a changed PR tip and none for an unchanged tip", () => {
    const root = importedEvent({
      kind: 1618,
      sourceKey: "github:pull-request:2",
      tags: [
        ["a", repoAddr],
        ["c", "0".repeat(40)],
      ],
    })
    const status = importedEvent({
      kind: 1630,
      sourceKey: "github:pull-request:2",
      tags: [
        ["a", repoAddr],
        ["e", root.id, "", "root"],
      ],
    })
    const inventory = buildInventory([root, status])

    expect(
      reconcileImportedCollaboration({
        inventory,
        platform: "github",
        issues: [],
        pullRequests: [pullRequest()],
        comments: [],
      }).filter(action => action.type === "update-pull-request"),
    ).toHaveLength(1)
    expect(
      reconcileImportedCollaboration({
        inventory,
        platform: "github",
        issues: [],
        pullRequests: [pullRequest({head: {...pullRequest().head, sha: "0".repeat(40)}})],
        comments: [],
      }).filter(action => action.type === "update-pull-request"),
    ).toHaveLength(0)
  })

  it.each([
    [pullRequest({state: "open", draft: false}), 1630],
    [pullRequest({state: "open", draft: true}), 1633],
    [pullRequest({state: "closed", draft: false}), 1632],
    [pullRequest({state: "merged", merged: true}), 1631],
  ])("reconciles only the current PR status", (pr, expectedKind) => {
    const actions = reconcileImportedCollaboration({
      inventory: buildInventory([]),
      platform: "github",
      issues: [],
      pullRequests: [pr],
      comments: [],
    })

    expect(actions.filter(action => action.type === "set-current-status")).toEqual([
      expect.objectContaining({kind: expectedKind}),
    ])
  })

  it("orders replies after new parents and drops unresolved replies", () => {
    const actions = reconcileImportedCollaboration({
      inventory: buildInventory([]),
      platform: "github",
      issues: [],
      pullRequests: [],
      comments: [
        {rootSourceKey: "github:pull-request:2", comment: comment(11, 10)},
        {rootSourceKey: "github:pull-request:2", comment: comment(10)},
        {rootSourceKey: "github:pull-request:2", comment: comment(12, 99)},
      ],
    })

    expect(actions.map(action => action.sourceKey)).toEqual([
      "github:pull-request-review-comment:10",
      "github:pull-request-review-comment:11",
    ])
  })
})
