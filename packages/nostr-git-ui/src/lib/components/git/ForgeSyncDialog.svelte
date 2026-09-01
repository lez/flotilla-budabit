<script lang="ts">
  import {
    DEFAULT_IMPORT_CONFIG,
    type ImportConfig,
    type NostrEvent,
    type NostrFilter,
  } from "@nostr-git/core";
  import {
    useImportRepo,
    type ExistingRepoForgeSyncRequest,
    type ForgeSyncResult,
  } from "../../hooks/useImportRepo.svelte";

  type Props = {
    repoLabel: string;
    sourceOptions: Array<{ url: string; source: "web" | "clone" }>;
    lastSuccessfulAt?: Date;
    hasPriorSync?: boolean;
    resolveScope: ExistingRepoForgeSyncRequest["resolveScope"];
    userPubkey: string;
    workerApi?: any;
    onSignEvent: (event: Omit<NostrEvent, "id" | "sig" | "pubkey">) => Promise<NostrEvent>;
    onPublishEvent: (event: NostrEvent, context?: { relays?: string[] }) => Promise<any>;
    onFetchEvents?: (filters: NostrFilter[]) => Promise<NostrEvent[]>;
    onFetchRelayEvents: (params: {
      relays: string[];
      filters: NostrFilter[];
      timeoutMs?: number;
      throwOnTimeout?: boolean;
    }) => Promise<NostrEvent[]>;
    onComplete?: (result: ForgeSyncResult) => void | Promise<void>;
    onRefresh?: () => void | Promise<void>;
    onClose?: () => void;
  };

  let {
    repoLabel,
    sourceOptions,
    lastSuccessfulAt,
    hasPriorSync = false,
    resolveScope,
    userPubkey,
    workerApi,
    onSignEvent,
    onPublishEvent,
    onFetchEvents,
    onFetchRelayEvents,
    onComplete,
    onRefresh,
    onClose,
  }: Props = $props();
  let sourceChoice = $state(sourceOptions[0]?.url || "custom");
  let customSourceUrl = $state("");
  let token = $state("");
  let dateMode = $state<"all" | "last" | "custom">(lastSuccessfulAt ? "last" : "all");
  let customDate = $state("");
  let mirrorIssues = $state(true);
  let mirrorPullRequests = $state(true);
  let mirrorComments = $state(true);
  let result = $state<ForgeSyncResult | null>(null);
  let warning = $state("");

  const sync = useImportRepo({
    userPubkey,
    workerApi,
    onSignEvent,
    onPublishEvent,
    onFetchEvents,
    onFetchRelayEvents,
  });
  const sourceUrl = $derived(sourceChoice === "custom" ? customSourceUrl.trim() : sourceChoice);
  const sinceDate = $derived.by(() => {
    if (dateMode === "last") return lastSuccessfulAt;
    if (dateMode === "custom" && customDate) return new Date(`${customDate}T00:00:00`);
    return undefined;
  });

  async function runSync() {
    warning = "";
    result = null;
    const config: ImportConfig = {
      ...DEFAULT_IMPORT_CONFIG,
      sinceDate,
      mirrorIssues,
      mirrorPullRequests,
      mirrorComments,
    };
    result = await sync.syncExistingRepository(sourceUrl, token || undefined, config, {
      resolveScope,
    });
    await onComplete?.(result);
    try {
      await onRefresh?.();
    } catch {
      warning = "Forge sync completed, but the repository view could not be refreshed.";
    }
  }
</script>

<section
  class="mx-auto flex min-h-full w-full max-w-3xl flex-col bg-base-100 sm:min-h-0 sm:rounded-xl sm:border sm:border-base-300"
>
  <header class="flex items-start justify-between gap-4 border-b border-base-300 p-4 sm:p-6">
    <div>
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        Repository activity
      </p>
      <h2 class="mt-1 text-xl font-semibold">
        {hasPriorSync || result ? "Sync forge data" : "Import forge data"}
      </h2>
      <p class="mt-1 text-sm text-base-content/65">{repoLabel}</p>
    </div>
    <button class="btn btn-ghost btn-sm" type="button" onclick={onClose} disabled={sync.isImporting}
      >Close</button
    >
  </header>

  <div class="grid flex-1 gap-5 overflow-y-auto p-4 sm:grid-cols-[1.15fr_0.85fr] sm:p-6">
    <div class="space-y-5">
      <label class="form-control gap-2">
        <span class="text-sm font-medium">Announced forge</span>
        <select
          class="select select-bordered w-full"
          bind:value={sourceChoice}
          disabled={sync.isImporting}
        >
          {#each sourceOptions as option}<option value={option.url}
              >{option.url} ({option.source})</option
            >{/each}
          <option value="custom">Custom supported forge URL</option>
        </select>
        {#if sourceChoice === "custom"}
          <input
            class="input input-bordered w-full"
            type="url"
            bind:value={customSourceUrl}
            placeholder="https://forge.example/owner/repository"
          />
        {/if}
      </label>
      <label class="form-control gap-2">
        <span class="text-sm font-medium"
          >Access token <span class="font-normal text-base-content/55">(optional)</span></span
        >
        <input
          class="input input-bordered w-full"
          type="password"
          bind:value={token}
          autocomplete="off"
          disabled={sync.isImporting}
        />
      </label>
      <fieldset class="space-y-2">
        <legend class="mb-2 text-sm font-medium">Import range</legend>
        <label class="flex items-center gap-2"
          ><input class="radio radio-sm" type="radio" bind:group={dateMode} value="all" /> All activity</label
        >
        {#if lastSuccessfulAt}<label class="flex items-center gap-2"
            ><input class="radio radio-sm" type="radio" bind:group={dateMode} value="last" /> Since last
            successful sync</label
          >{/if}
        <label class="flex items-center gap-2"
          ><input class="radio radio-sm" type="radio" bind:group={dateMode} value="custom" /> Custom date</label
        >
        {#if dateMode === "custom"}<input
            class="input input-bordered input-sm ml-6"
            type="date"
            bind:value={customDate}
          />{/if}
      </fieldset>
      <fieldset class="space-y-2">
        <legend class="mb-2 text-sm font-medium">Data categories</legend>
        <label class="flex items-center gap-2"
          ><input class="checkbox checkbox-sm" type="checkbox" bind:checked={mirrorIssues} /> Issues</label
        >
        <label class="flex items-center gap-2"
          ><input class="checkbox checkbox-sm" type="checkbox" bind:checked={mirrorPullRequests} /> Pull
          requests</label
        >
        <label class="flex items-center gap-2"
          ><input class="checkbox checkbox-sm" type="checkbox" bind:checked={mirrorComments} /> Conversation,
          review, and inline comments</label
        >
      </fieldset>
    </div>

    <aside class="rounded-lg border border-base-300 bg-base-200/45 p-4">
      <h3 class="font-semibold">Reconciliation preview</h3>
      <dl class="mt-4 space-y-3 text-sm">
        <div>
          <dt class="text-base-content/55">Destination</dt>
          <dd class="break-all font-medium">{repoLabel}</dd>
        </div>
        <div>
          <dt class="text-base-content/55">Source</dt>
          <dd class="break-all">{sourceUrl || "No compatible source"}</dd>
        </div>
        <div>
          <dt class="text-base-content/55">Range</dt>
          <dd>{sinceDate ? `Since ${sinceDate.toLocaleDateString()}` : "All activity"}</dd>
        </div>
        <div>
          <dt class="text-base-content/55">Behavior</dt>
          <dd>Existing source keys are skipped; current tips and statuses are reconciled.</dd>
        </div>
      </dl>
      {#if sync.progress}<p class="mt-5 border-t border-base-300 pt-4 text-sm font-medium">
          {sync.progress.step}
        </p>{/if}
      {#if sync.error}<p class="mt-4 rounded-md bg-error/10 p-3 text-sm text-error">
          {sync.error}
        </p>{/if}
      {#if warning}<p class="mt-4 rounded-md bg-warning/10 p-3 text-sm">{warning}</p>{/if}
      {#if result}
        <div class="mt-5 grid grid-cols-2 gap-2 border-t border-base-300 pt-4 text-sm">
          <div><strong>{result.issuesCreated}</strong> issues created</div>
          <div><strong>{result.pullRequestsCreated}</strong> PRs created</div>
          <div><strong>{result.commentsCreated}</strong> comments created</div>
          <div><strong>{result.updatesCreated}</strong> updates created</div>
          <div><strong>{result.skipped}</strong> unchanged skipped</div>
          <div><strong>{result.pendingReplicationCount}</strong> replication pending</div>
        </div>
      {/if}
    </aside>
  </div>

  <footer
    class="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-base-300 bg-base-100 p-4 sm:p-6"
  >
    {#if result}<button class="btn btn-outline" type="button" onclick={() => (result = null)}
        >Sync again</button
      >{/if}
    <button
      class="btn btn-primary"
      type="button"
      onclick={runSync}
      disabled={sync.isImporting ||
        !sourceUrl ||
        (!mirrorIssues && !mirrorPullRequests && !mirrorComments) ||
        (dateMode === "custom" && !customDate)}
    >
      {sync.isImporting ? "Syncing forge data..." : "Sync forge data"}
    </button>
  </footer>
</section>
