use std::io::{BufRead, Read};

use crate::error::{Error, Result};

/// A parsed HTTP response.
///
/// `raw_head` preserves the original bytes of the status line + headers so
/// `-i` can echo them verbatim.
#[derive(Debug, Clone)]
pub struct Response {
    pub version: String,
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub raw_head: Vec<u8>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn is_redirect(&self) -> bool {
        matches!(self.status, 301 | 302 | 303 | 307 | 308)
    }

    pub fn location(&self) -> Option<&str> {
        self.header("location")
    }

    pub fn is_chunked(&self) -> bool {
        self.header("transfer-encoding")
            .map(|v| v.to_ascii_lowercase().contains("chunked"))
            .unwrap_or(false)
    }
}

/// Read one full response from `reader`.
///
/// * `head_only` - the request was HEAD, so there is never a body.
/// * `progress` - called with the running total of body bytes received.
pub fn read_response<R: BufRead>(
    reader: &mut R,
    head_only: bool,
    progress: &mut dyn FnMut(u64),
) -> Result<Response> {
    // --- status line + headers -------------------------------------------
    let mut raw_head: Vec<u8> = Vec::new();
    loop {
        let mut line = Vec::new();
        let n = reader
            .read_until(b'\n', &mut line)
            .map_err(|e| Error::from_io(&e, false))?;
        if n == 0 {
            return Err(if raw_head.is_empty() {
                Error::Protocol("no data".into())
            } else {
                Error::Protocol("truncated headers".into())
            });
        }
        raw_head.extend_from_slice(&line);
        if raw_head.len() > 1024 * 1024 {
            return Err(Error::Protocol("headers exceed 1 MiB".into()));
        }
        if line == b"\r\n" || line == b"\n" {
            break;
        }
    }

    // Tolerate bare-LF servers by normalising line endings.
    let head_str = String::from_utf8_lossy(&raw_head).into_owned();
    let mut lines = head_str.split('\n').map(|l| l.trim_end_matches('\r'));
    let status_line = lines
        .next()
        .filter(|l| !l.is_empty())
        .ok_or_else(|| Error::Protocol("empty status line".into()))?;
    if !status_line.starts_with("HTTP/") {
        return Err(Error::Protocol(format!(
            "malformed status line '{status_line}'"
        )));
    }
    let mut parts = status_line.splitn(3, ' ');
    let version = parts.next().unwrap_or("").to_string();
    let status: u16 = parts
        .next()
        .ok_or_else(|| Error::Protocol(format!("malformed status line '{status_line}'")))?
        .parse()
        .map_err(|_| Error::Protocol(format!("malformed status code in '{status_line}'")))?;
    let reason = parts.next().unwrap_or("").to_string();

    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }

    let mut resp = Response {
        version,
        status,
        reason,
        headers,
        raw_head,
        body: Vec::new(),
    };

    // --- body -------------------------------------------------------------
    if head_only || matches!(resp.status, 204 | 304) || (100..200).contains(&resp.status) {
        return Ok(resp);
    }

    let mut total = 0u64;
    if resp.is_chunked() {
        resp.body = read_chunked(reader, &mut total, progress)?;
    } else if let Some(len) = resp.header("content-length") {
        let len: u64 = len
            .parse()
            .map_err(|_| Error::Protocol(format!("invalid Content-Length '{len}'")))?;
        let mut buf = Vec::with_capacity(len.min(64 * 1024) as usize);
        fill(reader, &mut buf, len, &mut total, progress)?;
        resp.body = buf;
    } else {
        let mut buf = Vec::new();
        loop {
            let mut tmp = [0u8; 16 * 1024];
            let n = reader
                .read(&mut tmp)
                .map_err(|e| Error::from_io(&e, false))?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            total += n as u64;
            progress(total);
        }
        resp.body = buf;
    }
    Ok(resp)
}

/// Append exactly `want` more bytes from `reader` into `buf`.
fn fill<R: BufRead>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    want: u64,
    total: &mut u64,
    progress: &mut dyn FnMut(u64),
) -> Result<()> {
    let mut got: u64 = 0;
    while got < want {
        let mut tmp = [0u8; 16 * 1024];
        let mut limited = (&mut *reader).take(want - got);
        let n = limited
            .read(&mut tmp)
            .map_err(|e| Error::from_io(&e, false))?;
        if n == 0 {
            return Err(Error::Protocol(format!(
                "end of file while reading body ({}/{want} bytes)",
                got
            )));
        }
        buf.extend_from_slice(&tmp[..n]);
        got += n as u64;
        *total += n as u64;
        progress(*total);
    }
    Ok(())
}

fn read_chunked<R: BufRead>(
    reader: &mut R,
    total: &mut u64,
    progress: &mut dyn FnMut(u64),
) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        // Chunk-size line: `hex[;extensions] CRLF`
        let mut line = Vec::new();
        reader
            .read_until(b'\n', &mut line)
            .map_err(|e| Error::from_io(&e, false))?;
        if line.is_empty() {
            return Err(Error::Protocol("truncated chunked body".into()));
        }
        let text = String::from_utf8_lossy(&line);
        let size_text = text.split(';').next().unwrap_or("").trim();
        let size = u64::from_str_radix(size_text, 16)
            .map_err(|_| Error::Protocol(format!("invalid chunk size '{size_text}'")))?;

        if size == 0 {
            // Trailer section (if any): read until blank line.
            loop {
                let mut t = Vec::new();
                let n = reader
                    .read_until(b'\n', &mut t)
                    .map_err(|e| Error::from_io(&e, false))?;
                if n == 0 || t == b"\r\n" || t == b"\n" {
                    break;
                }
            }
            break;
        }

        fill(reader, &mut out, size, total, progress)?;

        // Consume the CRLF that terminates the chunk data.
        let mut crlf = [0u8; 2];
        reader
            .read_exact(&mut crlf)
            .map_err(|e| Error::from_io(&e, false))?;
        if !(crlf[0] == b'\r' && crlf[1] == b'\n') && crlf[0] != b'\n' {
            return Err(Error::Protocol("missing CRLF after chunk".into()));
        }
    }
    Ok(out)
}

/// Decode a `Content-Encoding` value.
///
/// Returns `Ok(None)` when decompression is not needed or the encoding is
/// unknown (unknown encodings are passed through, like curl does).
pub fn decompress(encoding: &str, data: &[u8]) -> Result<Option<Vec<u8>>> {
    let mut out = Vec::new();
    match encoding.trim().to_ascii_lowercase().as_str() {
        "gzip" | "x-gzip" => {
            let mut d = flate2::read::MultiGzDecoder::new(data);
            d.read_to_end(&mut out)
                .map_err(|e| Error::Protocol(format!("gzip decompression failed: {e}")))?;
            Ok(Some(out))
        }
        "deflate" => {
            // Try zlib-wrapped first, then raw deflate.
            let mut d = flate2::read::ZlibDecoder::new(data);
            if d.read_to_end(&mut out).is_err() {
                out.clear();
                let mut d = flate2::read::DeflateDecoder::new(data);
                d.read_to_end(&mut out)
                    .map_err(|e| Error::Protocol(format!("deflate decompression failed: {e}")))?;
            }
            Ok(Some(out))
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn read(raw: &[u8], head_only: bool) -> Result<Response> {
        let mut r = std::io::BufReader::new(Cursor::new(raw.to_vec()));
        read_response(&mut r, head_only, &mut |_| {})
    }

    #[test]
    fn parses_simple_response() {
        let resp = read(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\n\r\nhello",
            false,
        )
        .unwrap();
        assert_eq!(resp.status, 200);
        assert_eq!(resp.reason, "OK");
        assert_eq!(resp.version, "HTTP/1.1");
        assert_eq!(resp.header("content-type"), Some("text/plain"));
        assert_eq!(resp.body, b"hello");
        assert!(String::from_utf8_lossy(&resp.raw_head).contains("Content-Length: 5"));
    }

    #[test]
    fn parses_chunked_response() {
        let raw =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        let resp = read(raw, false).unwrap();
        assert_eq!(resp.body, b"hello world");
        assert!(resp.is_chunked());
    }

    #[test]
    fn chunked_with_trailer_and_extensions() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4;ext=1\r\ntest\r\n0\r\nX-Trailer: v\r\n\r\n";
        let resp = read(raw, false).unwrap();
        assert_eq!(resp.body, b"test");
    }

    #[test]
    fn read_until_close_without_content_length() {
        let resp = read(b"HTTP/1.1 200 OK\r\n\r\nbody until close", false).unwrap();
        assert_eq!(resp.body, b"body until close");
    }

    #[test]
    fn head_only_has_no_body() {
        let resp = read(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n", true).unwrap();
        assert!(resp.body.is_empty());
        assert_eq!(resp.status, 200);
    }

    #[test]
    fn no_content_has_no_body() {
        let resp = read(b"HTTP/1.1 204 No Content\r\n\r\n", false).unwrap();
        assert!(resp.body.is_empty());
    }

    #[test]
    fn progress_reports_bytes() {
        let mut seen = Vec::new();
        let mut r = std::io::BufReader::new(Cursor::new(
            b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n0123456789".to_vec(),
        ));
        read_response(&mut r, false, &mut |b| seen.push(b)).unwrap();
        assert_eq!(*seen.last().unwrap(), 10);
    }

    #[test]
    fn empty_reply_is_protocol_error() {
        let err = read(b"", false).unwrap_err();
        assert_eq!(err.code(), 52);
    }

    #[test]
    fn truncated_body_is_error() {
        let err = read(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort", false).unwrap_err();
        assert_eq!(err.code(), 52);
    }

    #[test]
    fn redirect_detection() {
        let resp = read(
            b"HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\n\r\n",
            false,
        )
        .unwrap();
        assert!(resp.is_redirect());
        assert_eq!(resp.location(), Some("/next"));
        let resp = read(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", false).unwrap();
        assert!(!resp.is_redirect());
    }

    #[test]
    fn bare_lf_headers() {
        let resp = read(b"HTTP/1.1 200 OK\nContent-Length: 2\n\nhi", false).unwrap();
        assert_eq!(resp.status, 200);
        assert_eq!(resp.body, b"hi");
    }

    #[test]
    fn gzip_decompression() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(b"compressed data").unwrap();
        let gz = enc.finish().unwrap();
        let out = decompress("gzip", &gz).unwrap().unwrap();
        assert_eq!(out, b"compressed data");
        assert!(decompress("identity", b"x").unwrap().is_none());
        assert!(decompress("unknown", b"x").unwrap().is_none());
    }
}
