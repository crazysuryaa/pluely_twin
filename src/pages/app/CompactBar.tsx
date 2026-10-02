import { useState, useEffect } from "react";
import {
  PlayIcon,
  SquareIcon,
  SlidersHorizontalIcon,
  Maximize2Icon,
  Minimize2Icon,
  ShieldCheckIcon,
  UserIcon,
  PowerIcon,
} from "lucide-react";
import { DragButton } from "@/components";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface CompactBarProps {
  active: boolean;
  expanded: boolean;
  elapsed: string;
  profile: string;
  busy?: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleExpanded: () => void;
  onSettings?: () => void;
  onSessionSettings?: () => void;
  onGlobalSettings?: () => void;
  settingsOpen?: boolean;
  onOpenDashboard?: () => void;
  onQuit?: () => void;
}

export const CompactBar = ({
  active,
  expanded,
  elapsed,
  profile,
  busy,
  onStart,
  onStop,
  onToggleExpanded,
  onSettings,
  onSessionSettings,
  onGlobalSettings,
  settingsOpen = false,
  onOpenDashboard,
  onQuit,
}: CompactBarProps) => {
  const [confirmQuit, setConfirmQuit] = useState(false);

  useEffect(() => {
    if (!confirmQuit) return;
    const timer = setTimeout(() => {
      setConfirmQuit(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [confirmQuit]);

  return (
  <header
    data-tauri-drag-region="true"
    data-compact-bar="true"
    style={{
      backgroundColor: "rgba(23, 21, 31, var(--opacity, 1))",
    }}
    onMouseDown={(e) => {
      // If clicking directly on draggable regions of the header
      if (
        e.button === 0 &&
        (e.target as HTMLElement).getAttribute("data-tauri-drag-region") === "true"
      ) {
        void getCurrentWindow().startDragging().catch(console.error);
      }
    }}
    className="flex h-[54px] w-full shrink-0 items-center gap-2 overflow-hidden rounded-2xl border border-white/10 px-3 text-[#f7f8f8]"
  >
    <div
      data-tauri-drag-region="true"
      onMouseDown={(e) => {
        if (e.button === 0) void getCurrentWindow().startDragging().catch(console.error);
      }}
      className="flex shrink-0 items-center gap-1.5 text-sm font-semibold select-none cursor-grab"
    >
      <ShieldCheckIcon className="h-4 w-4 text-emerald-400 pointer-events-none" />
      <span className="pointer-events-none">Pluely</span>
    </div>
    <span className="h-5 w-px shrink-0 bg-white/15" />

    {/* Empty space stays draggable and pushes actions to the right */}
    <div data-tauri-drag-region="true" className="h-full min-w-0 flex-1" />

    {/* Start / Stop button */}
    <button
      aria-label={active ? "Stop session" : "Start session"}
      title={active ? "Stop session" : "Start session"}
      disabled={busy}
      onClick={active ? onStop : onStart}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
        active ? "bg-rose-500 text-white" : "bg-white/10 hover:bg-white/20"
      }`}
    >
      {active ? (
        <SquareIcon className="h-3.5 w-3.5 fill-current" />
      ) : (
        <PlayIcon className="h-4 w-4 fill-current" />
      )}
    </button>
    {active && (
      <span className="shrink-0 font-mono text-xs tabular-nums select-none">
        {elapsed}
      </span>
    )}

    {/* Session settings toggle button (viewer panel session settings) */}
    <button
      aria-label="Session settings"
      title="Session settings (within viewer)"
      onClick={onSessionSettings || onSettings}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
        settingsOpen
          ? "bg-white/20 text-white"
          : "hover:bg-white/10 text-zinc-300"
      }`}
    >
      <SlidersHorizontalIcon className="h-4 w-4" />
    </button>

    {/* Profile & global settings (opens dashboard) */}
    <button
      aria-label="Profile and settings"
      title={`${profile} · settings`}
      onClick={onGlobalSettings || onOpenDashboard || onSettings}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10 text-indigo-400 transition-colors"
    >
      <UserIcon className="h-4 w-4" />
    </button>

    {/* Expand / Collapse session */}
    {(active || expanded) && (
      <button
        aria-label={expanded ? "Collapse session" : "Expand session"}
        title={expanded ? "Collapse session" : "Expand session"}
        onClick={onToggleExpanded}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10 text-zinc-300"
      >
        {expanded ? (
          <Minimize2Icon className="h-4 w-4" />
        ) : (
          <Maximize2Icon className="h-4 w-4" />
        )}
      </button>
    )}

    {/* Quit button (to close the app) */}
    {onQuit && (
      confirmQuit ? (
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/60 px-2 py-1 text-xs">
          <span className="font-medium text-rose-200 select-none">Quit?</span>
          <button
            onClick={() => {
              setConfirmQuit(false);
              onQuit();
            }}
            aria-label="Confirm quit"
            className="rounded bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-500 transition-colors"
          >
            Quit
          </button>
          <button
            onClick={() => setConfirmQuit(false)}
            aria-label="Cancel quit"
            className="rounded bg-white/10 px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/20 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          aria-label="Quit app"
          title="Quit Pluely"
          onClick={() => setConfirmQuit(true)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
        >
          <PowerIcon className="h-4 w-4" />
        </button>
      )
    )}

    {/* Drag handle */}
    <DragButton />
  </header>
  );
};
