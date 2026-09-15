// Type surface for the vanilla Window modules the shell reuses verbatim
// (resolved through the `@legacy` alias to apps/window/web/js). Only the
// exports the shell calls are declared; the modules stay the single source of
// truth for route grammar, native panel hosting and the Ads workspace.

declare module "@legacy/view-routing.js" {
  export const OWNER_SECTIONS: readonly string[]
  export const OWNER_CUSTOMER_SEGMENT: string
  export type OwnerRoute = {
    view: string
    projectId?: string
    ownerSection?: string
    ownerCustomerId?: string
    invalid?: boolean
    message?: string
  }
  export function routeForPath(pathname: string): OwnerRoute
  export function ownerPathForSection(section: string): string
  export function ownerPathForCustomer(customerId: string): string
  export function pathForView(view: string, detail?: Record<string, unknown>): string
}

declare module "@legacy/owner-app-host.js" {
  export type OwnerAppId = "mail" | "crm" | "support" | "campaigns"
  export type OwnerApp = {
    id: OwnerAppId
    label: string
    nativeLabel: string
    origin: string
    home: string
    retain: boolean
  }
  export type OwnerAppHost = {
    element: HTMLElement
    mount(target: HTMLElement): OwnerAppHost
    show(appId: string, options?: { path?: string | null; from?: string }): boolean
    preload(): Promise<void> | void
    reload(appId?: string): void
    check(appId: string): Promise<unknown>
    focusHeading(): void
    cancelPending(): void
    pendingWarning(): { kind: string; app: string | null; next: string | null } | null
    confirmPending(): void
    panelState(appId: string): string
    activeApp(): string | null
    hasUnsavedWork(): boolean
    hideAll(): boolean
    whenSettled(): Promise<null>
    dispose(): void
  }
  export const OWNER_APPS: readonly OwnerApp[]
  export function ownerApp(id: string): OwnerApp | null
  export function ownerAppIds(): string[]
  export function createOwnerAppHost(deps?: {
    document?: Document
    window?: Window
    fetch?: typeof fetch
    onStateChange?: (change: { active: string | null; text: string }) => void
  }): OwnerAppHost
  export function nativeRecordPath(appId: string, kind: string, identifier: string): string | null
  export function nativeListPath(appId: string, which: string): string | null
  export function allowedNativePath(app: OwnerApp | null, path: string): string | null
}

declare module "@legacy/ads/ads-workspace.js" {
  export const ADS_SCREENS: readonly { id: string; label: string }[]
  export function mountAdsWorkspace(host: HTMLElement, options?: { preview?: boolean }): () => void
}
