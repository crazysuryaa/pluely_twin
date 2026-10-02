#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use tauri::{App, AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

// The offset from the top of the screen to the window
const TOP_OFFSET: i32 = 54;

/// Sets up the main window with custom positioning
pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Try different possible window labels
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("pluely"))
        .or_else(|| {
            // Get the first window if specific labels don't work
            app.webview_windows().values().next().cloned()
        })
        .ok_or("No window found")?;

    position_window_top_center(&window, TOP_OFFSET)?;

    // Set window as non-focusable on Windows
    // #[cfg(target_os = "windows")]
    // {
    //     let _ = window.set_focusable(false);
    // }

    Ok(())
}

/// Positions a window at the top center of the screen with a specified Y offset
pub fn position_window_top_center(
    window: &WebviewWindow,
    y_offset: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get the primary monitor
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        // Calculate center X position
        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;

        // Set the window position
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: y_offset,
        }))?;
    }

    Ok(())
}

/// Future function for centering window completely (both X and Y)
#[allow(dead_code)]
pub fn center_window_completely(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;
        let center_y = (monitor_size.height as i32 - window_size.height as i32) / 2;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: center_y,
        }))?;
    }

    Ok(())
}

#[cfg(test)]
mod layout_tests {
    use super::clamp_workspace_rect;

    #[test]
    fn preserves_visible_position_instead_of_recentering() {
        assert_eq!(
            clamp_workspace_rect(760.0, 600.0, 100.0, 80.0, (0.0, 0.0, 1512.0, 982.0), true),
            (760.0, 600.0, 100.0, 80.0)
        );
    }

    #[test]
    fn clamps_offscreen_position_and_bounds_size_on_negative_origin_monitor() {
        assert_eq!(
            clamp_workspace_rect(
                1000.0,
                800.0,
                -100.0,
                500.0,
                (-900.0, 0.0, 900.0, 650.0),
                true
            ),
            (868.0, 586.0, -868.0, 64.0)
        );
    }

    #[test]
    fn expanded_minimum_never_exceeds_small_monitor() {
        assert_eq!(
            clamp_workspace_rect(100.0, 100.0, 10.0, 10.0, (0.0, 0.0, 400.0, 300.0), true),
            (368.0, 236.0, 10.0, 10.0)
        );
        assert_eq!(
            clamp_workspace_rect(460.0, 54.0, 10.0, 10.0, (0.0, 0.0, 1512.0, 982.0), false),
            (460.0, 54.0, 10.0, 10.0)
        );
    }
}

// Geometry is logical pixels; monitor origins may be negative.
fn clamp_workspace_rect(
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    monitor: (f64, f64, f64, f64),
    expanded: bool,
) -> (f64, f64, f64, f64) {
    let (left, top, monitor_width, monitor_height) = monitor;
    let max_width = (monitor_width - 32.0).max(1.0);
    let max_height = (monitor_height - 64.0).max(1.0);
    let width = width.max(if expanded { 520.0 } else { 1.0 }).min(max_width);
    let height = height
        .max(if expanded { 360.0 } else { 1.0 })
        .min(max_height);
    (
        width,
        height,
        x.clamp(left, left + monitor_width - width),
        y.clamp(top, top + monitor_height - height),
    )
}

#[tauri::command]
pub fn set_window_size(
    window: tauri::WebviewWindow,
    width: u32,
    height: u32,
    expanded: Option<bool>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, Position, Size};

    if width == 0
        || height == 0
        || x.is_some() != y.is_some()
        || x.is_some_and(|value| !value.is_finite())
        || y.is_some_and(|value| !value.is_finite())
    {
        return Err("Invalid window geometry".into());
    }
    // Legacy callers can continue supplying only width and height.
    let expanded = expanded.unwrap_or(height > 54);
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let current_position = window.outer_position().map_err(|e| e.to_string())?;
    let logical_position = current_position.to_logical::<f64>(scale);
    let desired_x = x.unwrap_or(logical_position.x);
    let desired_y = y.unwrap_or(logical_position.y);
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let saved_monitor = monitors.into_iter().find(|monitor| {
        let scale = monitor.scale_factor();
        let origin = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        desired_x >= origin.x
            && desired_x < origin.x + size.width
            && desired_y >= origin.y
            && desired_y < origin.y + size.height
    });
    let monitor = saved_monitor
        .or(window.current_monitor().map_err(|e| e.to_string())?)
        .or(window.primary_monitor().map_err(|e| e.to_string())?);
    let (width, height, target_x, target_y, max_width, max_height) = if let Some(monitor) = monitor
    {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        let (width, height, x, y) = clamp_workspace_rect(
            width as f64,
            height as f64,
            desired_x,
            desired_y,
            (origin.x, origin.y, size.width, size.height),
            expanded,
        );
        (
            width,
            height,
            x,
            y,
            (size.width - 32.0).max(1.0),
            (size.height - 64.0).max(1.0),
        )
    } else {
        (
            width as f64,
            height as f64,
            desired_x,
            desired_y,
            f64::MAX,
            f64::MAX,
        )
    };

    // Clear the expanded minimum before shrinking the idle pill.
    window
        .set_min_size(if expanded {
            Some(Size::Logical(LogicalSize::new(
                520.0_f64.min(max_width),
                360.0_f64.min(max_height),
            )))
        } else {
            None
        })
        .map_err(|e| format!("Failed to set window minimum: {e}"))?;
    window
        .set_max_size(
            if expanded && max_width.is_finite() && max_width != f64::MAX {
                Some(Size::Logical(LogicalSize::new(max_width, max_height)))
            } else {
                None
            },
        )
        .map_err(|e| format!("Failed to set window maximum: {e}"))?;
    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|e| format!("Failed to resize window: {e}"))?;
    window
        .set_resizable(expanded)
        .map_err(|e| format!("Failed to set window resizability: {e}"))?;
    // Never recenter: only move to restore saved coordinates or bring an off-screen edge back.
    if (target_x - logical_position.x).abs() > 0.5 || (target_y - logical_position.y).abs() > 0.5 {
        window
            .set_position(Position::Logical(LogicalPosition::new(target_x, target_y)))
            .map_err(|e| format!("Failed to reposition window: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)
}

#[tauri::command]
pub fn toggle_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        match dashboard_window.is_visible() {
            Ok(true) => {
                // Window is visible, hide it
                dashboard_window
                    .hide()
                    .map_err(|e| format!("Failed to hide dashboard window: {}", e))?;
            }
            Ok(false) => {
                // Window is hidden, show and focus it
                dashboard_window
                    .show()
                    .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
                dashboard_window
                    .set_focus()
                    .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
            }
            Err(e) => {
                return Err(format!("Failed to check dashboard visibility: {}", e));
            }
        }
    } else {
        // Window doesn't exist, create and show it
        show_dashboard_window(&app)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_window(app: tauri::AppHandle, direction: String, step: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let current_pos = window
            .outer_position()
            .map_err(|e| format!("Failed to get window position: {}", e))?;

        let (new_x, new_y) = match direction.as_str() {
            "up" => (current_pos.x, current_pos.y - step),
            "down" => (current_pos.x, current_pos.y + step),
            "left" => (current_pos.x - step, current_pos.y),
            "right" => (current_pos.x + step, current_pos.y),
            _ => return Err(format!("Invalid direction: {}", direction)),
        };

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: new_x,
                y: new_y,
            }))
            .map_err(|e| format!("Failed to set window position: {}", e))?;
    } else {
        return Err("Main window not found".to_string());
    }

    Ok(())
}

pub fn create_dashboard_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, tauri::Error> {
    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("/chats".into()));

    #[cfg(target_os = "macos")]
    let base_builder = base_builder
        .title("Pluely - Dashboard")
        .center()
        .decorations(true)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .content_protected(true)
        .visible(true)
        .traffic_light_position(LogicalPosition::new(14.0, 18.0));

    #[cfg(not(target_os = "macos"))]
    let base_builder = base_builder
        .title("Pluely - Dashboard")
        .center()
        .decorations(true)
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
        .content_protected(true)
        .visible(false);

    let window = base_builder.build()?;

    // Set up close event handler - hide window instead of destroying it
    setup_dashboard_close_handler(&window);

    Ok(window)
}

/// Sets up the close event handler for the dashboard window
fn setup_dashboard_close_handler<R: Runtime>(window: &WebviewWindow<R>) {
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent the window from being destroyed
            api.prevent_close();
            // Hide the window instead
            if let Err(e) = window_clone.hide() {
                eprintln!("Failed to hide dashboard window on close: {}", e);
            }
        }
    });
}

/// Shows the dashboard window and brings it to focus
pub fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        // Window exists, show and focus it
        dashboard_window
            .show()
            .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
        dashboard_window
            .set_focus()
            .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
    } else {
        // Window doesn't exist, create it and then show it
        let window = create_dashboard_window(app)
            .map_err(|e| format!("Failed to create dashboard window: {}", e))?;
        window
            .show()
            .map_err(|e| format!("Failed to show new dashboard window: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus new dashboard window: {}", e))?;
    }
    Ok(())
}
