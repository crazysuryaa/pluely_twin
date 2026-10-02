//! Plain-text extraction for session documents (resume, JD, evidence).
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use std::io::Read;

const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;

#[tauri::command]
pub async fn extract_document_text(file_name: String, data_base64: String) -> Result<String, String> {
    let bytes = B64
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Invalid file data: {e}"))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err("File is larger than 10 MB".to_string());
    }
    let ext = file_name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();

    let text = tokio::task::spawn_blocking(move || extract(&ext, &bytes))
        .await
        .map_err(|e| format!("Extraction task failed: {e}"))??;

    let text = normalize(&text);
    if text.is_empty() {
        return Err("No readable text found in this file".to_string());
    }
    Ok(text)
}

fn extract(ext: &str, bytes: &[u8]) -> Result<String, String> {
    match ext {
        "txt" | "md" | "text" => Ok(String::from_utf8_lossy(bytes).into_owned()),
        "pdf" => pdf_extract::extract_text_from_mem(bytes)
            .map_err(|e| format!("Could not read PDF: {e}")),
        "docx" => extract_docx(bytes),
        "doc" | "rtf" => extract_with_textutil(ext, bytes),
        _ => Err(format!(
            "Unsupported file type .{ext} (use txt, md, pdf, doc, docx or rtf)"
        )),
    }
}

/// A .docx is a zip; the body text lives in word/document.xml.
fn extract_docx(bytes: &[u8]) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("Could not open .docx: {e}"))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| "Not a valid .docx (missing document body)".to_string())?
        .read_to_string(&mut xml)
        .map_err(|e| format!("Could not read .docx: {e}"))?;
    Ok(docx_xml_to_text(&xml))
}

fn docx_xml_to_text(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 4);
    let mut rest = xml;
    while let Some(start) = rest.find('<') {
        out.push_str(&unescape_xml(&rest[..start]));
        let Some(end) = rest[start..].find('>') else { break };
        let tag = &rest[start + 1..start + end];
        match tag.split([' ', '/']).next().unwrap_or("") {
            "" if tag == "/w:p" => out.push('\n'), // </w:p> paragraph end
            "w:tab" => out.push('\t'),
            "w:br" | "w:cr" => out.push('\n'),
            _ => {}
        }
        rest = &rest[start + end + 1..];
    }
    out
}

fn unescape_xml(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[cfg(target_os = "macos")]
fn extract_with_textutil(ext: &str, bytes: &[u8]) -> Result<String, String> {
    let path = std::env::temp_dir().join(format!(
        "pluely-doc-{}.{ext}",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&path, bytes).map_err(|e| format!("Could not stage file: {e}"))?;
    let output = std::process::Command::new("/usr/bin/textutil")
        .args(["-convert", "txt", "-stdout"])
        .arg(&path)
        .output();
    let _ = std::fs::remove_file(&path);
    let output = output.map_err(|e| format!("Could not run textutil: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Could not read .{ext}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(not(target_os = "macos"))]
fn extract_with_textutil(ext: &str, _bytes: &[u8]) -> Result<String, String> {
    Err(format!(".{ext} files are only supported on macOS; save as .docx or .pdf"))
}

/// Unify line endings, drop trailing spaces and collapse long blank runs.
fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_run = 0;
    for line in text.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
        } else {
            blank_run = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docx_paragraphs_tabs_and_entities() {
        let xml = r#"<w:document><w:body><w:p><w:pPr><w:jc/></w:pPr><w:r><w:t>Jane &amp; Co</w:t></w:r></w:p><w:p><w:r><w:t>Skills:</w:t><w:tab/><w:t>Rust</w:t></w:r></w:p></w:body></w:document>"#;
        assert_eq!(normalize(&docx_xml_to_text(xml)), "Jane & Co\nSkills:\tRust");
    }

    #[test]
    fn normalize_collapses_blank_runs() {
        assert_eq!(normalize("a  \r\n\r\n\r\n\nb\n"), "a\n\nb");
    }

    #[test]
    fn rejects_unknown_types() {
        assert!(extract("exe", b"x").is_err());
    }

    #[test]
    fn reads_plain_text() {
        assert_eq!(extract("txt", "héllo".as_bytes()).unwrap(), "héllo");
    }
}
