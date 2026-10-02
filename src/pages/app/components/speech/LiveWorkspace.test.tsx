// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveWorkspace } from "./LiveWorkspace";

describe("LiveWorkspace", () => {
  it("keeps live controls, listening context, AI output, and actions in separate regions", () => {
    render(
      <LiveWorkspace
        controls={<button>Stop listening</button>}
        listening={<p>Latest system transcription</p>}
        response={<p>Generated AI response</p>}
        actions={<button>Summarize</button>}
      />
    );

    expect(screen.getByRole("toolbar", { name: "Live session controls" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Listening and commenter feed" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "AI response" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Workspace actions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop listening" })).toBeTruthy();
    expect(screen.getByText("Latest system transcription")).toBeTruthy();
    expect(screen.getByText("Generated AI response")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Summarize" })).toBeTruthy();
  });

  it("applies dynamic transparency attributes to workspace containers", () => {
    const { container } = render(
      <LiveWorkspace
        controls={<div>Controls</div>}
        listening={<div>Feed</div>}
        response={<div>AI</div>}
        actions={<div>Actions</div>}
      />
    );

    const workspace = container.querySelector('[data-workspace="true"]') as HTMLElement;
    expect(workspace).toBeTruthy();
    expect(workspace.style.backgroundColor).toContain("var(--opacity");
  });
});
