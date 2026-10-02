// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultsSection } from "./ResultsSection";

describe("ResultsSection workspace mode", () => {
  it("keeps AI output while inputs are rendered in the listening pane", () => {
    render(
      <ResultsSection
        lastTranscription="System transcript"
        lastAIResponse="AI answer"
        pendingManualQuestion=""
        onSubmitPending={async () => undefined}
        remoteComments={[{ id: "1", text: "Remote note", device_name: "Commenter" }]}
        isAIProcessing={false}
        conversation={{ id: "c", title: "", createdAt: 0, updatedAt: 0, messages: [] }}
        conversationMode={false}
        setConversationMode={() => undefined}
        showInputs={false}
      />
    );

    expect(screen.getByText("AI answer")).toBeTruthy();
    expect(screen.queryByText("System transcript")).toBeNull();
    expect(screen.queryByText("Remote note")).toBeNull();
  });
});
