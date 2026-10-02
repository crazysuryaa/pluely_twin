import { useState, useEffect, type ReactNode } from "react";
import {
  Button,
  Updater,
  ScrollArea,
  Markdown,
  CopyButton,
  VerbatimText,
} from "@/components";
import {
  AlertCircleIcon,
  XIcon,
  SparklesIcon,
  ArrowLeftIcon,
  HeadphonesIcon,
  MessageSquareIcon,
  SlidersHorizontalIcon,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ModeSwitcher } from "./ModeSwitcher";
import { RecordingPanel } from "./RecordingPanel";
import { ResultsSection } from "./ResultsSection";
import { SettingsPanel } from "./SettingsPanel";
import { PermissionFlow } from "./PermissionFlow";
// import { QuickActions } from "./QuickActions";
import { Warning } from "./Warning";
import { useSystemAudioType, useSystemPrompts } from "@/hooks";
// import { useApp } from "@/contexts";
import { MAX_FILES } from "@/config";
import { LiveWorkspace } from "./LiveWorkspace";
import { ListeningPane } from "./ListeningPane";
import type { RemoteSessionPresentation } from "@/hooks/useRemoteSessionStatus";

export const SystemAudio = (
  props: useSystemAudioType & {
    remoteSession: RemoteSessionPresentation;
    composer: ReactNode;
    typedResponse: ReactNode;
    hasTypedResponse: boolean;
    settingsOpen: boolean;
    expanded: boolean;
    onToggleSettings?: () => void;
    onCloseSettings?: () => void;
  }
) => {
  // Mounted with the session so a saved prompt is always selected for it.
  const {
    prompts: savedPrompts,
    selectedPromptId,
    handleSelectPrompt,
  } = useSystemPrompts();
  const {
    isProcessing,
    isHearingSpeech,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    pendingManualQuestion,
    submitPendingQuestion,
    deleteMessage,
    discardPendingSpeech,
    attachedScreenshots,
    // addScreenshot,
    removeScreenshot,
    remoteComments,
    error,
    setupRequired,
    startCapture,
    useSystemPrompt,
    setUseSystemPrompt,
    // startNewConversation,
    conversation,
    // quickActions,
    // addQuickAction,
    // removeQuickAction,
    // isManagingQuickActions,
    // setIsManagingQuickActions,
    // showQuickActions,
    // setShowQuickActions,
    // handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    scrollAreaRef,
    remoteSession,
    composer,
    typedResponse,
    hasTypedResponse,
    settingsOpen,
    expanded,
    onToggleSettings,
    onCloseSettings,
  } = props;

  // const { supportsImages } = useApp();

  // Full screen toggle and selection state for full view
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // View mode toggle
  const [conversationMode, setConversationMode] = useState(true);
  const [responseSource, setResponseSource] = useState<"speech" | "chat">("speech");
  useEffect(() => {
    if (hasTypedResponse) {
      setResponseSource("chat");
      setSelectedMessageId(null);
    }
  }, [hasTypedResponse]);
  useEffect(() => {
    if (isAIProcessing) {
      setResponseSource("speech");
      setSelectedMessageId(null);
    }
  }, [isAIProcessing]);

  // Screenshot state
  // const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  const isVadMode = vadConfig.enabled;
  const hasResponse = Boolean(lastAIResponse || isAIProcessing || remoteComments.length > 0);

  // Keyboard shortcut for Cmd+K to toggle view mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!expanded) return;

      // Cmd+K or Ctrl+K to toggle view mode
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setConversationMode((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  const handleModeChange = (vadEnabled: boolean) => {
    updateVadConfiguration({
      ...vadConfig,
      enabled: vadEnabled,
    });
  };

  /*
  // Capture screenshot functionality
  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) return;

    setIsCapturingScreenshot(true);
    try {
      // Check screen recording permission on macOS
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturingScreenshot(false);
          return;
        }
      }

      // Capture screenshot
      const base64: string = await invoke("capture_screenshot", {
        screenId: null, // Use default screen
      });

      addScreenshot(base64);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [isCapturingScreenshot, addScreenshot]);
  */

  // Selected message resolution for detail view
  const selectedMessage =
    selectedMessageId === "pending"
      ? {
          id: "pending",
          role: "user" as const,
          content: pendingManualQuestion || lastTranscription,
          timestamp: Date.now(),
        }
      : conversation.messages.find((m) => m.id === selectedMessageId);

  const selectedComment =
    !selectedMessage && selectedMessageId
      ? remoteComments.find((c) => c.id === selectedMessageId)
      : null;

  const precedingQuestion =
    selectedMessage?.role === "assistant"
      ? conversation.messages[conversation.messages.findIndex((m) => m.id === selectedMessage.id) - 1]
      : null;

  const succeedingResponse =
    selectedMessage?.role === "user"
      ? conversation.messages[conversation.messages.findIndex((m) => m.id === selectedMessage.id) + 1]
      : null;

  return (
    <LiveWorkspace
      isFullScreen={isFullScreen}
      listening={
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 min-w-0 flex-1 w-full">
            <ListeningPane
              conversation={conversation}
              transcription={lastTranscription}
              pendingManualQuestion={pendingManualQuestion}
              onSubmitPending={submitPendingQuestion}
              isProcessing={isProcessing}
              isHearingSpeech={isHearingSpeech}
              isAIProcessing={isAIProcessing}
              capturing={props.capturing}
              error={error}
              remoteComments={remoteComments}
              selectedMessageId={selectedMessageId}
              onSelectMessage={(id) => setSelectedMessageId(id)}
              onMinimize={() => setIsFullScreen(true)}
              onDeleteEntry={deleteMessage}
              onDiscardPending={discardPendingSpeech}
            />
          </div>
          {!setupRequired ? (
            <div className="flex-shrink-0 w-full border-t border-white/8 p-3">
              <RecordingPanel
                isVadMode={isVadMode}
                isRecording={isRecordingInContinuousMode}
                isProcessing={isProcessing}
                isAIProcessing={isAIProcessing}
                recordingProgress={recordingProgress}
                maxDuration={vadConfig.max_recording_duration_secs}
                onStartRecording={startContinuousRecording}
                onStopAndSend={manualStopAndSend}
                onIgnore={ignoreContinuousRecording}
              />
            </div>
          ) : null}
        </div>
      }
      response={
        <div className="flex h-full w-full min-h-0 min-w-0 flex-col">
          <div className="flex h-11 w-full flex-shrink-0 items-center justify-between gap-1 border-b border-white/8 px-3">
            <div className="flex items-center gap-2">
              {selectedMessageId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs text-[#a0a5ad] hover:text-white"
                  onClick={() => setSelectedMessageId(null)}
                >
                  <ArrowLeftIcon className="h-3.5 w-3.5" />
                  <span>Back to Live</span>
                </Button>
              ) : (
                <h2 className="text-sm font-medium tracking-tight">AI Response</h2>
              )}
            </div>
            <div className="flex items-center gap-1">

              {/* Chat preview toggle */}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-[#a0a5ad] hover:text-white"
                title={isFullScreen ? "Show chat preview" : "Minimize chat preview"}
                aria-label={isFullScreen ? "Show chat preview" : "Minimize chat preview"}
                onClick={() => setIsFullScreen((v) => !v)}
              >
                {isFullScreen ? (
                  <PanelLeftOpen className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                )}
              </Button>
              {/* Session settings toggle within viewer panel */}
              {onToggleSettings && (
                <Button
                  size="icon"
                  variant={settingsOpen ? "default" : "ghost"}
                  className={`h-7 w-7 ${
                    settingsOpen
                      ? "bg-white/20 text-white hover:bg-white/25"
                      : "text-[#a0a5ad] hover:text-white"
                  }`}
                  title={settingsOpen ? "Hide session settings" : "Session settings"}
                  aria-label="Session settings"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSettings();
                  }}
                >
                  <SlidersHorizontalIcon className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className="h-full w-full min-h-0 min-w-0 flex-1" ref={scrollAreaRef}>
            <div className="w-full space-y-4 p-4">
              {/* Session settings view when open */}
              {settingsOpen && (
                <div className="space-y-3 rounded-xl border border-indigo-500/20 bg-indigo-950/[0.15] p-4">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontalIcon className="h-4 w-4 text-indigo-400" />
                      <h3 className="text-sm font-semibold text-white">Session Settings</h3>
                    </div>
                    {(onCloseSettings || onToggleSettings) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-[#8a8f98] hover:text-white"
                        onClick={onCloseSettings || onToggleSettings}
                      >
                        Close
                      </Button>
                    )}
                  </div>
                  <ModeSwitcher
                    isVadMode={isVadMode}
                    onModeChange={handleModeChange}
                    disabled={
                      isRecordingInContinuousMode || isProcessing || isAIProcessing
                    }
                  />
                  <p className="text-xs text-[#8a8f98]">
                    {remoteSession.sessionLabel} · {remoteSession.screenLabel} ·{" "}
                    {remoteSession.commenterLabel}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void invoke("open_dashboard")}
                    >
                      Worldwide, profiles & app settings
                    </Button>
                    <Updater />
                  </div>
                  <SettingsPanel
                    vadConfig={vadConfig}
                    onUpdateVadConfig={updateVadConfiguration}
                    useSystemPrompt={useSystemPrompt}
                    setUseSystemPrompt={setUseSystemPrompt}
                    savedPrompts={savedPrompts}
                    selectedPromptId={selectedPromptId}
                    onSelectPrompt={handleSelectPrompt}
                  />
                  <Warning isVadMode={isVadMode} />
                </div>
              )}

              {/* Detail view when an entry is selected from the side chat panel */}
              {selectedMessageId && (selectedMessage || selectedComment) ? (
                <div className="space-y-4">
                  {selectedMessage?.role === "assistant" && (
                    <>
                      {precedingQuestion && (
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-xs space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-emerald-400">
                            <HeadphonesIcon className="h-3 w-3" />
                            <span>Interview / Question:</span>
                          </div>
                          <p className="text-sm font-medium text-white">{precedingQuestion.content}</p>
                        </div>
                      )}
                      <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-indigo-400">
                            <SparklesIcon className="h-3 w-3" />
                            <span>AI Response:</span>
                          </div>
                          <CopyButton content={selectedMessage.content} />
                        </div>
                        <div className="prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed text-[#e2e4e7]">
                          <Markdown>{selectedMessage.content}</Markdown>
                        </div>
                      </div>
                    </>
                  )}

                  {selectedMessage?.role === "user" && (
                    <>
                      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 space-y-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-emerald-400">
                          <HeadphonesIcon className="h-3 w-3" />
                          <span>Interview / Question:</span>
                        </div>
                        <p className="text-sm font-medium text-white">{selectedMessage.content}</p>
                      </div>
                      {succeedingResponse ? (
                        <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-indigo-400">
                              <SparklesIcon className="h-3 w-3" />
                              <span>AI Response:</span>
                            </div>
                            <CopyButton content={succeedingResponse.content} />
                          </div>
                          <div className="prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed text-[#e2e4e7]">
                            <Markdown>{succeedingResponse.content}</Markdown>
                          </div>
                        </div>
                      ) : selectedMessage.id === "pending" ? (
                        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs text-amber-300">
                          This question is pending submission. Click the Submit button at the bottom right to send it to AI.
                        </div>
                      ) : null}
                    </>
                  )}

                  {selectedComment && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-amber-300">
                          <MessageSquareIcon className="h-3.5 w-3.5 text-amber-400" />
                          <span>{selectedComment.device_name || "Twin Response"}:</span>
                        </div>
                        <CopyButton content={selectedComment.text} />
                      </div>
                      <VerbatimText text={selectedComment.text} />
                    </div>
                  )}
                </div>
              ) : (
                /* Live response view */
                <>
                  {attachedScreenshots.length > 0 ? (
                    <div className="rounded-xl border border-[#7170ff]/20 bg-[#7170ff]/[0.06] p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-[#d0d6e0]">Attached screenshots</p>
                          <p className="text-[11px] text-[#8a8f98]">
                            Sent with the next submitted question
                          </p>
                        </div>
                        <span className="text-[11px] text-[#8a8f98]">
                          {attachedScreenshots.length}/{MAX_FILES}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {attachedScreenshots.map((image, index) => (
                          <div key={index} className="group relative">
                            <img
                              src={`data:image/png;base64,${image}`}
                              alt={`Screenshot ${index + 1}`}
                              className="h-20 w-full rounded-lg border border-white/10 object-cover"
                            />
                            <Button
                              size="icon"
                              variant="destructive"
                              className="absolute right-1.5 top-1.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => removeScreenshot(index)}
                              title="Remove screenshot"
                            >
                              <XIcon className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {error && !setupRequired ? (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-red-200">
                      <AlertCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium">Something needs attention</p>
                        <p className="mt-1 text-xs text-red-200/80">{error}</p>
                      </div>
                    </div>
                  ) : null}

                  {setupRequired ? (
                    <PermissionFlow
                      onPermissionGranted={() => startCapture()}
                      onPermissionDenied={() => undefined}
                    />
                  ) : (
                    <>
                      {responseSource === "chat" ? (
                        <div className="w-full space-y-3">
                          {typedResponse}
                          {remoteComments.length > 0 && (
                            <div className="w-full space-y-2.5 pt-3 border-t border-white/8">
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
                                  <VerbatimText text={comment.text} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : hasResponse ? (
                        <ResultsSection
                          lastTranscription={lastTranscription}
                          lastAIResponse={lastAIResponse}
                          pendingManualQuestion={pendingManualQuestion}
                          onSubmitPending={submitPendingQuestion}
                          remoteComments={remoteComments}
                          isAIProcessing={isAIProcessing}
                          conversation={conversation}
                          conversationMode={conversationMode}
                          setConversationMode={setConversationMode}
                          showInputs={false}
                        />
                      ) : (
                        <div className="flex min-h-40 w-full flex-col items-center justify-center px-4 py-6 text-center">
                          <SparklesIcon className="mb-3 h-5 w-5 text-[#8a8f98]" />
                          <h3 className="text-sm font-medium text-[#f7f8f8]">
                            Your next response will appear here
                          </h3>
                          <p className="mt-2 max-w-xs text-xs leading-5 text-[#8a8f98]">
                            Keep listening in automatic mode, or send the latest transcript from the left panel.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      }
      actions={
        <div className="w-full space-y-2">
          {composer}
          {/* Quick shortcuts commented out for now
          {!setupRequired && hasResponse ? (
            <QuickActions
              actions={quickActions}
              onActionClick={handleQuickActionClick}
              onAddAction={addQuickAction}
              onRemoveAction={removeQuickAction}
              isManaging={isManagingQuickActions}
              setIsManaging={setIsManagingQuickActions}
              show={showQuickActions}
              setShow={setShowQuickActions}
            />
          ) : null}
          */}
        </div>
      }
    />
  );
};
