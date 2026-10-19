use crate::error::Result;
use crate::formats::{FormatInfo, FORMATS};
use crate::library::{AddResult, Annotation, Book, Bookmark, Category, Library};
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

// --- Books ---------------------------------------------------------------------

#[tauri::command]
pub fn list_books(state: State<LibraryState>) -> Result<Vec<Book>> {
    lock(&state).list()
}

/// Accepts files and folders (scanned recursively).
#[tauri::command]
pub fn add_books(paths: Vec<String>, state: State<LibraryState>) -> Result<AddResult> {
    lock(&state).add_paths(&paths)
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
pub fn set_extracted_metadata(
    id: i64,
    title: Option<String>,
    author: Option<String>,
    cover: Option<String>,
    state: State<LibraryState>,
) -> Result<()> {
    lock(&state).set_extracted_metadata(id, title.as_deref(), author.as_deref(), cover.as_deref())
}

#[tauri::command]
pub fn update_book_properties(
    id: i64,
    title: String,
    author: Option<String>,
    description: Option<String>,
    state: State<LibraryState>,
) -> Result<Book> {
    let lib = lock(&state);
    lib.update_properties(id, &title, author.as_deref(), description.as_deref())?;
    lib.get(id)
}

#[tauri::command]
pub fn set_cover(id: i64, cover: String, state: State<LibraryState>) -> Result<Book> {
    let lib = lock(&state);
    lib.set_cover(id, &cover)?;
    lib.get(id)
}

#[tauri::command]
pub fn reset_cover(id: i64, state: State<LibraryState>) -> Result<Book> {
    let lib = lock(&state);
    lib.reset_cover(id)?;
    lib.get(id)
}

#[tauri::command]
pub fn save_progress(id: i64, location: String, progress: f64, state: State<LibraryState>) -> Result<()> {
    lock(&state).save_progress(id, &location, progress)
}

#[tauri::command]
pub fn set_favorite(book_ids: Vec<i64>, favorite: bool, state: State<LibraryState>) -> Result<()> {
    lock(&state).set_favorite(&book_ids, favorite)
}

#[tauri::command]
pub fn set_read(book_ids: Vec<i64>, read: bool, state: State<LibraryState>) -> Result<()> {
    lock(&state).set_read(&book_ids, read)
}

#[tauri::command]
pub fn trash_books(book_ids: Vec<i64>, state: State<LibraryState>) -> Result<()> {
    lock(&state).trash(&book_ids)
}

#[tauri::command]
pub fn restore_books(book_ids: Vec<i64>, state: State<LibraryState>) -> Result<()> {
    lock(&state).restore(&book_ids)
}

/// Removes books from the library for good. Files on disk are never touched.
#[tauri::command]
pub fn delete_books(book_ids: Vec<i64>, state: State<LibraryState>) -> Result<()> {
    lock(&state).delete(&book_ids)
}

#[tauri::command]
pub fn empty_trash(state: State<LibraryState>) -> Result<()> {
    lock(&state).empty_trash()
}

// --- Categories ------------------------------------------------------------------

#[tauri::command]
pub fn list_categories(state: State<LibraryState>) -> Result<Vec<Category>> {
    lock(&state).categories()
}

#[tauri::command]
pub fn create_category(name: String, state: State<LibraryState>) -> Result<Category> {
    lock(&state).create_category(&name)
}

#[tauri::command]
pub fn rename_category(id: i64, name: String, state: State<LibraryState>) -> Result<()> {
    lock(&state).rename_category(id, &name)
}

#[tauri::command]
pub fn delete_category(id: i64, state: State<LibraryState>) -> Result<()> {
    lock(&state).delete_category(id)
}

#[tauri::command]
pub fn add_to_category(book_ids: Vec<i64>, category_id: i64, state: State<LibraryState>) -> Result<()> {
    lock(&state).add_to_category(&book_ids, category_id)
}

#[tauri::command]
pub fn remove_from_category(book_ids: Vec<i64>, category_id: i64, state: State<LibraryState>) -> Result<()> {
    lock(&state).remove_from_category(&book_ids, category_id)
}

// --- Annotations -----------------------------------------------------------------

#[tauri::command]
pub fn list_annotations(book_id: i64, state: State<LibraryState>) -> Result<Vec<Annotation>> {
    lock(&state).annotations(book_id)
}

#[tauri::command]
pub fn save_annotation(
    book_id: i64,
    location: String,
    text: String,
    note: Option<String>,
    color: String,
    progress: f64,
    state: State<LibraryState>,
) -> Result<Vec<Annotation>> {
    let lib = lock(&state);
    lib.save_annotation(book_id, &location, &text, note.as_deref(), &color, progress)?;
    lib.annotations(book_id)
}

#[tauri::command]
pub fn update_annotation(
    id: i64,
    book_id: i64,
    note: Option<String>,
    color: String,
    state: State<LibraryState>,
) -> Result<Vec<Annotation>> {
    let lib = lock(&state);
    lib.update_annotation(id, note.as_deref(), &color)?;
    lib.annotations(book_id)
}

#[tauri::command]
pub fn delete_annotation(id: i64, book_id: i64, state: State<LibraryState>) -> Result<Vec<Annotation>> {
    let lib = lock(&state);
    lib.delete_annotation(id)?;
    lib.annotations(book_id)
}

#[tauri::command]
pub fn clear_annotations(book_id: i64, state: State<LibraryState>) -> Result<()> {
    lock(&state).clear_annotations(book_id)
}

/// Writes an export the user asked for. Only text formats the app produces
/// are allowed, so this cannot be used to overwrite arbitrary files.
#[tauri::command]
pub fn save_export(path: String, contents: String) -> Result<()> {
    let allowed = ["html", "htm", "md", "txt"];
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !allowed.contains(&ext.as_str()) {
        return Err(crate::error::Error::Invalid(format!("cannot export to .{ext} files")));
    }
    std::fs::write(path, contents)?;
    Ok(())
}

// --- Bookmarks -------------------------------------------------------------------

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
