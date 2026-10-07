use crate::cli::{BodyData, Config};
use crate::url::Url;

/// Build the full request bytes (head + body) for `method` against `url`.
///
/// * `body` - payload bytes (already finalised for redirects)
/// * `strip_auth` - drop Authorization headers (cross-origin redirect)
///
/// `-H "Name: value"` replaces an existing header of the same name (case
/// insensitive) or appends a new one. `-H "Name;"` removes the header.
pub fn build(cfg: &Config, url: &Url, method: &str, body: &[u8], strip_auth: bool) -> Vec<u8> {
    // Managed defaults, in wire order. `Host` comes first like curl.
    let mut headers: Vec<(String, String)> = Vec::new();
    headers.push(("Host".into(), url.host_header()));

    let default_ua = format!("rcurl/{}", crate::cli::VERSION);
    let ua = cfg.user_agent.as_deref().unwrap_or(&default_ua);
    headers.push(("User-Agent".into(), ua.to_string()));
    // `--json` also advertises JSON in Accept, like curl.
    if matches!(cfg.body, Some(BodyData::Json(_))) {
        headers.push(("Accept".into(), "application/json".into()));
    } else {
        headers.push(("Accept".into(), "*/*".into()));
    }
    if let Some(r) = &cfg.referer {
        headers.push(("Referer".into(), r.clone()));
    }
    if let Some((user, pass)) = &cfg.auth {
        // Basic credentials are dropped on cross-origin redirects too.
        if !strip_auth {
            let token = crate::base64::encode(format!("{user}:{pass}").as_bytes());
            headers.push(("Authorization".into(), format!("Basic {token}")));
        }
    }
    if cfg.compressed {
        headers.push(("Accept-Encoding".into(), "gzip, deflate".into()));
    }

    let has_body = !body.is_empty() || matches!(method, "POST" | "PUT" | "PATCH");
    if has_body {
        if let Some(BodyData::Form(_) | BodyData::Json(_)) = &cfg.body {
            if let Some(ct) = cfg.body.as_ref().and_then(BodyData::content_type) {
                headers.push(("Content-Type".into(), ct.into()));
            }
        }
        headers.push(("Content-Length".into(), body.len().to_string()));
    }
    headers.push(("Connection".into(), "close".into()));

    for raw in &cfg.headers {
        let (name, value) = match raw.split_once(':') {
            Some((n, v)) => (n.trim().to_string(), v.trim().to_string()),
            None => (
                raw.trim().trim_end_matches(';').trim().to_string(),
                String::new(),
            ),
        };
        if name.is_empty() {
            continue;
        }
        if strip_auth && is_sensitive(&name) {
            continue;
        }
        if value.is_empty() {
            headers.retain(|(n, _)| !n.eq_ignore_ascii_case(&name));
            continue;
        }
        if let Some(slot) = headers
            .iter_mut()
            .find(|(n, _)| n.eq_ignore_ascii_case(&name))
        {
            slot.1 = value;
        } else {
            headers.push((name, value));
        }
    }

    let mut out = Vec::with_capacity(256 + body.len());
    out.extend_from_slice(format!("{} {} HTTP/1.1\r\n", method, url.request_target()).as_bytes());
    for (name, value) in &headers {
        out.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
    }
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(body);
    out
}

/// Headers that must be dropped when redirecting to a different origin.
pub fn is_sensitive(name: &str) -> bool {
    name.eq_ignore_ascii_case("authorization") || name.eq_ignore_ascii_case("proxy-authorization")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{BodyData, Config, OutputTarget};

    fn cfg() -> Config {
        Config {
            url: String::new(),
            method: None,
            headers: Vec::new(),
            body: None,
            output: OutputTarget::Stdout,
            include_headers: false,
            head: false,
            verbose: false,
            silent: false,
            show_error: false,
            follow: false,
            user_agent: None,
            referer: None,
            auth: None,
            insecure: false,
            compressed: false,
            connect_timeout: None,
            max_time: None,
            no_progress: false,
        }
    }

    fn text(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn simple_get() {
        let cfg = cfg();
        let url = Url::parse("http://example.com/api?x=1").unwrap();
        let req = text(build(&cfg, &url, "GET", b"", false));
        assert!(req.starts_with("GET /api?x=1 HTTP/1.1\r\n"));
        assert!(req.contains("\r\nHost: example.com\r\n"));
        assert!(req.contains("User-Agent: rcurl/"));
        assert!(req.contains("Connection: close\r\n\r\n"));
        assert!(!req.contains("Content-Length"));
    }

    #[test]
    fn post_with_body_and_default_content_type() {
        let mut cfg = cfg();
        cfg.body = Some(BodyData::Form(b"a=1".to_vec()));
        let url = Url::parse("http://example.com/").unwrap();
        let req = text(build(&cfg, &url, "POST", b"a=1", false));
        assert!(req.contains("Content-Type: application/x-www-form-urlencoded\r\n"));
        assert!(req.contains("Content-Length: 3\r\n"));
        assert!(req.ends_with("\r\n\r\na=1"));
    }

    #[test]
    fn custom_header_overrides_default() {
        let mut cfg = cfg();
        cfg.headers.push("User-Agent: custom/1".into());
        cfg.headers.push("X-Token: abc".into());
        let url = Url::parse("http://example.com/").unwrap();
        let req = text(build(&cfg, &url, "GET", b"", false));
        assert_eq!(req.matches("User-Agent:").count(), 1);
        assert!(req.contains("User-Agent: custom/1\r\n"));
        assert!(req.contains("X-Token: abc\r\n"));
    }

    #[test]
    fn user_can_override_host() {
        let mut cfg = cfg();
        cfg.headers.push("Host: virtual.host".into());
        let url = Url::parse("http://example.com/").unwrap();
        let req = text(build(&cfg, &url, "GET", b"", false));
        assert_eq!(req.matches("Host:").count(), 1);
        assert!(req.contains("Host: virtual.host\r\n"));
    }

    #[test]
    fn semicolon_removes_header() {
        let mut cfg = cfg();
        cfg.headers.push("User-Agent;".into());
        let url = Url::parse("http://example.com/").unwrap();
        let req = text(build(&cfg, &url, "GET", b"", false));
        assert!(!req.contains("User-Agent"));
        assert!(req.contains("Connection: close"));
    }

    #[test]
    fn auth_header_built_and_stripped_on_cross_origin() {
        let mut cfg = cfg();
        cfg.auth = Some(("u".into(), "p".into()));
        let url = Url::parse("http://example.com/").unwrap();
        let req = text(build(&cfg, &url, "GET", b"", false));
        assert!(req.contains("Authorization: Basic dTpw\r\n"));

        let req = text(build(&cfg, &url, "GET", b"", true));
        assert!(!req.contains("Authorization"));
    }

    #[test]
    fn compressed_sends_accept_encoding() {
        let mut cfg = cfg();
        cfg.compressed = true;
        let url = Url::parse("http://example.com/").unwrap();
        let req = text(build(&cfg, &url, "GET", b"", false));
        assert!(req.contains("Accept-Encoding: gzip, deflate\r\n"));
    }

    #[test]
    fn host_header_with_port() {
        let cfg = cfg();
        let url = Url::parse("http://localhost:8080/x").unwrap();
        let req = text(build(&cfg, &url, "GET", b"", false));
        assert!(req.contains("Host: localhost:8080\r\n"));
    }
}
