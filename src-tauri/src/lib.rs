mod error;
mod known_hosts;
mod ssh_session;
mod sftp_cmd;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tracing_subscriber;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ssh_session::SessionPool::new())
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
            sftp_cmd::remove_known_host
        ])
        .run(tauri::generate_context!())
        .expect("Tauri应用执行过程中捕获致命异常");
}
