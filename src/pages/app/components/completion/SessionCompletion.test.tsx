// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useCompletion } from "@/hooks/useCompletion";
import { ScrollArea } from "@/components";
import { SessionCompletion } from "./SessionCompletion";

const mocks = vi.hoisted(() => ({ useCompletion: vi.fn() }));
vi.mock("@/hooks/useCompletion", () => ({ useCompletion: mocks.useCompletion }));
// Hardware-dependent controls remain the existing components in production.
vi.mock("./Audio", () => ({ Audio: () => <button>Voice input</button> }));
vi.mock("./Screenshot", () => ({ Screenshot: () => <button>Screenshot</button> }));
vi.mock("./Files", () => ({ Files: () => <button>Attach images</button> }));

type Completion = ReturnType<typeof useCompletion>;
let completion: Completion;

function mount(isHidden = false) {
  return render(
    <SessionCompletion isHidden={isHidden}>
      {({ composer, response, hasResponse }) => (
        <>
          <div data-testid="composer">{composer}</div>
          <ScrollArea data-testid="response" data-has-response={String(hasResponse)}>{response}</ScrollArea>
        </>
      )}
    </SessionCompletion>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  completion = {
    input: "Explain this", response: "", error: null, isLoading: false,
    inputRef: { current: null }, scrollAreaRef: { current: null },
    attachedFiles: [], conversationHistory: [], currentConversationId: null,
    keepEngaged: false, messageHistoryOpen: false,
    setInput: vi.fn(), submit: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(), reset: vi.fn(), handleKeyPress: vi.fn(),
    handlePaste: vi.fn().mockResolvedValue(undefined), setKeepEngaged: vi.fn(),
    startNewConversation: vi.fn(), setMessageHistoryOpen: vi.fn(),
  } as unknown as Completion;
  mocks.useCompletion.mockImplementation(() => completion);
});
afterEach(cleanup);

describe("SessionCompletion", () => {
  it("keeps the composer and response mounted but disables composer controls when compact", () => {
    completion.response = "Persistent answer";
    mount(true);
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Voice input" }).closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByText("Persistent answer")).toBeTruthy();
    expect(completion.inputRef.current).toBeTruthy();
    expect(completion.reset).not.toHaveBeenCalled();
  });

  it("uses the parent response scroller rather than adding a nested or fixed-height scroll region", () => {
    completion.response = "Inline content";
    const { container } = mount();
    expect(container.querySelectorAll('[data-slot="scroll-area"]')).toHaveLength(1);
    expect(completion.scrollAreaRef.current).toBe(screen.getByTestId("response"));
  });

  it("lets a loaded conversation show history inline and start a new chat", () => {
    completion.currentConversationId = "saved";
    completion.conversationHistory = [{ id: "1", role: "assistant", content: "Saved answer", timestamp: 1 }];
    completion.messageHistoryOpen = true;
    const { container } = mount();
    expect(screen.getByText("Saved answer")).toBeTruthy();
    expect(container.querySelector('[data-slot="popover-content"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Current Conversation" }));
    expect(completion.setMessageHistoryOpen).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "New Chat" }));
    expect(completion.startNewConversation).toHaveBeenCalledOnce();
    expect(completion.setMessageHistoryOpen).toHaveBeenCalledWith(false);
  });

  it("shows inline conversation history without duplicating the current answer or mutating hook state", () => {
    completion.currentConversationId = "conversation-1";
    completion.response = "Latest answer";
    completion.keepEngaged = true;
    completion.conversationHistory = Object.freeze([
      { id: "u1", role: "user", content: "First question", timestamp: 1 },
      { id: "a1", role: "assistant", content: "Previous answer", timestamp: 2 },
      { id: "u2", role: "user", content: "Latest question", timestamp: 3 },
      { id: "a2", role: "assistant", content: "Latest answer", timestamp: 4 },
    ]) as unknown as Completion["conversationHistory"];
    mount();
    expect(screen.getAllByText("Latest answer")).toHaveLength(1);
    expect(screen.getByText("Previous answer")).toBeTruthy();
    expect(screen.getByText("Latest question")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Conversation mode" }));
    expect(completion.setKeepEngaged).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Close and start new conversation" }));
    expect(completion.startNewConversation).toHaveBeenCalledOnce();
    expect(completion.conversationHistory[0].id).toBe("u1");
  });

  it("offers cancellation in the composer while streaming and keeps partial output", () => {
    completion.isLoading = true;
    completion.response = "Partial answer";
    mount();
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Generating response...")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel loading" }));
    expect(completion.cancel).toHaveBeenCalledOnce();
    expect(screen.getByText("Partial answer")).toBeTruthy();
    expect(completion.reset).not.toHaveBeenCalled();
  });

  it("opts out of hook resizing so the session shell owns window dimensions", () => {
    mount();
    expect(mocks.useCompletion).toHaveBeenCalledWith({ manageWindow: false });
  });

  it("renders a response inline with copy, errors, and the existing scroll ref", () => {
    completion.response = "Typed answer";
    completion.error = "Provider failed";
    const { container } = mount();
    expect(screen.getByText("Typed answer")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Provider failed");
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
    expect(completion.scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]")).toBeTruthy();
    expect(screen.getByTestId("response").getAttribute("data-has-response")).toBe("true");
    expect(container.querySelector('[data-slot="popover-content"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(completion.reset).toHaveBeenCalledOnce();
  });

  it("provides separate inline slots with a single completion owner and existing controls", () => {
    const { container } = mount();
    expect(mocks.useCompletion).toHaveBeenCalledOnce();
    const input = screen.getByRole("textbox", { name: "Ask AI" });
    expect(completion.inputRef.current).toBe(input);
    fireEvent.change(input, { target: { value: "Next question" } });
    expect(completion.setInput).toHaveBeenCalledWith("Next question");
    fireEvent.keyPress(input, { key: "Enter", charCode: 13 });
    expect(completion.handleKeyPress).toHaveBeenCalledOnce();
    fireEvent.paste(input);
    expect(completion.handlePaste).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(completion.submit).toHaveBeenCalledWith();
    for (const name of ["Voice input", "Screenshot", "Attach images"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByTestId("response").getAttribute("data-has-response")).toBe("false");
    expect(container.querySelector('[data-slot="popover-content"]')).toBeNull();
  });
});
