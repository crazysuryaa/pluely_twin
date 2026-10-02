export type WorkspaceWindowSize = { width: number; height: number };
export type WorkspacePosition = { x: number; y: number };
export type WorkspaceGeometry = WorkspaceWindowSize & Partial<WorkspacePosition>;
export const WINDOW_GEOMETRY_KEY = "pluely.workspace-window.v1";
export const MIN_EXPANDED_SIZE = { width: 520, height: 360 };

export function getWorkspaceWindowSize(
  expanded: boolean,
  availableWidth: number,
  availableHeight: number,
  saved: WorkspaceWindowSize = { width: 760, height: 600 }
): WorkspaceWindowSize {
  const maxWidth = Math.max(1, availableWidth - 32);
  const maxHeight = Math.max(1, availableHeight - 64);
  return expanded
    ? {
        width: Math.round(Math.min(maxWidth, Math.max(520, saved.width))),
        height: Math.round(Math.min(maxHeight, Math.max(360, saved.height))),
      }
    : { width: Math.min(460, maxWidth), height: Math.min(54, maxHeight) };
}

export function parseWorkspaceGeometry(raw: string | null): WorkspaceGeometry | undefined {
  if (raw === null) return undefined;
  const value = JSON.parse(raw);
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!value || !finite(value.width) || !finite(value.height) ||
      value.width <= 0 || value.height <= 54 ||
      ((value.x !== undefined || value.y !== undefined) && (!finite(value.x) || !finite(value.y)))) {
    throw new Error("Invalid saved workspace window geometry");
  }
  return { width: value.width, height: value.height,
    ...(value.x !== undefined ? { x: value.x, y: value.y } : {}) };
}

type Unlisten = () => void;
export interface WindowLayoutAdapter {
  storage: Pick<Storage, "getItem" | "setItem">;
  availableSize: () => Promise<WorkspaceWindowSize>;
  apply: (geometry: WorkspaceGeometry & { expanded: boolean }) => Promise<unknown>;
  onResized: (listener: (size: WorkspaceWindowSize) => void) => Promise<Unlisten>;
  onMoved: (listener: (position: WorkspacePosition) => void) => Promise<Unlisten>;
  reportError: (error: unknown) => void;
}

// Shared by all hook consumers: one explicit mode and one native listener pair.
export function createWindowLayoutController(adapter: WindowLayoutAdapter) {
  let saved: WorkspaceGeometry | undefined;
  try {
    saved = parseWorkspaceGeometry(adapter.storage.getItem(WINDOW_GEOMETRY_KEY));
  } catch (error) {
    adapter.reportError(error);
  }
  saved ??= { width: 760, height: 600 };
  let expectedSize: WorkspaceWindowSize | undefined;
  let expanded = false;
  let transitioning = false;
  let queue = Promise.resolve();
  let users = 0;
  let stopListeners: Unlisten | undefined;

  const persist = () => {
    try { adapter.storage.setItem(WINDOW_GEOMETRY_KEY, JSON.stringify(saved)); }
    catch (error) { adapter.reportError(error); }
  };
  const resize = (nextExpanded: boolean) => {
    const operation = queue.then(async () => {
      transitioning = true;
      const previous = expanded;
      expanded = nextExpanded;
      try {
        const available = await adapter.availableSize();
        const size = getWorkspaceWindowSize(nextExpanded, available.width, available.height, saved);
        expectedSize = size;
        await adapter.apply({ ...size, ...(nextExpanded && saved?.x !== undefined
          ? { x: saved.x, y: saved.y } : {}), expanded: nextExpanded });
      } catch (error) {
        expanded = previous;
        throw error;
      } finally {
        transitioning = false;
      }
    });
    queue = operation.catch(() => {}); // Keep future explicit requests usable after a failure.
    return operation;
  };

  const attach = (): Unlisten => {
    users++;
    if (users === 1) {
      let disposed = false;
      const listeners: Unlisten[] = [];
      const register = async (promise: Promise<Unlisten>) => {
        try {
          const unlisten = await promise;
          if (disposed) unlisten(); else listeners.push(unlisten);
        } catch (error) { adapter.reportError(error); }
      };
      stopListeners = () => { disposed = true; listeners.forEach((stop) => stop()); };
      void register(adapter.onResized((size) => {
        if (disposed || !expanded || transitioning || size.height <= 54 ||
            (expectedSize && Math.abs(size.width - expectedSize.width) < 1 &&
              Math.abs(size.height - expectedSize.height) < 1) ||
            !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0) return;
        expectedSize = undefined;
        saved = { ...saved, ...size };
        persist();
      }));
      void register(adapter.onMoved((position) => {
        if (disposed || !expanded || transitioning || !saved ||
            !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
        saved = { ...saved, ...position };
        persist();
      }));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--users === 0) { stopListeners?.(); stopListeners = undefined; }
    };
  };
  return { resize, attach };
}
