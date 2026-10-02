// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/contexts", () => ({ useApp: () => ({ hasActiveLicense: true }) }));
import { CompactBar } from "./CompactBar";
afterEach(cleanup);
describe("session-first header", () => {
  it("shows an explicit Start action without a composer or capture utilities", () => {
    const onStart = vi.fn();
    render(<CompactBar active={false} expanded={false} elapsed="00:00" profile="Current profile" onStart={onStart} onStop={vi.fn()} onToggleExpanded={vi.fn()} onSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "Start session"}));
    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Worldwide off")).toBeNull();
  });
  it("can reveal a running session without stopping capture", () => {
    const onToggleExpanded = vi.fn(), onStop = vi.fn();
    render(<CompactBar active expanded={false} elapsed="00:25" profile="Current profile" onStart={vi.fn()} onStop={onStop} onToggleExpanded={onToggleExpanded} onSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "Expand session"}));
    expect(onToggleExpanded).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByText("00:25")).toBeTruthy();
  });
  it("triggers dashboard and requires confirmation before quit action", () => {
    const onOpenDashboard = vi.fn(), onQuit = vi.fn();
    render(<CompactBar active={false} expanded={false} elapsed="00:00" profile="My Profile" onStart={vi.fn()} onStop={vi.fn()} onToggleExpanded={vi.fn()} onSettings={vi.fn()} onOpenDashboard={onOpenDashboard} onQuit={onQuit} />);
    fireEvent.click(screen.getByRole("button", {name: "Profile and settings"}));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", {name: "Global settings"})).toBeNull();

    fireEvent.click(screen.getByRole("button", {name: "Quit app"}));
    expect(onQuit).not.toHaveBeenCalled();
    expect(screen.getByText("Quit?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", {name: "Confirm quit"}));
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("can cancel quit confirmation", () => {
    const onQuit = vi.fn();
    render(<CompactBar active={false} expanded={false} elapsed="00:00" profile="My Profile" onStart={vi.fn()} onStop={vi.fn()} onToggleExpanded={vi.fn()} onSettings={vi.fn()} onQuit={onQuit} />);

    fireEvent.click(screen.getByRole("button", {name: "Quit app"}));
    expect(screen.getByText("Quit?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", {name: "Cancel quit"}));
    expect(onQuit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", {name: "Quit app"})).toBeTruthy();
  });

  it("provides distinct session settings and global settings actions without toggling expansion", () => {
    const onSessionSettings = vi.fn();
    const onGlobalSettings = vi.fn();
    const onToggleExpanded = vi.fn();

    render(
      <CompactBar
        active={false}
        expanded={false}
        elapsed="00:00"
        profile="My Profile"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleExpanded={onToggleExpanded}
        onSessionSettings={onSessionSettings}
        onGlobalSettings={onGlobalSettings}
      />
    );

    // Both settings buttons must be rendered
    const sessionSettingsBtn = screen.getByRole("button", { name: "Session settings" });
    const globalSettingsBtn = screen.getByRole("button", { name: "Profile and settings" });
    expect(sessionSettingsBtn).toBeTruthy();
    expect(globalSettingsBtn).toBeTruthy();

    // Clicking session settings triggers onSessionSettings, NOT onToggleExpanded
    fireEvent.click(sessionSettingsBtn);
    expect(onSessionSettings).toHaveBeenCalledOnce();
    expect(onToggleExpanded).not.toHaveBeenCalled();

    // Clicking global settings triggers onGlobalSettings, NOT onToggleExpanded
    fireEvent.click(globalSettingsBtn);
    expect(onGlobalSettings).toHaveBeenCalledOnce();
    expect(onToggleExpanded).not.toHaveBeenCalled();
  });

  it("applies dynamic transparency attributes to the compact bar header", () => {
    const { container } = render(
      <CompactBar
        active={false}
        expanded={false}
        elapsed="00:00"
        profile="My Profile"
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleExpanded={vi.fn()}
      />
    );

    const header = container.querySelector('[data-compact-bar="true"]') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.backgroundColor).toContain("var(--opacity");
  });
});
