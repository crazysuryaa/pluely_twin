import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { snapToNearestEdge } from "./CustomCursor";

describe("snapToNearestEdge", () => {
  it("snaps to whichever window edge the entry point is closest to", () => {
    expect(snapToNearestEdge(3, 30, 460, 54)).toEqual({ x: 0, y: 30 });
    expect(snapToNearestEdge(457, 30, 460, 54)).toEqual({ x: 460, y: 30 });
    expect(snapToNearestEdge(200, 2, 460, 54)).toEqual({ x: 200, y: 0 });
    expect(snapToNearestEdge(200, 52, 460, 54)).toEqual({ x: 200, y: 54 });
  });
});
