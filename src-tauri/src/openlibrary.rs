//! Book metadata and covers from Open Library (https://openlibrary.org), an
//! open, free service of the Internet Archive that needs no API key.
//!
//! Requests only go out when the user presses "Search" in the book
//! properties, and only to openlibrary.org over HTTPS.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

const API: &str = "https://openlibrary.org";
const COVERS: &str = "https://covers.openlibrary.org/b/id";
const MAX_JSON: u64 = 2 * 1024 * 1024;
const MAX_IMAGE: u64 = 8 * 1024 * 1024;

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .https_only(true)
            .max_redirects(4)
            // Open Library asks clients to identify themselves.
            .user_agent(concat!("Noctua/", env!("CARGO_PKG_VERSION"), " (https://github.com/probuho/Noctua)"))
            .build()
            .into()
    })
}

fn net(e: ureq::Error) -> Error {
    Error::Invalid(format!("Open Library: {e}"))
}

/// One search result, as the frontend shows it.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Work key, e.g. "/works/OL45804W".
    pub key: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i64>,
    pub cover_id: Option<i64>,
    pub publisher: Option<String>,
    pub languages: Vec<String>,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    docs: Vec<Doc>,
}

#[derive(Deserialize)]
struct Doc {
    key: String,
    title: Option<String>,
    #[serde(default)]
    author_name: Vec<String>,
    first_publish_year: Option<i64>,
    cover_i: Option<i64>,
    #[serde(default)]
    publisher: Vec<String>,
    #[serde(default)]
    language: Vec<String>,
}

fn parse_search(json: &str) -> Result<Vec<Candidate>> {
    let resp: SearchResponse = serde_json::from_str(json).map_err(|e| Error::Invalid(e.to_string()))?;
    Ok(resp
        .docs
        .into_iter()
        .filter_map(|d| {
            Some(Candidate {
                key: d.key,
                title: d.title?,
                authors: d.author_name,
                year: d.first_publish_year,
                cover_id: d.cover_i,
                publisher: d.publisher.into_iter().next(),
                languages: d.language,
            })
        })
        .collect())
}

/// Searches by title and (optionally) author. Falls back to a free-text
/// query when the exact fields find nothing.
pub fn search(title: &str, author: Option<&str>) -> Result<Vec<Candidate>> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Invalid("title is empty".into()));
    }
    let fields = "key,title,author_name,first_publish_year,cover_i,publisher,language";
    let run = |req: ureq::RequestBuilder<ureq::typestate::WithoutBody>| -> Result<Vec<Candidate>> {
        let body = req
            .query("fields", fields)
            .query("limit", "12")
            .call()
            .map_err(net)?
            .body_mut()
            .with_config()
            .limit(MAX_JSON)
            .read_to_string()
            .map_err(net)?;
        parse_search(&body)
    };
    let url = format!("{API}/search.json");
    let mut req = agent().get(&url).query("title", title);
    if let Some(a) = author.map(str::trim).filter(|a| !a.is_empty()) {
        req = req.query("author", a);
    }
    let found = run(req)?;
    if !found.is_empty() || author.is_none() {
        return Ok(found);
    }
    run(agent().get(&url).query("q", title))
}

#[derive(Deserialize)]
struct Work {
    description: Option<Description>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Description {
    Text(String),
    Typed { value: String },
}

fn parse_description(json: &str) -> Option<String> {
    let work: Work = serde_json::from_str(json).ok()?;
    let text = match work.description? {
        Description::Text(s) | Description::Typed { value: s } => s,
    };
    // Open Library descriptions often end with a "----------" block of links.
    let text = text.split("\r\n----------").next().unwrap_or(&text);
    let text = text.split("\n----------").next().unwrap_or(text).trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Description of a work, if Open Library has one.
pub fn description(key: &str) -> Result<Option<String>> {
    let valid = key.strip_prefix("/works/").is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()));
    if !valid {
        return Err(Error::Invalid(format!("invalid work key: {key}")));
    }
    let body = agent()
        .get(&format!("{API}{key}.json"))
        .call()
        .map_err(net)?
        .body_mut()
        .with_config()
        .limit(MAX_JSON)
        .read_to_string()
        .map_err(net)?;
    Ok(parse_description(&body))
}

/// Cover image bytes. `size` is "S", "M" or "L".
pub fn cover(cover_id: i64, size: &str) -> Result<Vec<u8>> {
    if cover_id <= 0 || !matches!(size, "S" | "M" | "L") {
        return Err(Error::Invalid("invalid cover request".into()));
    }
    agent()
        .get(&format!("{COVERS}/{cover_id}-{size}.jpg"))
        // Without this, a missing cover returns a 1x1 placeholder instead of 404.
        .query("default", "false")
        .call()
        .map_err(net)?
        .body_mut()
        .with_config()
        .limit(MAX_IMAGE)
        .read_to_vec()
        .map_err(net)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_results() {
        let json = r#"{"numFound":2,"docs":[
            {"key":"/works/OL1W","title":"Y colorín colorado este cuento aún no se ha acabado",
             "author_name":["Odín Dupeyron"],"first_publish_year":2004,"cover_i":123,
             "publisher":["Grijalbo","Otra"],"language":["spa"]},
            {"key":"/works/OL2W"}]}"#;
        let list = parse_search(json).unwrap();
        assert_eq!(list.len(), 1, "results without a title are skipped");
        assert_eq!(list[0].authors, vec!["Odín Dupeyron"]);
        assert_eq!(list[0].cover_id, Some(123));
        assert_eq!(list[0].publisher.as_deref(), Some("Grijalbo"));
    }

    #[test]
    fn parses_both_description_shapes() {
        assert_eq!(parse_description(r#"{"description":"Hola"}"#).as_deref(), Some("Hola"));
        assert_eq!(
            parse_description(r#"{"description":{"type":"/type/text","value":"Texto\r\n----------\nLinks"}}"#).as_deref(),
            Some("Texto")
        );
        assert_eq!(parse_description(r#"{"title":"x"}"#), None);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(description("/authors/OL1A").is_err());
        assert!(description("/works/../x").is_err());
        assert!(cover(0, "M").is_err());
        assert!(cover(5, "XL").is_err());
    }

    /// Hits the real service: `cargo test live_ -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_search_and_cover() {
        let list = search("Y colorín colorado este cuento aún no se ha acabado", Some("Odín Dupeyron")).unwrap();
        println!("{list:#?}");
        assert!(!list.is_empty());
        if let Some(id) = list.iter().find_map(|c| c.cover_id) {
            let bytes = cover(id, "M").unwrap();
            println!("cover bytes: {}", bytes.len());
            assert!(bytes.starts_with(&[0xFF, 0xD8]), "JPEG");
        }
        println!("description: {:?}", description(&list[0].key).unwrap());
    }
}
