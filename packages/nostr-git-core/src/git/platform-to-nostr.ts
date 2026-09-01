/**
 * Platform to Nostr Event Conversion
 *
 * Converts Git platform data (issues, comments, PRs) to Nostr events
 * with proper tagging, dating, and threading support.
 */

import type {
  Issue,
  Comment,
  PullRequest,
  RepoMetadata,
  PlatformActor,
  PlatformObjectType,
  PlatformSource,
  PullRequestReviewComment,
} from "../api/api.js"
import type {NostrEvent} from "nostr-tools"
import type {CommentTag} from "../events/nip22/nip22.js"
import {finalizeEvent} from "nostr-tools"
import {hexToBytes} from "nostr-tools/utils"
import {
  createIssueEvent,
  createPullRequestEvent,
  createStatusEvent,
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  createGitCommentEvent,
  createGitInlineCommentEvent,
  GIT_ISSUE,
  GIT_STATUS_OPEN,
  GIT_STATUS_CLOSED,
} from "../events/index.js"

/**
 * User profile mapping: platform:username -> {privkey, pubkey}
 */
export type UserProfileMap = Map<string, {privkey: string; pubkey: string}>

/**
 * Comment event mapping: platform comment ID -> Nostr event ID
 * Used for preserving comment threading
 */
export type CommentEventMap = Map<string, string>

const fallbackSource = (
  platform: string,
  objectType: PlatformObjectType,
  objectId: string | number,
  proxyUrl: string,
): PlatformSource => ({
  provider: platform,
  objectType,
  objectId: String(objectId),
  sourceKey: `${platform}:${objectType}:${objectId}`,
  proxyUrl,
})

export const getPlatformSource = (
  item: {id: number; htmlUrl: string; source?: PlatformSource},
  platform: string,
  objectType: PlatformObjectType,
) => item.source || fallbackSource(platform, objectType, item.id, item.htmlUrl)

export const importedBridgeTags = ({
  source,
  author,
  createdAt,
  updatedAt,
}: {
  source: PlatformSource
  author: PlatformActor
  createdAt: string
  updatedAt: string
}): string[][] => {
  const originalDate = Math.floor(Date.parse(createdAt) / 1000)
  const originalUpdatedAt = Math.floor(Date.parse(updatedAt) / 1000)
  return [
    ["proxy", source.proxyUrl, source.provider],
    ["source-author", author.login || "ghost", author.htmlUrl || ""],
    ["imported", ""],
    ["original_date", String(originalDate)],
    ["original_updated_at", String(originalUpdatedAt)],
  ]
}

/**
 * Convert repository metadata to Nostr RepoAnnouncementEvent
 *
 * @param repo - Repository metadata
 * @param relays - List of relay URLs for the repo
 * @param userPubkey - Public key (hex) of the importing user
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @returns Unsigned RepoAnnouncementEvent
 */
export function convertRepoToNostrEvent(
  repo: RepoMetadata,
  relays: string[],
  userPubkey: string,
  importTimestamp: number,
): Omit<NostrEvent, "id" | "sig" | "pubkey"> {
  const repoName = repo.fullName.split("/").pop() || repo.name
  const hashtags: string[] = []

  const event = createRepoAnnouncementEvent({
    repoId: repoName,
    name: repo.name,
    description: repo.description,
    web: [repo.htmlUrl],
    clone: [repo.cloneUrl],
    relays,
    maintainers: [userPubkey],
    hashtags,
    created_at: importTimestamp,
  })

  const tags: string[][] = [...event.tags, ["imported", ""]]

  return {
    ...event,
    tags,
  }
}

/**
 * Convert repository metadata to Nostr RepoStateEvent
 *
 * @param repo - Repository metadata
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @returns Unsigned RepoStateEvent
 */
export function convertRepoToStateEvent(
  repo: RepoMetadata,
  importTimestamp: number,
  refs?: Array<{type: "heads" | "tags"; name: string; commit: string}>,
): Omit<NostrEvent, "id" | "sig" | "pubkey"> {
  const repoName = repo.fullName.split("/").pop() || repo.name

  const event = createRepoStateEvent({
    repoId: repoName,
    head: repo.defaultBranch,
    refs,
    created_at: importTimestamp,
  })

  const tags: string[][] = [...event.tags, ["imported", ""]]

  return {
    ...event,
    tags,
  }
}

/**
 * Convert platform issues to Nostr IssueEvent array
 *
 * Creates issue events with proper tagging, dating, and signing.
 * Events are created with fake timestamps starting from startTimestamp
 * to ensure chronological ordering.
 *
 * @param issues - Array of platform issues
 * @param repoAddr - Repository address (e.g., "30617:pubkey:repo")
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param userProfiles - Map of platform users to Nostr keypairs (keys: "platform:username")
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @returns Array of unsigned IssueEvent objects ready to be signed
 */
export function convertIssuesToNostrEvents(
  issues: Issue[],
  repoAddr: string,
  platform: string,
  userProfiles: UserProfileMap,
  importTimestamp: number,
  startTimestamp: number,
): Array<{event: Omit<NostrEvent, "id" | "sig" | "pubkey">; privkey: string}> {
  const result: Array<{event: Omit<NostrEvent, "id" | "sig" | "pubkey">; privkey: string}> = []
  let currentTimestamp = startTimestamp

  for (const issue of issues) {
    const profileKey = `${platform}:${issue.author.login}`
    const profile = userProfiles.get(profileKey)

    if (!profile) {
      console.warn(
        `No profile found for user ${issue.author.login}, skipping issue ${issue.number}`,
      )
      continue
    }

    const labels = issue.labels.map(label => label.name)
    const source = getPlatformSource(issue, platform, "issue")

    const baseEvent = createIssueEvent({
      content: issue.body || "",
      repoAddr,
      subject: issue.title,
      labels,
      created_at: currentTimestamp,
      tags: [],
    })

    const tags: string[][] = [
      ...baseEvent.tags,
      ...importedBridgeTags({
        source,
        author: issue.author,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      }),
    ]

    const issueEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
      ...baseEvent,
      tags,
    }

    currentTimestamp += 1

    result.push({
      event: issueEvent,
      privkey: profile.privkey,
    })
  }

  return result
}

// todo: review this function and make sure it's correct
/**
 * Convert issue status to Nostr StatusEvent
 *
 * Creates status events for the current status only (no history).
 *
 * @param issueEventId - Nostr event ID of the issue event
 * @param issueState - Current issue state ('open' | 'closed')
 * @param originalDate - Original date of the issue (ISO 8601); stored in tag as Unix timestamp (seconds)
 * @param repoAddr - Repository address
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @returns Unsigned StatusEvent object ready to be signed
 */
export function convertIssueStatusToEvent(
  issueEventId: string,
  issueState: "open" | "closed",
  originalDate: string,
  repoAddr: string,
  startTimestamp: number,
  provenance?: {
    source: PlatformSource
    author: PlatformActor
    updatedAt?: string
  },
): Omit<NostrEvent, "id" | "sig" | "pubkey"> {
  const statusKind = issueState === "closed" ? GIT_STATUS_CLOSED : GIT_STATUS_OPEN
  const statusContent = issueState === "closed" ? "closed" : "open"

  const parsed = Date.parse(originalDate)
  const originalDateUnixSeconds = Number.isNaN(parsed) ? startTimestamp : Math.floor(parsed / 1000)

  const baseEvent = createStatusEvent({
    kind: statusKind,
    content: statusContent,
    rootId: issueEventId,
    repoAddr,
    created_at: startTimestamp,
    tags: [],
  })

  const tags: string[][] = [
    ...baseEvent.tags,
    ...(provenance
      ? importedBridgeTags({
          source: provenance.source,
          author: provenance.author,
          createdAt: originalDate,
          updatedAt: provenance.updatedAt || originalDate,
        })
      : [
          ["imported", ""],
          ["original_date", originalDateUnixSeconds.toString()],
        ]),
  ]

  const statusEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
    ...baseEvent,
    tags,
  }

  return statusEvent
}

/**
 * Result of converting comments to Nostr events
 */
export interface ConvertedComment {
  /**
   * Unsigned comment event
   */
  event: Omit<NostrEvent, "id" | "sig" | "pubkey">

  /**
   * Private key for signing the event
   */
  privkey: string

  /**
   * Original platform comment ID (for mapping after signing)
   */
  platformCommentId: number
  platformCommentKey: string
}

export interface CommentConversionContext {
  rootKind?: number
  repoAddr?: string
}

/**
 * Convert platform comments to Nostr CommentEvent array
 *
 * Converts comments with full threading support (preserves parent references).
 * Comments are sorted chronologically and assigned fake timestamps to ensure
 * proper ordering and avoid duplicate timestamps.
 *
 * @param comments - Array of platform comments (will be sorted chronologically)
 * @param rootEventId - Nostr event ID of the root issue/PR event
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param userProfiles - Map of platform users to Nostr keypairs (keys: "platform:username")
 * @param commentEventMap - Map to track platform comment ID -> Nostr event ID (updated after signing)
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @param context - Optional root kind and repository context
 * @returns Array of converted comments with platform IDs for mapping after signing
 */
export function convertCommentsToNostrEvents(
  comments: Comment[],
  rootEventId: string,
  platform: string,
  userProfiles: UserProfileMap,
  commentEventMap: CommentEventMap,
  importTimestamp: number,
  startTimestamp: number,
  context: CommentConversionContext = {},
): ConvertedComment[] {
  const result: ConvertedComment[] = []
  let currentTimestamp = startTimestamp
  const rootKind = context.rootKind ?? GIT_ISSUE

  const sortedComments = [...comments].sort((a, b) => {
    return Date.parse(a.createdAt) - Date.parse(b.createdAt)
  })

  for (const comment of sortedComments) {
    if (comment.kind === "review" && !comment.body.trim()) continue
    const profileKey = `${platform}:${comment.author.login}`
    const profile = userProfiles.get(profileKey)

    if (!profile) {
      console.warn(
        `No profile found for user ${comment.author.login}, skipping comment ${comment.id}`,
      )
      continue
    }

    const objectType: PlatformObjectType =
      comment.kind === "inline"
        ? "pull-request-review-comment"
        : comment.kind === "review"
          ? "pull-request-review"
          : "issue-comment"
    const source = getPlatformSource(comment, platform, objectType)

    let parentRef:
      | {type: "e"; value: string; kind: string; pubkey?: string; relay?: string}
      | undefined

    const parentSourceKey =
      comment.inReplyToSourceKey ||
      (comment.inReplyToId ? `${platform}:${objectType}:${comment.inReplyToId}` : undefined)
    if (parentSourceKey) {
      const parentEventId = commentEventMap.get(parentSourceKey)
      if (parentEventId) {
        parentRef = {
          type: "e",
          value: parentEventId,
          kind: "1111",
        }
      }
    }

    const commentOptions = {
      content: comment.body || "",
      root: {
        id: rootEventId,
        kind: rootKind,
      },
      parent: parentRef
        ? {
            id: parentRef.value,
            kind: Number(parentRef.kind),
          }
        : undefined,
      authorPubkey: profile.pubkey,
      created_at: currentTimestamp,
      repoRefs: context.repoAddr ? [context.repoAddr] : [],
      extraTags: importedBridgeTags({
        source,
        author: comment.author,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      }) as CommentTag[],
    }
    const baseEvent =
      comment.kind === "inline"
        ? createGitInlineCommentEvent({
            ...commentOptions,
            filePath: (comment as PullRequestReviewComment).path,
            commitId: (comment as PullRequestReviewComment).commitId,
            line: String(
              (comment as PullRequestReviewComment).line ||
                (comment as PullRequestReviewComment).originalLine ||
                "",
            ),
            lineSide: (comment as PullRequestReviewComment).side === "LEFT" ? "del" : undefined,
          })
        : createGitCommentEvent(commentOptions)

    const commentEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
      ...baseEvent,
      tags: baseEvent.tags,
    }

    currentTimestamp += 1

    result.push({
      event: commentEvent,
      privkey: profile.privkey,
      platformCommentId: comment.id,
      platformCommentKey: source.sourceKey,
    })
  }

  return result
}

/**
 * Convert platform pull requests to Nostr PullRequestEvent array
 *
 * Uses PR title, body, head branch, base branch, and optionally commit SHAs
 * when provided via prCommits (e.g. from listPullRequestCommits).
 *
 * @param prs - Array of platform pull requests
 * @param repoAddr - Repository address (e.g., "30617:pubkey:repo")
 * @param platform - Platform identifier (e.g., 'github', 'gitlab')
 * @param userProfiles - Map of platform users to Nostr keypairs (keys: "platform:username")
 * @param importTimestamp - Unix timestamp (seconds) when import occurred
 * @param startTimestamp - Starting timestamp for fake chronological ordering
 * @param prCommits - Optional map of PR number -> commit SHAs (from listPullRequestCommits)
 * @returns Array of unsigned PullRequestEvent objects ready to be signed
 */
export function convertPullRequestsToNostrEvents(
  prs: PullRequest[],
  repoAddr: string,
  platform: string,
  userProfiles: UserProfileMap,
  importTimestamp: number,
  startTimestamp: number,
  prCommits?: Map<number, string[]>,
): Array<{
  event: Omit<NostrEvent, "id" | "sig" | "pubkey">
  privkey: string
  platformPullRequestNumber: number
}> {
  const result: Array<{
    event: Omit<NostrEvent, "id" | "sig" | "pubkey">
    privkey: string
    platformPullRequestNumber: number
  }> = []
  let currentTimestamp = startTimestamp

  for (const pr of prs) {
    const profileKey = `${platform}:${pr.author.login}`
    const profile = userProfiles.get(profileKey)

    if (!profile) {
      console.warn(`No profile found for user ${pr.author.login}, skipping PR ${pr.number}`)
      continue
    }

    const labels: string[] = []
    const source = getPlatformSource(pr, platform, "pull-request")
    const commits = prCommits?.get(pr.number)
    const tipCommitOid = commits && commits.length > 0 ? commits[commits.length - 1] : undefined

    const baseEvent = createPullRequestEvent({
      content: pr.body || "",
      repoAddr,
      subject: pr.title,
      labels,
      branchName: pr.head.ref,
      targetBranch: pr.base.ref,
      mergeBase: pr.base.sha,
      tipCommitOid: tipCommitOid || pr.head.sha,
      created_at: currentTimestamp,
      tags: [],
    })

    const tags: string[][] = [
      ...baseEvent.tags,
      ...importedBridgeTags({
        source,
        author: pr.author,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      }),
    ]

    const prEvent: Omit<NostrEvent, "id" | "sig" | "pubkey"> = {
      ...baseEvent,
      tags,
    }

    currentTimestamp += 1

    result.push({
      event: prEvent,
      privkey: profile.privkey,
      platformPullRequestNumber: pr.number,
    })
  }

  return result
}

/**
 * Sign an unsigned event with a private key
 *
 * @param unsignedEvent - Event template without id, sig, pubkey
 * @param privkey - Private key (hex string) for signing
 * @returns Signed Nostr event
 */
export function signEvent(
  unsignedEvent: Omit<NostrEvent, "id" | "sig" | "pubkey">,
  privkey: string,
): NostrEvent {
  if (!/^[0-9a-fA-F]{64}$/.test(privkey)) {
    throw new Error(`Invalid private key format: expected 64 hex characters, got ${privkey.length}`)
  }
  const privkeyBytes = hexToBytes(privkey)

  return finalizeEvent(unsignedEvent, privkeyBytes)
}
