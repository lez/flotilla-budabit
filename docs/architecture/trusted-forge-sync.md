# Trusted Forge Sync

Budabit can import and repeatedly synchronize forge collaboration data into an existing NIP-34 repository. The workflow is repository-scoped: it uses the current kind `30617` coordinate and its declared activity relays without replacing repository announcement or state metadata.

## Authority

Imported repository history is trusted only when signed by the repository owner or a direct maintainer listed by the owner's current kind `30617` announcement. Maintainer authority is not transitive. The application checks this authority when presenting the action, when opening the dialog, and again before every signature and publication. An account, coordinate, announcement, or relay-scope change stops the operation.

This restriction applies only to events carrying `imported`. Native NIP-34 issues, pull requests, comments, and other contributor events remain permissionless and continue through the normal repository validation path.

## Provenance

The active authorized Nostr account signs imported repository events. Forge users do not receive synthetic signing authority. Their identity and source data are retained in bridge tags:

- `imported` identifies bridge-produced history.
- `proxy` stores the canonical forge object URL and provider.
- `source-key` stores a collision-safe provider/object-type/object-id key.
- `source-author` stores the forge login and profile URL.
- `original_date` and `original_updated_at` preserve source timing.

GitHub coverage includes issue and pull-request conversation comments, nonempty review summaries, inline review comments, and inline reply relationships. Inline path, commit, line, and side context is represented with NIP-22 comment tags.

## Reconciliation

Dates limit forge API fetching; they never determine identity. Relay inventory verifies signatures, repository scope, direct authority, complete proxy metadata, and event lineage before source keys or proxies are admitted.

Repeated synchronization:

- skips existing issue, pull-request, and comment source identities;
- imports missing comments beneath existing roots;
- emits one kind `1619` update when a pull-request tip changes;
- emits only the current open, closed, applied, or draft status when needed;
- resolves inline reply parents by namespaced source key;
- leaves unchanged objects unpublished.

Pull-request roots and updates are not published until their exact `refs/nostr/<event-id>` ref is advertised at the expected commit on an existing GRASP target.

## Recovery

Repository transaction records use schema version 3. A bounded collaboration checkpoint stores the phase and page cursors, one exact pending signed event, canonical relay outcomes, and per-target pull-request ref evidence. The exact event is persisted before side effects.

Recovery first inventories canonical relays. If the exact event is already visible, it is not republished. Otherwise, pull-request refs must be observed at their checkpointed commits before the exact event can be retried. Timeouts and unknown Git or relay outcomes fail closed and remain in the journal for later recovery. Credentials and credential-bearing relay URLs are rejected from persisted state.

## Delivery States

Canonical completion requires an explicit successful outcome from at least one authoritative repository relay. Missing or implicit outcomes do not complete an item.

Optional secondary replication is separate. Each event/relay pair enters a durable outbox after canonical acceptance. Timeouts and rate limits retain the exact signed event with bounded exponential backoff and parsed retry delays. Secondary failure does not invalidate canonical completion, and the UI reports pending replication independently.

## Repository UX

Owners and direct maintainers see `Import forge data` on repositories with no imported roots and `Sync forge data` after imported history exists. The action is available in the route-wide repository bar and overview actions.

The dialog offers announcement-derived forge URLs or a custom supported URL, all-time/last-successful/custom-date ranges, issue/pull-request/comment categories, reconciliation behavior, and created/updated/skipped/replication results. Existing-repository mode cannot create remotes or publish replacement kind `30617`/`30618` events. After canonical completion, the repository announcement and collaboration history are refreshed.
