// The Ads workspace is a Frank read model with its own screens, saved views,
// drafts and publishing queue, all implemented and tested in the vanilla
// module `ads/ads-workspace.js`. The shell mounts that module into its content
// area instead of re-implementing it; the module is disposed when the owner
// leaves the section so its readers and drawers never outlive it.
import * as React from "react"
import { mountAdsWorkspace } from "@legacy/ads/ads-workspace.js"

export function AdsIsland() {
  const slot = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const host = slot.current
    if (!host) return
    const dispose = mountAdsWorkspace(host)
    return () => {
      dispose()
      host.replaceChildren()
    }
  }, [])
  return <div ref={slot} className="owner-panel-read is-ads relative flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="ads-island" />
}
