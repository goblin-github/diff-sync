mod error;
mod known_hosts;
mod ssh_session;
mod sftp_cmd;

use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tracing_subscriber;

/// Tracks whether a close-request has been intercepted and is waiting for
/// the user to resolve the "unsaved changes" dialog.
struct CloseRequestState {
    pending: Mutex<bool>,
}

/// Let the frontend tell Rust that the user has resolved the quit dialog
/// (Save & Quit / Discard & Quit) — close the window.
#[tauri::command]
fn confirm_quit(app: tauri::AppHandle) {
    let state = app.state::<CloseRequestState>();
    // Set pending=true so the on_window_event handler lets the close through.
    *state.pending.lock().unwrap() = true;
    // Trigger a close on the main window.
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.close();
    }
}

/// Let the frontend tell Rust that the user cancelled the quit dialog.
#[tauri::command]
fn cancel_quit(state: tauri::State<'_, CloseRequestState>) {
    *state.pending.lock().unwrap() = false;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ssh_session::SessionPool::new())
        .manage(CloseRequestState {
            pending: Mutex::new(false),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<CloseRequestState>();
                let mut pending = state.pending.lock().unwrap();
                if *pending {
                    // User confirmed quit — let the window close normally.
                    *pending = false;
                    return;
                }
                // First close request: prevent default and ask the frontend.
                *pending = true;
                api.prevent_close();
                let _ = window.emit("close-requested-from-rust", ());
            }
        })
        .setup(|app| {
            // macOS menu bar with Preferences
            let prefs = MenuItemBuilder::with_id("preferences", "设置...")
                .accelerator("Cmd+,")
                .build(app)?;
            let app_menu = SubmenuBuilder::new(app, "DiffSync")
                .item(&prefs)
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "编辑")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle Preferences click
            let app_handle = app.handle().clone();
            prefs.set_accelerator(Some("CmdOrCtrl+,"))?;
            app.on_menu_event(move |_app, event| {
                if event.id() == "preferences" {
                    let _ = app_handle.emit("open-settings", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sftp_cmd::save_env_credential,
            sftp_cmd::delete_env_credential,
            sftp_cmd::clear_all_credentials,
            sftp_cmd::test_ssh_connection,
            sftp_cmd::read_remote_config,
            sftp_cmd::write_remote_config,
            sftp_cmd::push_remote_config,
            sftp_cmd::validate_config_format,
            sftp_cmd::save_projects,
            sftp_cmd::load_projects,
            sftp_cmd::get_app_config_dir,
            sftp_cmd::read_local_file,
            sftp_cmd::write_local_file,
            sftp_cmd::get_env_credential,
            sftp_cmd::backup_remote_config,
            sftp_cmd::list_backups,
            sftp_cmd::restore_backup,
            sftp_cmd::delete_backup,
            sftp_cmd::read_backup_content,
            sftp_cmd::remove_known_host,
            confirm_quit,
            cancel_quit,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri应用执行过程中捕获致命异常");
}
