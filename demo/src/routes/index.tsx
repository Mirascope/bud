import { Button } from "@demo/components/ui/button";
import { Textarea } from "@demo/components/ui/textarea";
import { cn } from "@demo/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, User } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from "react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function HomePage() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0;

  useAutoResize(textareaRef, draft);

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
    if (!content) return;

    const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    const scrollElement = scrollRef.current;
    stickToLatestRef.current =
      !scrollElement || !hasMessages || isScrolledToLatest(scrollElement);

    setMessages((current) => [
      ...current,
      { id: `${id}-user`, role: "user", content },
      {
        id: `${id}-assistant`,
        role: "assistant",
        content: "Not Implemented Yet",
      },
    ]);
    setDraft("");
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

  return (
    <main
      className={cn(
        "flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground",
        hasMessages ? "justify-end" : "justify-center",
      )}
    >
      <section
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          hasMessages ? "block" : "hidden",
        )}
        aria-label="Chat messages"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-8">
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

      {hasMessages && showJumpToLatest && (
        <Button
          className="fixed bottom-28 left-1/2 z-20 h-9 -translate-x-1/2 rounded-xl border border-input bg-background px-3 text-foreground shadow-lg hover:bg-accent"
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
            ? "fixed inset-x-0 bottom-0 bg-gradient-to-t from-background via-background to-background/0 pb-4 pt-10"
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
    </main>
  );
}

function MessageAvatar({ role }: { role: Message["role"] }) {
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
