import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(new URL("./ForgeSyncDialog.svelte", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../hooks/useImportRepo.svelte.ts", import.meta.url), "utf8");

describe("existing repository forge sync surface", () => {
  it("offers source, date, category, preview, repeat, and reconciliation results", () => {
    for (const label of [
      "Import forge data",
      "Sync forge data",
      "Custom supported forge URL",
      "successful sync",
      "Data categories",
      "Reconciliation preview",
      "Sync again",
      "unchanged skipped",
      "replication pending",
    ]) {
      expect(dialog).toContain(label);
    }
    expect(dialog).toContain("sm:grid-cols");
    expect(dialog).not.toContain("Destination repository name");
    expect(dialog).not.toContain("Remote targets");
    expect(dialog).not.toContain("Announce Repo on Nostr");
  });

  it("keeps existing-repository sync isolated from metadata and target creation", () => {
    const method = hook.slice(
      hook.indexOf("async function syncExistingRepository"),
      hook.indexOf("function abortImport")
    );
    expect(method).toContain("initialScope.repoAddress");
    expect(method).toContain("resolveAuthorizedScope");
    expect(method).toContain("loadCollaborationInventory");
    expect(method).not.toContain("publishRepoEvents(");
    expect(method).not.toContain("syncRepositoryToRemotes(");
    expect(method).not.toContain("publishRepoSyncAnnouncement(");
    expect(method).not.toContain("ensureForkedRepo(");
  });
});
