import { useEffect, useRef } from "react";
import { MousePointer2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

/** Snap an entry point onto the nearest window edge (where the cursor crossed in). */
export const snapToNearestEdge = (
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } => {
  const distances = [x, width - x, y, height - y];
  const nearest = distances.indexOf(Math.min(...distances));
  if (nearest === 0) return { x: 0, y };
  if (nearest === 1) return { x: width, y };
  if (nearest === 2) return { x, y: 0 };
  return { x, y: height };
};

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

    // Park a capturable arrow where the real cursor entered, so screen-share
    // viewers see it stop at the window edge rather than disappear.
    const handleMouseOver = (e: MouseEvent) => {
      if (e.relatedTarget) return; // moved between elements, not into the window
      const point = snapToNearestEdge(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight
      );
      void invoke("show_cursor_ghost", point).catch(console.error);
    };

    // On exit, glide the parked arrow to where the cursor left so viewers see
    // it travel there instead of jumping.
    const handleMouseOut = (e: MouseEvent) => {
      if (e.relatedTarget) return;
      const point = snapToNearestEdge(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight
      );
      void invoke("release_cursor_ghost", point).catch(console.error);
    };

    // Start the animation loop
    rafId = requestAnimationFrame(updateCursorPosition);

    // Add event listeners
    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      void invoke("hide_cursor_ghost").catch(console.error);
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
