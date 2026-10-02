import { useEffect, useRef } from "react";
import { HeadphonesIcon, MessageSquareIcon, SparklesIcon, Loader2, AlertCircleIcon, PanelLeftClose } from "lucide-react";
import type { ChatConversation } from "@/types";
import { cn } from "@/lib/utils";

export interface RemoteComment {
  id: string;
  text: string;
  device_name?: string | null;
  timestamp?: number;
}

export interface ListeningPaneProps {
  conversation?: ChatConversation;
  transcription?: string;
  pendingManualQuestion?: string;
  onSubmitPending?: () => Promise<void>;
  isProcessing?: boolean;
  isHearingSpeech?: boolean;
  isAIProcessing?: boolean;
  capturing?: boolean;
  error?: string;
  remoteComments?: RemoteComment[];
  selectedMessageId?: string | null;
  onSelectMessage?: (id: string | null) => void;
  onMinimize?: () => void;
}

interface UnifiedHistoryEntry {
  id: string;
  role: "user" | "assistant" | "system" | "commenter";
  content: string;
  timestamp: number;
  authorName?: string;
}

export const ListeningPane = ({
  conversation,
  transcription = "",
  pendingManualQuestion = "",
  isProcessing = false,
  isHearingSpeech = false,
  isAIProcessing = false,
  capturing = true,
  error = "",
  remoteComments = [],
  selectedMessageId = null,
  onSelectMessage,
  onMinimize,
}: ListeningPaneProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build unified history
  const historyEntries: UnifiedHistoryEntry[] = [];

  if (conversation?.messages && conversation.messages.length > 0) {
    for (const msg of conversation.messages) {
      historyEntries.push({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        timestamp: msg.timestamp,
      });
    }
  }

  for (const comment of remoteComments) {
    historyEntries.push({
      id: comment.id,
      role: "commenter",
      content: comment.text,
      timestamp: comment.timestamp || Date.now(),
      authorName: comment.device_name || "Twin",
    });
  }

  // Sort chronological: oldest at top, latest at bottom
  historyEntries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // If there's a standalone transcription that isn't yet committed to conversation messages
  const hasPendingSpeech = Boolean(
    pendingManualQuestion ||
    (transcription && !historyEntries.some(e => e.content === transcription))
  );
  const pendingContent = pendingManualQuestion || transcription;

  const hasActivity = historyEntries.length > 0 || hasPendingSpeech || isProcessing || isHearingSpeech;

  // Auto-scroll to bottom on update
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [historyEntries.length, pendingContent, isProcessing, isAIProcessing, isHearingSpeech]);

  const formatTime = (ts?: number) => {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header with live dynamic status */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/8 px-3">
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
              <h2 className="text-sm font-medium text-amber-300">Transcribing...</h2>
            </>
          ) : isHearingSpeech ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <h2 className="text-sm font-medium text-emerald-300">Hearing speech...</h2>
            </>
          ) : isAIProcessing ? (
            <>
              <SparklesIcon className="h-3.5 w-3.5 animate-pulse text-indigo-400" />
              <h2 className="text-sm font-medium text-indigo-300">Thinking...</h2>
            </>
          ) : capturing ? (
            <>
              <HeadphonesIcon className="h-3.5 w-3.5 text-emerald-300" />
              <h2 className="text-sm font-medium text-[#f7f8f8]">Listening</h2>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </>
          ) : (
            <>
              <HeadphonesIcon className="h-3.5 w-3.5 text-zinc-500" />
              <h2 className="text-sm font-medium text-zinc-400">Idle</h2>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {historyEntries.length > 0 && (
            <span className="text-[10px] text-zinc-400 select-none mr-1">
              {historyEntries.length} {historyEntries.length === 1 ? "entry" : "entries"}
            </span>
          )}
          {onMinimize && (
            <button
              onClick={onMinimize}
              title="Minimize chat preview"
              aria-label="Minimize chat preview"
              className="flex h-6 w-6 items-center justify-center rounded text-[#a0a5ad] hover:text-white hover:bg-white/10 transition-colors"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* History scrollable area - latest at bottom */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
            <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            <p className="flex-1 text-[11px] leading-tight">{error}</p>
          </div>
        )}

        {!hasActivity ? (
          <div className="flex min-h-32 flex-col items-center justify-center px-1 py-4 text-center">
            <p className="text-xs font-medium leading-5 text-[#d0d6e0]">
              Waiting for speech or a commenter message
            </p>
            <p className="mt-1 max-w-60 text-xs leading-relaxed text-[#62666d]">
              Transcription and remote comments will appear here as the session runs.
            </p>
          </div>
        ) : null}

        {/* Entire history scrollable list */}
        {historyEntries.map((entry) => {
          const isSelected = selectedMessageId === entry.id;
          return (
            <article
              key={entry.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectMessage?.(isSelected ? null : entry.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectMessage?.(isSelected ? null : entry.id);
                }
              }}
              title="Click to view full screen"
              className={cn(
                "group flex flex-col gap-1 rounded-xl p-2.5 transition-all cursor-pointer border text-left select-none",
                isSelected
                  ? "border-[#7170ff]/60 bg-[#7170ff]/10 shadow-sm"
                  : "border-white/5 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05]"
              )}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide">
                  {entry.role === "assistant" ? (
                    <>
                      <SparklesIcon className="h-3 w-3 text-[#7170ff] shrink-0" />
                      <span className="text-[#a5b4fc] text-[10px] font-semibold uppercase">AI</span>
                    </>
                  ) : entry.role === "commenter" ? (
                    <>
                      <MessageSquareIcon className="h-3 w-3 text-amber-400 shrink-0" />
                      <span className="text-amber-300 text-[10px] font-semibold uppercase truncate max-w-[100px]">
                        {entry.authorName || "Commenter"}
                      </span>
                    </>
                  ) : (
                    <>
                      <HeadphonesIcon className="h-3 w-3 text-emerald-400 shrink-0" />
                      <span className="text-emerald-300 text-[10px] font-semibold uppercase">System</span>
                    </>
                  )}
                </div>
                <time className="text-[10px] text-zinc-400 shrink-0 tabular-nums">
                  {formatTime(entry.timestamp)}
                </time>
              </div>
              <p className="truncate text-xs leading-relaxed text-[#d0d6e0] group-hover:text-white">
                {entry.content}
              </p>
            </article>
          );
        })}

        {/* Live pending speech if waiting for submission */}
        {hasPendingSpeech && pendingContent ? (
          <article
            role="button"
            tabIndex={0}
            onClick={() => onSelectMessage?.("pending")}
            title="Click to view full screen"
            className={cn(
              "group flex flex-col gap-1 rounded-xl p-2.5 transition-all cursor-pointer border border-emerald-500/30 bg-emerald-500/[0.05] text-left",
              selectedMessageId === "pending" && "border-emerald-400 bg-emerald-500/10"
            )}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-emerald-300">
                <HeadphonesIcon className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>System</span>
                <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] text-emerald-300 font-normal">
                  Pending
                </span>
              </div>
              <span className="text-[10px] text-emerald-400/70">Ready to submit</span>
            </div>
            <p className="truncate text-xs leading-relaxed text-[#e2e4e7] group-hover:text-white">
              {pendingContent}
            </p>
          </article>
        ) : null}

        {/* Active Transcribing indicator row */}
        {isProcessing && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-2.5 text-xs text-amber-300">
            <Loader2 className="h-3 w-3 animate-spin shrink-0 text-amber-400" />
            <span className="text-[11px] truncate">Transcribing audio speech...</span>
          </div>
        )}

        {/* Active AI Processing indicator row */}
        {isAIProcessing && (
          <div className="flex items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-400/[0.04] p-2.5 text-xs text-indigo-300">
            <SparklesIcon className="h-3 w-3 animate-pulse shrink-0 text-indigo-400" />
            <span className="text-[11px] truncate">AI is thinking...</span>
          </div>
        )}

        {/* Bottom anchor for auto-scroll */}
        <div ref={bottomRef} className="h-0 w-0" />
      </div>
    </div>
  );
};
