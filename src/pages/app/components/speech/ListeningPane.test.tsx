// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListeningPane } from "./ListeningPane";

describe("ListeningPane", () => {
  it("renders full conversation history as scrollable one-liners and allows entry selection", () => {
    const onSelect = vi.fn();

    render(
      <ListeningPane
        conversation={{
          id: "conv-1",
          title: "Session",
          createdAt: 1000,
          updatedAt: 2000,
          messages: [
            { id: "msg-1", role: "user", content: "Explain the relay architecture", timestamp: 1000 },
            { id: "msg-2", role: "assistant", content: "The relay isolates media transport", timestamp: 1001 },
          ],
        }}
        transcription=""
        pendingManualQuestion=""
        isProcessing={false}
        remoteComments={[
          { id: "comment-1", text: "Mention reconnect behavior", device_name: "Shreya", timestamp: 1002 },
        ]}
        selectedMessageId={null}
        onSelectMessage={onSelect}
      />
    );

    expect(screen.getByText("Explain the relay architecture")).toBeTruthy();
    expect(screen.getByText("The relay isolates media transport")).toBeTruthy();
    expect(screen.getByText("Mention reconnect behavior")).toBeTruthy();
    expect(screen.getByText("Shreya")).toBeTruthy();

    // Verify clicking an entry invokes onSelectMessage
    fireEvent.click(screen.getByText("Explain the relay architecture"));
    expect(onSelect).toHaveBeenCalledWith("msg-1");
  });

  it("dynamically shows transcribing status when processing", () => {
    render(
      <ListeningPane
        isProcessing={true}
        capturing={true}
      />
    );

    expect(screen.getByText("Transcribing...")).toBeTruthy();
  });

  it("shows an instructional empty state before audio arrives", () => {
    render(
      <ListeningPane
        transcription=""
        pendingManualQuestion=""
        isProcessing={false}
        remoteComments={[]}
      />
    );

    expect(screen.getByText("Waiting for speech or a commenter message")).toBeTruthy();
  });

  it("deletes transcribed speech without selecting it, and only for speech entries", () => {
    const onSelect = vi.fn(), onDelete = vi.fn(), onDiscard = vi.fn();
    render(
      <ListeningPane
        conversation={{
          id: "conv-2",
          title: "Session",
          createdAt: 1000,
          updatedAt: 2000,
          messages: [
            { id: "u-1", role: "user", content: "What is your notice period?", timestamp: 1000 },
            { id: "a-1", role: "assistant", content: "Two weeks", timestamp: 1001 },
          ],
        }}
        pendingManualQuestion="And your salary expectations?"
        onSelectMessage={onSelect}
        onDeleteEntry={onDelete}
        onDiscardPending={onDiscard}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete transcribed speech" }));
    expect(onDelete).toHaveBeenCalledWith("u-1");
    expect(onSelect).not.toHaveBeenCalled();
    // AI answers have no delete button; only the one speech entry does.
    expect(screen.getAllByRole("button", { name: "Delete transcribed speech" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete pending speech" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});
