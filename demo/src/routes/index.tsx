import type { SessionId } from "@bud/sessions";
import { Button } from "@demo/components/ui/button";
import { Textarea } from "@demo/components/ui/textarea";
import {
  addDemoExchange,
  createDemoSession,
  deleteDemoSession,
  listDemoSessions,
  loadDemoMessages,
  type DemoAttachment,
  type DemoAttachmentInput,
  type DemoMessage,
  type DemoSession,
} from "@demo/lib/demo-sessions";
import { cn } from "@demo/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
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
  Trash2,
  User,
  Video,
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
} from "react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const [activeSessionId, setActiveSessionId] = useState<SessionId | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarHoverArmed, setIsSidebarHoverArmed] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
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
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;
  const hasAttachments = attachments.length > 0;
  const canSend =
    (draft.trim().length > 0 || hasAttachments) && !isLoading && !isSending;
  const isSidebarHoverSuppressed = isSidebarCollapsed && !isSidebarHoverArmed;

  useAutoResize(textareaRef, draft);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialSession() {
      setIsLoading(true);
      const nextSessions = await listDemoSessions();
      const sessionId = nextSessions[0]?.sessionId ?? null;
      const nextMessages = sessionId ? await loadDemoMessages(sessionId) : [];

      if (cancelled) return;
      setActiveSessionId(sessionId);
      setMessages(nextMessages);
      setSessions(nextSessions);
      setIsLoading(false);
    }

    void loadInitialSession();

    return () => {
      cancelled = true;
    };
  }, []);

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
    if ((!content && !hasAttachments) || isLoading || isSending) return;
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
      const sessionId = activeSessionId ?? (await createDemoSession());
      const nextMessages = await addDemoExchange(
        sessionId,
        content,
        attachmentInputs,
      );
      const nextSessions = await listDemoSessions();
      setActiveSessionId(sessionId);
      setMessages(
        mergeLatestUserAttachments(nextMessages, submittedAttachments),
      );
      setSessions(nextSessions);
    })().finally(() => setIsSending(false));
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

  return (
    <main className="h-screen min-h-screen overflow-hidden bg-background text-foreground">
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
            "flex h-full w-72 -translate-x-full flex-col border-r border-border bg-accent/95 p-3 shadow-xl backdrop-blur transition-transform duration-150 group-focus-within/sidebar:translate-x-0",
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
                className="rounded-none"
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
                className="rounded-none"
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
                    "group/session flex w-full items-center gap-1 rounded-none transition-colors",
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
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-none px-3 py-2 text-left text-sm"
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
                    className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-none opacity-0 transition-opacity hover:bg-accent group-hover/session:opacity-100 group-focus-within/session:opacity-100"
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
        </aside>
      </div>

      {sessionMenu && (
        <div
          className="fixed z-50 min-w-40 rounded-none border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          onClick={(event) => event.stopPropagation()}
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded-none px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-accent"
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
          !isSidebarCollapsed && "md:ml-72",
          hasMessages ? "justify-end" : "justify-center",
        )}
      >
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

        {!hasMessages && (
          <div className="mx-auto w-full max-w-3xl px-3 text-center">
            <div className="mb-5 text-sm font-medium text-muted-foreground">
              {isLoading ? "Loading session..." : "What should Bud help with?"}
            </div>
          </div>
        )}

        {hasMessages && showJumpToLatest && (
          <Button
            className={cn(
              "fixed bottom-28 left-1/2 z-20 h-9 -translate-x-1/2 rounded-none border border-input bg-background px-3 text-foreground shadow-lg hover:bg-accent",
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
            className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-none border border-input bg-background p-3 shadow-[0_8px_32px_rgb(0_0_0/0.08)] transition-colors focus-within:border-ring"
            onSubmit={handleSubmit}
            ref={formRef}
          >
            {attachments.length > 0 && (
              <AttachmentList
                attachments={attachments}
                onOpenImage={setOpenImageAttachment}
                onRemove={handleRemoveAttachment}
              />
            )}
            <label className="sr-only" htmlFor="chat-composer">
              Message
            </label>
            <div className="flex items-end gap-2">
              <input
                accept="image/*,audio/*,video/*,application/pdf,text/plain,application/json,text/html,text/css,text/xml,text/rtf,.js,.mjs,.py"
                className="sr-only"
                multiple
                onChange={handleAttachmentChange}
                ref={attachmentInputRef}
                type="file"
              />
              <Button
                aria-label="Attach files"
                className="mb-1 rounded-none"
                disabled={isLoading || isSending}
                onClick={() => attachmentInputRef.current?.click()}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Paperclip className="size-4" />
              </Button>
              <Textarea
                className="max-h-48 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[16px] leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-[15px]"
                disabled={isLoading}
                id="chat-composer"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Bud"
                ref={textareaRef}
                rows={1}
                value={draft}
              />
              <Button
                aria-label="Send message"
                className="mb-1 rounded-none"
                disabled={!canSend}
                size="icon-sm"
                type="submit"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </form>
        </div>
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
        {(otherAttachments.length > 0 || message.content) && (
          <div
            className={cn(
              "flex flex-col gap-2 whitespace-pre-wrap break-words",
              message.role === "user"
                ? "rounded-none bg-secondary px-5 py-2.5 text-secondary-foreground"
                : "px-1 text-foreground",
            )}
          >
            {otherAttachments.length > 0 && (
              <AttachmentList
                attachments={otherAttachments}
                onOpenImage={onOpenImage}
              />
            )}
            {message.content}
          </div>
        )}
      </div>
    </article>
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
            className="group/attachment flex max-w-64 items-center gap-2 rounded-none border border-border/70 bg-background/80 p-1.5 text-foreground shadow-sm"
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
                className="flex size-6 shrink-0 items-center justify-center rounded-none text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground group-hover/attachment:opacity-100"
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
        className="size-10 overflow-hidden rounded-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
        className="size-10 rounded-none object-cover"
        muted
        src={attachment.url}
      />
    );
  }

  const Icon = attachmentIcon(attachment.kind);
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-none bg-muted text-muted-foreground">
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
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-none border border-border bg-background text-foreground shadow-lg transition-colors hover:bg-accent"
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
        className="flex size-8 shrink-0 items-center justify-center rounded-none bg-primary text-sm font-semibold text-primary-foreground shadow-sm"
      >
        B
      </div>
    );
  }

  return (
    <div
      aria-label="User avatar"
      className="flex size-8 shrink-0 items-center justify-center rounded-none bg-muted text-muted-foreground"
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

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [ref, value]);
}
