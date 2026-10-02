import { useEffect, useRef } from "react";
import { MousePointer2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const CustomCursor = () => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef({ x: 0, y: 0 });
  const isVisibleRef = useRef(false);

  useEffect(() => {
    let rafId: number;

    const updateCursorPosition = () => {
      if (cursorRef.current && isVisibleRef.current) {
        cursorRef.current.style.transform = `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`;
      }
      rafId = requestAnimationFrame(updateCursorPosition);
    };

    const handleMouseMove = (e: MouseEvent) => {
      positionRef.current = { x: e.clientX, y: e.clientY };

      if (!isVisibleRef.current) {
        isVisibleRef.current = true;
        if (cursorRef.current) {
          cursorRef.current.style.opacity = "1";
        }
      }
    };

    const handleMouseLeave = () => {
      isVisibleRef.current = false;
      if (cursorRef.current) {
        cursorRef.current.style.opacity = "0";
      }
    };

    const handleWindowBlur = () => {
      isVisibleRef.current = false;
      if (cursorRef.current) {
        cursorRef.current.style.display = "0";
      }
    };

    const setPointerVisible = (visible: boolean) => {
      isVisibleRef.current = visible;
      if (cursorRef.current) cursorRef.current.style.opacity = visible ? "1" : "0";
    };

    // The backend tracks the real cursor against the window (WebKit misses
    // mouse-leave on this never-focused panel) and parks a capturable arrow at
    // the edge it crossed, so viewers see it stop there instead of vanishing.
    void invoke("set_cursor_ghost_enabled", { enabled: true }).catch(console.error);
    let disposed = false;
    let unlistenInside: (() => void) | undefined;
    listen<boolean>("cursor-ghost-inside", (event) => {
      if (!event.payload) setPointerVisible(false);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenInside = unlisten;
      })
      .catch(console.error);

    // Start the animation loop
    rafId = requestAnimationFrame(updateCursorPosition);

    // Add event listeners
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      disposed = true;
      unlistenInside?.();
      void invoke("set_cursor_ghost_enabled", { enabled: false }).catch(console.error);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("blur", handleWindowBlur);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={cursorRef}
      className="fixed top-0 left-0 pointer-events-none z-[9999] opacity-0 will-change-transform"
      style={{
        transform: "translate3d(0px, 0px, 0)",
        transition: "opacity 0.1s ease-out",
      }}
    >
      <MousePointer2 className="w-5 h-5 drop-shadow-2xl fill-secondary stroke-primary" />
    </div>
  );
};
