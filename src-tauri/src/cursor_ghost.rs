//! A screen-capturable arrow parked where the real cursor entered the
//! (content-protected) main window, so viewers see the cursor stop at the
//! window edge instead of vanishing. Locally the user sees Pluely's own
//! invisible-to-capture pointer inside the window.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
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
// Only track while the page uses the invisible cursor (see CustomCursor.tsx).
static ENABLED: AtomicBool = AtomicBool::new(false);
const GLIDE: Duration = Duration::from_millis(180);
const FRAME: Duration = Duration::from_millis(8);
const POLL: Duration = Duration::from_millis(16);
/// Tells the main page whether the real cursor is over the window, so it can
/// show/hide Pluely's own pointer. WebKit doesn't reliably fire mouse-leave
/// for this never-key panel, so enter/leave is decided here instead.
pub const INSIDE_EVENT: &str = "cursor-ghost-inside";

/// Screen position (logical) for the ghost window so the arrow tip lands on
/// `x`/`y`, given in logical coordinates inside the main window.
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

/// Snap a point inside a `width` x `height` window onto its nearest edge
/// (where the cursor crossed in or out).
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

fn park<R: Runtime>(app: &AppHandle<R>, x: f64, y: f64) -> Result<(), String> {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let target = ghost_position(app, x, y)?;
    ghost_window(app)?
        .set_position(target)
        .map_err(|e| e.to_string())
}

/// Glides the parked arrow to the exit point, then moves it off-screen so
/// the real cursor takes over without a visible jump.
fn release<R: Runtime>(app: &AppHandle<R>, x: f64, y: f64) -> Result<(), String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let ghost = ghost_window(app)?;
    let target = ghost_position(app, x, y)?;
    let scale = ghost.scale_factor().map_err(|e| e.to_string())?;
    let start = ghost
        .outer_position()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    if start.x <= OFFSCREEN / 2.0 {
        return Ok(()); // nothing parked
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

fn hide<R: Runtime>(app: &AppHandle<R>) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(ghost) = app.get_webview_window(LABEL) {
        let _ = ghost.set_position(LogicalPosition::new(OFFSCREEN, OFFSCREEN));
    }
}

/// Cursor position relative to the main window, in logical points, plus the
/// window's logical size. `None` if the window is hidden or unavailable.
fn cursor_in_main<R: Runtime>(app: &AppHandle<R>) -> Option<((f64, f64), (f64, f64))> {
    let main = app.get_webview_window("main")?;
    if !main.is_visible().unwrap_or(false) {
        return None;
    }
    let scale = main.scale_factor().ok()?;
    let cursor = app.cursor_position().ok()?;
    let origin = main.inner_position().ok()?;
    let size = main.inner_size().ok()?.to_logical::<f64>(scale);
    let rel = (
        (cursor.x - origin.x as f64) / scale,
        (cursor.y - origin.y as f64) / scale,
    );
    Some((rel, (size.width, size.height)))
}

/// Polls the global cursor and parks/releases the arrow on window enter/exit.
pub fn start_monitor<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        // Last cursor position while inside, for the exit point.
        let mut inside_at: Option<((f64, f64), (f64, f64))> = None;
        loop {
            std::thread::sleep(POLL);
            let current = if ENABLED.load(Ordering::SeqCst) {
                cursor_in_main(&app).filter(|((x, y), (w, h))| {
                    *x >= 0.0 && *y >= 0.0 && *x < *w && *y < *h
                })
            } else {
                None
            };

            match (inside_at, current) {
                (None, Some(((x, y), (w, h)))) => {
                    let (ex, ey) = snap_to_nearest_edge(x, y, w, h);
                    let _ = park(&app, ex, ey);
                    let _ = app.emit_to("main", INSIDE_EVENT, true);
                }
                (Some(((x, y), (w, h))), None) => {
                    let (ex, ey) = snap_to_nearest_edge(x, y, w, h);
                    if ENABLED.load(Ordering::SeqCst) {
                        let _ = release(&app, ex, ey);
                    } else {
                        hide(&app);
                    }
                    let _ = app.emit_to("main", INSIDE_EVENT, false);
                }
                _ => {}
            }
            inside_at = current;
        }
    });
}

/// The page turns tracking on while Pluely's invisible cursor is in use.
#[tauri::command]
pub fn set_cursor_ghost_enabled<R: Runtime>(app: AppHandle<R>, enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        hide(&app);
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
