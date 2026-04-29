import type { SessionId } from "@bud/sessions";
import { Button } from "@demo/components/ui/button";
import { Textarea } from "@demo/components/ui/textarea";
import {
  addDemoExchange,
  availableDemoModels,
  createDemoSession,
  DEMO_THINKING_LEVELS,
  deleteDemoSession,
  getDemoModelPreparationStatus,
  getDemoModelRuntimeStatus,
  getDemoSettings,
  loadDemoHostedProviderAvailability,
  listDemoSessions,
  loadDemoMessages,
  prepareDemoModel,
  refreshDemoModelPreparationStatus,
  resetDemoModelPreparation,
  saveDemoSettings,
  type DemoAttachment,
  type DemoAttachmentInput,
  type DemoActivity,
  type DemoActivityEvent,
  type DemoSettings,
  type DemoHostedProviderAvailability,
  type DemoTheme,
  type DemoMessage,
  type DemoModelOption,
  type DemoModelPreparationProgress,
  type DemoModelRuntimeStatus,
  type DemoSession,
} from "@demo/lib/demo-sessions";
import { cn } from "@demo/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Cpu,
  Download,
  FileAudio,
  FileIcon,
  FileText,
  ImageIcon,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  User,
  Video,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function canUseSelectedModel(
  settings: DemoSettings,
  localModelReady: boolean,
  modelOptions: readonly DemoModelOption[],
): boolean {
  if (settings.modelId.startsWith("web-llm/")) return localModelReady;
  return modelOptions.some((model) => model.id === settings.modelId);
}

function canUseModelOption(model: DemoModelOption): boolean {
  if (model.provider !== "local") return true;
  return getDemoModelPreparationStatus(model.id).ready;
}

function modelSupportsThinking(model?: DemoModelOption): boolean {
  return model?.supportsThinking ?? false;
}

function demoSettingsThinking(value: string): DemoSettings["thinkingLevel"] {
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "extra-high"
    ? value
    : null;
}

function thinkingLabel(level: DemoSettings["thinkingLevel"]): string {
  return level ? level.toUpperCase() : "DEFAULT";
}

function applyTheme(theme: DemoTheme): void {
  if (typeof window === "undefined") return;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldUseDark = theme === "dark" || (theme === "system" && systemDark);
  document.documentElement.classList.toggle("dark", shouldUseDark);
  document.documentElement.style.colorScheme = shouldUseDark ? "dark" : "light";
}

function ModelPreparationPanel({
  error,
  isClearing,
  isPreparing,
  modelId,
  onBack,
  onClear,
  onPrepare,
  progress,
  runtimeStatus,
  showClearCache,
}: {
  readonly error: string | null;
  readonly isClearing: boolean;
  readonly isPreparing: boolean;
  readonly modelId: string;
  readonly onBack: () => void;
  readonly onClear: () => void;
  readonly onPrepare: () => void;
  readonly progress: DemoModelPreparationProgress | null;
  readonly runtimeStatus: DemoModelRuntimeStatus;
  readonly showClearCache: boolean;
}) {
  const progressValue = progress?.progress ?? 0;
  const hasProgress = progress?.progress != null;
  const unsupportedMessage = runtimeUnsupportedMessage(runtimeStatus);
  const canPrepare = !unsupportedMessage;

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        {progress?.status === "Ready" ? (
          <CheckCircle2 className="size-6" />
        ) : (
          <Cpu className="size-6" />
        )}
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold leading-tight text-foreground">
          Download Local Model
        </h1>
        <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
          {modelId}
        </p>
      </div>

      {(isPreparing || hasProgress) && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width]",
              isPreparing && !hasProgress && "animate-pulse",
            )}
            style={{ width: `${hasProgress ? progressValue : 12}%` }}
          />
        </div>
      )}

      <div className="min-h-6 text-sm text-muted-foreground">
        {error ??
          progress?.status ??
          unsupportedMessage ??
          "Download the browser-local model to use Bud without a hosted provider."}
      </div>

      <div className="grid w-full grid-cols-3 gap-2 text-xs text-muted-foreground">
        <RuntimeBadge
          label="Isolation"
          value={runtimeStatus.crossOriginIsolated}
        />
        <RuntimeBadge label="Secure" value={runtimeStatus.secureContext} />
        <RuntimeBadge label="WebGPU" value={runtimeStatus.webGPU} />
      </div>

      <Button
        className="min-w-44 rounded-md"
        disabled={isPreparing || isClearing || !canPrepare}
        onClick={onPrepare}
        type="button"
      >
        {isPreparing ? (
          <RefreshCw className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        {isPreparing ? "Downloading" : error ? "Try again" : "Download model"}
      </Button>
      <Button
        className="rounded-md text-muted-foreground"
        disabled={isPreparing || isClearing}
        onClick={onBack}
        type="button"
        variant="ghost"
      >
        Back to chat
      </Button>
      {showClearCache && (
        <Button
          className="rounded-md text-muted-foreground"
          disabled={isPreparing || isClearing}
          onClick={onClear}
          type="button"
          variant="ghost"
        >
          {isClearing ? (
            <RefreshCw className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          {isClearing ? "Clearing cache" : "Clear cached model"}
        </Button>
      )}
    </section>
  );
}

function runtimeUnsupportedMessage(
  status: DemoModelRuntimeStatus,
): string | null {
  if (!status.browser) return "Bud needs a browser to prepare the local model.";
  if (!status.secureContext) {
    return "This browser context is not secure enough for WebLLM. Open Bud in Chrome or Chrome Canary at http://localhost:4322/.";
  }
  if (!status.crossOriginIsolated) {
    return "This browser context is not cross-origin isolated. The server headers are set, so try Chrome or Chrome Canary directly.";
  }
  if (!status.webGPU) {
    return "This browser does not expose WebGPU. Try Chrome or Chrome Canary with WebGPU enabled.";
  }
  return null;
}

function RuntimeBadge({
  label,
  value,
}: {
  readonly label: string;
  readonly value: boolean;
}) {
  return (
    <div className="rounded-md border border-border px-2 py-1">
      {label}: {value ? "yes" : "no"}
    </div>
  );
}

function ThinkingPicker({
  onChange,
  value,
}: {
  readonly onChange: (value: string) => void;
  readonly value: DemoSettings["thinkingLevel"];
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [isOpen]);

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        aria-expanded={isOpen}
        aria-label={`Thinking: ${thinkingLabel(value)}`}
        className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-semibold uppercase text-foreground shadow-sm transition-colors hover:bg-accent"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <Brain className="size-4 text-primary" />
        {thinkingLabel(value)}
      </button>
      {isOpen && (
        <div className="absolute bottom-10 left-0 z-40 w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl">
          {DEMO_THINKING_LEVELS.map((level) => {
            const optionValue = level ?? "default";
            const selected = value === level;
            return (
              <button
                className={cn(
                  "flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                  selected && "bg-accent",
                )}
                key={optionValue}
                onClick={() => {
                  onChange(optionValue);
                  setIsOpen(false);
                }}
                type="button"
              >
                <span className="flex-1 font-medium">
                  {thinkingLabel(level)}
                </span>
                {selected && <Check className="size-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModelPicker({
  localModelReady,
  models,
  onChange,
  onPrepareLocalModel,
  value,
}: {
  readonly localModelReady: boolean;
  readonly models: readonly DemoModelOption[];
  readonly onChange: (modelId: string) => void;
  readonly onPrepareLocalModel: (modelId: string) => void;
  readonly value: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = models.find((model) => model.id === value) ?? models[0];
  const [activeProvider, setActiveProvider] = useState<
    DemoModelOption["provider"]
  >(selected?.provider ?? "local");
  const providers = providerTabs(models);
  const activeModels = models.filter(
    (model) => model.provider === activeProvider,
  );

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [isOpen]);

  useEffect(() => {
    if (selected) setActiveProvider(selected.provider);
  }, [selected]);

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        aria-expanded={isOpen}
        aria-label="Model"
        className="flex h-9 max-w-72 items-center gap-2 rounded-md border border-input bg-background py-1 pl-1 pr-2 text-left text-sm text-foreground shadow-sm transition-colors hover:bg-accent"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <ModelProviderIcon provider={selected?.provider ?? "local"} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {selected?.label ?? "Select model"}
        </span>
      </button>
      {isOpen && (
        <div className="absolute bottom-11 right-0 z-40 flex h-64 w-[21rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex w-12 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-1">
            {providers.map((provider) => (
              <button
                aria-label={providerLabel(provider)}
                className={cn(
                  "flex size-10 items-center justify-center rounded-md transition-colors hover:bg-accent",
                  activeProvider === provider && "bg-accent shadow-sm",
                )}
                key={provider}
                onClick={() => setActiveProvider(provider)}
                type="button"
              >
                <ModelProviderIcon provider={provider} />
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-1">
            {activeModels.map((model) => {
              const needsPreparation =
                model.provider === "local" && !localModelReady;
              return (
                <div
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                    model.id === value && "bg-accent",
                    !needsPreparation && "hover:bg-accent",
                    needsPreparation && "text-muted-foreground",
                  )}
                  key={model.id}
                >
                  <button
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                    disabled={needsPreparation}
                    onClick={() => {
                      onChange(model.id);
                      setIsOpen(false);
                    }}
                    type="button"
                  >
                    <span className="block truncate font-medium">
                      {model.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {model.id}
                    </span>
                  </button>
                  {needsPreparation ? (
                    <button
                      className="shrink-0 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                      onClick={() => {
                        onPrepareLocalModel(model.id);
                        setIsOpen(false);
                      }}
                      type="button"
                    >
                      Prepare
                    </button>
                  ) : (
                    model.id === value && (
                      <Check className="size-4 text-primary" />
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function providerTabs(
  models: readonly DemoModelOption[],
): readonly DemoModelOption["provider"][] {
  const providers: DemoModelOption["provider"][] = [];
  for (const model of models) {
    if (!providers.includes(model.provider)) providers.push(model.provider);
  }
  return providers;
}

function providerLabel(provider: DemoModelOption["provider"]): string {
  switch (provider) {
    case "local":
      return "Local";
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "google":
      return "Google";
  }
}

function ThemeSwitcher({
  onChange,
  value,
}: {
  readonly onChange: (theme: DemoTheme) => void;
  readonly value: DemoTheme;
}) {
  const themes: readonly DemoTheme[] = ["light", "dark", "system"];

  return (
    <div className="mt-3 border-t border-border/70 px-2 pt-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Theme
      </div>
      <div className="grid grid-cols-3 rounded-md border border-border bg-background p-1">
        {themes.map((theme) => {
          const selected = theme === value;
          return (
            <button
              className={cn(
                "rounded px-2 py-1.5 text-xs font-medium capitalize text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                selected && "bg-accent text-accent-foreground shadow-sm",
              )}
              key={theme}
              onClick={() => onChange(theme)}
              type="button"
            >
              {theme}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelProviderIcon({
  provider,
}: {
  readonly provider: DemoModelOption["provider"];
}) {
  if (provider === "local") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
        <Cpu className="size-5" />
      </span>
    );
  }

  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-[15px] font-semibold text-accent-foreground">
      {provider === "anthropic" ? "A" : provider === "openai" ? "◎" : "G"}
    </span>
  );
}

function HomePage() {
  const [activeSessionId, setActiveSessionId] = useState<SessionId | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [demoSettings, setDemoSettings] = useState(() => getDemoSettings());
  const [hostedProviderAvailability, setHostedProviderAvailability] =
    useState<DemoHostedProviderAvailability | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHoverArmed, setIsSidebarHoverArmed] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearingModel, setIsClearingModel] = useState(false);
  const [isPreparingModel, setIsPreparingModel] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelPreparation, setModelPreparation] = useState(() =>
    getDemoModelPreparationStatus(),
  );
  const [modelRuntimeStatus, setModelRuntimeStatus] = useState(() =>
    getDemoModelRuntimeStatus(),
  );
  const [modelProgress, setModelProgress] =
    useState<DemoModelPreparationProgress | null>(null);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [openImageAttachment, setOpenImageAttachment] =
    useState<DemoAttachment | null>(null);
  const [sessions, setSessions] = useState<DemoSession[]>([]);
  const [sessionMenu, setSessionMenu] = useState<{
    readonly sessionId: SessionId;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const lastUsableModelRef = useRef<string | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;
  const hasAttachments = attachments.length > 0;
  const modelOptions = availableDemoModels(
    demoSettings,
    hostedProviderAvailability,
  );
  const selectedModel = modelOptions.find(
    (model) => model.id === demoSettings.modelId,
  );
  const selectedModelSupportsThinking = modelSupportsThinking(selectedModel);
  const canUseChat = canUseSelectedModel(
    demoSettings,
    modelPreparation.ready,
    modelOptions,
  );
  const canSend =
    (draft.trim().length > 0 || hasAttachments) &&
    !isLoading &&
    !isSending &&
    canUseChat;
  const isSidebarHoverSuppressed = isSidebarCollapsed && !isSidebarHoverArmed;

  useAutoResize(textareaRef, draft);

  useEffect(() => {
    if (canUseChat) {
      lastUsableModelRef.current = demoSettings.modelId;
    }
  }, [canUseChat, demoSettings.modelId]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialSession() {
      const hostedAvailabilityPromise = loadDemoHostedProviderAvailability();
      const storedSettings = getDemoSettings();
      const shouldWaitForHostedAvailability =
        !storedSettings.modelId.startsWith("web-llm/");
      const hostedAvailability = shouldWaitForHostedAvailability
        ? await hostedAvailabilityPromise
        : null;
      const availableModels = availableDemoModels(
        storedSettings,
        hostedAvailability,
      );
      const settings = availableModels.some(
        (model) => model.id === storedSettings.modelId,
      )
        ? storedSettings
        : saveDemoSettings({
            ...storedSettings,
            modelId: availableModels[0]?.id ?? storedSettings.modelId,
          });

      setDemoSettings(settings);
      setHostedProviderAvailability(hostedAvailability);
      setModelRuntimeStatus(getDemoModelRuntimeStatus());
      setIsLoading(true);
      const nextModelPreparation = getDemoModelPreparationStatus(
        settings.modelId,
      );
      const nextCanUseChat = canUseSelectedModel(
        settings,
        nextModelPreparation.ready,
        availableModels,
      );
      const nextSessions = nextCanUseChat ? await listDemoSessions() : [];
      const sessionId = nextCanUseChat
        ? (nextSessions[0]?.sessionId ?? null)
        : null;
      const nextMessages =
        sessionId && nextCanUseChat ? await loadDemoMessages(sessionId) : [];

      if (cancelled) return;
      setModelPreparation(nextModelPreparation);
      setActiveSessionId(sessionId);
      setMessages(nextMessages);
      setSessions(nextSessions);
      setIsLoading(false);

      void hostedAvailabilityPromise.then((nextAvailability) => {
        if (!cancelled) setHostedProviderAvailability(nextAvailability);
      });
      void refreshDemoModelPreparationStatus(settings.modelId).then(
        (refreshed) => {
          if (!cancelled) setModelPreparation(refreshed);
        },
      );
    }

    void loadInitialSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyTheme(demoSettings.theme);
    if (demoSettings.theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [demoSettings.theme]);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !hasMessages) return;

    if (stickToLatestRef.current) {
      scrollToLatest(scrollElement, "instant");
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [hasMessages, messages.length]);

  useEffect(() => {
    if (!sessionMenu) return;

    const closeMenu = () => setSessionMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenu);
    };
  }, [sessionMenu]);

  useEffect(() => {
    if (!openImageAttachment) return;

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenImageAttachment(null);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openImageAttachment]);

  useEffect(() => {
    if (!isSidebarHoverSuppressed) return;

    const rearmHover = (event: PointerEvent) => {
      if (event.clientX > 40) {
        setIsSidebarHoverArmed(true);
      }
    };

    window.addEventListener("pointermove", rearmHover);
    return () => {
      window.removeEventListener("pointermove", rearmHover);
    };
  }, [isSidebarHoverSuppressed]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (
      (!content && !hasAttachments) ||
      isLoading ||
      isSending ||
      !canUseChat
    ) {
      return;
    }
    const submittedAttachments = attachments;
    const attachmentInputs: DemoAttachmentInput[] = submittedAttachments.map(
      (attachment) => ({ file: attachment.file }),
    );

    const scrollElement = scrollRef.current;
    stickToLatestRef.current =
      !scrollElement || !hasMessages || isScrolledToLatest(scrollElement);

    setDraft("");
    setAttachments([]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    setIsSending(true);

    void (async () => {
      const hadActiveSession = activeSessionId != null;
      const sessionId = activeSessionId ?? (await createDemoSession());
      const timestamp = new Date().toISOString();
      const submittedSettings = demoSettings;
      const submittedModel = modelOptions.find(
        (model) => model.id === submittedSettings.modelId,
      );
      const submittedThinkingLevel = modelSupportsThinking(submittedModel)
        ? submittedSettings.thinkingLevel
        : null;
      const userMessage: DemoMessage = {
        id: `${sessionId}-pending-user-${globalThis.crypto.randomUUID()}`,
        role: "user",
        content,
        timestamp,
        attachments: submittedAttachments,
      };
      const assistantMessageId = `${sessionId}-pending-assistant-${globalThis.crypto.randomUUID()}`;
      const assistantMessage: DemoMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp,
        modelId: submittedSettings.modelId,
        thinkingLevel: submittedThinkingLevel,
        isComplete: false,
        isPending: true,
        activities: [],
      };

      setActiveSessionId(sessionId);
      setMessages((current) => [...current, userMessage, assistantMessage]);
      if (!hadActiveSession) {
        void listDemoSessions().then(setSessions);
      }

      let assistantText = "";
      const updateAssistantActivities = (
        transform: (
          activities: readonly DemoActivity[],
        ) => readonly DemoActivity[],
        patch: Partial<DemoMessage> = {},
      ) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  isPending: false,
                  ...patch,
                  activities: transform(message.activities ?? []),
                }
              : message,
          ),
        );
      };
      const updateAssistantActivity = (event: DemoActivityEvent) => {
        const position =
          assistantText.length > 0 ? "after_text" : "before_text";
        const eventWithPosition =
          event.type === "thought" || event.type === "tool_call"
            ? ({ ...event, position } satisfies DemoActivityEvent)
            : event;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  isPending: false,
                  activities: applyActivityEvent(
                    message.activities ?? [],
                    eventWithPosition,
                  ),
                }
              : message,
          ),
        );
      };

      const nextMessages = await addDemoExchange(
        sessionId,
        content,
        attachmentInputs,
        {
          modelId: submittedSettings.modelId,
          thinkingLevel: submittedThinkingLevel,
          onAssistantDelta: (delta) => {
            assistantText += delta;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      isPending: false,
                      content: assistantText,
                      activities: completeActiveThinkingActivities(
                        message.activities ?? [],
                      ),
                    }
                  : message,
              ),
            );
          },
          onActivity: updateAssistantActivity,
          onStatus: () => {
            // Detailed activity is rendered above the assistant text.
          },
          onDone: () =>
            updateAssistantActivities(completeActiveThinkingActivities, {
              isComplete: true,
            }),
          onError: (error) =>
            updateAssistantActivities(failActiveActivities, {
              isComplete: true,
              isPending: false,
              content: error.message,
              isError: true,
            }),
        },
      ).catch((error: unknown) => {
        updateAssistantActivities(failActiveActivities, {
          isComplete: true,
          isPending: false,
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        });
        return null;
      });
      const nextSessions = await listDemoSessions();
      if (nextMessages) {
        setMessages(
          mergeLatestUserAttachments(nextMessages, submittedAttachments),
        );
      }
      setSessions(nextSessions);
    })().finally(() => setIsSending(false));
  }

  function handlePrepareModel() {
    if (isPreparingModel || isClearingModel) return;

    setIsPreparingModel(true);
    setModelError(null);
    setModelRuntimeStatus(getDemoModelRuntimeStatus());
    setModelProgress({ status: "Preparing local model", progress: null });

    void prepareDemoModel(demoSettings.modelId, setModelProgress)
      .then((status) => {
        setModelPreparation(status);
        setModelProgress({ status: "Ready", progress: 100 });
      })
      .catch((error: unknown) => {
        setModelRuntimeStatus(getDemoModelRuntimeStatus());
        setModelError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setIsPreparingModel(false));
  }

  function handleClearModelCache() {
    if (isPreparingModel || isClearingModel) return;
    if (!window.confirm("Clear Bud's cached local model from this browser?")) {
      return;
    }

    setIsClearingModel(true);
    setModelError(null);
    setModelRuntimeStatus(getDemoModelRuntimeStatus());

    void resetDemoModelPreparation(demoSettings.modelId)
      .then((status) => {
        setModelError(null);
        setModelPreparation(status);
        setModelProgress(null);
      })
      .catch((error: unknown) => {
        setModelError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setIsClearingModel(false));
  }

  function handleBackFromPrepare() {
    const fallback =
      modelOptions.find(
        (model) =>
          model.id === lastUsableModelRef.current && canUseModelOption(model),
      ) ?? modelOptions.find(canUseModelOption);
    if (!fallback) {
      setModelError("Download a local model before returning to chat.");
      return;
    }

    const saved = saveDemoSettings({
      ...demoSettings,
      modelId: fallback.id,
    });
    setDemoSettings(saved);
    setModelError(null);
    setModelProgress(null);
    setModelPreparation(getDemoModelPreparationStatus(fallback.id));

    if (fallback.provider === "local") {
      void refreshDemoModelPreparationStatus(fallback.id).then(
        setModelPreparation,
      );
    }
  }

  function handleModelChange(modelId: string) {
    const nextModel = modelOptions.find((model) => model.id === modelId);
    const saved = saveDemoSettings({
      ...demoSettings,
      modelId,
      thinkingLevel: modelSupportsThinking(nextModel)
        ? demoSettings.thinkingLevel
        : null,
    });
    setDemoSettings(saved);
    setModelError(null);
    setModelProgress(null);
    if (modelId.startsWith("web-llm/")) {
      void refreshDemoModelPreparationStatus(modelId).then(setModelPreparation);
    }
  }

  function handleThinkingChange(value: string) {
    const thinkingLevel =
      value === "default" ? null : demoSettingsThinking(value);
    const saved = saveDemoSettings({ ...demoSettings, thinkingLevel });
    setDemoSettings(saved);
  }

  function handleThemeChange(theme: DemoTheme) {
    const saved = saveDemoSettings({ ...demoSettings, theme });
    setDemoSettings(saved);
    applyTheme(theme);
  }

  function handleAttachmentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    const nextAttachments = files.map((file) => {
      const url = shouldPreviewFile(file)
        ? URL.createObjectURL(file)
        : undefined;
      if (url) objectUrlsRef.current.add(url);
      return pendingAttachmentFromFile(file, url);
    });
    setAttachments((current) => [...current, ...nextAttachments]);
    event.target.value = "";
  }

  function handleRemoveAttachment(attachmentId: string) {
    setAttachments((current) => {
      const attachment = current.find((item) => item.id === attachmentId);
      if (attachment?.url) {
        URL.revokeObjectURL(attachment.url);
        objectUrlsRef.current.delete(attachment.url);
      }
      return current.filter((item) => item.id !== attachmentId);
    });
  }

  function handleScroll() {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const isAtLatest = isScrolledToLatest(scrollElement);
    stickToLatestRef.current = isAtLatest;
    setShowJumpToLatest(!isAtLatest);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function handleJumpToLatest() {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    stickToLatestRef.current = true;
    setShowJumpToLatest(false);
    scrollToLatest(scrollElement, "smooth");
  }

  function handleNewSession() {
    setDraft("");
    setIsLoading(true);

    void createDemoSession().then(async (sessionId) => {
      const nextSessions = await listDemoSessions();
      setActiveSessionId(sessionId);
      setMessages([]);
      setSessions(nextSessions);
      stickToLatestRef.current = true;
      setShowJumpToLatest(false);
      setIsLoading(false);
    });
  }

  function handleToggleSidebar(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;

    if (isSidebarCollapsed) {
      setIsSidebarHoverArmed(true);
      setIsSidebarCollapsed(false);
      return;
    }

    setIsSidebarHoverArmed(false);
    setIsSidebarCollapsed(true);
    button.blur();
  }

  function handleSelectSession(sessionId: SessionId) {
    if (sessionId === activeSessionId) return;

    setDraft("");
    setIsLoading(true);

    void loadDemoMessages(sessionId).then((nextMessages) => {
      setActiveSessionId(sessionId);
      setMessages(nextMessages);
      stickToLatestRef.current = true;
      setShowJumpToLatest(false);
      setIsLoading(false);
    });
  }

  function handleSessionContextMenu(
    event: React.MouseEvent,
    sessionId: SessionId,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setSessionMenu({
      sessionId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function handleOpenSessionMenu(
    event: React.MouseEvent,
    sessionId: SessionId,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget.getBoundingClientRect();
    setSessionMenu({
      sessionId,
      x: target.right - 8,
      y: target.bottom + 6,
    });
  }

  function handleDeleteSession(sessionId: SessionId) {
    setSessionMenu(null);
    setIsLoading(true);

    void deleteDemoSession(sessionId).then(async () => {
      const nextSessions = await listDemoSessions();
      const nextActiveSession =
        sessionId === activeSessionId
          ? (nextSessions[0]?.sessionId ?? null)
          : activeSessionId;
      const nextMessages = nextActiveSession
        ? await loadDemoMessages(nextActiveSession)
        : [];

      setActiveSessionId(nextActiveSession);
      setMessages(nextMessages);
      setSessions(nextSessions);
      stickToLatestRef.current = true;
      setShowJumpToLatest(false);
      setIsLoading(false);
    });
  }

  if (isLoading) {
    return (
      <main className="flex h-screen min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="size-6 animate-spin text-primary" />
          <div className="text-sm font-medium">Loading Bud</div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen min-h-screen overflow-hidden bg-background text-foreground">
      {canUseChat && (
        <div
          className={cn(
            "group/sidebar fixed inset-y-0 left-0 z-40 w-8 focus-within:w-72",
            isSidebarHoverArmed && "hover:w-72",
            !isSidebarCollapsed && "md:w-72",
          )}
          onMouseEnter={() => {
            if (isSidebarCollapsed) {
              setIsSidebarHoverArmed(true);
            }
          }}
          onMouseLeave={() => setIsSidebarHoverArmed(true)}
        >
          <aside
            className={cn(
              "flex h-full w-72 -translate-x-full flex-col border-r border-border bg-accent/95 p-3 shadow-xl backdrop-blur transition-transform duration-150 group-focus-within/sidebar:translate-x-0 dark:bg-card/95",
              isSidebarHoverArmed &&
                "group-hover/sidebar:translate-x-0 group-hover/sidebar:delay-150",
              !isSidebarCollapsed && "md:translate-x-0 md:shadow-none",
              isSidebarHoverSuppressed && "!-translate-x-full",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2 px-2">
              <div className="font-display text-sm font-semibold text-accent-foreground">
                Bud
              </div>
              <div className="flex gap-1">
                <Button
                  aria-label={
                    isSidebarCollapsed ? "Pin sidebar open" : "Collapse sidebar"
                  }
                  className="rounded-md"
                  onClick={handleToggleSidebar}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  {isSidebarCollapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                </Button>
                <Button
                  aria-label="New session"
                  className="rounded-md"
                  onClick={handleNewSession}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>

            <nav
              aria-label="Sessions"
              className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2"
            >
              {sessions.length === 0 && !isLoading ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  No sessions
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    className={cn(
                      "group/session flex w-full items-center gap-1 rounded-md transition-colors",
                      session.sessionId === activeSessionId
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                    )}
                    key={session.sessionId}
                    onContextMenu={(event) =>
                      handleSessionContextMenu(event, session.sessionId)
                    }
                    title={`${session.title}\nRight-click to delete`}
                  >
                    <button
                      aria-label={session.title}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-3 py-2 text-left text-sm"
                      onClick={() => handleSelectSession(session.sessionId)}
                      type="button"
                    >
                      <MessageSquare className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {session.title}
                      </span>
                    </button>
                    <button
                      aria-label={`Session menu: ${session.title}`}
                      className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-accent group-hover/session:opacity-100 group-focus-within/session:opacity-100"
                      onClick={(event) =>
                        handleOpenSessionMenu(event, session.sessionId)
                      }
                      type="button"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </div>
                ))
              )}
            </nav>
            <ThemeSwitcher
              onChange={handleThemeChange}
              value={demoSettings.theme}
            />
          </aside>
        </div>
      )}

      {canUseChat && sessionMenu && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          onClick={(event) => event.stopPropagation()}
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-accent"
            onClick={() => handleDeleteSession(sessionMenu.sessionId)}
            type="button"
          >
            <Trash2 className="size-4" />
            Delete session
          </button>
        </div>
      )}

      <section
        className={cn(
          "relative flex h-full min-w-0 flex-1 flex-col overflow-hidden transition-[margin-left] duration-150",
          canUseChat && !isSidebarCollapsed && "md:ml-72",
          hasMessages && canUseChat ? "justify-end" : "justify-center",
        )}
      >
        {canUseChat && (
          <section
            aria-label="Chat messages"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              hasMessages ? "block" : "hidden",
            )}
            onScroll={handleScroll}
            ref={scrollRef}
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-8">
              {messages.map((message) => (
                <MessageArticle
                  key={message.id}
                  message={message}
                  onOpenImage={setOpenImageAttachment}
                />
              ))}
            </div>
          </section>
        )}

        {!canUseChat ? (
          <ModelPreparationPanel
            error={modelError}
            isClearing={isClearingModel}
            isPreparing={isPreparingModel}
            modelId={modelPreparation.modelId}
            onBack={handleBackFromPrepare}
            onClear={handleClearModelCache}
            onPrepare={handlePrepareModel}
            progress={modelProgress}
            runtimeStatus={modelRuntimeStatus}
            showClearCache={modelPreparation.cached === true}
          />
        ) : !hasMessages ? (
          <div className="mx-auto w-full max-w-3xl px-3 text-center">
            <div className="mb-5 text-sm font-medium text-muted-foreground">
              {isLoading ? "Loading session..." : "What should Bud help with?"}
            </div>
          </div>
        ) : null}

        {canUseChat && hasMessages && showJumpToLatest && (
          <Button
            className={cn(
              "fixed bottom-28 left-1/2 z-20 h-9 -translate-x-1/2 rounded-md border border-input bg-background px-3 text-foreground shadow-lg hover:bg-accent",
              !isSidebarCollapsed && "md:left-[calc(50%+9rem)]",
            )}
            onClick={handleJumpToLatest}
            type="button"
            variant="outline"
          >
            <ArrowDown className="size-4" />
            Jump to latest
          </Button>
        )}

        {canUseChat && (
          <div
            className={cn(
              "w-full px-3",
              hasMessages
                ? cn(
                    "fixed bottom-0 bg-gradient-to-t from-background via-background to-background/0 pb-4 pt-10",
                    isSidebarCollapsed
                      ? "inset-x-0"
                      : "inset-x-0 md:left-72 md:w-[calc(100%-18rem)]",
                  )
                : "-translate-y-[8vh]",
            )}
          >
            <form
              className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-md border border-input bg-background p-2 shadow-[0_8px_32px_rgb(0_0_0/0.08)] transition-colors focus-within:border-ring dark:bg-card dark:shadow-[0_16px_48px_rgb(0_0_0/0.35)]"
              onSubmit={handleSubmit}
              ref={formRef}
            >
              <label className="sr-only" htmlFor="chat-composer">
                Message
              </label>
              <div>
                <input
                  accept="image/*,audio/*,video/*,application/pdf,text/plain,application/json,text/html,text/css,text/xml,text/rtf,.js,.mjs,.py"
                  className="sr-only"
                  multiple
                  onChange={handleAttachmentChange}
                  ref={attachmentInputRef}
                  type="file"
                />
                <Textarea
                  className="max-h-48 !min-h-6 w-full resize-none border-0 bg-transparent p-0 text-[16px] leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-[15px]"
                  disabled={
                    isLoading ||
                    !canUseSelectedModel(
                      demoSettings,
                      modelPreparation.ready,
                      modelOptions,
                    )
                  }
                  id="chat-composer"
                  onChange={(event) => {
                    resizeTextarea(event.currentTarget);
                    setDraft(event.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Message Bud"
                  ref={textareaRef}
                  rows={1}
                  value={draft}
                />
              </div>
              {attachments.length > 0 && (
                <AttachmentList
                  attachments={attachments}
                  onOpenImage={setOpenImageAttachment}
                  onRemove={handleRemoveAttachment}
                />
              )}
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Attach files"
                  className="shrink-0 rounded-md"
                  disabled={
                    isLoading ||
                    isSending ||
                    !canUseSelectedModel(
                      demoSettings,
                      modelPreparation.ready,
                      modelOptions,
                    )
                  }
                  onClick={() => attachmentInputRef.current?.click()}
                  size="icon-sm"
                  type="button"
                  variant="outline"
                >
                  <Paperclip className="size-4" />
                </Button>
                <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
                  <ModelPicker
                    localModelReady={modelPreparation.ready}
                    models={modelOptions}
                    onChange={handleModelChange}
                    onPrepareLocalModel={handleModelChange}
                    value={demoSettings.modelId}
                  />
                  {selectedModelSupportsThinking && (
                    <ThinkingPicker
                      onChange={handleThinkingChange}
                      value={demoSettings.thinkingLevel}
                    />
                  )}
                  <Button
                    aria-label="Send message"
                    className="shrink-0 rounded-md"
                    disabled={!canSend}
                    size="icon-sm"
                    type="submit"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                </div>
              </div>
            </form>
          </div>
        )}
      </section>
      {openImageAttachment?.url && (
        <ImageOverlay
          attachment={openImageAttachment}
          onClose={() => setOpenImageAttachment(null)}
        />
      )}
    </main>
  );
}

interface PendingAttachment extends DemoAttachment {
  readonly file: File;
}

function MessageArticle({
  message,
  onOpenImage,
}: {
  readonly message: DemoMessage;
  readonly onOpenImage: (attachment: DemoAttachment) => void;
}) {
  const imageAttachments =
    message.attachments?.filter(
      (attachment) => attachment.kind === "image" && attachment.url,
    ) ?? [];
  const otherAttachments =
    message.attachments?.filter(
      (attachment) => attachment.kind !== "image" || !attachment.url,
    ) ?? [];

  return (
    <article
      className={cn(
        "flex items-start gap-3",
        message.role === "user"
          ? "flex-row-reverse justify-start"
          : "justify-start",
      )}
    >
      <MessageAvatar role={message.role} />
      <div
        className={cn(
          "flex max-w-[min(72ch,calc(100%-3rem))] flex-col gap-2 text-[15px] leading-7",
          message.role === "user" ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "flex items-baseline gap-2 leading-none",
            message.role === "user" && "justify-end",
          )}
        >
          <span className="font-display text-sm font-semibold text-foreground">
            {message.role === "user" ? "You" : "Bud"}
          </span>
          <time
            className="text-sm text-muted-foreground"
            dateTime={message.timestamp}
          >
            {formatMessageTimestamp(message.timestamp)}
          </time>
        </div>
        {imageAttachments.length > 0 && (
          <AttachmentList
            attachments={imageAttachments}
            onOpenImage={onOpenImage}
          />
        )}
        {message.role === "assistant" &&
          (message.activities?.some(
            (activity) => activity.position !== "after_text",
          ) ??
            false) && (
            <ActivityList
              activities={(message.activities ?? []).filter(
                (activity) => activity.position !== "after_text",
              )}
              hasAssistantText={message.content.length > 0}
            />
          )}
        {message.role === "assistant" &&
          message.isPending &&
          !message.content &&
          (message.activities?.length ?? 0) === 0 && <TypingIndicator />}
        {message.role === "assistant" && message.isError && message.content ? (
          <div className="flex max-w-xl items-start gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm leading-6 text-destructive shadow-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">Request failed</div>
              <div className="whitespace-pre-wrap break-words text-destructive/85">
                {message.content}
              </div>
            </div>
          </div>
        ) : (
          (otherAttachments.length > 0 || message.content) && (
            <div
              className={cn(
                "flex flex-col gap-2 break-words",
                message.role === "user"
                  ? "whitespace-pre-wrap rounded-md bg-secondary px-5 py-2.5 text-secondary-foreground"
                  : "px-1 text-foreground",
              )}
            >
              {otherAttachments.length > 0 && (
                <AttachmentList
                  attachments={otherAttachments}
                  onOpenImage={onOpenImage}
                />
              )}
              {message.role === "assistant" ? (
                <MarkdownContent value={message.content} />
              ) : (
                message.content
              )}
            </div>
          )
        )}
        {message.role === "assistant" &&
          (message.activities?.some(
            (activity) => activity.position === "after_text",
          ) ??
            false) && (
            <ActivityList
              activities={(message.activities ?? []).filter(
                (activity) => activity.position === "after_text",
              )}
              hasAssistantText={message.content.length > 0}
            />
          )}
        {message.role === "assistant" &&
          message.modelId &&
          message.isComplete && (
            <div className="px-1 text-[11px] font-medium tracking-normal text-muted-foreground/70">
              {message.modelId.toLowerCase()}
              <span className="mx-1.5 text-muted-foreground/50">•</span>
              {thinkingLabel(message.thinkingLevel ?? null).toUpperCase()}
            </div>
          )}
      </div>
    </article>
  );
}

function TypingIndicator() {
  return (
    <div
      aria-label="Bud is typing"
      className="flex w-fit items-center gap-1 rounded-md bg-muted px-3 py-2"
      role="status"
    >
      <TypingDot delay="0ms" />
      <TypingDot delay="150ms" />
      <TypingDot delay="300ms" />
    </div>
  );
}

function TypingDot({ delay }: { readonly delay: string }) {
  return (
    <span
      className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
      style={{ animationDelay: delay }}
    />
  );
}

function MarkdownContent({ value }: { readonly value: string }) {
  const blocks = splitMarkdownBlocks(value);

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <CodeBlock
            code={block.content}
            key={`${block.type}-${index}`}
            language={block.language}
          />
        ) : (
          <MarkdownTextBlock
            key={`${block.type}-${index}`}
            value={block.content}
          />
        ),
      )}
    </div>
  );
}

type MarkdownBlock =
  | { readonly type: "text"; readonly content: string }
  | {
      readonly type: "code";
      readonly content: string;
      readonly language: string;
    };

function splitMarkdownBlocks(value: string): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const pattern = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const before = value.slice(lastIndex, match.index);
    if (before.trim()) blocks.push({ type: "text", content: before });
    blocks.push({
      type: "code",
      language: match[1] ?? "",
      content: (match[2] ?? "").replace(/\n$/, ""),
    });
    lastIndex = pattern.lastIndex;
  }

  const tail = value.slice(lastIndex);
  if (tail.trim()) blocks.push({ type: "text", content: tail });
  return blocks.length > 0 ? blocks : [{ type: "text", content: value }];
}

function MarkdownTextBlock({ value }: { readonly value: string }) {
  const lines = value.trim().split(/\n/);
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul className="ml-5 list-disc space-y-1" key={`list-${nodes.length}`}>
        {items.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      listItems.push(listMatch[1] ?? "");
      continue;
    }

    flushList();
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      nodes.push(
        <Tag
          className="font-display text-base font-semibold leading-7 text-foreground"
          key={`heading-${nodes.length}`}
        >
          {renderInlineMarkdown(heading[2] ?? "")}
        </Tag>,
      );
    } else {
      nodes.push(
        <p className="leading-7" key={`paragraph-${nodes.length}`}>
          {renderInlineMarkdown(trimmed)}
        </p>,
      );
    }
  }
  flushList();

  return <>{nodes}</>;
}

function CodeBlock({
  code,
  language,
}: {
  readonly code: string;
  readonly language: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/50">
      {language && (
        <div className="border-b border-border px-3 py-1 text-[11px] font-medium uppercase text-muted-foreground">
          {language}
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-xs leading-5 text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInlineMarkdown(value: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex)
      nodes.push(value.slice(lastIndex, match.index));
    const token = match[0] ?? "";
    if (token.startsWith("**")) {
      nodes.push(
        <strong className="font-semibold" key={`${token}-${match.index}`}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
          key={`${token}-${match.index}`}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      nodes.push(
        <a
          className="font-medium text-primary underline-offset-4 hover:underline"
          href={link?.[2] ?? "#"}
          key={`${token}-${match.index}`}
          rel="noreferrer"
          target="_blank"
        >
          {link?.[1] ?? token}
        </a>,
      );
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function ActivityList({
  activities,
  hasAssistantText,
}: {
  readonly activities: readonly DemoActivity[];
  readonly hasAssistantText: boolean;
}) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-1.5">
      {activities.map((activity) => (
        <ActivityItem
          activity={activity}
          defaultOpen={!hasAssistantText && activity.status === "active"}
          key={activity.id}
        />
      ))}
    </div>
  );
}

function ActivityItem({
  activity,
  defaultOpen,
}: {
  readonly activity: DemoActivity;
  readonly defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const Icon = activity.type === "thinking" ? Brain : Wrench;
  const statusLabel =
    activity.status === "active"
      ? "Running"
      : activity.status === "error"
        ? "Failed"
        : "Done";
  const detail =
    activity.type === "thinking"
      ? activity.content.trim()
      : formatActivityPayload({
          input: activity.input,
          output: activity.output,
        });
  const hasDetail = detail.length > 0;

  useEffect(() => {
    if (!defaultOpen) setIsOpen(false);
  }, [defaultOpen]);

  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-muted/35 text-sm">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-muted/60"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {isOpen ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
        <Icon
          className={cn(
            "size-4 shrink-0",
            activity.status === "active" && "animate-pulse text-primary",
            activity.status === "error" && "text-destructive",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {activity.title}
        </span>
        <span className="shrink-0 text-xs">{statusLabel}</span>
      </button>
      {isOpen && hasDetail && (
        <pre className="max-h-56 overflow-auto border-t border-border/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  );
}

function AttachmentList({
  attachments,
  onOpenImage,
  onRemove,
}: {
  readonly attachments: readonly DemoAttachment[];
  readonly onOpenImage?: (attachment: DemoAttachment) => void;
  readonly onRemove?: (attachmentId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const shouldRenderImageOnly =
          attachment.kind === "image" && attachment.url && !onRemove;

        if (shouldRenderImageOnly) {
          return (
            <button
              aria-label={`Open ${attachment.name}`}
              className="block max-w-64 overflow-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              key={attachment.id}
              onClick={() => onOpenImage?.(attachment)}
              type="button"
            >
              <img
                alt=""
                className="max-h-40 max-w-64 object-contain"
                src={attachment.url}
              />
            </button>
          );
        }

        return (
          <div
            className="group/attachment flex max-w-64 items-center gap-2 rounded-md border border-border/70 bg-background/80 p-1.5 text-foreground shadow-sm"
            key={attachment.id}
          >
            <AttachmentPreview
              attachment={attachment}
              onOpenImage={onOpenImage}
            />
            <div className="min-w-0 flex-1 pr-1">
              <div className="truncate text-xs font-medium leading-4">
                {attachment.name}
              </div>
              <div className="truncate text-[11px] leading-4 text-muted-foreground">
                {attachmentLabel(attachment)}
              </div>
            </div>
            {onRemove && (
              <button
                aria-label={`Remove ${attachment.name}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground group-hover/attachment:opacity-100"
                onClick={() => onRemove(attachment.id)}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AttachmentPreview({
  attachment,
  onOpenImage,
}: {
  readonly attachment: DemoAttachment;
  readonly onOpenImage?: (attachment: DemoAttachment) => void;
}) {
  if (attachment.kind === "image" && attachment.url) {
    return (
      <button
        aria-label={`Open ${attachment.name}`}
        className="size-10 overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => onOpenImage?.(attachment)}
        type="button"
      >
        <img alt="" className="size-full object-cover" src={attachment.url} />
      </button>
    );
  }

  if (attachment.kind === "video" && attachment.url) {
    return (
      <video
        className="size-10 rounded-md object-cover"
        muted
        src={attachment.url}
      />
    );
  }

  const Icon = attachmentIcon(attachment.kind);
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </div>
  );
}

function ImageOverlay({
  attachment,
  onClose,
}: {
  readonly attachment: DemoAttachment;
  readonly onClose: () => void;
}) {
  if (!attachment.url) return null;

  return (
    <div
      aria-label={attachment.name}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
    >
      <button
        aria-label="Close image"
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-lg transition-colors hover:bg-accent"
        onClick={onClose}
        type="button"
      >
        <X className="size-4" />
      </button>
      <img
        alt={attachment.name}
        className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        src={attachment.url}
      />
    </div>
  );
}

function MessageAvatar({ role }: { role: DemoMessage["role"] }) {
  if (role === "assistant") {
    return (
      <div
        aria-label="Bud avatar"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm"
      >
        B
      </div>
    );
  }

  return (
    <div
      aria-label="User avatar"
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
    >
      <User className="size-4" />
    </div>
  );
}

function pendingAttachmentFromFile(
  file: File,
  url: string | undefined,
): PendingAttachment {
  return {
    id: `attachment-${globalThis.crypto.randomUUID()}`,
    file,
    name: file.name,
    kind: attachmentKindFromMimeType(file.type),
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    url,
  };
}

function mergeLatestUserAttachments(
  messages: readonly DemoMessage[],
  attachments: readonly PendingAttachment[],
): DemoMessage[] {
  if (attachments.length === 0) return [...messages];

  const nextMessages = [...messages];
  for (let index = nextMessages.length - 1; index >= 0; index--) {
    const message = nextMessages[index]!;
    if (message.role !== "user") continue;
    nextMessages[index] = {
      ...message,
      attachments: mergeAttachments(message.attachments ?? [], attachments),
    };
    break;
  }
  return nextMessages;
}

function mergeAttachments(
  persistedAttachments: readonly DemoAttachment[],
  submittedAttachments: readonly PendingAttachment[],
): readonly DemoAttachment[] {
  if (submittedAttachments.length > 0) return submittedAttachments;
  return persistedAttachments;
}

function applyActivityEvent(
  activities: readonly DemoActivity[],
  event: DemoActivityEvent,
): readonly DemoActivity[] {
  switch (event.type) {
    case "thought": {
      const position = event.position ?? "before_text";
      const existing = activities.find(
        (activity) =>
          activity.type === "thinking" &&
          (activity.position ?? "before_text") === position,
      );
      if (!existing) {
        return [
          ...activities,
          {
            id: `thinking-${globalThis.crypto.randomUUID()}`,
            type: "thinking",
            status: "active",
            title: "Thinking",
            content: event.delta,
            position,
          },
        ];
      }

      return activities.map((activity) =>
        activity.id === existing.id && activity.type === "thinking"
          ? {
              ...activity,
              status: "active",
              content: `${activity.content}${event.delta}`,
            }
          : activity,
      );
    }

    case "tool_call": {
      const title = activityTitle(event.name);
      const withoutDuplicate = activities.filter(
        (activity) => activity.id !== event.id,
      );
      return [
        ...completeActiveThinkingActivities(withoutDuplicate),
        {
          id: event.id,
          type: "tool",
          status: "active",
          title,
          position: event.position ?? "before_text",
          input: event.args,
        },
      ];
    }

    case "tool_result":
      return activities.map((activity) =>
        activity.id === event.id && activity.type === "tool"
          ? {
              ...activity,
              status: event.ok ? "done" : "error",
              output: event.output,
            }
          : activity,
      );
  }
}

function activityTitle(name: string): string {
  if (name === "computer") return "Computer";
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function completeActiveThinkingActivities(
  activities: readonly DemoActivity[],
): readonly DemoActivity[] {
  return activities.map((activity) =>
    activity.type === "thinking" && activity.status === "active"
      ? { ...activity, status: "done" }
      : activity,
  );
}

function failActiveActivities(
  activities: readonly DemoActivity[],
): readonly DemoActivity[] {
  return activities.map((activity) =>
    activity.status === "active" ? { ...activity, status: "error" } : activity,
  );
}

function formatActivityPayload(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shouldPreviewFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type.startsWith("audio/") ||
    file.type.startsWith("video/")
  );
}

function attachmentKindFromMimeType(mimeType: string): DemoAttachment["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/pdf" ||
    mimeType === "application/json"
  ) {
    return "document";
  }
  return "file";
}

function attachmentIcon(kind: DemoAttachment["kind"]) {
  switch (kind) {
    case "image":
      return ImageIcon;
    case "audio":
      return FileAudio;
    case "video":
      return Video;
    case "document":
      return FileText;
    case "file":
      return FileIcon;
  }
}

function attachmentLabel(attachment: DemoAttachment): string {
  const size = attachment.size ? formatFileSize(attachment.size) : undefined;
  if (size) return `${attachment.mimeType || "file"} · ${size}`;
  return attachment.mimeType || attachment.kind;
}

function formatMessageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (isSameLocalDay(date, new Date())) {
    return `Today at ${time}`;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) {
    return `Yesterday at ${time}`;
  }

  const daysAgo = getLocalDayDistance(date, new Date());
  if (daysAgo > 1 && daysAgo < 7) {
    const weekday = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
    }).format(date);
    return `${weekday} at ${time}`;
  }

  const calendarDate = new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(date);
  return `${calendarDate} at ${time}`;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getLocalDayDistance(left: Date, right: Date): number {
  const leftDay = new Date(left.getFullYear(), left.getMonth(), left.getDate());
  const rightDay = new Date(
    right.getFullYear(),
    right.getMonth(),
    right.getDate(),
  );
  return Math.round(
    (rightDay.getTime() - leftDay.getTime()) / (24 * 60 * 60 * 1000),
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const SCROLL_BOTTOM_THRESHOLD = 32;

function isScrolledToLatest(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    SCROLL_BOTTOM_THRESHOLD
  );
}

function scrollToLatest(
  element: HTMLElement,
  behavior: ScrollBehavior | "instant",
) {
  element.scrollTo({
    top: element.scrollHeight,
    behavior,
  });
}

function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    resizeTextarea(element);
  }, [ref, value]);
}

const TEXTAREA_MAX_HEIGHT = 192;

function resizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  const nextHeight = Math.min(element.scrollHeight, TEXTAREA_MAX_HEIGHT);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY =
    element.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
}
