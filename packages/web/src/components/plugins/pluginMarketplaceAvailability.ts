export type PluginMarketplaceSurface = "marketplace" | "cloud-unavailable";

export function pluginMarketplaceSurface(localMode: boolean): PluginMarketplaceSurface {
  return localMode ? "marketplace" : "cloud-unavailable";
}
