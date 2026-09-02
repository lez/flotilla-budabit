import * as nip19 from "nostr-tools/nip19"
import {repository} from "@welshman/app"
import {request} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {DEFAULT_COMMUNITY_INPUT} from "@app/core/community-state"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {SMART_WIDGET_RELAYS} from "@app/core/state"
import {selectDefaultCommunityWidgets} from "@app/extensions/builtin-filter"
import {loadCachedCommunityCuratedWidgets} from "@app/extensions/community-widget-slots"
import {parseSmartWidget} from "@app/extensions/registry"
import {setDefaultExtensionWidgets} from "@app/extensions/settings"
import {getWidgetLineId} from "@app/extensions/widget-identity"
import type {SmartWidgetEvent} from "@app/extensions/types"

/**
 * Widgets shipped with the app: fetched by naddr from the network and merged
 * into the default extension list (installed + enabled by default, like the
 * default community widgets).
 */
const PREINSTALLED_WIDGET_NADDRS = [
  // budabit-workflows widget
  "naddr1qvzqqqr42ypzq3cmmtjgv5ll6n87jjadgdayfszq3ujltx3lwjrs4qly0dkh3yknqyvhwumn8ghj7un9d3shjtnev94kj6r0dehx2tnrdaksz9rhwden5te0wfjkccte9ejxzmt4wvhxjmcpp4mhxue69uhkummn9ekx7mqqz9382erpvf5hgtthdaexkenvdamhxfkyx9q"
]

const loadPreinstalledWidget = async (naddr: string): Promise<SmartWidgetEvent | null> => {
  try {
    const decoded = nip19.decode(naddr)
    if (decoded.type !== "naddr") return null

    const data = decoded.data as nip19.AddressPointer
    const kind = data.kind || SMART_WIDGET_KIND
    const relays = data.relays?.length ? data.relays : SMART_WIDGET_RELAYS
    const filters = [{kinds: [kind], authors: [data.pubkey], "#d": [data.identifier], limit: 1}]

    try {
      await request({relays, filters, autoClose: true})
    } catch (error) {
      console.warn(`[extensions] Preinstalled widget fetch error (${data.identifier})`, error)
    }

    const event = repository.query(filters)[0] as TrustedEvent | undefined
    return event ? parseSmartWidget(event) : null
  } catch (error) {
    console.warn(`[extensions] Failed to load preinstalled widget (${naddr})`, error)
    return null
  }
}

const dedupeWidgets = (widgets: SmartWidgetEvent[]): SmartWidgetEvent[] => {
  const byId = new Map<string, SmartWidgetEvent>()

  for (const widget of widgets) {
    const current = byId.get(getWidgetLineId(widget))
    if (!current || (widget.created_at || 0) > (current.created_at || 0)) {
      byId.set(getWidgetLineId(widget), widget)
    }
  }

  return Array.from(byId.values())
}

let builtinLoadPromise: Promise<void> | undefined

export const installBuiltinExtensions = () => {
  if (builtinLoadPromise) return builtinLoadPromise

  builtinLoadPromise = (async () => {
    const preinstalled = (
      await Promise.all(PREINSTALLED_WIDGET_NADDRS.map(loadPreinstalledWidget))
    ).filter((widget): widget is SmartWidgetEvent => widget !== null)

    if (!DEFAULT_COMMUNITY_INPUT) {
      setDefaultExtensionWidgets(preinstalled)
      return
    }

    try {
      await loadCachedCommunityCuratedWidgets(DEFAULT_COMMUNITY_INPUT, {
        priority: RELAY_REQUEST_PRIORITY.background,
      }).catch(() => undefined)
      // A home slot may have promoted the pending background load. Read the
      // current entry so defaults use the promoted result rather than stale data.
      const result = await loadCachedCommunityCuratedWidgets(DEFAULT_COMMUNITY_INPUT, {
        priority: RELAY_REQUEST_PRIORITY.background,
      })
      const communityWidgets =
        result?.status === "community"
          ? selectDefaultCommunityWidgets(result.widgets, result.community.ownerPubkey)
          : []
      setDefaultExtensionWidgets(dedupeWidgets([...preinstalled, ...communityWidgets]))
    } catch (error) {
      console.warn("[extensions] Failed to load default community extensions", error)
      setDefaultExtensionWidgets(preinstalled)
    }
  })()

  return builtinLoadPromise
}
