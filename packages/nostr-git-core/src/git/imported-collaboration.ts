import type {NostrEvent} from "nostr-tools"
import {verifyEvent} from "nostr-tools"

import type {Comment, Issue, PullRequest} from "../api/api.js"
import {
  GIT_ISSUE,
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "../events/nip34/nip34.js"
import {isTrustedImportedRepoEvent} from "../events/nip34/status-resolver.js"
import {getPlatformSource} from "./platform-to-nostr.js"

const COMMENT = 1111
const STATUS_KINDS = new Set([
  GIT_STATUS_OPEN,
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
])
const FULL_OID = /^[0-9a-f]{40}$/i

export type ImportedCollaborationInventory = {
  eventsById: Map<string, NostrEvent>
  rootsBySourceKey: Map<string, NostrEvent>
  rootsByProxy: Map<string, NostrEvent>
  updatesBySourceKey: Map<string, NostrEvent>
  commentsBySourceKey: Map<string, NostrEvent>
  commentsByProxy: Map<string, NostrEvent>
  statusesBySourceKey: Map<string, NostrEvent>
}

export type ImportedCommentInput = {
  rootSourceKey: string
  comment: Comment
}

export type ImportedCollaborationAction =
  | {type: "create-issue"; sourceKey: string; issue: Issue}
  | {type: "create-pull-request"; sourceKey: string; pullRequest: PullRequest}
  | {
      type: "update-pull-request"
      sourceKey: string
      rootEvent: NostrEvent
      pullRequest: PullRequest
    }
  | {
      type: "create-comment"
      sourceKey: string
      rootSourceKey: string
      parentSourceKey?: string
      comment: Comment
    }
  | {
      type: "set-current-status"
      sourceKey: string
      rootSourceKey: string
      kind: number
      source: Issue | PullRequest
    }

const tagValues = (event: Pick<NostrEvent, "tags">, name: string) =>
  event.tags.filter(tag => tag[0] === name).map(tag => tag[1] || "")

const singleTagValue = (event: Pick<NostrEvent, "tags">, name: string) => {
  const values = tagValues(event, name).filter(Boolean)
  return values.length === 1 ? values[0] : ""
}

const hasExactRepoScope = (event: NostrEvent, repoAddr: string) => {
  const tagName = event.kind === COMMENT ? "q" : "a"
  const values = tagValues(event, tagName)
  return values.includes(repoAddr)
}

const isCanonicalProxy = (sourceKey: string, proxyTag: string[]) => {
  const provider = proxyTag[2]?.trim().toLowerCase()
  if (!provider || !sourceKey.startsWith(`${provider}:`)) return false
  try {
    const url = new URL(proxyTag[1])
    if (!url.hostname || (url.protocol !== "https:" && url.protocol !== "http:")) return false
    if (url.username || url.password) return false
    if (provider === "github" && url.hostname.toLowerCase() !== "github.com") return false
    if (provider === "gitlab" && url.hostname.toLowerCase() !== "gitlab.com") return false
    if (provider === "bitbucket" && url.hostname.toLowerCase() !== "bitbucket.org") return false
    return true
  } catch {
    return false
  }
}

const getRootId = (event: NostrEvent) => {
  if (event.kind === GIT_PULL_REQUEST_UPDATE) return singleTagValue(event, "E")
  if (event.kind === COMMENT) return singleTagValue(event, "E")
  if (STATUS_KINDS.has(event.kind)) {
    const roots = event.tags.filter(tag => tag[0] === "e" && tag[3] === "root")
    return roots.length === 1 ? roots[0][1] || "" : ""
  }
  return ""
}

const eventRank = (event: NostrEvent) => {
  const updated = Number(singleTagValue(event, "original_updated_at"))
  return Number.isFinite(updated) ? updated : 0
}

const isNewer = (candidate: NostrEvent, current: NostrEvent) =>
  eventRank(candidate) > eventRank(current) ||
  (eventRank(candidate) === eventRank(current) &&
    (candidate.created_at > current.created_at ||
      (candidate.created_at === current.created_at && candidate.id > current.id)))

const setLatest = (map: Map<string, NostrEvent>, key: string, event: NostrEvent) => {
  const current = map.get(key)
  if (!current || isNewer(event, current)) map.set(key, event)
}

export const buildImportedCollaborationInventory = ({
  events,
  repoAddr,
  repoOwner,
  maintainers,
  verify = verifyEvent,
}: {
  events: NostrEvent[]
  repoAddr: string
  repoOwner: string
  maintainers: Iterable<string>
  verify?: (event: NostrEvent) => boolean
}): ImportedCollaborationInventory => {
  const inventory: ImportedCollaborationInventory = {
    eventsById: new Map(),
    rootsBySourceKey: new Map(),
    rootsByProxy: new Map(),
    updatesBySourceKey: new Map(),
    commentsBySourceKey: new Map(),
    commentsByProxy: new Map(),
    statusesBySourceKey: new Map(),
  }
  const candidates: Array<{event: NostrEvent; sourceKey: string; proxy: string}> = []

  for (const event of events) {
    if (!verify(event)) continue
    if (!isTrustedImportedRepoEvent({event, repoOwner, maintainers})) continue
    if (!event.tags.some(tag => tag[0] === "imported")) continue
    if (!hasExactRepoScope(event, repoAddr)) continue
    const sourceKey = singleTagValue(event, "source-key")
    const proxyTags = event.tags.filter(
      tag => tag[0] === "proxy" && Boolean(tag[1]) && Boolean(tag[2]),
    )
    if (!sourceKey || proxyTags.length !== 1 || !isCanonicalProxy(sourceKey, proxyTags[0])) continue
    if (
      (event.kind === GIT_PULL_REQUEST || event.kind === GIT_PULL_REQUEST_UPDATE) &&
      !FULL_OID.test(singleTagValue(event, "c"))
    ) {
      continue
    }
    candidates.push({event, sourceKey, proxy: `${proxyTags[0][2]}:${proxyTags[0][1]}`})
  }

  for (const candidate of candidates) {
    const {event, sourceKey, proxy} = candidate
    if (event.kind !== GIT_ISSUE && event.kind !== GIT_PULL_REQUEST) continue
    setLatest(inventory.rootsBySourceKey, sourceKey, event)
    setLatest(inventory.rootsByProxy, proxy, event)
  }

  const rootById = new Map(
    Array.from(inventory.rootsBySourceKey.entries()).map(([sourceKey, event]) => [
      event.id,
      sourceKey,
    ]),
  )
  for (const candidate of candidates) {
    const {event, sourceKey, proxy} = candidate
    inventory.eventsById.set(event.id, event)
    if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST) continue
    const rootId = getRootId(event)
    const rootSourceKey = rootById.get(rootId)
    if (!rootSourceKey) continue
    if (event.kind === GIT_PULL_REQUEST_UPDATE) {
      if (singleTagValue(event, "P") !== inventory.rootsBySourceKey.get(rootSourceKey)?.pubkey) {
        continue
      }
      setLatest(inventory.updatesBySourceKey, rootSourceKey, event)
    } else if (event.kind === COMMENT) {
      setLatest(inventory.commentsBySourceKey, sourceKey, event)
      setLatest(inventory.commentsByProxy, proxy, event)
    } else if (STATUS_KINDS.has(event.kind)) {
      setLatest(inventory.statusesBySourceKey, rootSourceKey, event)
    }
  }
  for (const event of inventory.rootsBySourceKey.values()) inventory.eventsById.set(event.id, event)
  return inventory
}

const desiredIssueStatus = (issue: Issue) =>
  issue.state === "closed" ? GIT_STATUS_CLOSED : GIT_STATUS_OPEN

const desiredPullRequestStatus = (pullRequest: PullRequest) => {
  if (pullRequest.merged || pullRequest.state === "merged") return GIT_STATUS_APPLIED
  if (pullRequest.draft) return GIT_STATUS_DRAFT
  return pullRequest.state === "closed" ? GIT_STATUS_CLOSED : GIT_STATUS_OPEN
}

const getKnownPullRequestTip = (
  inventory: ImportedCollaborationInventory,
  sourceKey: string,
  root: NostrEvent,
) => {
  const update = inventory.updatesBySourceKey.get(sourceKey)
  return singleTagValue(update || root, "c")
}

const orderMissingComments = (
  comments: ImportedCommentInput[],
  platform: string,
  inventory: ImportedCollaborationInventory,
) => {
  const pending = new Map(
    comments.map(input => [
      getPlatformSource(
        input.comment,
        platform,
        input.comment.kind === "inline"
          ? "pull-request-review-comment"
          : input.comment.kind === "review"
            ? "pull-request-review"
            : "issue-comment",
      ).sourceKey,
      input,
    ]),
  )
  const ordered: ImportedCommentInput[] = []
  const resolved = new Set(inventory.commentsBySourceKey.keys())
  while (pending.size > 0) {
    let progressed = false
    for (const [sourceKey, input] of Array.from(pending.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const parent = input.comment.inReplyToSourceKey
      if (parent && !resolved.has(parent) && pending.has(parent)) continue
      if (parent && !resolved.has(parent)) {
        pending.delete(sourceKey)
        continue
      }
      ordered.push(input)
      resolved.add(sourceKey)
      pending.delete(sourceKey)
      progressed = true
    }
    if (!progressed) break
  }
  return ordered
}

export const reconcileImportedCollaboration = ({
  inventory,
  platform,
  issues,
  pullRequests,
  comments,
}: {
  inventory: ImportedCollaborationInventory
  platform: string
  issues: Issue[]
  pullRequests: PullRequest[]
  comments: ImportedCommentInput[]
}): ImportedCollaborationAction[] => {
  const actions: ImportedCollaborationAction[] = []

  for (const issue of issues) {
    const source = getPlatformSource(issue, platform, "issue")
    const sourceKey = source.sourceKey
    if (
      !inventory.rootsBySourceKey.has(sourceKey) &&
      !inventory.rootsByProxy.has(`${source.provider}:${source.proxyUrl}`)
    ) {
      actions.push({type: "create-issue", sourceKey, issue})
    }
    if (inventory.statusesBySourceKey.get(sourceKey)?.kind !== desiredIssueStatus(issue)) {
      actions.push({
        type: "set-current-status",
        sourceKey: `${sourceKey}:status`,
        rootSourceKey: sourceKey,
        kind: desiredIssueStatus(issue),
        source: issue,
      })
    }
  }

  for (const pullRequest of pullRequests) {
    const source = getPlatformSource(pullRequest, platform, "pull-request")
    const sourceKey = source.sourceKey
    const rootEvent =
      inventory.rootsBySourceKey.get(sourceKey) ||
      inventory.rootsByProxy.get(`${source.provider}:${source.proxyUrl}`)
    if (!rootEvent) {
      actions.push({type: "create-pull-request", sourceKey, pullRequest})
    } else if (getKnownPullRequestTip(inventory, sourceKey, rootEvent) !== pullRequest.head.sha) {
      actions.push({type: "update-pull-request", sourceKey, rootEvent, pullRequest})
    }
    if (
      inventory.statusesBySourceKey.get(sourceKey)?.kind !== desiredPullRequestStatus(pullRequest)
    ) {
      actions.push({
        type: "set-current-status",
        sourceKey: `${sourceKey}:status`,
        rootSourceKey: sourceKey,
        kind: desiredPullRequestStatus(pullRequest),
        source: pullRequest,
      })
    }
  }

  for (const input of orderMissingComments(comments, platform, inventory)) {
    const objectType =
      input.comment.kind === "inline"
        ? "pull-request-review-comment"
        : input.comment.kind === "review"
          ? "pull-request-review"
          : "issue-comment"
    const source = getPlatformSource(input.comment, platform, objectType)
    const sourceKey = source.sourceKey
    if (
      inventory.commentsBySourceKey.has(sourceKey) ||
      inventory.commentsByProxy.has(`${source.provider}:${source.proxyUrl}`)
    ) {
      continue
    }
    actions.push({
      type: "create-comment",
      sourceKey,
      rootSourceKey: input.rootSourceKey,
      parentSourceKey: input.comment.inReplyToSourceKey,
      comment: input.comment,
    })
  }
  return actions
}
