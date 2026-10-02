import arrowCursor from "@/assets/macos-arrow-cursor.png";

// Rendered in the capturable "cursor-ghost" window: macOS's own arrow image at
// its native 28x40pt size. Its hotspot (5, 5) matches TIP_X/TIP_Y in
// src-tauri/src/cursor_ghost.rs.
export const CursorGhost = () => (
  <img
    src={arrowCursor}
    width={28}
    height={40}
    alt=""
    draggable={false}
    style={{ position: "fixed", top: 0, left: 0, display: "block" }}
  />
);
