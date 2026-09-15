// The native application region: CRM, Support, Mail and Email flows rendered
// by their own applications inside Frank's content area.
//
// The panel host itself is the vanilla Window module `owner-app-host.js`,
// reused as-is: it owns the authorized readiness check, the bridge protocol
// with each native origin, the sign-in hand-off, preloading, retained panels
// and the unsaved-work guard, and it is covered by the existing behavioural
// tests. This component only mounts it once, keeps it alive across section
// changes, and translates the shell route into `show()` / `hideAll()` calls.
import * as React from "react"
import { createOwnerAppHost, type OwnerAppHost } from "@legacy/owner-app-host.js"
import type { SectionId } from "@/lib/routes"
import { isNativeSection } from "@/lib/routes"

export type NativeHostProps = {
  section: SectionId
  appPath: string
  visible: boolean
  /** The host settled on a different application than the route asked for. */
  onActiveChange: (active: string | null) => void
  onAnnounce?: (text: string) => void
}

export function NativeHost({ section, appPath, visible, onActiveChange, onAnnounce }: NativeHostProps) {
  const slot = React.useRef<HTMLDivElement | null>(null)
  const host = React.useRef<OwnerAppHost | null>(null)
  const activeRef = React.useRef<string | null>(null)
  const announce = React.useRef(onAnnounce)
  const activeChange = React.useRef(onActiveChange)
  React.useEffect(() => {
    announce.current = onAnnounce
    activeChange.current = onActiveChange
  }, [onAnnounce, onActiveChange])

  React.useEffect(() => {
    if (!slot.current || host.current) return
    const created = createOwnerAppHost({
      document,
      window,
      fetch: (input, init) => window.fetch(input, init),
      onStateChange: ({ active, text }) => {
        announce.current?.(text)
        if (active !== activeRef.current) {
          activeRef.current = active
          activeChange.current(active)
        }
      },
    })
    created.mount(slot.current)
    host.current = created
    // Warm every native panel now, exactly as the vanilla workspace did, so the
    // owner never waits on a cold readiness check when reaching a section.
    void created.preload()
    return () => {
      created.dispose()
      host.current = null
    }
  }, [])

  React.useEffect(() => {
    const current = host.current
    if (!current) return
    if (isNativeSection(section)) {
      const opened = current.show(section, { path: appPath || null, from: "shell" })
      if (opened === false) {
        // A protected panel is asking the owner whether to leave it. The host
        // renders that question; the shell falls back to what is actually open.
        activeChange.current(current.activeApp())
      }
    } else if (current.activeApp()) {
      current.hideAll()
    }
  }, [section, appPath])

  return (
    <div
      ref={slot}
      className="owner-app-frame-slot flex min-h-0 flex-1"
      data-testid="native-host-slot"
      hidden={!visible}
      aria-hidden={!visible}
    />
  )
}
