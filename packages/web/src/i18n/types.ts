export type Locale = "zh-CN" | "en-US";

/** A flat dictionary of translation key → string for a single locale. */
export type Dict = Record<string, string>;

/** A namespace bundle: parallel zh-CN / en-US dictionaries with identical keys. */
export type Bundle = Record<Locale, Dict>;

/**
 * Define a namespace's messages while enforcing that the en-US block has
 * exactly the same keys as the zh-CN block (missing or extra keys error).
 */
export function defineMessages<T extends Dict>(zh: T, en: Record<keyof T, string>): Bundle {
  return { "zh-CN": zh, "en-US": en as Dict };
}
