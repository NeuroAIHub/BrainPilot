import type { Bundle, Dict, Locale } from "./types";

import sidebar from "./messages/sidebar";
import sandbox from "./messages/sandbox";
import shell from "./messages/shell";
import settings from "./messages/settings";
import chat from "./messages/chat";
import search from "./messages/search";
import quota from "./messages/quota";
import files from "./messages/files";
import trace from "./messages/trace";
import analytics from "./messages/analytics";
import network from "./messages/network";
import profile from "./messages/profile";
import contexts from "./messages/contexts";
import terminal from "./messages/terminal";
import demo from "./messages/demo";
import marketplace from "./messages/marketplace";

/** Fallback locale used when a key is missing in the active locale. */
export const DEFAULT_LOCALE: Locale = "zh-CN";

/** All namespace bundles. Keys are already fully-qualified (e.g. "sidebar.newChat"). */
const bundles: Bundle[] = [sidebar, sandbox, shell, settings, chat, search, quota, files, trace, analytics, network, profile, contexts, terminal, demo, marketplace];

function build(locale: Locale): Dict {
  return Object.assign({}, ...bundles.map((bundle) => bundle[locale]));
}

export const messages: Record<Locale, Dict> = {
  "zh-CN": build("zh-CN"),
  "en-US": build("en-US"),
};
