/**
 * Whether this deployment has the aggregate Resources surface (plugins, skills,
 * knowledge bases and datasets) at all.
 *
 * It used to be derived from `localMode`, which conflated two unrelated things:
 * a hosted-but-capable deployment lost the catalogue it can actually serve, and
 * a local build with the capability switched off still routed `?page=plugins` to
 * a page promising a future launch. The capability flag
 * (`runtimeConfig.pluginsSettingsEnabled`) is the single authority now — the
 * same one Settings uses for its Plugins tab.
 */
export type PluginMarketplaceSurface = "marketplace" | "unavailable";

/**
 * `pluginsEnabled` is an opt-*out* flag in `config.ts`
 * (`VITE_PLUGINS_SETTINGS_ENABLED !== "0"`), so only an explicit `false`
 * withdraws the surface. An undeclared capability is treated as present, which
 * keeps the production default and any partial config object in agreement.
 */
export function pluginMarketplaceSurface(
  pluginsEnabled: boolean | undefined,
): PluginMarketplaceSurface {
  return pluginsEnabled !== false ? "marketplace" : "unavailable";
}

/**
 * The sidebar hides the aggregate entry entirely where the capability is off —
 * a nav item that can only land on an "unavailable" page is noise. The route
 * itself stays addressable (copied/bookmarked links must still resolve), which
 * is why the surface above keeps reporting `unavailable` instead of nothing.
 */
export function showsResourcesNavItem(pluginsEnabled: boolean | undefined): boolean {
  return pluginMarketplaceSurface(pluginsEnabled) === "marketplace";
}
