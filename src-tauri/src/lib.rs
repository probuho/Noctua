mod commands;
mod error;
mod formats;
mod library;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let library = library::Library::open(&dir.join("library.db"))?;
            app.manage(Mutex::new(library));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::supported_formats,
            commands::list_books,
            commands::add_books,
            commands::remove_book,
            commands::open_book,
            commands::update_book_metadata,
            commands::save_progress,
            commands::list_bookmarks,
            commands::add_bookmark,
            commands::remove_bookmark,
            commands::clear_bookmarks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
