//! Keeping book files in order on disk: renaming them after their metadata,
//! writing title and author inside EPUB files, and sending files to the
//! system trash. Every write goes to a temporary file first and replaces the
//! original only when it is complete, so a failure never leaves a broken book.

use crate::error::{Error, Result};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Text that is valid as a file name on Windows, macOS and Linux.
pub fn safe_stem(text: &str, max_chars: usize) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| if "\\/:*?\"<>|#^[]".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    cleaned.trim_matches(|c| c == '.' || c == ' ').chars().take(max_chars).collect::<String>().trim_end().to_string()
}

/// "Author - Title.ext", or "Title.ext" without an author.
pub fn organized_name(title: &str, author: Option<&str>, extension: &str) -> Option<String> {
    let title = safe_stem(title, 150);
    if title.is_empty() {
        return None;
    }
    let stem = match author.map(|a| safe_stem(a, 80)).filter(|a| !a.is_empty()) {
        Some(a) => format!("{a} - {title}"),
        None => title,
    };
    Some(format!("{stem}.{extension}"))
}

/// Renames the file in its folder to its organized name. Returns the new path
/// (the same one when nothing had to change). Never overwrites another file.
pub fn rename(path: &Path, title: &str, author: Option<&str>) -> Result<PathBuf> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
    let Some(name) = organized_name(title, author, &ext) else { return Ok(path.to_path_buf()) };
    let dir = path.parent().ok_or_else(|| Error::Invalid("file has no folder".into()))?;
    let current = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if current == name {
        return Ok(path.to_path_buf());
    }
    let stem = name.strip_suffix(&format!(".{ext}")).unwrap_or(&name).to_string();
    // Same name with different case: renaming is allowed (it is the same file).
    let mut target = dir.join(&name);
    let mut n = 2;
    while target.exists() && !current.eq_ignore_ascii_case(&name) {
        target = dir.join(format!("{stem} ({n}).{ext}"));
        // Already called "Name (n)": keep it instead of picking another number.
        if target.file_name().and_then(|n| n.to_str()) == Some(current) {
            return Ok(path.to_path_buf());
        }
        n += 1;
    }
    fs::rename(path, &target)?;
    Ok(target)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Replaces the text of the first `<dc:{tag} ...>` element, or adds one
/// before `</metadata>` when the book has none. `None` leaves it untouched.
fn set_dc(opf: &str, tag: &str, value: Option<&str>) -> String {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else { return opf.to_string() };
    let open = format!("<dc:{tag}");
    let close = format!("</dc:{tag}>");
    if let Some(start) = opf.find(&open) {
        let after = &opf[start..];
        let Some(gt) = after.find('>') else { return opf.to_string() };
        let content_start = start + gt + 1;
        if after[..gt].ends_with('/') {
            // Self-closing element: replace it with a full one.
            return format!("{}<dc:{tag}>{}</dc:{tag}>{}", &opf[..start], xml_escape(value), &opf[content_start..]);
        }
        if let Some(end) = opf[content_start..].find(&close) {
            return format!("{}{}{}", &opf[..content_start], xml_escape(value), &opf[content_start + end..]);
        }
        return opf.to_string();
    }
    match opf.find("</metadata>").or_else(|| opf.find("</opf:metadata>")) {
        Some(pos) => format!("{}  <dc:{tag}>{}</dc:{tag}>\n  {}", &opf[..pos], xml_escape(value), &opf[pos..]),
        None => opf.to_string(),
    }
}

fn opf_path(archive: &mut zip::ZipArchive<fs::File>) -> Result<String> {
    let mut container = String::new();
    archive
        .by_name("META-INF/container.xml")
        .map_err(|e| Error::Invalid(format!("not an EPUB: {e}")))?
        .read_to_string(&mut container)?;
    let start = container.find("full-path=\"").ok_or_else(|| Error::Invalid("EPUB without package file".into()))? + 11;
    let end = container[start..].find('"').ok_or_else(|| Error::Invalid("EPUB without package file".into()))?;
    Ok(container[start..start + end].to_string())
}

/// Writes title, author and description into an EPUB, so other readers and
/// file managers show the same details as Noctua.
pub fn write_epub_metadata(path: &Path, title: &str, author: Option<&str>, description: Option<&str>) -> Result<()> {
    let zip_err = |e: zip::result::ZipError| Error::Invalid(format!("EPUB: {e}"));
    let mut archive = zip::ZipArchive::new(fs::File::open(path)?).map_err(zip_err)?;
    let opf_name = opf_path(&mut archive)?;
    let mut opf = String::new();
    archive.by_name(&opf_name).map_err(zip_err)?.read_to_string(&mut opf)?;
    let mut updated = set_dc(&opf, "title", Some(title));
    updated = set_dc(&updated, "creator", author);
    updated = set_dc(&updated, "description", description);
    if updated == opf {
        return Ok(());
    }

    let tmp = path.with_extension("noctua-tmp");
    let result = (|| -> Result<()> {
        let mut out = zip::ZipWriter::new(fs::File::create(&tmp)?);
        for i in 0..archive.len() {
            let entry = archive.by_index_raw(i).map_err(zip_err)?;
            if entry.name().is_ok_and(|n| n == opf_name) {
                drop(entry);
                let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
                out.start_file(opf_name.as_str(), options).map_err(zip_err)?;
                out.write_all(updated.as_bytes())?;
            } else {
                // Copied byte for byte, so "mimetype" stays first and uncompressed.
                out.raw_copy_file(entry).map_err(zip_err)?;
            }
        }
        out.finish().map_err(zip_err)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    drop(archive);
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Sends files to the system trash (recoverable). Returns the ones that failed.
pub fn to_trash(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| p.exists())
        .filter(|p| trash::delete(p).is_err())
        .map(|p| p.display().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("noctua-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn names_are_organized_and_portable() {
        assert_eq!(
            organized_name("Y colorín colorado: este cuento", Some("Odín Dupeyron"), "epub").unwrap(),
            "Odín Dupeyron - Y colorín colorado este cuento.epub"
        );
        assert_eq!(organized_name("Libro", None, "pdf").unwrap(), "Libro.pdf");
        assert_eq!(organized_name(" ... ", None, "pdf"), None);
    }

    #[test]
    fn rename_never_overwrites() {
        let dir = temp("rename");
        let a = dir.join("a.epub");
        fs::write(&a, b"one").unwrap();
        fs::write(dir.join("Ana - Libro.epub"), b"other").unwrap();
        let moved = rename(&a, "Libro", Some("Ana")).unwrap();
        assert_eq!(moved.file_name().unwrap(), "Ana - Libro (2).epub");
        assert_eq!(fs::read(dir.join("Ana - Libro.epub")).unwrap(), b"other");
        assert_eq!(rename(&moved, "Libro", Some("Ana")).unwrap().file_name().unwrap(), "Ana - Libro (2).epub");
    }

    #[test]
    fn dc_elements_are_replaced_or_added() {
        let opf = r#"<metadata><dc:title id="t">Viejo</dc:title><dc:creator/></metadata>"#;
        let out = set_dc(&set_dc(opf, "title", Some("Nuevo & <bueno>")), "creator", Some("Ana"));
        assert!(out.contains(r#"<dc:title id="t">Nuevo &amp; &lt;bueno&gt;</dc:title>"#));
        assert!(out.contains("<dc:creator>Ana</dc:creator>"));
        let out = set_dc(&out, "description", Some("Hola"));
        assert!(out.contains("<dc:description>Hola</dc:description>"));
        assert_eq!(set_dc(&out, "creator", None), out);
    }

    #[test]
    fn epub_metadata_is_written_and_stays_valid() {
        let dir = temp("epub");
        let path = dir.join("b.epub");
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&path).unwrap());
            let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            w.start_file("mimetype", stored).unwrap();
            w.write_all(b"application/epub+zip").unwrap();
            w.start_file("META-INF/container.xml", stored).unwrap();
            w.write_all(br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#).unwrap();
            w.start_file("OEBPS/content.opf", stored).unwrap();
            w.write_all(b"<package><metadata><dc:title>()</dc:title></metadata></package>").unwrap();
            w.start_file("OEBPS/ch1.xhtml", stored).unwrap();
            w.write_all(b"<p>Hola</p>").unwrap();
            w.finish().unwrap();
        }
        write_epub_metadata(&path, "Y colorín colorado", Some("Odín Dupeyron"), None).unwrap();
        let mut a = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        assert_eq!(a.by_index(0).unwrap().name().unwrap(), "mimetype", "mimetype stays first");
        let mut opf = String::new();
        a.by_name("OEBPS/content.opf").unwrap().read_to_string(&mut opf).unwrap();
        assert!(opf.contains("<dc:title>Y colorín colorado</dc:title>"));
        assert!(opf.contains("<dc:creator>Odín Dupeyron</dc:creator>"));
        let mut ch = String::new();
        a.by_name("OEBPS/ch1.xhtml").unwrap().read_to_string(&mut ch).unwrap();
        assert_eq!(ch, "<p>Hola</p>");
        assert!(!dir.join("b.noctua-tmp").exists());
    }
}
