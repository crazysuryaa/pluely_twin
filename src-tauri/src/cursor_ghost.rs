//! A screen-capturable arrow parked where the real cursor entered the
//! (content-protected) main window, so viewers see the cursor stop at the
//! window edge instead of vanishing. Locally the user sees Pluely's own
//! invisible-to-capture pointer inside the window.
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, LogicalPosition, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
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
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let target = ghost_position(&app, x, y)?;
    ghost_window(&app)?
        .set_position(target)
        .map_err(|e| e.to_string())
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
