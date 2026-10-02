import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
describe("session-first architecture", () => {
  it("keeps the composer in the session workspace, not the compact header", () => {
    const source = read("./index.tsx");
    expect(source.includes("AudioVisualizer")).toBe(false);
    expect(source.includes("SessionCompletion")).toBe(true);
    expect(source.includes("startCapture()")).toBe(true);
  });
  it("renders the workspace inline rather than in a capture popover", () => {
    const source = read("./components/speech/index.tsx");
    expect(source).not.toContain("<PopoverContent");
    expect(source).not.toContain("<PopoverTrigger");
    expect(source).toContain("{composer}");
  });
  it("makes the shell the sole automatic sizing owner", () => {
    expect(read("../../hooks/useSystemAudio.ts")).not.toContain("resizeWindow(shouldOpenPopover)");
    expect(read("../../hooks/useCompletion.ts")).toContain("manageWindow");
  });
});
