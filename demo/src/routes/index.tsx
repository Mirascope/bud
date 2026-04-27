import type { SessionId } from "@bud/sessions";
import { Button } from "@demo/components/ui/button";
import { Textarea } from "@demo/components/ui/textarea";
import {
  addDemoExchange,
  createDemoSession,
  ensureDemoSession,
  listDemoSessions,
  loadDemoMessages,
  type DemoMessage,
  type DemoSession,
} from "@demo/lib/demo-sessions";
import { cn } from "@demo/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, MessageSquare, Plus, User } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const [activeSessionId, setActiveSessionId] = useState<SessionId | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [sessions, setSessions] = useState<DemoSession[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0 && !!activeSessionId && !isSending;

  useAutoResize(textareaRef, draft);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialSession() {
      setIsLoading(true);
      const sessionId = await ensureDemoSession();
      const [nextSessions, nextMessages] = await Promise.all([
        listDemoSessions(),
        loadDemoMessages(sessionId),
      ]);

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (!content || !activeSessionId || isSending) return;

    const scrollElement = scrollRef.current;
    stickToLatestRef.current =
      !scrollElement || !hasMessages || isScrolledToLatest(scrollElement);

    setDraft("");
    setIsSending(true);

    void addDemoExchange(activeSessionId, content)
      .then(async (nextMessages) => {
        const nextSessions = await listDemoSessions();
        setMessages(nextMessages);
        setSessions(nextSessions);
      })
      .finally(() => setIsSending(false));
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

  return (
    <main className="flex h-screen min-h-screen overflow-hidden bg-background text-foreground">
      <aside className="hidden w-72 shrink-0 border-r border-border bg-accent/35 p-3 md:flex md:flex-col">
        <div className="mb-3 flex items-center justify-between gap-2 px-2">
          <div className="text-sm font-semibold text-accent-foreground">
            Sessions
          </div>
          <Button
            aria-label="New session"
            className="rounded-lg"
            onClick={handleNewSession}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <nav
          aria-label="Sessions"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
        >
          {sessions.map((session) => (
            <button
              className={cn(
                "flex items-start gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                session.sessionId === activeSessionId
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
              )}
              key={session.sessionId}
              onClick={() => handleSelectSession(session.sessionId)}
              type="button"
            >
              <MessageSquare className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{session.title}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section
        className={cn(
          "relative flex min-w-0 flex-1 flex-col overflow-hidden",
          hasMessages ? "justify-end" : "justify-center",
        )}
      >
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-border bg-accent/80 p-2 backdrop-blur md:hidden">
          <Button
            aria-label="New session"
            className="rounded-lg bg-background shadow-sm"
            onClick={handleNewSession}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
          </Button>
          <div
            aria-label="Sessions"
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
          >
            {sessions.map((session) => (
              <button
                className={cn(
                  "max-w-44 shrink-0 truncate rounded-lg px-3 py-1.5 text-left text-xs transition-colors",
                  session.sessionId === activeSessionId
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
                key={session.sessionId}
                onClick={() => handleSelectSession(session.sessionId)}
                type="button"
              >
                {session.title}
              </button>
            ))}
          </div>
        </div>

        <section
          aria-label="Chat messages"
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            hasMessages ? "block" : "hidden",
          )}
          onScroll={handleScroll}
          ref={scrollRef}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-20 md:pt-8">
            {messages.map((message) => (
              <article
                className={cn(
                  "flex items-start gap-3",
                  message.role === "user"
                    ? "flex-row-reverse justify-start"
                    : "justify-start",
                )}
                key={message.id}
              >
                <MessageAvatar role={message.role} />
                <div
                  className={cn(
                    "max-w-[min(72ch,calc(100%-3rem))] whitespace-pre-wrap break-words text-[15px] leading-7",
                    message.role === "user"
                      ? "rounded-2xl bg-secondary px-5 py-2.5 text-secondary-foreground"
                      : "px-1 text-foreground",
                  )}
                >
                  {message.content}
                </div>
              </article>
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
            className="fixed bottom-28 left-1/2 z-20 h-9 -translate-x-1/2 rounded-xl border border-input bg-background px-3 text-foreground shadow-lg hover:bg-accent md:left-[calc(50%+9rem)]"
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
              ? "fixed inset-x-0 bottom-0 bg-gradient-to-t from-background via-background to-background/0 pb-4 pt-10 md:left-72 md:w-[calc(100%-18rem)]"
              : "-translate-y-[8vh]",
          )}
        >
          <form
            className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-input bg-background p-3 shadow-[0_8px_32px_rgb(0_0_0/0.08)] transition-colors focus-within:border-ring"
            onSubmit={handleSubmit}
            ref={formRef}
          >
            <label className="sr-only" htmlFor="chat-composer">
              Message
            </label>
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
              className="mb-1 rounded-lg"
              disabled={!canSend}
              size="icon-sm"
              type="submit"
            >
              <ArrowUp className="size-4" />
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}

function MessageAvatar({ role }: { role: DemoMessage["role"] }) {
  if (role === "assistant") {
    return (
      <div
        aria-label="Bud avatar"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm"
      >
        B
      </div>
    );
  }

  return (
    <div
      aria-label="User avatar"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <User className="size-4" />
    </div>
  );
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
