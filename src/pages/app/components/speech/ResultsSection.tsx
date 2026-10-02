import { ChatConversation } from "@/types";
import { Markdown, Switch, CopyButton } from "@/components";
import { BotIcon, HeadphonesIcon, Loader2, MessageSquareIcon, SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  lastTranscription: string;
  lastAIResponse: string;
  pendingManualQuestion: string;
  onSubmitPending: () => Promise<void>;
  remoteComments: Array<{
    id: string;
    text: string;
    device_name?: string | null;
  }>;
  isAIProcessing: boolean;
  conversation: ChatConversation;
  conversationMode: boolean;
  setConversationMode: (mode: boolean) => void;
  showInputs?: boolean;
};

export const ResultsSection = ({
  lastTranscription,
  lastAIResponse,
  remoteComments,
  isAIProcessing,
  conversation,
  conversationMode,
  setConversationMode,
  showInputs = true,
}: Props) => {
  const hasResponse = Boolean(lastAIResponse || isAIProcessing);
  const hasTwinResponse = remoteComments.length > 0;
  const hasHistory = conversation.messages.length > 2;

  if (
    !hasResponse &&
    !hasTwinResponse &&
    (!showInputs || !lastTranscription)
  ) {
    return null;
  }

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">
            {conversationMode ? "Conversation" : "AI Response"}
          </h4>
        </div>
        <div className="flex items-center gap-2 select-none">
          <span className="text-[9px] text-muted-foreground/50 bg-muted/50 px-1 rounded">
            {modKey}+K
          </span>
          <Switch
            checked={conversationMode}
            onCheckedChange={setConversationMode}
            className="scale-75"
          />
          {lastAIResponse && <CopyButton content={lastAIResponse} />}
        </div>
      </div>

      {/* RESPONSE MODE: System as text, then AI response, then Twin responses */}
      {!conversationMode && (
        <div className="w-full space-y-3">
          {/* System Input - Just text with bold label */}
          {showInputs && lastTranscription && (
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-muted-foreground flex-1">
                <span className="font-semibold">System:</span> {lastTranscription}
              </p>
            </div>
          )}

          {/* AI Response */}
          {hasResponse && (
            <div className="w-full">
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">
                    Generating response...
                  </span>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none w-full dark:prose-invert">
                  <Markdown>{lastAIResponse}</Markdown>
                  {isAIProcessing && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Twin Responses - Below AI response */}
          {remoteComments.length > 0 && (
            <div className={`w-full space-y-2.5 ${hasResponse ? "pt-3 border-t border-border/50" : ""}`}>
              {remoteComments.map((comment) => (
                <div
                  key={comment.id}
                  className="w-full rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <MessageSquareIcon className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-[10px] font-semibold text-amber-300 uppercase tracking-wide">
                        {comment.device_name || "Twin Response"}
                      </span>
                    </div>
                    <CopyButton content={comment.text} />
                  </div>
                  <div className="prose prose-sm max-w-none w-full dark:prose-invert text-sm leading-relaxed text-[#e2e4e7]">
                    <Markdown>{comment.text}</Markdown>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CONVERSATION MODE: AI on top, then System, then Twin responses, then history */}
      {conversationMode && (
        <div className="w-full space-y-2">
          {/* AI Response - First (on top) */}
          {hasResponse && (
            <div className="w-full rounded-md bg-background/50 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <BotIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                  AI
                </span>
              </div>
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">
                    Generating...
                  </span>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none w-full dark:prose-invert text-sm">
                  <Markdown>{lastAIResponse}</Markdown>
                  {isAIProcessing && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* System Input - Second */}
          {showInputs && lastTranscription && (
            <div className="w-full rounded-md border-l-2 border-primary/50 bg-primary/5 p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5">
                  <HeadphonesIcon className="h-3 w-3 text-primary" />
                  <span className="text-[9px] font-medium text-primary uppercase tracking-wide">
                    System
                  </span>
                </div>
              </div>
              <p className="text-sm">{lastTranscription}</p>
            </div>
          )}

          {/* Twin Responses - Below */}
          {remoteComments.length > 0 && (
            <div className="w-full space-y-2">
              {remoteComments.map((comment) => (
                <div
                  key={comment.id}
                  className="w-full rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <MessageSquareIcon className="h-3 w-3 text-amber-400" />
                      <span className="text-[9px] font-medium text-amber-300 uppercase tracking-wide">
                        {comment.device_name || "Twin Response"}
                      </span>
                    </div>
                    <CopyButton content={comment.text} />
                  </div>
                  <div className="prose prose-sm max-w-none w-full dark:prose-invert text-sm">
                    <Markdown>{comment.text}</Markdown>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Previous Messages */}
          {hasHistory && (
            <div className="w-full space-y-2 pt-2 border-t border-border/50">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">
                Previous
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {conversation.messages
                  .slice(0, -2)
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .map((message, index) => (
                    <div
                      key={message.id || index}
                      className={cn(
                        "p-2 rounded-md text-[11px]",
                        message.role === "user"
                          ? "bg-primary/5 border-l-2 border-primary/30"
                          : "bg-background/50"
                      )}
                    >
                      <span className="text-[8px] font-medium text-muted-foreground uppercase">
                        {message.role === "user" ? "System" : "AI"}
                      </span>
                      <div className="text-muted-foreground leading-relaxed mt-0.5">
                        <Markdown>{message.content}</Markdown>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
