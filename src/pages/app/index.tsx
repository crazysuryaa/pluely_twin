import { useEffect, useRef, useState } from "react";
import { CustomCursor } from "@/components";
import { SystemAudio } from "./components";
import { useApp } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";
import { CompactBar } from "./CompactBar";
import { SessionCompletion } from "./components/completion/SessionCompletion";
import { useRemoteSessionStatus } from "@/hooks/useRemoteSessionStatus";

const App = () => {
  const { isHidden, systemAudio } = useApp();
  const { customizable } = useAppContext();
  const remoteSession = useRemoteSessionStatus();
  const [expanded, setExpanded] = useState(false);
  const [sessionRequested, setSessionRequested] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState("00:00");
  const startedAt = useRef<number | null>(null);
  const wasCapturing = useRef(false);
  const active = sessionRequested || systemAudio.capturing;
  const { resizeWindow } = systemAudio;

  // Explicit shell state is the only source of window-mode transitions.
  useEffect(() => { void resizeWindow(expanded); }, [expanded, resizeWindow]);
  // A keyboard capture start reveals the session once, not on every transcript.
  useEffect(() => {
    if (systemAudio.capturing && !wasCapturing.current) {
      setSessionRequested(true);
      setExpanded(true);
    }
    if (!systemAudio.capturing && wasCapturing.current) setSessionRequested(false);
    wasCapturing.current = systemAudio.capturing;
  }, [systemAudio.capturing]);
  useEffect(() => {
    if (!active) { startedAt.current = null; setElapsed("00:00"); return; }
    startedAt.current ??= Date.now();
    const update = () => {
      const seconds = Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000);
      setElapsed(`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [active]);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setSessionRequested(true);
    setExpanded(true);
    try { await systemAudio.startCapture(); } finally { setBusy(false); }
  };
  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try { await systemAudio.stopCapture(); setSessionRequested(false); } finally { setBusy(false); }
    // Keep the workspace available for errors, history and typed questions.
  };
  const openDashboard = () => { void invoke("open_dashboard").catch(console.error); };
  const quit = () => { void invoke("exit_app").catch(console.error); };

  // Explicit session settings open: MUST never minimize! Always expands window if needed and opens settings.
  const handleSessionSettings = () => {
    setExpanded(true);
    setSettingsOpen(true);
  };

  const handleCloseSessionSettings = () => {
    setSettingsOpen(false);
    // Preserves window expansion - never minimizes!
  };

  const handleGlobalSettings = () => {
    openDashboard();
  };

  return (
    <ErrorBoundary fallbackRender={() => <ErrorLayout isCompact />}>
      <SessionCompletion
        isHidden={isHidden || !expanded}
        pendingManualQuestion={systemAudio.pendingManualQuestion}
        onSubmitPending={systemAudio.submitPendingQuestion}
        isAIProcessing={systemAudio.isAIProcessing}
      >
        {({ composer, response, hasResponse }) => (
          <div className={`relative flex h-screen w-screen min-h-0 flex-col gap-1 overflow-hidden ${isHidden ? "hidden pointer-events-none" : ""}`}>
            <CompactBar
              active={active}
              expanded={expanded}
              elapsed={elapsed}
              profile="Current profile"
              busy={busy}
              onStart={() => void start()}
              onStop={() => void stop()}
              onToggleExpanded={() => setExpanded((value) => !value)}
              onSettings={handleSessionSettings}
              onSessionSettings={handleSessionSettings}
              onGlobalSettings={handleGlobalSettings}
              settingsOpen={settingsOpen}
              onOpenDashboard={openDashboard}
              onQuit={quit}
            />
            <div hidden={!expanded} className={expanded ? "min-h-0 min-w-0 flex-1 w-full" : "hidden"}>
              <SystemAudio
                {...systemAudio}
                remoteSession={remoteSession}
                composer={composer}
                typedResponse={response}
                hasTypedResponse={hasResponse}
                settingsOpen={settingsOpen}
                onToggleSettings={handleSessionSettings}
                onCloseSettings={handleCloseSessionSettings}
                expanded={expanded}
              />
            </div>
            {expanded && <button aria-label="Resize session window" title="Drag to resize" className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize text-white/40" onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              void getCurrentWindow().startResizeDragging("SouthEast").catch(console.error);
            }}>◢</button>}
            {customizable.cursor.type === "invisible" && getPlatform() !== "linux" && !isHidden && <CustomCursor />}
          </div>
        )}
      </SessionCompletion>
    </ErrorBoundary>
  );
};
export default App;
