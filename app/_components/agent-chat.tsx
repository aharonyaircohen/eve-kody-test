"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  ActivityIcon,
  AlertCircleIcon,
  BotIcon,
  BrainIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  Clock3Icon,
  Code2Icon,
  DatabaseIcon,
  ExternalLinkIcon,
  FolderTreeIcon,
  HistoryIcon,
  Layers3Icon,
  MessageSquareIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";

const AGENT_NAME = "eve-agent";
const AGENT_MODEL = "inclusionai/ling-3.0-flash-sante-free";
const SESSION_STORAGE_KEY = "eve-kody-test:recent-sessions";

type SavedSession = {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
};

export function AgentChat({
  sessionId,
  sessionless = false,
}: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const [cancellationError, setCancellationError] = useState<string>();
  const [hasInputText, setHasInputText] = useState(false);
  const [savedSessions, setSavedSessions] = useState<readonly SavedSession[]>([]);
  const lastSubmittedText = useRef("New Eve session");
  const currentSessionId = useRef(sessionId);
  const agent = useEveAgent({
    initialSession:
      sessionId === undefined
        ? undefined
        : {
            sessionId,
            streamIndex: 0,
          },
    resume: sessionId !== undefined,
    onSessionChange(session) {
      if (session !== undefined) {
        currentSessionId.current = session.sessionId;
      }
      if (sessionId === undefined && session !== undefined) {
        // Next patches window.history to navigate, which would detach the active stream.
        History.prototype.replaceState.call(
          window.history,
          window.history.state,
          "",
          `/s/${encodeURIComponent(session.sessionId)}`,
        );
      }
      saveSession(session?.sessionId, lastSubmittedText.current, setSavedSessions);
    },
  });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSavedSessions(parsed.filter(isSavedSession).slice(0, 12));
        }
      }
    } catch {
      // Browser storage is optional; the Eve session URL remains the source of truth.
    }
  }, []);

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";
  const isEmpty = agent.data.messages.length === 0;
  const lastMessage = agent.data.messages.at(-1);
  const isPendingAssistantShell =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.every((part) => part.type === "step-start");
  const showPendingThinking =
    isBusy &&
    (agent.status === "submitted" || lastMessage?.role !== "assistant" || isPendingAssistantShell);
  const turnFailure = isBusy || isResuming ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = cancellationError ?? agent.error?.message ?? turnFailure;
  const hasConversationContent = !isEmpty || errorMessage !== undefined;
  const showConversationLayout = isResuming || hasConversationContent;
  const activeSessionId = sessionId ?? agent.session?.sessionId;

  useEffect(() => {
    if (activeSessionId === undefined || isEmpty) return;
    const firstUserMessage = agent.data.messages.find((message) => message.role === "user");
    const title = firstUserMessage ? getMessageText(firstUserMessage) : lastSubmittedText.current;
    saveSession(activeSessionId, title, setSavedSessions);
  }, [activeSessionId, agent.data.messages, isEmpty]);

  const requestCancellation = () => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => {
      setCancellationError(toErrorMessage(error));
    });
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isResuming) return;

    setHasInputText(false);
    setCancellationError(undefined);
    if (text.length > 0) {
      lastSubmittedText.current = text.slice(0, 72);
    }
    const options = isBusy ? { turnPolicy: "steer" as const } : undefined;

    if (message.files.length === 0) {
      await agent.send(text, options);
      saveSession(currentSessionId.current, lastSubmittedText.current, setSavedSessions);
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send(parts, options);
    saveSession(currentSessionId.current, lastSubmittedText.current, setSavedSessions);
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea
        disabled={isResuming}
        onChange={(event) => setHasInputText(event.currentTarget.value.trim().length > 0)}
        placeholder="Send a message…"
      />
      <ComposerAction
        hasInputText={hasInputText}
        isBusy={isBusy}
        isResuming={isResuming}
        onCancel={requestCancellation}
      />
    </PromptInput>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <DemoSidebar
        activeSessionId={activeSessionId}
        savedSessions={savedSessions}
        status={agent.status}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader canStartNewChat={activeSessionId !== undefined} />

        {showConversationLayout ? (
          <Conversation
            className="min-h-0 flex-1"
            initial={sessionId === undefined ? undefined : false}
            resize={activeSessionId === undefined ? "smooth" : "instant"}
            scrollRestorationKey={
              isEmpty || activeSessionId === undefined
                ? undefined
                : `eve:web-chat-scroll:${activeSessionId}`
            }
          >
            <ConversationTopFade className="top-14" />
            <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-8 pb-8 sm:px-6">
              {agent.data.messages.map((message, index) =>
                showPendingThinking &&
                isPendingAssistantShell &&
                message.id === lastMessage.id ? null : (
                  <AgentMessage
                    canRespond={!isBusy && !isResuming}
                    isStreaming={
                      agent.status === "streaming" && index === agent.data.messages.length - 1
                    }
                    key={message.id}
                    message={message}
                    onInputResponses={(inputResponses) => {
                      setCancellationError(undefined);
                      return agent.respond(inputResponses);
                    }}
                  />
                ),
              )}
              {showPendingThinking ? <PendingThinking /> : null}
              {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        ) : (
          <WelcomePanel />
        )}

        <div
          className={cn(
            "mx-auto w-full px-4 sm:px-6",
            showConversationLayout
              ? "max-w-3xl shrink-0 bg-gradient-to-t from-background via-background to-transparent pt-4 pb-6"
              : "max-w-2xl shrink-0 pb-10",
          )}
        >
          <div className="w-full">{composer}</div>
        </div>
      </main>
    </div>
  );
}

function ComposerAction({
  hasInputText,
  isBusy,
  isResuming,
  onCancel,
}: {
  readonly hasInputText: boolean;
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly onCancel: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const canSubmit = hasInputText || attachments.files.length > 0;

  if (!isBusy || canSubmit) {
    return <PromptInputSubmit disabled={isResuming} />;
  }

  return (
    <PromptInputButton
      aria-label="Stop"
      className="absolute right-2.5 bottom-2.5"
      onClick={onCancel}
      variant="outline"
    >
      <SquareIcon className="size-3 fill-current" />
    </PromptInputButton>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Request failed</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function ChatHeader({ canStartNewChat }: { readonly canStartNewChat: boolean }) {
  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-5 backdrop-blur sm:px-8">
      <div className="flex items-center gap-2 text-sm">
        <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
          <BotIcon className="size-4" />
        </div>
        <span className="font-medium">{AGENT_NAME}</span>
        <span className="hidden text-muted-foreground sm:inline">/ browser session</span>
      </div>
      <div className="flex items-center gap-3">
        <StatusPill />
        {canStartNewChat ? (
          <Button
            aria-label="Start a new chat"
            className="pr-3"
            onClick={() => window.location.assign("/s")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
            <span className="hidden font-normal text-sm sm:inline">New chat</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function StatusPill() {
  return (
    <span className="hidden items-center gap-1.5 text-muted-foreground text-xs sm:flex">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Ready
    </span>
  );
}

function DemoSidebar({
  activeSessionId,
  savedSessions,
  status,
}: {
  readonly activeSessionId: string | undefined;
  readonly savedSessions: readonly SavedSession[];
  readonly status: string;
}) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r bg-card/60 lg:flex">
      <div className="flex h-14 items-center gap-3 border-b px-5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-foreground text-background">
          <Layers3Icon className="size-4" />
        </div>
        <div>
          <p className="font-semibold text-sm">Eve workspace</p>
          <p className="text-muted-foreground text-xs">Agent runtime demo</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between px-2 text-muted-foreground text-[11px] uppercase tracking-wider">
            <span>Agents</span>
            <Code2Icon className="size-3.5" />
          </div>
          <div className="rounded-xl border bg-background p-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BotIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{AGENT_NAME}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">Root agent · active</p>
              </div>
              <CheckCircle2Icon className="ml-auto size-4 shrink-0 text-emerald-500" />
            </div>
            <div className="mt-3 space-y-1.5 border-t pt-3 text-muted-foreground text-[11px]">
              <p className="flex items-center gap-2"><Code2Icon className="size-3" /> agent/agent.ts</p>
              <p className="flex items-center gap-2"><FolderTreeIcon className="size-3" /> agent/instructions.md</p>
              <p className="flex items-center gap-2"><Clock3Icon className="size-3" /> {AGENT_MODEL}</p>
            </div>
            <a
              className="mt-3 flex items-center gap-1.5 text-primary text-xs hover:underline"
              href="https://eve.dev/docs/concepts/project-structure"
              rel="noreferrer"
              target="_blank"
            >
              Agent authoring guide
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>
          <div className="mt-2 rounded-lg border border-dashed px-3 py-2.5 text-muted-foreground text-xs">
            <p className="font-medium text-foreground">Where agents are made</p>
            <p className="mt-1 leading-relaxed">Edit the files under <code className="rounded bg-muted px-1">agent/</code>. Eve compiles them into a durable runtime.</p>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between px-2 text-muted-foreground text-[11px] uppercase tracking-wider">
            <span>Recent sessions · this browser</span>
            <HistoryIcon className="size-3.5" />
          </div>
          {savedSessions.length === 0 ? (
            <div className="rounded-lg px-2 py-3 text-muted-foreground text-xs leading-relaxed">
              Sessions appear here after you send a message. The list is local to this browser; each Eve session has a durable URL.
            </div>
          ) : (
            <div className="space-y-1">
              {savedSessions.map((session) => (
                <a
                  className={cn(
                    "group flex items-start gap-2 rounded-lg px-2.5 py-2.5 text-sm transition-colors hover:bg-muted",
                    activeSessionId === session.id && "bg-muted",
                  )}
                  href={`/s/${encodeURIComponent(session.id)}`}
                  key={session.id}
                >
                  <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{session.title}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{formatSessionDate(session.updatedAt)}</span>
                  </span>
                  <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              ))}
            </div>
          )}
          <Button className="mt-2 w-full justify-start gap-2" onClick={() => window.location.assign("/s")} size="sm" variant="outline">
            <PlusIcon className="size-3.5" />
            New session
          </Button>
        </div>
      </div>

      <div className="border-t p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <ActivityIcon className="size-3.5" />
          <span>Runtime status: {status === "streaming" || status === "submitted" ? "working" : "idle"}</span>
        </div>
      </div>
    </aside>
  );
}

function WelcomePanel() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10 sm:px-8">
      <div className="w-full max-w-3xl">
        <div className="mb-10 max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-muted-foreground text-xs">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Eve browser demo
          </div>
          <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">Build a conversation with a durable agent.</h1>
          <p className="mt-3 max-w-xl text-muted-foreground leading-relaxed">Send a message below. Eve creates a durable session, streams the reply, and keeps the session available at its own URL so you can come back later.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <DemoCapability icon={<MessageSquareIcon className="size-4" />} title="Chat" text="Stream a normal agent turn in the browser." />
          <DemoCapability icon={<DatabaseIcon className="size-4" />} title="Resume" text="Reload the session URL and continue the same thread." />
          <DemoCapability icon={<FolderTreeIcon className="size-4" />} title="Author" text="Change behavior in agent/instructions.md and agent/agent.ts." />
        </div>
      </div>
    </div>
  );
}

function DemoCapability({
  icon,
  text,
  title,
}: {
  readonly icon: ReactNode;
  readonly text: string;
  readonly title: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">{icon}</div>
      <p className="font-medium text-sm">{title}</p>
      <p className="mt-1 text-muted-foreground text-xs leading-relaxed">{text}</p>
    </div>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-muted-foreground text-sm">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to cancel the response.";
}

function getLatestTurnFailure(
  events: ReturnType<typeof useEveAgent>["events"],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.type === "turn.failed") {
      return event.data.code === "MODEL_CALL_FAILED"
        ? "The model is temporarily unavailable. Please try again."
        : event.data.message;
    }

    if (event.type === "turn.completed" || event.type === "turn.cancelled") {
      return undefined;
    }

    if (event.type === "message.received") {
      return undefined;
    }
  }

  return undefined;
}

function saveSession(
  sessionId: string | undefined,
  title: string,
  setSavedSessions: Dispatch<SetStateAction<readonly SavedSession[]>>,
) {
  if (sessionId === undefined || typeof window === "undefined") return;

  const nextSession: SavedSession = {
    id: sessionId,
    title: title.trim().slice(0, 72) || "New Eve session",
    updatedAt: Date.now(),
  };

  setSavedSessions((current) => {
    const next = [nextSession, ...current.filter((session) => session.id !== sessionId)].slice(0, 12);
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Browser storage is optional; the session URL remains usable.
    }
    return next;
  });
}

function isSavedSession(value: unknown): value is SavedSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.updatedAt === "number"
  );
}

function getMessageText(message: { readonly parts: readonly unknown[] }): string {
  const text = message.parts
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const candidate = part as { readonly type?: unknown; readonly text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join(" ")
    .trim();
  return text || "New Eve session";
}

function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Recent";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
