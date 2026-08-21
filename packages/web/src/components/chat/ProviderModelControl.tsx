import {
  BrainCircuit,
  Check,
  ChevronDown,
  LockKeyhole,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import type { ProviderProfile, ThinkingLevel } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import {
  restoreFocusAfterModalClose,
  type FocusScheduler,
} from "../settings/settingsFocusReturn";
import { trapFocusKeyDown } from "../settings/settingsModalStack";

type ProviderModelControlProps = {
  providers: ProviderProfile[];
  providerId?: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  reasoningSupported: boolean;
  isDraft: boolean;
  disabled?: boolean;
  onSelectModel: (providerId: string, modelId: string) => void | Promise<void>;
  onThinkingLevelChange: (level: ThinkingLevel) => void | Promise<void>;
  onManageProviders?: (trigger?: HTMLElement) => void;
};

const THINKING_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];

export function selectedModelSupportsReasoning(
  provider: Pick<ProviderProfile, "models" | "reasoningModels"> | undefined,
  modelId: string,
): boolean {
  if (!provider || !modelId) return false;
  return (provider.reasoningModels ?? provider.models).includes(modelId);
}

export function selectedModelStatus(
  provider: Pick<ProviderProfile, "healthStatus" | "modelHealth"> | null | undefined,
  modelId: string,
): ProviderProfile["healthStatus"] {
  const modelHealth = provider?.modelHealth.find((entry) => entry.model === modelId);
  return modelHealth?.status ?? provider?.healthStatus ?? "unknown";
}

export function focusProviderModelPopup(popup: HTMLElement): void {
  const target =
    popup.querySelector<HTMLElement>('.provider-model-option[aria-pressed="true"]:not([disabled])') ??
    popup.querySelector<HTMLElement>(".provider-model-option:not([disabled])") ??
    popup.querySelector<HTMLElement>('[aria-pressed="true"]:not([disabled])') ??
    popup.querySelector<HTMLElement>("button:not([disabled])") ??
    popup;
  target.focus();
}

export function restoreProviderModelFocus(
  target: HTMLElement | null,
  schedule?: FocusScheduler,
): void {
  restoreFocusAfterModalClose(target, schedule);
}

export function ProviderModelControl({
  providers,
  providerId,
  modelId,
  thinkingLevel,
  reasoningSupported,
  isDraft,
  disabled = false,
  onSelectModel,
  onThinkingLevelChange,
  onManageProviders,
}: ProviderModelControlProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const popupId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedProvider = useMemo(
    () => providerId
      ? providers.find((provider) => provider.id === providerId)
      : providers.find((provider) => provider.isActive),
    [providerId, providers],
  );
  const selectedStatus = selectedModelStatus(selectedProvider, modelId);
  const selectedProviderLabel = selectedProvider?.name ?? providerId;

  const updatePosition = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const padding = 12;
    const gap = 8;
    const width = Math.min(380, window.innerWidth - padding * 2);
    const left = Math.min(
      Math.max(padding, rect.right - width),
      Math.max(padding, window.innerWidth - width - padding),
    );
    const spaceAbove = rect.top - padding;
    const spaceBelow = window.innerHeight - rect.bottom - padding;
    const placeAbove = spaceAbove >= Math.min(420, Math.max(240, spaceBelow));
    setPopupStyle({
      left,
      width,
      maxHeight: Math.max(220, (placeAbove ? spaceAbove : spaceBelow) - gap),
      ...(placeAbove
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (popupRef.current) focusProviderModelPopup(popupRef.current);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      // The trigger is the stable opener. In Safari, focusing synchronously
      // while the portal is being removed is overwritten by WebKit's own
      // dialog teardown, so restore only after the close has painted.
      restoreProviderModelFocus(triggerRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (popupRef.current) trapFocusKeyDown(popupRef.current, event);
    };
    const reposition = () => updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, updatePosition]);

  const popup = open ? createPortal(
    <div
      aria-label={t("chat.modelControl.label")}
      className="provider-model-popover"
      id={popupId}
      ref={popupRef}
      role="dialog"
      style={popupStyle}
      tabIndex={-1}
    >
      <div className="provider-model-popover__header">
        <BrainCircuit aria-hidden="true" size={17} />
        <strong>{t("chat.modelControl.label")}</strong>
      </div>

      {!isDraft ? (
        <div className="provider-model-popover__locked">
          <LockKeyhole aria-hidden="true" size={14} />
          <span>
            <strong>{t("chat.modelControl.fixedTitle")}</strong>
            <small>{t("chat.modelControl.fixedHint")}</small>
          </span>
        </div>
      ) : null}

      <div className="provider-model-popover__providers">
        {providers.length === 0 ? (
          <p className="provider-model-popover__empty">{t("chat.modelControl.noProviders")}</p>
        ) : providers.map((provider) => (
          <section className="provider-model-group" key={provider.id}>
            <div className="provider-model-group__title">
              <span
                aria-hidden="true"
                className="provider-model-group__provider-dot"
                style={{ backgroundColor: provider.iconColor || "var(--color-text-subtle)" }}
              />
              <strong>{provider.name}</strong>
            </div>
            <div className="provider-model-group__models">
              {provider.models.map((model) => {
                const selected = provider.id === selectedProvider?.id && model === modelId;
                const supportsReasoning = selectedModelSupportsReasoning(provider, model);
                const health = provider.modelHealth.find((entry) => entry.model === model);
                const status = health?.status ?? provider.healthStatus ?? "unknown";
                return (
                  <button
                    aria-pressed={selected}
                    className={`provider-model-option ${selected ? "is-selected" : ""}`}
                    disabled={!isDraft || status === "unavailable"}
                    key={`${provider.id}:${model}`}
                    onClick={() => {
                      setOpen(false);
                      void onSelectModel(provider.id, model);
                    }}
                    title={health?.error || undefined}
                    type="button"
                  >
                    <span className={`model-status-dot model-status-dot--${status}`} />
                    <span className="provider-model-option__name">{model}</span>
                    {supportsReasoning ? (
                      <span className="provider-model-option__reasoning">
                        <Sparkles aria-hidden="true" size={12} />
                        {t("chat.modelControl.reasoningBadge")}
                      </span>
                    ) : null}
                    {selected ? <Check aria-hidden="true" size={15} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="provider-model-popover__reasoning">
        <div className="provider-model-popover__reasoning-title">
          <Sparkles aria-hidden="true" size={14} />
          <span>{t("chat.thinkingLevel")}</span>
        </div>
        {reasoningSupported ? (
          <div aria-label={t("chat.thinkingLevel")} className="thinking-level-segments" role="group">
            {THINKING_LEVELS.map((level) => (
              <button
                aria-pressed={thinkingLevel === level}
                className={thinkingLevel === level ? "is-selected" : ""}
                key={level}
                onClick={() => void onThinkingLevelChange(level)}
                type="button"
              >
                {t(`chat.thinkingLevel.${level}` as const)}
              </button>
            ))}
          </div>
        ) : (
          <p>{t("chat.modelControl.reasoningUnsupported")}</p>
        )}
      </div>

      {onManageProviders ? (
        <button
          className="provider-model-popover__manage"
          onClick={(event) => {
            setOpen(false);
            // The manage row lives inside this portal and unmounts immediately.
            // Return to the persistent model trigger after Settings closes.
            onManageProviders(triggerRef.current ?? event.currentTarget);
          }}
          type="button"
        >
          <Settings2 aria-hidden="true" size={15} />
          {providers.length === 0 ? t("chat.modelControl.addProvider") : t("chat.modelControl.manageProviders")}
        </button>
      ) : null}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`provider-model-control ${open ? "is-open" : ""}`} ref={rootRef}>
      <button
        aria-controls={open ? popupId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("chat.modelControl.label")}
        className="provider-model-control__trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        title={selectedProviderLabel
          ? [selectedProviderLabel, modelId].filter(Boolean).join(" · ")
          : t("chat.modelControl.select")}
        type="button"
      >
        <span className={`model-status-dot model-status-dot--${selectedStatus}`} />
        <span className={`provider-model-control__model ${modelId ? "" : "is-placeholder"}`}>
          {modelId || t("chat.modelControl.select")}
        </span>
        {reasoningSupported ? (
          <span className="provider-model-control__thinking">
            <Sparkles aria-hidden="true" size={11} />
            {t(`chat.thinkingLevel.${thinkingLevel}` as const)}
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {popup}
    </div>
  );
}
