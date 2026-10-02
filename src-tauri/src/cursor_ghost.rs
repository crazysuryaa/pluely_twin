//! A screen-capturable arrow parked where the real cursor entered the
//! (content-protected) main window, so viewers see the cursor stop at the
//! window edge instead of vanishing. Locally the user sees Pluely's own
//! invisible-to-capture pointer inside the window.
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const LABEL: &str = "cursor-ghost";
// NSCursor.arrow's image size and hotspot (points), so the parked arrow is
// the same size as the real cursor (see CursorGhost.tsx).
const WIDTH: f64 = 28.0;
const HEIGHT: f64 = 40.0;
const TIP_X: f64 = 5.0;
const TIP_Y: f64 = 5.0;
// Parking spot while unused. The window stays "visible" there so showing the
// arrow is just a move, which never activates the app or steals focus.
const OFFSCREEN: f64 = -10_000.0;

pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let ghost = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(WIDTH, HEIGHT)
        .position(OFFSCREEN, OFFSCREEN)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible_on_all_workspaces(true)
        // Must stay capturable: this is the only thing viewers should see.
        .content_protected(false)
        .visible(true)
        .build()?;
    ghost.set_ignore_cursor_events(true)?;
    Ok(())
}

// Bumped on every show/hide so an in-flight glide stops when superseded.
static GENERATION: AtomicU64 = AtomicU64::new(0);
const GLIDE: Duration = Duration::from_millis(180);
const FRAME: Duration = Duration::from_millis(8);

/// Screen position (logical) for the ghost window so the arrow tip lands on
/// `x`/`y`, given in logical coordinates inside the main window's webview.
fn ghost_position<R: Runtime>(
    app: &AppHandle<R>,
    x: f64,
    y: f64,
) -> Result<LogicalPosition<f64>, String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = main
        .inner_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    Ok(LogicalPosition::new(
        origin.x + x - TIP_X,
        origin.y + y - TIP_Y,
    ))
}

fn ghost_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| "Cursor ghost window not found".to_string())
}

#[tauri::command]
pub fn show_cursor_ghost<R: Runtime>(app: AppHandle<R>, x: f64, y: f64) -> Result<(), String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let target = ghost_position(&app, x, y)?;
    ghost_window(&app)?
        .set_position(target)
        .map_err(|e| e.to_string())?;
    watch_for_exit(app, generation);
    Ok(())
}

/// Tells the main page the real cursor left, so it hides Pluely's pointer.
pub const EXIT_EVENT: &str = "cursor-ghost-exit";
const EXIT_POLL: Duration = Duration::from_millis(16);
const RECT_REFRESH: Duration = Duration::from_millis(250);

/// Global cursor position in logical points (top-left origin), read without
/// touching the main thread so it can't starve the webview's mouse events.
#[cfg(target_os = "macos")]
fn global_cursor<R: Runtime>(_app: &AppHandle<R>) -> Option<(f64, f64)> {
    use std::ffi::c_void;
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let point = CGEventGetLocation(event);
        CFRelease(event);
        Some((point.x, point.y))
    }
}

#[cfg(not(target_os = "macos"))]
fn global_cursor<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    let main = app.get_webview_window("main")?;
    let scale = main.scale_factor().ok()?;
    let p = app.cursor_position().ok()?.to_logical::<f64>(scale);
    Some((p.x, p.y))
}

/// Main window's logical rect: (x, y, width, height).
fn main_rect<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64, f64, f64)> {
    let main = app.get_webview_window("main")?;
    let scale = main.scale_factor().ok()?;
    let origin = main.inner_position().ok()?.to_logical::<f64>(scale);
    let size = main.inner_size().ok()?.to_logical::<f64>(scale);
    Some((origin.x, origin.y, size.width, size.height))
}

/// WebKit doesn't reliably fire mouse-leave for this never-focused panel, so
/// while the arrow is parked, watch the real cursor and release on exit.
/// Stops as soon as anything else (page mouseout, re-entry, hide) takes over.
fn watch_for_exit<R: Runtime>(app: AppHandle<R>, generation: u64) {
    std::thread::spawn(move || {
        let Some(mut rect) = main_rect(&app) else {
            return;
        };
        let mut rect_at = Instant::now();
        let mut last_inside: Option<(f64, f64)> = None;
        while GENERATION.load(Ordering::SeqCst) == generation {
            std::thread::sleep(EXIT_POLL);
            if rect_at.elapsed() >= RECT_REFRESH {
                // The window can move while the cursor is inside (dragging).
                if let Some(r) = main_rect(&app) {
                    rect = r;
                }
                rect_at = Instant::now();
            }
            let Some((cx, cy)) = global_cursor(&app) else {
                continue;
            };
            let (wx, wy, ww, wh) = rect;
            let (x, y) = (cx - wx, cy - wy);
            if x >= 0.0 && y >= 0.0 && x < ww && y < wh {
                last_inside = Some((x, y));
                continue;
            }
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let (lx, ly) = last_inside.unwrap_or((x.clamp(0.0, ww), y.clamp(0.0, wh)));
            let (ex, ey) = snap_to_nearest_edge(lx, ly, ww, wh);
            let _ = release_cursor_ghost(app.clone(), ex, ey);
            let _ = app.emit_to("main", EXIT_EVENT, ());
            return;
        }
    });
}

/// Snap a point inside a `width` x `height` window onto its nearest edge.
fn snap_to_nearest_edge(x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
    let distances = [x, width - x, y, height - y];
    let nearest = (0..4)
        .min_by(|&a, &b| distances[a].total_cmp(&distances[b]))
        .unwrap_or(0);
    match nearest {
        0 => (0.0, y),
        1 => (width, y),
        2 => (x, 0.0),
        _ => (x, height),
    }
}

#[cfg(test)]
mod tests {
    use super::snap_to_nearest_edge;

    #[test]
    fn snaps_to_the_closest_edge() {
        assert_eq!(snap_to_nearest_edge(3.0, 30.0, 460.0, 54.0), (0.0, 30.0));
        assert_eq!(snap_to_nearest_edge(457.0, 30.0, 460.0, 54.0), (460.0, 30.0));
        assert_eq!(snap_to_nearest_edge(200.0, 2.0, 460.0, 54.0), (200.0, 0.0));
        assert_eq!(snap_to_nearest_edge(200.0, 52.0, 460.0, 54.0), (200.0, 54.0));
    }
}

/// Glides the parked arrow to the exit point, then parks it off-screen so
/// the real cursor takes over without a visible jump.
#[tauri::command]
pub fn release_cursor_ghost<R: Runtime>(app: AppHandle<R>, x: f64, y: f64) -> Result<(), String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let ghost = ghost_window(&app)?;
    let target = ghost_position(&app, x, y)?;
    let scale = ghost.scale_factor().map_err(|e| e.to_string())?;
    let start = ghost
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    if start.x <= OFFSCREEN / 2.0 {
        // Nothing parked (e.g. the app launched under the cursor).
        return Ok(());
    }

    std::thread::spawn(move || {
        let began = Instant::now();
        loop {
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let t = (began.elapsed().as_secs_f64() / GLIDE.as_secs_f64()).min(1.0);
            let eased = 1.0 - (1.0 - t).powi(3); // ease-out cubic
            let _ = ghost.set_position(LogicalPosition::new(
                start.x + (target.x - start.x) * eased,
                start.y + (target.y - start.y) * eased,
            ));
            if t >= 1.0 {
                break;
            }
            std::thread::sleep(FRAME);
        }
        if GENERATION.load(Ordering::SeqCst) == generation {
            let _ = ghost.set_position(LogicalPosition::new(OFFSCREEN, OFFSCREEN));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn hide_cursor_ghost<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    match app.get_webview_window(LABEL) {
        Some(ghost) => ghost
            .set_position(LogicalPosition::new(OFFSCREEN, OFFSCREEN))
            .map_err(|e| e.to_string()),
        None => Ok(()),
    }
}
