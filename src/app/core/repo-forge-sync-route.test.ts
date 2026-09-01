import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const session = readFileSync(
  new URL("../../routes/git/[id=naddr]/RepoSession.svelte", import.meta.url),
  "utf8",
)
const page = readFileSync(
  new URL("../../routes/git/[id=naddr]/+page.svelte", import.meta.url),
  "utf8",
)

describe("repository forge sync route contract", () => {
  it("gates the action with current direct authority and rechecks inside side effects", () => {
    expect(session).toContain("getRepoMaintainers(announcement).includes($pubkey)")
    expect(session).toContain("requireRepoForgeSyncScope")
    expect(session).toContain("Active account changed during forge sync")
    expect(session.match(/resolveScope\(\)/g)?.length).toBeGreaterThanOrEqual(3)
    expect(session).toContain("repoAddress: current.repoAddress")
    expect(session).toContain("current.relayUrls")
  })

  it("exposes a responsive action and refreshes collaboration after success", () => {
    expect(page).toContain("repoActions.syncFromForge")
    expect(page).toContain("Import forge data")
    expect(page).toContain("Sync forge data")
    expect(page).toContain("flex flex-wrap")
    expect(session).toContain('hidden md:inline">Sync forge')
    expect(session).toContain("repoRootHistory?.loadRecent()")
  })
})
