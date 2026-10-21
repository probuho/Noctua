//! Reading journal stored as plain Markdown files, one per book, in a folder
//! the user picks (it can be an Obsidian vault). Pasted images go to an
//! `attachments/` subfolder and are linked with standard Markdown, which
//! Obsidian, VS Code and any Markdown viewer understand.
//!
//! The folder comes from the library settings, never from the frontend, and
//! every path is checked to stay inside it.

use crate::error::{Error, Result};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const FOLDER_KEY: &str = "journal-folder";
pub const ATTACHMENTS: &str = "attachments";
const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// A file name that is valid on Windows, macOS and Linux.
pub fn file_name_for(title: &str, book_id: i64) -> String {
    let cleaned = crate::book_files::safe_stem(title, 120);
    if cleaned.is_empty() { format!("Libro {book_id}.md") } else { format!("{cleaned}.md") }
}

fn ensure_folder(folder: &Path) -> Result<()> {
    if !folder.is_dir() {
        return Err(Error::Invalid(format!("journal folder not found: {}", folder.display())));
    }
    Ok(())
}

pub fn read(folder: &Path, file: &str) -> Result<String> {
    ensure_folder(folder)?;
    match fs::read_to_string(folder.join(file)) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

/// Header for a new file: YAML front matter (Obsidian properties) and a title.
fn header(title: &str, author: Option<&str>) -> String {
    let quote = |s: &str| s.replace('"', "'");
    let mut out = format!("---\ntitle: \"{}\"\n", quote(title));
    if let Some(a) = author {
        out += &format!("author: \"{}\"\n", quote(a));
    }
    out += "tags: [noctua, lectura]\n---\n\n";
    out += &format!("# {title}\n");
    out
}

/// Updates the title/author properties and the "# Title" heading after the
/// book's details change. The rest of the file (the user's writing) is untouched.
pub fn retitle(text: &str, old_title: &str, title: &str, author: Option<&str>) -> String {
    let quote = |s: &str| s.replace('"', "'");
    let mut out = String::with_capacity(text.len());
    let mut in_front = false;
    let mut front_done = !text.starts_with("---");
    let mut author_written = false;
    let mut heading_done = false;
    for (i, line) in text.split_inclusive('\n').enumerate() {
        let bare = line.trim_end_matches(['\r', '\n']);
        let eol = &line[bare.len()..];
        if !front_done {
            if i == 0 {
                in_front = true;
                out.push_str(line);
                continue;
            }
            if in_front && bare == "---" {
                if let (false, Some(a)) = (author_written, author) {
                    out.push_str(&format!("author: \"{}\"{eol}", quote(a)));
                }
                in_front = false;
                front_done = true;
                out.push_str(line);
                continue;
            }
            if bare.starts_with("title:") {
                out.push_str(&format!("title: \"{}\"{eol}", quote(title)));
                continue;
            }
            if bare.starts_with("author:") {
                author_written = true;
                if let Some(a) = author {
                    out.push_str(&format!("author: \"{}\"{eol}", quote(a)));
                }
                continue;
            }
            out.push_str(line);
            continue;
        }
        if !heading_done && bare == format!("# {old_title}") {
            heading_done = true;
            out.push_str(&format!("# {title}{eol}"));
            continue;
        }
        out.push_str(line);
    }
    out
}

/// Appends a section to the book's journal, creating the file if needed.
pub fn append(folder: &Path, file: &str, title: &str, author: Option<&str>, section: &str) -> Result<String> {
    ensure_folder(folder)?;
    let path = folder.join(file);
    let mut text = if path.exists() { fs::read_to_string(&path)? } else { header(title, author) };
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text.push('\n');
    text.push_str(section.trim_end());
    text.push('\n');
    fs::write(&path, &text)?;
    Ok(text)
}

/// Replaces the whole file (used by "Edit file").
pub fn write(folder: &Path, file: &str, contents: &str) -> Result<()> {
    ensure_folder(folder)?;
    fs::write(folder.join(file), contents)?;
    Ok(())
}

/// Saves a pasted image and returns its path relative to the folder.
pub fn save_image(folder: &Path, bytes: &[u8], extension: &str) -> Result<String> {
    ensure_folder(folder)?;
    let ext = extension.trim_start_matches('.').to_ascii_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(Error::Invalid(format!("unsupported image type: {ext}")));
    }
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(Error::Invalid("image is empty or larger than 15 MB".into()));
    }
    let dir = folder.join(ATTACHMENTS);
    fs::create_dir_all(&dir)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default();
    let name = format!("noctua-{stamp}.{ext}");
    let mut f = fs::File::create_new(dir.join(&name))?;
    f.write_all(bytes)?;
    Ok(format!("{ATTACHMENTS}/{name}"))
}

/// Resolves a relative image path, refusing anything outside the folder.
pub fn image_path(folder: &Path, relative: &str) -> Result<PathBuf> {
    let rel = Path::new(relative);
    let safe = rel.components().all(|c| matches!(c, Component::Normal(_)));
    let ext_ok = rel
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
    if !safe || !ext_ok {
        return Err(Error::Invalid(format!("invalid image path: {relative}")));
    }
    Ok(folder.join(rel))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oer-journal-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn file_names_are_portable() {
        assert_eq!(file_name_for("Y colorín: colorado?", 1), "Y colorín colorado.md");
        assert_eq!(file_name_for("  ...  ", 7), "Libro 7.md");
        assert_eq!(file_name_for("a/b\\c", 1), "a b c.md");
    }

    #[test]
    fn append_creates_front_matter_then_adds_sections() {
        let dir = temp("append");
        let text = append(&dir, "Libro.md", "Libro", Some("Ana"), "## Día 1\n\nHola").unwrap();
        assert!(text.starts_with("---\ntitle: \"Libro\"\nauthor: \"Ana\""));
        let text = append(&dir, "Libro.md", "Libro", Some("Ana"), "## Día 2\n\nAdiós").unwrap();
        assert_eq!(text.matches("---\n").count(), 2, "front matter written once");
        assert!(text.contains("## Día 1") && text.ends_with("Adiós\n"));
        assert_eq!(read(&dir, "Libro.md").unwrap(), text);
        assert_eq!(read(&dir, "Otro.md").unwrap(), "");
    }

    #[test]
    fn retitle_updates_properties_and_heading_only() {
        let text = "---\ntitle: \"c\"\ntags: [noctua, lectura]\n---\n\n# c\n\n## Día\n\n# c en mi texto\n";
        let out = retitle(text, "c", "Manual \"nuevo\"", Some("Ana"));
        assert_eq!(
            out,
            "---\ntitle: \"Manual 'nuevo'\"\ntags: [noctua, lectura]\nauthor: \"Ana\"\n---\n\n# Manual \"nuevo\"\n\n## Día\n\n# c en mi texto\n"
        );
        let again = retitle(&out, "Manual \"nuevo\"", "Otro", None);
        assert!(!again.contains("author:") && again.contains("title: \"Otro\"") && again.contains("\n# Otro\n"));
        assert_eq!(retitle("Sin propiedades\n", "x", "y", None), "Sin propiedades\n");
        // Windows line endings are kept.
        assert_eq!(retitle("---\r\ntitle: \"a\"\r\n---\r\n# a\r\n", "a", "b", None), "---\r\ntitle: \"b\"\r\n---\r\n# b\r\n");
    }

    #[test]
    fn images_stay_inside_the_folder() {
        let dir = temp("images");
        let rel = save_image(&dir, b"\x89PNG", "png").unwrap();
        assert!(rel.starts_with("attachments/noctua-") && rel.ends_with(".png"));
        assert_eq!(fs::read(image_path(&dir, &rel).unwrap()).unwrap(), b"\x89PNG");
        assert!(save_image(&dir, b"x", "exe").is_err());
        assert!(image_path(&dir, "../secret.png").is_err());
        assert!(image_path(&dir, "attachments/notes.md").is_err());
        assert!(read(&dir.join("missing"), "x.md").is_err());
    }
}
