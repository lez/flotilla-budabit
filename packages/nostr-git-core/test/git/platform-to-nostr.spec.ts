import {describe, expect, it} from "vitest"

import {
  convertCommentsToNostrEvents,
  convertIssueStatusToEvent,
  convertIssuesToNostrEvents,
  convertPullRequestsToNostrEvents,
  type UserProfileMap,
} from "../../src/index.js"

describe("platform-to-nostr pull requests", () => {
  it("retains the platform PR number and uses the last imported commit as the tip", () => {
    const profiles: UserProfileMap = new Map([
      ["github:alice", {privkey: "1".repeat(64), pubkey: "2".repeat(64)}],
    ])
    const commits = ["a".repeat(40), "b".repeat(40)]

    const [converted] = convertPullRequestsToNostrEvents(
      [
        {
          id: 42,
          number: 42,
          title: "Import PR",
          body: "Body",
          state: "open",
          author: {login: "alice"},
          source: {
            provider: "github",
            objectType: "pull-request",
            objectId: "42",
            sourceKey: "github:pull-request:42",
            proxyUrl: "https://github.com/owner/repo/pull/42",
          },
          head: {
            ref: "feature",
            sha: "c".repeat(40),
            repo: {name: "repo", owner: "alice"},
          },
          base: {
            ref: "main",
            sha: "d".repeat(40),
            repo: {name: "repo", owner: "owner"},
          },
          merged: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          url: "https://api.github.com/repos/owner/repo/pulls/42",
          htmlUrl: "https://github.com/owner/repo/pull/42",
          diffUrl: "https://github.com/owner/repo/pull/42.diff",
          patchUrl: "https://github.com/owner/repo/pull/42.patch",
        },
      ],
      `30617:${"3".repeat(64)}:repo`,
      "github",
      profiles,
      1_800_000_000,
      1_800_000_001,
      new Map([[42, commits]]),
    )

    expect(converted.platformPullRequestNumber).toBe(42)
    expect(converted.event.tags).toContainEqual(["c", commits[1]])
    expect(converted.event.tags).toContainEqual(["branch-name", "feature"])
    expect(converted.event.tags).toContainEqual(["target-branch", "main"])
    expect(converted.event.tags).toContainEqual(["merge-base", "d".repeat(40)])
    expect(converted.event.tags).toContainEqual([
      "proxy",
      "https://github.com/owner/repo/pull/42",
      "github",
    ])
    expect(converted.event.tags).toContainEqual(["source-author", "alice", ""])
    expect(converted.event.tags).toContainEqual(["source-key", "github:pull-request:42"])
    expect(converted.event.tags).toContainEqual(["original_updated_at", "1767225600"])
  })
})

describe("platform-to-nostr comments", () => {
  const profiles: UserProfileMap = new Map([
    ["github:alice", {privkey: "1".repeat(64), pubkey: "2".repeat(64)}],
  ])
  const comment = {
    id: 7,
    body: "Imported comment",
    author: {login: "alice"},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: "https://api.github.com/repos/owner/repo/issues/comments/7",
    htmlUrl: "https://github.com/owner/repo/issues/1#issuecomment-7",
  }
  const repoAddr = `30617:${"3".repeat(64)}:repo`

  it.each([
    ["issue", 1621],
    ["pull request", 1618],
  ])("uses the %s root kind and repository q context", (_label, rootKind) => {
    const [converted] = convertCommentsToNostrEvents(
      [comment],
      "4".repeat(64),
      "github",
      profiles,
      new Map(),
      1_800_000_000,
      1_800_000_001,
      {rootKind, repoAddr},
    )

    expect(converted.event.tags).toContainEqual(["K", String(rootKind)])
    expect(converted.event.tags).toContainEqual(["q", repoAddr])
  })

  it("keeps the original issue-comment call signature", () => {
    const [converted] = convertCommentsToNostrEvents(
      [comment],
      "4".repeat(64),
      "github",
      profiles,
      new Map(),
      1_800_000_000,
      1_800_000_001,
    )

    expect(converted.event.tags).toContainEqual(["K", "1621"])
    expect(converted.event.tags.some(tag => tag[0] === "q")).toBe(false)
  })

  it("preserves inline file context and immediate reply parent", () => {
    const [converted] = convertCommentsToNostrEvents(
      [
        {
          ...comment,
          id: 101,
          kind: "inline" as const,
          source: {
            provider: "github",
            objectType: "pull-request-review-comment",
            objectId: "101",
            sourceKey: "github:pull-request-review-comment:101",
            proxyUrl: "https://github.com/owner/repo/pull/1#discussion_r101",
          },
          inReplyToId: 100,
          inReplyToSourceKey: "github:pull-request-review-comment:100",
          path: "src/file.ts",
          commitId: "a".repeat(40),
          originalLine: 42,
          side: "LEFT" as const,
        },
      ],
      "4".repeat(64),
      "github",
      profiles,
      new Map([["github:pull-request-review-comment:100", "5".repeat(64)]]),
      1_800_000_000,
      1_800_000_001,
      {rootKind: 1618, repoAddr},
    )

    expect(converted.platformCommentKey).toBe("github:pull-request-review-comment:101")
    expect(converted.event.tags).toContainEqual(["e", "5".repeat(64)])
    expect(converted.event.tags).toContainEqual(["f", "src/file.ts"])
    expect(converted.event.tags).toContainEqual(["c", "a".repeat(40)])
    expect(converted.event.tags).toContainEqual(["line", "42", "del"])
    expect(converted.event.tags).toContainEqual([
      "proxy",
      "https://github.com/owner/repo/pull/1#discussion_r101",
      "github",
    ])
  })

  it("omits empty review summaries", () => {
    expect(
      convertCommentsToNostrEvents(
        [{...comment, kind: "review", body: "   "}],
        "4".repeat(64),
        "github",
        profiles,
        new Map(),
        1_800_000_000,
        1_800_000_001,
        {rootKind: 1618, repoAddr},
      ),
    ).toEqual([])
  })
})

describe("platform-to-nostr issue provenance", () => {
  const profiles: UserProfileMap = new Map([
    ["github:alice", {privkey: "1".repeat(64), pubkey: "2".repeat(64)}],
  ])
  const source = {
    provider: "github",
    objectType: "issue" as const,
    objectId: "9",
    sourceKey: "github:issue:9",
    proxyUrl: "https://github.com/owner/repo/issues/9",
  }
  const actor = {login: "alice", htmlUrl: "https://github.com/alice"}

  it("emits complete bridge metadata for roots and statuses", () => {
    const [issue] = convertIssuesToNostrEvents(
      [
        {
          id: 9,
          number: 9,
          title: "Issue",
          body: "Body",
          state: "open",
          author: actor,
          source,
          assignees: [],
          labels: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          url: "https://api.github.com/issues/9",
          htmlUrl: source.proxyUrl,
        },
      ],
      `30617:${"3".repeat(64)}:repo`,
      "github",
      profiles,
      1_800_000_000,
      1_800_000_001,
    )
    const status = convertIssueStatusToEvent(
      "4".repeat(64),
      "open",
      "2026-01-01T00:00:00.000Z",
      `30617:${"3".repeat(64)}:repo`,
      1_800_000_002,
      {source, author: actor, updatedAt: "2026-01-02T00:00:00.000Z"},
    )

    for (const event of [issue.event, status]) {
      expect(event.tags).toContainEqual(["proxy", source.proxyUrl, "github"])
      expect(event.tags).toContainEqual(["source-author", "alice", "https://github.com/alice"])
      expect(event.tags).toContainEqual(["original_updated_at", "1767312000"])
    }
  })
})
