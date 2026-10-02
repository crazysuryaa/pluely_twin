import type { ReactNode } from "react";

interface LiveWorkspaceProps {
  controls?: ReactNode;
  listening: ReactNode;
  response: ReactNode;
  actions: ReactNode;
  isFullScreen?: boolean;
}

export const LiveWorkspace = ({
  controls,
  listening,
  response,
  actions,
  isFullScreen = false,
}: LiveWorkspaceProps) => {
  return (
    <div
      data-workspace="true"
      style={{
        backgroundColor: "rgba(11, 13, 18, var(--opacity, 1))",
      }}
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] border border-white/10 text-[#f7f8f8] shadow-2xl shadow-black/40"
    >
      {controls && (
        <div
          role="toolbar"
          aria-label="Live session controls"
          data-workspace-toolbar="true"
          className="flex min-h-16 w-full flex-shrink-0 items-center border-b border-white/8 bg-transparent px-4 py-3"
        >
          {controls}
        </div>
      )}

      <div
        className={`min-h-0 min-w-0 flex-1 w-full ${
          isFullScreen
            ? "flex w-full flex-col"
            : "grid grid-cols-[minmax(180px,0.28fr)_minmax(0,0.72fr)] w-full"
        }`}
      >
        {!isFullScreen && (
          <section
            aria-label="Listening and commenter feed"
            data-workspace-listening="true"
            className="min-h-0 min-w-0 overflow-hidden border-r border-white/8 bg-transparent flex flex-col"
          >
            {listening}
          </section>
        )}

        <section
          aria-label="AI response"
          data-workspace-response="true"
          className="min-h-0 min-w-0 flex-1 w-full overflow-hidden bg-transparent flex flex-col"
        >
          {response}
        </section>
      </div>

      <section
        aria-label="Workspace actions"
        data-workspace-actions="true"
        className="flex-shrink-0 w-full border-t border-white/8 bg-transparent px-3 py-2"
      >
        {actions}
      </section>
    </div>
  );
};
