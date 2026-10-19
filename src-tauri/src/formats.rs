//! Format detection on the backend side.
//!
//! The backend only decides *which* format a file is. Parsing and rendering
//! live in the frontend format plugins (`src/formats/*`), whose `id` must match
//! the ids declared here. Adding a format = one entry here + one plugin there.

use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct FormatInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub extensions: &'static [&'static str],
    #[serde(skip)]
    matches: fn(&[u8]) -> bool,
}

const ZIP_MAGIC: &[u8] = b"PK\x03\x04";
const PDF_MAGIC: &[u8] = b"%PDF-";

pub static FORMATS: &[FormatInfo] = &[
    FormatInfo {
        id: "epub",
        name: "EPUB",
        extensions: &["epub"],
        matches: |h| h.starts_with(ZIP_MAGIC),
    },
    FormatInfo {
        id: "pdf",
        name: "PDF",
        extensions: &["pdf"],
        matches: |h| h.starts_with(PDF_MAGIC),
    },
];

/// Identify a file by extension, then confirm with its magic bytes.
pub fn detect(path: &Path) -> Option<&'static FormatInfo> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let format = FORMATS.iter().find(|f| f.extensions.contains(&ext.as_str()))?;

    let mut header = [0u8; 8];
    let n = File::open(path).and_then(|mut f| f.read(&mut header)).ok()?;
    (format.matches)(&header[..n]).then_some(format)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(name);
        File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    #[test]
    fn detects_by_extension_and_magic() {
        assert_eq!(detect(&temp_file("oer-test.pdf", b"%PDF-1.7")).unwrap().id, "pdf");
        assert_eq!(detect(&temp_file("oer-test.EPUB", b"PK\x03\x04..")).unwrap().id, "epub");
    }

    #[test]
    fn rejects_mismatched_content() {
        assert!(detect(&temp_file("oer-fake.pdf", b"not a pdf")).is_none());
        assert!(detect(&temp_file("oer-test.txt", b"hello")).is_none());
    }
}
