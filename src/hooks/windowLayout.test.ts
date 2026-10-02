import { describe, expect, it } from "vitest";
import { createWindowLayoutController, getWorkspaceWindowSize, parseWorkspaceGeometry } from "./windowLayout";

describe("getWorkspaceWindowSize", () => {
  it("uses a small idle pill and a sensible default workspace", () => {
    expect(getWorkspaceWindowSize(false, 1512, 982)).toEqual({ width: 460, height: 54 });
    expect(getWorkspaceWindowSize(true, 1512, 982)).toEqual({ width: 760, height: 600 });
  });

  it("restores saved dimensions within the monitor and expanded minimum", () => {
    expect(getWorkspaceWindowSize(true, 1512, 982, { width: 1000, height: 800 })).toEqual({ width: 1000, height: 800 });
    expect(getWorkspaceWindowSize(true, 900, 650, { width: 1000, height: 800 })).toEqual({ width: 868, height: 586 });
    expect(getWorkspaceWindowSize(true, 1512, 982, { width: 100, height: 100 })).toEqual({ width: 520, height: 360 });
    expect(getWorkspaceWindowSize(true, 400, 300)).toEqual({ width: 368, height: 236 });
  });

  it("rejects corrupt or non-finite persisted geometry rather than silently accepting it", () => {
    expect(parseWorkspaceGeometry(null)).toBeUndefined();
    expect(parseWorkspaceGeometry('{"width":900,"height":650,"x":-1200,"y":40}')).toEqual({ width: 900, height: 650, x: -1200, y: 40 });
    for (const value of ['broken', '{}', '{"width":null,"height":600}', '{"width":760,"height":54}', '{"width":760,"height":600,"x":4}']) {
      expect(() => parseWorkspaceGeometry(value)).toThrow();
    }
  });
});

describe("window layout lifecycle", () => {
  it("ignores late programmatic resize echoes and restores preferences after restart", async () => {
    let resized: (size: { width: number; height: number }) => void = () => {};
    let raw = '{"width":1000,"height":800,"x":100,"y":50}';
    const controller = createWindowLayoutController({
      storage: { getItem: () => raw, setItem: (_key, value) => { raw = value; } },
      availableSize: async () => ({ width: 900, height: 650 }),
      apply: async () => {},
      onResized: async (listener) => { resized = listener; return () => {}; },
      onMoved: async () => () => {},
      reportError: (error) => { throw error; },
    });
    const release = controller.attach();
    await controller.resize(true);
    resized({ width: 868, height: 586 });
    expect(JSON.parse(raw)).toEqual({ width: 1000, height: 800, x: 100, y: 50 });
    release();
  });

  it("reports invalid storage and stays usable with defaults", async () => {
    const errors: unknown[] = [];
    const applied: unknown[] = [];
    const controller = createWindowLayoutController({
      storage: { getItem: () => "broken", setItem: () => {} },
      availableSize: async () => ({ width: 1512, height: 982 }),
      apply: async (geometry) => { applied.push(geometry); },
      onResized: async () => () => {}, onMoved: async () => () => {},
      reportError: (error) => { errors.push(error); },
    });
    await controller.resize(true);
    expect(errors).toHaveLength(1);
    expect(applied).toEqual([{ width: 760, height: 600, expanded: true }]);
  });

  it("shares listeners across consumers and cleans up registrations that finish after unmount", async () => {
    let registrations = 0;
    let cleanups = 0;
    let resolveResize!: (stop: () => void) => void;
    const controller = createWindowLayoutController({
      storage: { getItem: () => null, setItem: () => {} },
      availableSize: async () => ({ width: 1512, height: 982 }), apply: async () => {},
      onResized: () => { registrations++; return new Promise((resolve) => { resolveResize = resolve; }); },
      onMoved: async () => { registrations++; return () => { cleanups++; }; },
      reportError: (error) => { throw error; },
    });
    const first = controller.attach();
    const second = controller.attach();
    await Promise.resolve();
    expect(registrations).toBe(2);
    first();
    expect(cleanups).toBe(0);
    second();
    second();
    resolveResize(() => { cleanups++; });
    await Promise.resolve();
    expect(cleanups).toBe(2);
  });

  it("does not overwrite size preferences when moving a default-sized workspace", async () => {
    let moved: (position: { x: number; y: number }) => void = () => {};
    let raw: string | null = null;
    const controller = createWindowLayoutController({
      storage: { getItem: () => raw, setItem: (_key, value) => { raw = value; } },
      availableSize: async () => ({ width: 1512, height: 982 }), apply: async () => {},
      onResized: async () => () => {},
      onMoved: async (listener) => { moved = listener; return () => {}; },
      reportError: (error) => { throw error; },
    });
    const release = controller.attach();
    await controller.resize(true);
    moved({ x: 100, y: 80 });
    expect(JSON.parse(raw!)).toEqual({ width: 760, height: 600, x: 100, y: 80 });
    release();
  });

  it("persists user geometry, ignores compact transitions and cleans up native listeners", async () => {
    let resized: (size: { width: number; height: number }) => void = () => {};
    let moved: (position: { x: number; y: number }) => void = () => {};
    let saved: string | null = null;
    let cleanups = 0;
    const applied: unknown[] = [];
    const controller = createWindowLayoutController({
      storage: { getItem: () => saved, setItem: (_key, value) => { saved = value; } },
      availableSize: async () => ({ width: 1512, height: 982 }),
      apply: async (geometry) => {
        applied.push(geometry);
        // Native transition events must not overwrite remembered user dimensions.
        resized(geometry);
        moved({ x: 0, y: 0 });
      },
      onResized: async (listener) => { resized = listener; return () => { cleanups++; }; },
      onMoved: async (listener) => { moved = listener; return () => { cleanups++; }; },
      reportError: (error) => { throw error; },
    });
    const release = controller.attach();
    await Promise.resolve();
    await controller.resize(true);
    resized({ width: 950, height: 700 });
    moved({ x: -900, y: 100 });
    expect(JSON.parse(saved!)).toEqual({ width: 950, height: 700, x: -900, y: 100 });
    await controller.resize(false);
    resized({ width: 460, height: 54 });
    moved({ x: 100, y: 200 });
    await controller.resize(true);
    expect(applied[applied.length - 1]).toEqual({ width: 950, height: 700, x: -900, y: 100, expanded: true });
    expect(JSON.parse(saved!)).toEqual({ width: 950, height: 700, x: -900, y: 100 });
    release();
    expect(cleanups).toBe(2);
  });
});
