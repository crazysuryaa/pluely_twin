import { invoke } from "@tauri-apps/api/core";
import { currentMonitor } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect } from "react";
import { createWindowLayoutController } from "./windowLayout";

let layoutController: ReturnType<typeof createWindowLayoutController> | undefined;

function getLayoutController() {
  if (layoutController) return layoutController;
  const nativeWindow = getCurrentWebviewWindow();
  // Tauri event geometry is physical pixels; storage and commands use logical pixels.
  let scale = 1;
  const scaleReady = nativeWindow.scaleFactor().then((value) => { scale = value; });
  layoutController = createWindowLayoutController({
    storage: {
      getItem: (key) => globalThis.localStorage.getItem(key),
      setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    },
    availableSize: async () => {
      await scaleReady;
      const monitor = await currentMonitor();
      return monitor
        ? { width: monitor.size.width / monitor.scaleFactor, height: monitor.size.height / monitor.scaleFactor }
        : { width: globalThis.screen.availWidth, height: globalThis.screen.availHeight };
    },
    apply: (geometry) => invoke("set_window_size", { ...geometry }),
    onResized: async (listener) => {
      await scaleReady;
      const stopScale = await nativeWindow.onScaleChanged(({ payload }) => { scale = payload.scaleFactor; });
      try {
        const stopResize = await nativeWindow.onResized(({ payload }) => {
          listener({ width: payload.width / scale, height: payload.height / scale });
        });
        return () => { stopResize(); stopScale(); };
      } catch (error) { stopScale(); throw error; }
    },
    onMoved: async (listener) => {
      await scaleReady;
      return nativeWindow.onMoved(({ payload }) => {
        listener({ x: payload.x / scale, y: payload.y / scale });
      });
    },
    reportError: (error) => console.error("Window geometry/listener error:", error),
  });
  return layoutController;
}

export const useWindowResize = () => {
  const resizeWindow = useCallback(async (expanded: boolean) => {
    try {
      await getLayoutController().resize(expanded);
    } catch (error) {
      console.error("Failed to resize window:", error);
    }
  }, []);

  useEffect(() => {
    try { return getLayoutController().attach(); }
    catch (error) { console.error("Failed to setup window geometry listeners:", error); }
  }, []);

  // No DOM observers or drag handlers: expansion/collapse is exclusively explicit.
  return { resizeWindow };
};

interface UseWindowFocusOptions {
  onFocusLost?: () => void;
  onFocusGained?: () => void;
}

export const useWindowFocus = ({
  onFocusLost,
  onFocusGained,
}: UseWindowFocusOptions = {}) => {
  const handleFocusChange = useCallback(
    async (focused: boolean) => {
      if (focused && onFocusGained) {
        onFocusGained();
      } else if (!focused && onFocusLost) {
        onFocusLost();
      }
    },
    [onFocusLost, onFocusGained]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupFocusListener = async () => {
      try {
        const window = getCurrentWebviewWindow();

        // Listen to focus change events
        unlisten = await window.onFocusChanged(({ payload: focused }) => {
          handleFocusChange(focused);
        });
      } catch (error) {
        console.error("Failed to setup focus listener:", error);
      }
    };

    setupFocusListener();

    // Cleanup
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleFocusChange]);
};
