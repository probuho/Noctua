use crate::error::Result;
use crate::formats::{FormatInfo, FORMATS};
use crate::journal_files;
use crate::library::{AddResult, Annotation, Book, Bookmark, Category, JournalEntry, Library};
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

/// Result of saving properties: the book plus problems that did not stop the save.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertiesSaved {
    pub book: Book,
    pub warnings: Vec<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_book_properties(
    id: i64,
    title: String,
    author: Option<String>,
    description: Option<String>,
    rename_file: bool,
    write_to_file: bool,
    state: State<LibraryState>,
) -> Result<PropertiesSaved> {
    let lib = lock(&state);
    let before = lib.get(id)?;
    lib.update_properties(id, &title, author.as_deref(), description.as_deref())?;
    let book = lib.get(id)?;
    let mut warnings = Vec::new();
    let mut path = std::path::PathBuf::from(&book.path);

    if write_to_file && book.format == "epub" {
        if let Err(e) = crate::book_files::write_epub_metadata(&path, &book.title, book.author.as_deref(), book.description.as_deref()) {
            warnings.push(format!("write: {e}"));
        }
    }
    if rename_file {
        match crate::book_files::rename(&path, &book.title, book.author.as_deref()) {
            Ok(new_path) => path = new_path,
            Err(e) => warnings.push(format!("rename: {e}")),
        }
    }
    let size = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(book.size);
    lib.set_path(id, &path.to_string_lossy(), size)?;

    // The journal file is named after the title and repeats title/author in
    // its properties: keep both in step with the book.
    if before.title != book.title || before.author != book.author {
        if let Some(dir) = journal_dir(&lib)? {
            let old = dir.join(journal_files::file_name_for(&before.title, id));
            let new = dir.join(journal_files::file_name_for(&book.title, id));
            let result = (|| -> Result<()> {
                if !old.exists() {
                    return Ok(());
                }
                let text = std::fs::read_to_string(&old)?;
                let updated = journal_files::retitle(&text, &before.title, &book.title, book.author.as_deref());
                if old != new && new.exists() {
                    return Err(crate::error::Error::Invalid(format!("{} already exists", new.display())));
                }
                std::fs::write(&old, updated)?;
                if old != new {
                    std::fs::rename(&old, &new)?;
                }
                Ok(())
            })();
            if let Err(e) = result {
                warnings.push(format!("journal: {e}"));
            }
        }
    }
    Ok(PropertiesSaved { book: lib.get(id)?, warnings })
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
pub fn delete_books(book_ids: Vec<i64>, delete_files: bool, state: State<LibraryState>) -> Result<Vec<String>> {
    let mut lib = lock(&state);
    let failed = if delete_files { trash_files(&lib, &book_ids)? } else { Vec::new() };
    lib.delete(&book_ids)?;
    Ok(failed)
}

/// Removes the books in the trash from the library and, if asked, sends
/// their files to the system trash. Returns the files that could not be moved.
#[tauri::command]
pub fn empty_trash(delete_files: bool, state: State<LibraryState>) -> Result<Vec<String>> {
    let lib = lock(&state);
    let failed = if delete_files { trash_files(&lib, &lib.trashed_ids()?)? } else { Vec::new() };
    lib.empty_trash()?;
    Ok(failed)
}

fn trash_files(lib: &Library, ids: &[i64]) -> Result<Vec<String>> {
    let paths = ids.iter().map(|id| lib.get(*id).map(|b| std::path::PathBuf::from(b.path))).collect::<Result<Vec<_>>>()?;
    Ok(crate::book_files::to_trash(&paths))
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

// --- Journal -----------------------------------------------------------------------

#[tauri::command]
pub fn list_journal(book_id: i64, state: State<LibraryState>) -> Result<Vec<JournalEntry>> {
    lock(&state).journal(book_id)
}

#[tauri::command]
pub fn add_journal_entry(
    book_id: i64,
    body: String,
    location: Option<String>,
    progress: Option<f64>,
    state: State<LibraryState>,
) -> Result<Vec<JournalEntry>> {
    let lib = lock(&state);
    lib.add_journal_entry(book_id, &body, location.as_deref(), progress)?;
    lib.journal(book_id)
}

#[tauri::command]
pub fn update_journal_entry(id: i64, book_id: i64, body: String, state: State<LibraryState>) -> Result<Vec<JournalEntry>> {
    let lib = lock(&state);
    lib.update_journal_entry(id, &body)?;
    lib.journal(book_id)
}

#[tauri::command]
pub fn delete_journal_entry(id: i64, book_id: i64, state: State<LibraryState>) -> Result<Vec<JournalEntry>> {
    let lib = lock(&state);
    lib.delete_journal_entry(id)?;
    lib.journal(book_id)
}

/// Library-wide notebook: every highlight/note and journal entry.
#[tauri::command]
pub fn list_all_annotations(state: State<LibraryState>) -> Result<Vec<Annotation>> {
    lock(&state).all_annotations()
}

#[tauri::command]
pub fn list_all_journal(state: State<LibraryState>) -> Result<Vec<JournalEntry>> {
    lock(&state).all_journal()
}

// --- Journal files (Markdown, Obsidian-compatible) -----------------------------------

fn journal_dir(lib: &Library) -> Result<Option<std::path::PathBuf>> {
    Ok(lib
        .setting(journal_files::FOLDER_KEY)?
        .and_then(|raw| serde_json::from_str::<String>(&raw).ok())
        .map(std::path::PathBuf::from))
}

fn require_journal_dir(lib: &Library) -> Result<std::path::PathBuf> {
    journal_dir(lib)?.ok_or_else(|| crate::error::Error::Invalid("journal folder not set".into()))
}

/// The book's journal file name and title/author for its header.
fn journal_target(lib: &Library, book_id: i64) -> Result<(String, Book)> {
    let book = lib.get(book_id)?;
    Ok((journal_files::file_name_for(&book.title, book.id), book))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalFile {
    pub folder: Option<String>,
    pub file: String,
    pub contents: String,
}

#[tauri::command]
pub fn journal_folder(state: State<LibraryState>) -> Result<Option<String>> {
    Ok(journal_dir(&lock(&state))?.map(|p| p.to_string_lossy().into_owned()))
}

/// Sets the folder (chosen by the user in a native picker) and copies any
/// journal entries written before into one Markdown file per book.
#[tauri::command]
pub fn set_journal_folder(path: String, state: State<LibraryState>) -> Result<()> {
    let dir = std::path::PathBuf::from(&path);
    std::fs::create_dir_all(&dir)?;
    let lib = lock(&state);
    lib.set_setting(journal_files::FOLDER_KEY, &serde_json::to_string(&path).unwrap_or_default())?;
    if lib.setting("journal-migrated")?.is_none() {
        for book in lib.list()? {
            let mut entries = lib.journal(book.id)?;
            entries.reverse(); // oldest first, like a diary file
            if entries.is_empty() {
                continue;
            }
            let file = journal_files::file_name_for(&book.title, book.id);
            for e in entries {
                let pos = e.progress.map(|p| format!(" · {}%", (p * 100.0).round())).unwrap_or_default();
                let section = format!("## Entrada importada{pos}

{}", e.body);
                journal_files::append(&dir, &file, &book.title, book.author.as_deref(), &section)?;
            }
        }
        lib.set_setting("journal-migrated", "true")?;
    }
    Ok(())
}

#[tauri::command]
pub fn journal_read(book_id: i64, state: State<LibraryState>) -> Result<JournalFile> {
    let lib = lock(&state);
    let (file, _) = journal_target(&lib, book_id)?;
    let folder = journal_dir(&lib)?;
    let contents = match &folder {
        Some(dir) => journal_files::read(dir, &file)?,
        None => String::new(),
    };
    Ok(JournalFile { folder: folder.map(|p| p.to_string_lossy().into_owned()), file, contents })
}

#[tauri::command]
pub fn journal_append(book_id: i64, section: String, state: State<LibraryState>) -> Result<String> {
    let lib = lock(&state);
    let dir = require_journal_dir(&lib)?;
    let (file, book) = journal_target(&lib, book_id)?;
    journal_files::append(&dir, &file, &book.title, book.author.as_deref(), &section)
}

#[tauri::command]
pub fn journal_write(book_id: i64, contents: String, state: State<LibraryState>) -> Result<()> {
    let lib = lock(&state);
    let dir = require_journal_dir(&lib)?;
    let (file, _) = journal_target(&lib, book_id)?;
    journal_files::write(&dir, &file, &contents)
}

/// `data` is base64; returns the image path relative to the journal folder.
#[tauri::command]
pub fn journal_save_image(data: String, extension: String, state: State<LibraryState>) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| crate::error::Error::Invalid("invalid image data".into()))?;
    let dir = require_journal_dir(&lock(&state))?;
    journal_files::save_image(&dir, &bytes, &extension)
}

#[tauri::command]
pub fn journal_image(path: String, state: State<LibraryState>) -> Result<Response> {
    let dir = require_journal_dir(&lock(&state))?;
    Ok(Response::new(std::fs::read(journal_files::image_path(&dir, &path)?)?))
}

// --- Open Library (online metadata and covers) --------------------------------------
// `async` runs them off the main thread, so the window stays responsive.

#[tauri::command(async)]
pub fn metadata_search(title: String, author: Option<String>) -> Result<Vec<crate::openlibrary::Candidate>> {
    crate::openlibrary::search(&title, author.as_deref())
}

#[tauri::command(async)]
pub fn metadata_description(key: String) -> Result<Option<String>> {
    crate::openlibrary::description(&key)
}

#[tauri::command(async)]
pub fn metadata_cover(cover_id: i64, size: String) -> Result<Response> {
    Ok(Response::new(crate::openlibrary::cover(cover_id, &size)?))
}

// --- Settings ----------------------------------------------------------------------

/// Settings are opaque JSON strings owned by the frontend.
#[tauri::command]
pub fn get_setting(key: String, state: State<LibraryState>) -> Result<Option<String>> {
    lock(&state).setting(&key)
}

#[tauri::command]
pub fn set_setting(key: String, value: String, state: State<LibraryState>) -> Result<()> {
    lock(&state).set_setting(&key, &value)
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
