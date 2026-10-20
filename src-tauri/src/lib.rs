mod commands;
mod error;
mod formats;
mod journal_files;
mod library;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            commands::open_book,
            commands::set_extracted_metadata,
            commands::update_book_properties,
            commands::set_cover,
            commands::reset_cover,
            commands::save_progress,
            commands::set_favorite,
            commands::set_read,
            commands::trash_books,
            commands::restore_books,
            commands::delete_books,
            commands::empty_trash,
            commands::list_categories,
            commands::create_category,
            commands::rename_category,
            commands::delete_category,
            commands::add_to_category,
            commands::remove_from_category,
            commands::list_annotations,
            commands::save_annotation,
            commands::update_annotation,
            commands::delete_annotation,
            commands::clear_annotations,
            commands::save_export,
            commands::list_journal,
            commands::add_journal_entry,
            commands::update_journal_entry,
            commands::delete_journal_entry,
            commands::list_all_annotations,
            commands::list_all_journal,
            commands::journal_folder,
            commands::set_journal_folder,
            commands::journal_read,
            commands::journal_append,
            commands::journal_write,
            commands::journal_save_image,
            commands::journal_image,
            commands::get_setting,
            commands::set_setting,
            commands::list_bookmarks,
            commands::add_bookmark,
            commands::remove_bookmark,
            commands::clear_bookmarks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
