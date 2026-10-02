import { useCallback, type ReactNode } from "react";
import { Loader2, SendIcon, XIcon } from "lucide-react";
import { Button, CopyButton, Input, Markdown, Switch } from "@/components";
import { useCompletion } from "@/hooks/useCompletion";
import { Audio } from "./Audio";
import { Screenshot } from "./Screenshot";
import { Files } from "./Files";

export interface SessionCompletionSlots {
  composer: ReactNode;
  response: ReactNode;
  hasResponse: boolean;
}

export interface SessionCompletionProps {
  isHidden: boolean;
  pendingManualQuestion?: string;
  onSubmitPending?: () => Promise<void>;
  isAIProcessing?: boolean;
  children: (slots: SessionCompletionSlots) => ReactNode;
}

/** Own one typed-completion session while the shell places its inline slots. */
export const SessionCompletion = ({
  isHidden,
  pendingManualQuestion = "",
  onSubmitPending,
  isAIProcessing = false,
  children,
}: SessionCompletionProps) => {
  const completion = useCompletion({ manageWindow: false });
  // Let the shell own scrolling; keep hook shortcuts/autoscroll attached to its Radix root.
  const attachResponseRef = useCallback((node: HTMLElement | null) => {
    completion.scrollAreaRef.current = node
      ? (node.closest('[data-slot="scroll-area"]') as HTMLDivElement | null)
      : null;
  }, [completion.scrollAreaRef]);

  const isSubmitDisabled =
    isHidden ||
    (!completion.isLoading && !isAIProcessing && !completion.input.trim() && !pendingManualQuestion);

  const handleSubmit = () => {
    if (completion.isLoading) {
      completion.cancel();
    } else if (completion.input.trim()) {
      void completion.submit();
    } else if (pendingManualQuestion && onSubmitPending) {
      void onSubmitPending();
    }
  };

  const composer = (
    <fieldset disabled={isHidden} aria-label="Typed completion composer" className="flex w-full min-w-0 items-center gap-2 border-0 p-0">
      {/* Screenshot and attachment buttons to the left alongside audio */}
      <div className="flex items-center gap-1 shrink-0">
        <Audio {...completion} />
        <Screenshot {...completion} />
        <Files {...completion} />
      </div>
      <Input
        ref={completion.inputRef}
        aria-label="Ask AI"
        placeholder="Ask me anything..."
        value={completion.input}
        onChange={(event) => completion.setInput(event.target.value)}
        onKeyPress={completion.handleKeyPress}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            if (!completion.input.trim() && pendingManualQuestion && onSubmitPending) {
              event.preventDefault();
              void onSubmitPending();
            }
          }
        }}
        onPaste={completion.handlePaste}
        disabled={completion.isLoading || isAIProcessing || isHidden}
        className="min-w-0 flex-1"
      />
      <Button
        size="sm"
        aria-label={completion.isLoading ? "Cancel loading" : "Send"}
        title={completion.isLoading ? "Cancel loading" : "Submit question"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleSubmit}
        disabled={isSubmitDisabled}
        className="h-9 min-w-[84px] px-4 gap-1.5 rounded-xl font-medium text-xs bg-[#5e6ad2] hover:bg-[#7170ff] text-white shadow-sm shrink-0 transition-all flex items-center justify-center"
      >
        {completion.isLoading || isAIProcessing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Sending...</span>
          </>
        ) : (
          <>
            <SendIcon className="h-3.5 w-3.5" />
            <span>Submit</span>
          </>
        )}
      </Button>
    </fieldset>
  );
  const history = [...completion.conversationHistory].sort((a, b) => b.timestamp - a.timestamp);
  const latestAssistant = history.find((message) => message.role === "assistant");
  const visibleHistory = history.filter((message) => !(
    !completion.isLoading && completion.response &&
    message.id === latestAssistant?.id && message.content === completion.response
  ));
  const hasResponse = Boolean(
    completion.response || completion.error || completion.isLoading ||
    completion.keepEngaged || completion.conversationHistory.length
  );
  const response = hasResponse ? (
    <section ref={attachResponseRef} aria-label="Typed AI response" className="w-full min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-xs font-semibold">{completion.keepEngaged ? "Conversation Mode" : "AI Response"}</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            Conversation mode
            <Switch
              aria-label="Conversation mode"
              checked={completion.keepEngaged}
              onCheckedChange={(checked) => {
                completion.setKeepEngaged(checked);
                setTimeout(() => completion.inputRef.current?.focus(), 100);
              }}
            />
          </label>
          {completion.currentConversationId && completion.conversationHistory.length > 0 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label="View Current Conversation"
                aria-expanded={completion.messageHistoryOpen || completion.keepEngaged}
                disabled={completion.isLoading}
                onClick={() => completion.setMessageHistoryOpen(!completion.messageHistoryOpen)}
              >
                History ({completion.conversationHistory.length})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={completion.isLoading}
                onClick={() => {
                  completion.startNewConversation();
                  completion.setMessageHistoryOpen(false);
                }}
              >
                New Chat
              </Button>
            </>
          )}
          <CopyButton content={completion.response} />
          <Button
            size="icon"
            variant="ghost"
            aria-label={completion.keepEngaged ? "Close and start new conversation" : "Clear conversation"}
            title={completion.keepEngaged ? "Close and start new conversation" : "Clear conversation"}
            disabled={completion.isLoading}
            onClick={() => {
              if (completion.keepEngaged) {
                completion.setKeepEngaged(false);
                completion.startNewConversation();
              } else {
                completion.reset();
              }
            }}
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-3">
          {completion.error && (
            <div role="alert" className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <strong>Error:</strong> {completion.error}
            </div>
          )}
          {completion.isLoading && (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating response...
            </div>
          )}
          {completion.response && <Markdown>{completion.response}</Markdown>}
          {(completion.keepEngaged || completion.messageHistoryOpen) && visibleHistory.map((message) => (
            <article
              key={message.id}
              className={`rounded-lg p-3 text-sm ${message.role === "user" ? "border-l-4 border-primary bg-primary/10" : "bg-muted/50"}`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium uppercase">{message.role === "user" ? "You" : "AI"}</span>
                <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <Markdown>{message.content}</Markdown>
            </article>
          ))}
      </div>
    </section>
  ) : null;
  return children({ composer, response, hasResponse });
};
