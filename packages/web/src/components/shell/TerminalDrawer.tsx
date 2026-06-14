import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { runtimeConfig } from "../../config";
import { useAuth } from "../../contexts/AuthContext";
import { useSandbox } from "../../contexts/SandboxContext";
import { mockInitialTerminalOutput, mockTerminalResponse } from "../../mocks/backend";
import { getTerminalWsUrl } from "../../utils/api";
import { useT } from "../../i18n/useT";
import { tg } from "../../i18n/translate";

export type TerminalTab = {
  id: string;
  title: string;
  cwd: string;
};

type TerminalDrawerProps = {
  activeTabId: string | null;
  isMinimized: boolean;
  onActivateTab: (terminalId: string) => void;
  onCloseTab: (terminalId: string) => void;
  onMinimize: () => void;
  onNewTab: () => void;
  tabs: TerminalTab[];
};

const MIN_TERMINAL_HEIGHT = 220;
const DEFAULT_TERMINAL_HEIGHT = 320;
const TERMINAL_CHAR_WIDTH = 8;
const TERMINAL_LINE_HEIGHT = 21;

type TerminalConnectionState = "idle" | "connecting" | "connected" | "error" | "closed";

const terminalConnectionLabel: Record<TerminalConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  connected: "Connected",
  error: "Error",
  closed: "Closed",
};

export function TerminalDrawer({
  activeTabId,
  isMinimized,
  onActivateTab,
  onCloseTab,
  onMinimize,
  onNewTab,
  tabs,
}: TerminalDrawerProps) {
  const t = useT();
  const { token } = useAuth();
  const { currentSandbox } = useSandbox();
  const [height, setHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [outputByTab, setOutputByTab] = useState<Record<string, string>>({});
  const [connectionByTab, setConnectionByTab] = useState<Record<string, TerminalConnectionState>>({});
  const [reconnectKey, setReconnectKey] = useState(0);
  const [input, setInput] = useState("");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const knownTabIdsRef = useRef<Set<string>>(new Set());
  const dragStartRef = useRef<{ height: number; y: number } | null>(null);
  const terminalScreenRef = useRef<HTMLPreElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    tabs.forEach((tab) => {
      if (knownTabIdsRef.current.has(tab.id)) {
        return;
      }

      knownTabIdsRef.current.add(tab.id);
      setLoadingIds((current) => new Set(current).add(tab.id));

      window.setTimeout(() => {
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(tab.id);
          return next;
        });
      }, 700);
    });
  }, [tabs]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStartRef.current) {
        return;
      }

      const maxTerminalHeight = Math.min(window.innerHeight * 0.72, 720);
      const nextHeight = dragStartRef.current.height + (dragStartRef.current.y - event.clientY);
      setHeight(Math.max(MIN_TERMINAL_HEIGHT, Math.min(maxTerminalHeight, nextHeight)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const isOpen = tabs.length > 0 && !isMinimized;
  const isLoading = activeTab ? loadingIds.has(activeTab.id) : false;
  const isReady = !!activeTab && !!token && currentSandbox?.status === "running";
  const activeConnection = activeTab ? (connectionByTab[activeTab.id] ?? "idle") : "idle";

  const getTerminalSize = () => {
    const rect = terminalScreenRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 640;
    const screenHeight = rect?.height ?? Math.max(160, height - 86);
    return {
      cols: Math.max(40, Math.floor((width - 24) / TERMINAL_CHAR_WIDTH)),
      rows: Math.max(8, Math.floor((screenHeight - 24) / TERMINAL_LINE_HEIGHT)),
    };
  };

  const sendTerminalResize = () => {
    if (runtimeConfig.useMockBackend || wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "resize", ...getTerminalSize() }));
  };

  useEffect(() => {
    if (!isOpen || !activeTab || !token || !currentSandbox || currentSandbox.status !== "running") {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    if (runtimeConfig.useMockBackend) {
      setTerminalError(null);
      setConnectionByTab((current) => ({ ...current, [activeTab.id]: "connected" }));
      setLoadingIds((current) => {
        const next = new Set(current);
        next.delete(activeTab.id);
        return next;
      });
      setOutputByTab((current) => ({
        ...current,
        [activeTab.id]: current[activeTab.id] || mockInitialTerminalOutput(),
      }));
      return;
    }

    setTerminalError(null);
    setConnectionByTab((current) => ({ ...current, [activeTab.id]: "connecting" }));
    setLoadingIds((current) => new Set(current).add(activeTab.id));
    const { cols, rows } = getTerminalSize();
    const ws = new WebSocket(getTerminalWsUrl(currentSandbox.id, token, cols, rows));
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionByTab((current) => ({ ...current, [activeTab.id]: "connected" }));
      setLoadingIds((current) => {
        const next = new Set(current);
        next.delete(activeTab.id);
        return next;
      });
      setOutputByTab((current) => ({
        ...current,
        [activeTab.id]: current[activeTab.id] || "$ ",
      }));
    };

    ws.onmessage = async (event) => {
      let text = "";
      if (event.data instanceof Blob) {
        text = await event.data.text();
      } else if (typeof event.data === "string") {
        try {
          const parsed = JSON.parse(event.data) as { message?: string };
          text = parsed.message ? `\n${parsed.message}\n` : event.data;
        } catch {
          text = event.data;
        }
      }
      setOutputByTab((current) => ({
        ...current,
        [activeTab.id]: `${current[activeTab.id] || ""}${text}`,
      }));
    };

    ws.onerror = () => {
      setConnectionByTab((current) => ({ ...current, [activeTab.id]: "error" }));
      setTerminalError(tg("terminal.connectFailed"));
    };

    ws.onclose = () => {
      setConnectionByTab((current) => ({ ...current, [activeTab.id]: current[activeTab.id] === "error" ? "error" : "closed" }));
      setLoadingIds((current) => {
        const next = new Set(current);
        next.delete(activeTab.id);
        return next;
      });
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [activeTab, currentSandbox, isOpen, reconnectKey, token]);

  useEffect(() => {
    if (!isOpen || !activeTab || activeConnection !== "connected") {
      return;
    }
    sendTerminalResize();
  }, [activeConnection, activeTab?.id, height, isOpen]);

  useEffect(() => {
    const handleResize = () => sendTerminalResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const clearTerminal = () => {
    if (!activeTab) {
      return;
    }
    setOutputByTab((current) => ({ ...current, [activeTab.id]: "$ " }));
  };

  const reconnectTerminal = () => {
    if (!activeTab) {
      return;
    }
    if (runtimeConfig.useMockBackend) {
      setOutputByTab((current) => ({
        ...current,
        [activeTab.id]: `${current[activeTab.id] || ""}\nMock terminal reconnected.\n$ `,
      }));
      setConnectionByTab((current) => ({ ...current, [activeTab.id]: "connected" }));
      return;
    }
    wsRef.current?.close();
    setReconnectKey((current) => current + 1);
  };

  const sendTerminalInput = () => {
    if (!input || !activeTab) {
      return;
    }
    if (runtimeConfig.useMockBackend) {
      setOutputByTab((current) => ({
        ...current,
        [activeTab.id]: `${current[activeTab.id] || ""}${input}\n${mockTerminalResponse(input)}`,
      }));
      setInput("");
      return;
    }
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(`${input}\n`);
    setOutputByTab((current) => ({
      ...current,
      [activeTab.id]: `${current[activeTab.id] || ""}${input}\n`,
    }));
    setInput("");
  };

  return (
    <section
      aria-hidden={!isOpen}
      aria-label={t("terminal.aria.drawer")}
      className={`terminal-drawer ${isOpen ? "is-open" : ""} ${isDragging ? "is-resizing" : ""}`}
      style={{ height }}
    >
      <div
        aria-label={t("terminal.aria.resize")}
        className="terminal-drawer__resize-handle"
        onMouseDown={(event) => {
          dragStartRef.current = { height, y: event.clientY };
          setIsDragging(true);
        }}
        role="separator"
      />

      <div className="terminal-drawer__tabs">
        <div className="terminal-drawer__tab-strip" role="tablist">
          {tabs.map((tab) => {
            const tabIsActive = tab.id === activeTab?.id;
            const tabIsLoading = loadingIds.has(tab.id);
            const tabConnection = connectionByTab[tab.id] ?? "idle";

            return (
              <div className={`terminal-tab ${tabIsActive ? "is-active" : ""}`} key={tab.id}>
                <button
                  aria-selected={tabIsActive}
                  className="terminal-tab__select"
                  onClick={() => onActivateTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <span
                    className={`terminal-tab__status ${
                      tabIsLoading || tabConnection === "connecting"
                        ? "is-loading"
                        : tabConnection === "error"
                          ? "is-error"
                          : tabConnection === "connected"
                            ? "is-connected"
                            : ""
                    }`}
                  />
                  <span>{tab.title}</span>
                </button>
                <button
                  aria-label={`Close ${tab.title}`}
                  className="terminal-tab__close"
                  onClick={() => onCloseTab(tab.id)}
                  type="button"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          <button aria-label={t("terminal.aria.newTab")} className="terminal-tab-add" onClick={onNewTab} type="button">
            <Plus size={14} />
          </button>
        </div>
        <div className="terminal-drawer__tools">
          <button aria-label={t("terminal.aria.clear")} onClick={clearTerminal} type="button">
            <Trash2 size={14} />
          </button>
          <button aria-label={t("terminal.aria.reconnect")} onClick={reconnectTerminal} type="button">
            <RefreshCw size={14} />
          </button>
          <button aria-label={t("terminal.aria.minimize")} onClick={onMinimize} type="button">
            <Minus size={15} />
          </button>
        </div>
      </div>

      <div className="terminal-drawer__body">
        {isLoading || !activeTab ? (
          <div className="terminal-loading">
            <span className="terminal-loading__dot" />
            <span>Connecting to sandbox terminal...</span>
          </div>
        ) : !isReady ? (
          <div className="terminal-loading">
            <span className="terminal-loading__dot" />
            <span>Start a running sandbox to open the terminal.</span>
          </div>
        ) : (
          <>
            <div className="terminal-statusbar">
              <span>{activeTab.cwd}</span>
              <span>{terminalConnectionLabel[activeConnection]}</span>
            </div>
            <pre className="terminal-screen" aria-label={`${activeTab.title} output`} ref={terminalScreenRef}>
              <code>{terminalError ? `${terminalError}\n` : outputByTab[activeTab.id] || "$ "}</code>
            </pre>
            <form
              className="terminal-input"
              onSubmit={(event) => {
                event.preventDefault();
                sendTerminalInput();
              }}
            >
              <span>$</span>
              <input value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} />
            </form>
          </>
        )}
      </div>
    </section>
  );
}
