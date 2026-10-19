use crate::error::Result;
use crate::formats::{FormatInfo, FORMATS};
use crate::library::{AddResult, Book, Bookmark, Library};
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::State;

pub type LibraryState = Mutex<Library>;

fn lock<'a>(state: &'a State<LibraryState>) -> std::sync::MutexGuard<'a, Library> {
    // A poisoned lock only means an earlier command panicked; the DB is still usable.
    state.lock().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
pub fn supported_formats() -> Vec<FormatInfo> {
    FORMATS.to_vec()
}

#[tauri::command]
pub fn list_books(state: State<LibraryState>) -> Result<Vec<Book>> {
    lock(&state).list()
}

#[tauri::command]
pub fn add_books(paths: Vec<String>, state: State<LibraryState>) -> Result<AddResult> {
    lock(&state).add_paths(&paths)
}

#[tauri::command]
pub fn remove_book(id: i64, state: State<LibraryState>) -> Result<()> {
    lock(&state).remove(id)
}

/// Returns the raw file bytes as an ArrayBuffer. Reading through the backend
/// avoids widening the asset-protocol scope and works the same on mobile.
#[tauri::command]
pub fn open_book(id: i64, state: State<LibraryState>) -> Result<Response> {
    let path = {
        let lib = lock(&state);
        lib.mark_opened(id)?;
        lib.get(id)?.path
    };
    Ok(Response::new(std::fs::read(path)?))
}

#[tauri::command]
pub fn update_book_metadata(
    id: i64,
    title: Option<String>,
    author: Option<String>,
    cover: Option<String>,
    state: State<LibraryState>,
) -> Result<()> {
    lock(&state).update_metadata(id, title.as_deref(), author.as_deref(), cover.as_deref())
}

#[tauri::command]
pub fn save_progress(
    id: i64,
    location: String,
    progress: f64,
    state: State<LibraryState>,
) -> Result<()> {
    lock(&state).save_progress(id, &location, progress)
}

#[tauri::command]
pub fn list_bookmarks(book_id: i64, state: State<LibraryState>) -> Result<Vec<Bookmark>> {
    lock(&state).bookmarks(book_id)
}

#[tauri::command]
pub fn add_bookmark(
    book_id: i64,
    location: String,
    label: String,
    progress: f64,
    state: State<LibraryState>,
) -> Result<Vec<Bookmark>> {
    let lib = lock(&state);
    lib.add_bookmark(book_id, &location, &label, progress)?;
    lib.bookmarks(book_id)
}

#[tauri::command]
pub fn remove_bookmark(id: i64, book_id: i64, state: State<LibraryState>) -> Result<Vec<Bookmark>> {
    let lib = lock(&state);
    lib.remove_bookmark(id)?;
    lib.bookmarks(book_id)
}

#[tauri::command]
pub fn clear_bookmarks(book_id: i64, state: State<LibraryState>) -> Result<()> {
    lock(&state).clear_bookmarks(book_id)
}
