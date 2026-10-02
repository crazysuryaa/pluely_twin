// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const audio = vi.hoisted(() => ({ capturing: false, startCapture: vi.fn(async () => undefined), stopCapture: vi.fn(async () => undefined), resizeWindow: vi.fn(async () => undefined) }));
vi.mock("@/hooks", () => ({ useApp: () => ({isHidden:false, systemAudio:audio}) }));
vi.mock("@/contexts", () => ({useApp: () => ({customizable:{cursor:{type:"default"}}})}));
vi.mock("@/hooks/useRemoteSessionStatus", () => ({useRemoteSessionStatus: () => ({active:false})}));
vi.mock("@/components", () => ({CustomCursor: () => null, DragButton: () => null}));
vi.mock("./components", () => ({SystemAudio: ({composer}: {composer: React.ReactNode}) => <section aria-label="Session workspace">{composer}</section>}));
vi.mock("./components/completion/SessionCompletion", () => ({SessionCompletion: ({children}: {children: (slots: object) => React.ReactNode}) => children({composer:<input aria-label="Ask Pluely" />,response:null,hasResponse:false})}));
vi.mock("@tauri-apps/api/core", () => ({invoke: vi.fn(async () => undefined)}));
vi.mock("@tauri-apps/api/window", () => ({getCurrentWindow: () => ({startResizeDragging: vi.fn(), startDragging: vi.fn()})}));
vi.mock("@/lib", () => ({getPlatform: () => "macos"}));
vi.mock("@/layouts", () => ({ErrorLayout: () => <p>Error</p>}));
import App from "./index";
afterEach(() => {cleanup(); vi.clearAllMocks();});
describe("session lifecycle", () => {
  it("keeps capture off until Start, reveals the composer, and collapses without stopping", async () => {
    render(<App />);
    expect(audio.startCapture).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name:"Start session"}));
    await waitFor(() => expect(audio.startCapture).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", {name:"Ask Pluely"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"Collapse session"}));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(audio.stopCapture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name:"Expand session"}));
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(audio.startCapture).toHaveBeenCalledOnce();
  });

  it("clicking session settings or global settings does not collapse the workspace", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", {name:"Start session"}));
    await waitFor(() => expect(audio.startCapture).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", {name:"Ask Pluely"})).toBeTruthy();

    // Clicking session settings does NOT collapse
    fireEvent.click(screen.getByRole("button", {name:"Session settings"}));
    expect(screen.getByRole("textbox", {name:"Ask Pluely"})).toBeTruthy();

    // Clicking global settings does NOT collapse
    fireEvent.click(screen.getByRole("button", {name:"Profile and settings"}));
    expect(screen.getByRole("textbox", {name:"Ask Pluely"})).toBeTruthy();
  });

  it("clicking session settings while compact expands the workspace and never minimizes", async () => {
    render(<App />);
    expect(screen.queryByRole("textbox")).toBeNull();

    // Clicking session settings MUST expand if needed
    fireEvent.click(screen.getByRole("button", { name: "Session settings" }));
    expect(screen.getByRole("textbox", { name: "Ask Pluely" })).toBeTruthy();

    // Clicking session settings again MUST NOT minimize
    fireEvent.click(screen.getByRole("button", { name: "Session settings" }));
    expect(screen.getByRole("textbox", { name: "Ask Pluely" })).toBeTruthy();
  });
});
