/**
 * React instance key for session-owned Files sidebar state (#403).
 * A new key remounts the tree and invalidates all selection/preview state.
 */
export function fileSidebarScopeKey(sessionId: string | null | undefined): string {
  return sessionId ?? "draft";
}
