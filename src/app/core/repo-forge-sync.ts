import {parseRepoAnnouncementEvent, type RepoAnnouncementEvent} from "@nostr-git/core/events"
import {parseRepoUrl} from "@nostr-git/core"

import {getRepoMaintainers} from "@app/core/repo-authority"
import {normalizeRepoPublicationRelays} from "@app/core/repo-publication"

export type RepoForgeSourceOption = {url: string; source: "web" | "clone"}

const normalizeForgeSource = (value: string) => {
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return ""
  parseRepoUrl(url.toString())
  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")
  return url.toString().replace(/\/$/, "")
}

export const getRepoForgeSourceOptions = (
  announcement: RepoAnnouncementEvent,
): RepoForgeSourceOption[] => {
  const parsed = parseRepoAnnouncementEvent(announcement)
  const seen = new Set<string>()
  const options: RepoForgeSourceOption[] = []
  for (const [source, values] of [
    ["web", parsed.web || []],
    ["clone", parsed.clone || []],
  ] as const) {
    for (const value of values) {
      try {
        const url = normalizeForgeSource(value)
        if (!url || seen.has(url)) continue
        seen.add(url)
        options.push({url, source})
      } catch {
        // Ignore non-forge and malformed announcement URLs.
      }
    }
  }
  return options
}

export const requireRepoForgeSyncScope = ({
  announcement,
  expectedRepoAddress,
  viewerPubkey,
  relayUrls,
}: {
  announcement: RepoAnnouncementEvent
  expectedRepoAddress: string
  viewerPubkey: string
  relayUrls: string[]
}) => {
  const parsed = parseRepoAnnouncementEvent(announcement)
  const repoAddress = parsed.address
  if (repoAddress !== expectedRepoAddress) {
    throw new Error("Repository announcement no longer matches this page")
  }
  const maintainers = getRepoMaintainers(announcement)
  if (!viewerPubkey || !maintainers.includes(viewerPubkey)) {
    throw new Error("Active account is not authorized to sync this repository")
  }
  const authoritativeRelays = normalizeRepoPublicationRelays(relayUrls)
  if (authoritativeRelays.length === 0) {
    throw new Error("Repository announcement has no activity relays")
  }
  const sourceOptions = getRepoForgeSourceOptions(announcement)
  if (sourceOptions.length === 0) {
    throw new Error("Repository announcement has no compatible forge URL")
  }
  return {
    repoAddress,
    ownerPubkey: announcement.pubkey,
    maintainerPubkeys: maintainers.filter(pubkey => pubkey !== announcement.pubkey),
    relayUrls: authoritativeRelays,
    sourceCloneUrls: parsed.clone || [],
    sourceOptions,
  }
}
