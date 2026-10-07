use crate::error::{Error, Result};

/// A minimal URL parser supporting `scheme://host[:port][/path][?query][#fragment]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Url {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub path: String,
    pub query: String,
}

impl Url {
    pub fn parse(input: &str) -> Result<Url> {
        let input = input.trim();
        let (scheme, rest) = input
            .split_once("://")
            .ok_or_else(|| Error::Url(format!("no protocol found in '{input}'")))?;
        let scheme = scheme.to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err(Error::Url(format!("unsupported protocol '{scheme}'")));
        }
        if !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
        {
            return Err(Error::Url(format!("invalid scheme '{scheme}'")));
        }

        let rest = split_fragment(rest);
        let (authority, rest) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        let path_and_query = rest;
        let (path, query) = match path_and_query.split_once('?') {
            Some((p, q)) => (p, q),
            None => (path_and_query, ""),
        };

        // Strip userinfo (user:pass@host) - authentication is done via -u.
        let authority = match authority.rfind('@') {
            Some(i) => &authority[i + 1..],
            None => authority,
        };

        let (host, port_str) = if let Some(h) = authority.strip_prefix('[') {
            // IPv6 literal [::1]:8080
            let (h, rest) = h
                .split_once(']')
                .ok_or_else(|| Error::Url(format!("invalid IPv6 host in '{input}'")))?;
            let port = rest.strip_prefix(':').unwrap_or_default();
            (h.to_string(), port)
        } else {
            match authority.rsplit_once(':') {
                Some((h, p)) => (h.to_string(), p),
                None => (authority.to_string(), ""),
            }
        };

        if host.is_empty() {
            return Err(Error::Url(format!("no host found in '{input}'")));
        }

        let port = if port_str.is_empty() {
            default_port(&scheme)
        } else {
            port_str
                .parse::<u16>()
                .map_err(|_| Error::Url(format!("invalid port '{port_str}'")))?
        };

        let path = if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        };

        Ok(Url {
            scheme,
            host,
            port,
            path,
            query: query.to_string(),
        })
    }

    /// Resolve a `Location` header value against this URL (RFC 3986 subset).
    pub fn join(&self, location: &str) -> Result<Url> {
        let location = location.trim();
        if location.contains("://") {
            return Url::parse(location);
        }
        if let Some(rest) = location.strip_prefix("//") {
            return Url::parse(&format!("{}://{}", self.scheme, rest));
        }
        let (path, query) = match location.split_once('?') {
            Some((p, q)) => (p, q),
            None => (location, ""),
        };
        // `?q` - keep the current path, replace the query.
        // ``   - keep path and query (RFC 3986 5.2.2, empty reference).
        if path.is_empty() {
            let (path, query) = if location.contains('?') {
                (self.path.clone(), query.to_string())
            } else {
                (self.path.clone(), self.query.clone())
            };
            return Ok(Url {
                scheme: self.scheme.clone(),
                host: self.host.clone(),
                port: self.port,
                path,
                query,
            });
        }
        let path = if path.starts_with('/') {
            normalize_path(path)
        } else {
            let dir = match self.path.rfind('/') {
                Some(i) => &self.path[..i + 1],
                None => "/",
            };
            normalize_path(&format!("{dir}{path}"))
        };
        Ok(Url {
            scheme: self.scheme.clone(),
            host: self.host.clone(),
            port: self.port,
            path,
            query: query.to_string(),
        })
    }

    /// The request target sent in the request line: `/path?query`.
    pub fn request_target(&self) -> String {
        if self.query.is_empty() {
            self.path.clone()
        } else {
            format!("{}?{}", self.path, self.query)
        }
    }

    /// `Host` header value (host, plus port only when non-default).
    pub fn host_header(&self) -> String {
        if self.port == default_port(&self.scheme) {
            self.host.clone()
        } else {
            let host = if self.host.contains(':') {
                format!("[{}]", self.host)
            } else {
                self.host.clone()
            };
            format!("{}:{}", host, self.port)
        }
    }

    pub fn is_https(&self) -> bool {
        self.scheme == "https"
    }

    /// File name used by `-O` (remote file name derived from the URL path).
    pub fn remote_filename(&self) -> String {
        let name = match self.path.rsplit('/').find(|s| !s.is_empty()) {
            Some(s) => s.to_string(),
            None => String::new(),
        };
        if name.is_empty() {
            "index.html".to_string()
        } else {
            name
        }
    }
}

fn default_port(scheme: &str) -> u16 {
    if scheme == "https" {
        443
    } else {
        80
    }
}

fn split_fragment(rest: &str) -> &str {
    match rest.find('#') {
        Some(i) => &rest[..i],
        None => rest,
    }
}

/// Remove `.` and `..` segments from an absolute path.
fn normalize_path(path: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            s => segments.push(s),
        }
    }
    format!("/{}", segments.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_http_url() {
        let u = Url::parse("http://example.com/path?a=1&b=2").unwrap();
        assert_eq!(u.scheme, "http");
        assert_eq!(u.host, "example.com");
        assert_eq!(u.port, 80);
        assert_eq!(u.path, "/path");
        assert_eq!(u.query, "a=1&b=2");
        assert_eq!(u.request_target(), "/path?a=1&b=2");
        assert_eq!(u.host_header(), "example.com");
    }

    #[test]
    fn https_defaults_to_443_and_strips_fragment() {
        let u = Url::parse("https://example.com/x#frag").unwrap();
        assert_eq!(u.port, 443);
        assert_eq!(u.path, "/x");
        assert_eq!(u.query, "");
        assert!(u.is_https());
    }

    #[test]
    fn empty_path_becomes_slash() {
        let u = Url::parse("http://example.com").unwrap();
        assert_eq!(u.path, "/");
        assert_eq!(u.request_target(), "/");
        assert_eq!(u.remote_filename(), "index.html");
    }

    #[test]
    fn explicit_port_kept_in_host_header() {
        let u = Url::parse("http://localhost:8080/a").unwrap();
        assert_eq!(u.port, 8080);
        assert_eq!(u.host_header(), "localhost:8080");
        // non-default https port also kept
        let u = Url::parse("https://localhost:8443/a").unwrap();
        assert_eq!(u.host_header(), "localhost:8443");
        // default https port omitted
        let u = Url::parse("https://localhost/a").unwrap();
        assert_eq!(u.host_header(), "localhost");
    }

    #[test]
    fn strips_userinfo() {
        let u = Url::parse("http://user:pass@example.com/a").unwrap();
        assert_eq!(u.host, "example.com");
    }

    #[test]
    fn ipv6_literal() {
        let u = Url::parse("http://[::1]:8080/a").unwrap();
        assert_eq!(u.host, "::1");
        assert_eq!(u.port, 8080);
        assert_eq!(u.host_header(), "[::1]:8080");
    }

    #[test]
    fn rejects_bad_urls() {
        assert!(Url::parse("example.com").is_err());
        assert!(Url::parse("ftp://example.com").is_err());
        assert!(Url::parse("http://").is_err());
        assert!(Url::parse("http://example.com:99999/").is_err());
    }

    #[test]
    fn join_absolute_location() {
        let u = Url::parse("http://a.com/x/y").unwrap();
        let n = u.join("http://b.com/z").unwrap();
        assert_eq!(n.host, "b.com");
        assert_eq!(n.path, "/z");
        // protocol-relative
        let n = u.join("//b.com/z").unwrap();
        assert_eq!(n.scheme, "http");
        assert_eq!(n.host, "b.com");
        // absolute path
        let n = u.join("/top").unwrap();
        assert_eq!(n.host, "a.com");
        assert_eq!(n.path, "/top");
    }

    #[test]
    fn join_relative_location() {
        let u = Url::parse("http://a.com/dir/page?q=1").unwrap();
        let n = u.join("other?q=2").unwrap();
        assert_eq!(n.path, "/dir/other");
        assert_eq!(n.query, "q=2");
        let n = u.join("../up").unwrap();
        assert_eq!(n.path, "/up");
        let n = u.join("?onlyquery").unwrap();
        assert_eq!(n.path, "/dir/page");
        assert_eq!(n.query, "onlyquery");
    }

    #[test]
    fn remote_filename_from_path() {
        let u = Url::parse("http://a.com/files/report.txt?x=1").unwrap();
        assert_eq!(u.remote_filename(), "report.txt");
    }
}
