import { describe, expect, it } from "vitest";
import { describeRemoteSession } from "./useRemoteSessionStatus";

describe("describeRemoteSession", () => {
  it("projects relay and screen-share state independently", () => {
    expect(
      describeRemoteSession(
        { active: true, mode: "relay" },
        { status: "reconnecting", retry_in_seconds: 8 },
        { status: "streaming" },
        1
      )
    ).toEqual({
      sessionLabel: "Worldwide reconnecting in 8s",
      screenLabel: "Screen live",
      commenterLabel: "1 commenter",
      active: true,
    });
  });

  it("reports an inactive session without implying screen sharing", () => {
    expect(describeRemoteSession(null, null, { status: "stopped" }, 0)).toEqual({
      sessionLabel: "No Worldwide session",
      screenLabel: "Screen off",
      commenterLabel: "No commenters",
      active: false,
    });
  });
});
