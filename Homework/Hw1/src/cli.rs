use std::path::PathBuf;
use std::time::Duration;

use crate::error::{Error, Result};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Kind of request body, determines the default Content-Type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BodyData {
    /// `-d`: application/x-www-form-urlencoded
    Form(Vec<u8>),
    /// `--data-binary`: raw bytes
    Binary(Vec<u8>),
    /// `--json`: application/json
    Json(Vec<u8>),
}

impl BodyData {
    pub fn bytes(&self) -> &[u8] {
        match self {
            BodyData::Form(b) | BodyData::Binary(b) | BodyData::Json(b) => b,
        }
    }

    pub fn content_type(&self) -> Option<&'static str> {
        match self {
            BodyData::Form(_) => Some("application/x-www-form-urlencoded"),
            BodyData::Binary(_) => None,
            BodyData::Json(_) => Some("application/json"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputTarget {
    Stdout,
    File(PathBuf),
    /// `-O`: file name taken from the remote URL
    RemoteName,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub url: String,
    pub method: Option<String>,
    pub headers: Vec<String>,
    pub body: Option<BodyData>,
    pub output: OutputTarget,
    pub include_headers: bool,
    pub head: bool,
    pub verbose: bool,
    pub silent: bool,
    pub show_error: bool,
    pub follow: bool,
    pub user_agent: Option<String>,
    pub referer: Option<String>,
    pub auth: Option<(String, String)>,
    pub insecure: bool,
    pub compressed: bool,
    pub connect_timeout: Option<Duration>,
    pub max_time: Option<Duration>,
    pub no_progress: bool,
}

impl Config {
    /// Effective HTTP method: `-X` wins, then `-I` (HEAD), then POST if a body
    /// is present, otherwise GET.
    pub fn effective_method(&self) -> String {
        if let Some(m) = &self.method {
            return m.to_ascii_uppercase();
        }
        if self.head {
            return "HEAD".to_string();
        }
        if self.body.is_some() {
            "POST".to_string()
        } else {
            "GET".to_string()
        }
    }
}

#[derive(Debug)]
pub enum ParseResult {
    Run(Box<Config>),
    Help,
    Version,
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<ParseResult> {
    let args: Vec<String> = args.into_iter().collect();
    let mut cfg = Config {
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
    };
    let mut urls: Vec<String> = Vec::new();
    let mut end_of_opts = false;

    // Letters that consume a value (curl style: -X POST or -XPOST).
    let mut i = 1;
    while i < args.len() {
        let arg = args[i].clone();
        i += 1;

        if end_of_opts || !arg.starts_with('-') || arg == "-" {
            urls.push(arg);
            continue;
        }
        if arg == "--" {
            end_of_opts = true;
            continue;
        }

        if let Some(long) = arg.strip_prefix("--") {
            let (name, inline) = match long.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (long, None),
            };
            match name {
                "help" => return Ok(ParseResult::Help),
                "version" => return Ok(ParseResult::Version),
                "silent" => cfg.silent = true,
                "show-error" => cfg.show_error = true,
                "verbose" => cfg.verbose = true,
                "include" => cfg.include_headers = true,
                "head" => cfg.head = true,
                "location" => cfg.follow = true,
                "insecure" | "insecure-skip-tls-verify" => cfg.insecure = true,
                "compressed" => cfg.compressed = true,
                "no-progress" | "no-progress-meter" => cfg.no_progress = true,
                "request" => cfg.method = Some(value(inline, &args, &mut i, name)?),
                "header" => cfg.headers.push(value(inline, &args, &mut i, name)?),
                "data" | "data-raw" | "data-binary" => {
                    let v = value(inline, &args, &mut i, name)?;
                    let kind = if name == "data-binary" {
                        BodyKind::Binary
                    } else {
                        BodyKind::Form
                    };
                    append_data(&mut cfg, v, kind)?;
                }
                "json" => {
                    let v = value(inline, &args, &mut i, name)?;
                    append_data(&mut cfg, v, BodyKind::Json)?;
                }
                "user" | "user-agent" | "referer" | "url" => {
                    let v = value(inline, &args, &mut i, name)?;
                    match name {
                        "user" => cfg.auth = Some(split_auth(&v)?),
                        "user-agent" => cfg.user_agent = Some(v),
                        "referer" => cfg.referer = Some(v),
                        _ => urls.push(v),
                    }
                }
                "output" => {
                    let v = value(inline, &args, &mut i, name)?;
                    cfg.output = OutputTarget::File(PathBuf::from(v));
                }
                "remote-name" => cfg.output = OutputTarget::RemoteName,
                "connect-timeout" => {
                    let v = value(inline, &args, &mut i, name)?;
                    cfg.connect_timeout = Some(parse_duration(&v, name)?);
                }
                "max-time" => {
                    let v = value(inline, &args, &mut i, name)?;
                    cfg.max_time = Some(parse_duration(&v, name)?);
                }
                "form" | "form-string" | "retry" | "write-out" | "cookie-jar" | "cookie"
                | "range" | "upload-file" => {
                    return Err(Error::Usage(format!(
                        "option --{name} is not supported in this build (see README)"
                    )));
                }
                _ => {
                    return Err(Error::Usage(format!("option --{name} is unknown")));
                }
            }
            continue;
        }

        // Short option cluster, e.g. -sL, -XPOST, -H "K: V".
        let chars: Vec<char> = arg[1..].chars().collect();
        let mut ci = 0;
        while ci < chars.len() {
            let c = chars[ci];
            ci += 1;
            match c {
                'h' => return Ok(ParseResult::Help),
                'V' => return Ok(ParseResult::Version),
                's' => cfg.silent = true,
                'S' => cfg.show_error = true,
                'v' => cfg.verbose = true,
                'i' => cfg.include_headers = true,
                'I' => cfg.head = true,
                'L' => cfg.follow = true,
                'k' => cfg.insecure = true,
                'O' => cfg.output = OutputTarget::RemoteName,
                'X' | 'H' | 'd' | 'o' | 'u' | 'A' | 'e' | 'm' | 'T' => {
                    // Rest of the cluster is the value; otherwise next arg.
                    let inline: Option<String> = if ci < chars.len() {
                        let rest: String = chars[ci..].iter().collect();
                        ci = chars.len();
                        Some(rest)
                    } else {
                        None
                    };
                    let name = short_name(c);
                    let v = value(inline, &args, &mut i, name)?;
                    match c {
                        'X' => cfg.method = Some(v),
                        'H' => cfg.headers.push(v),
                        'd' => {
                            append_data(&mut cfg, v, BodyKind::Form)?;
                        }
                        'o' => cfg.output = OutputTarget::File(PathBuf::from(v)),
                        'u' => cfg.auth = Some(split_auth(&v)?),
                        'A' => cfg.user_agent = Some(v),
                        'e' => cfg.referer = Some(v),
                        'm' => cfg.max_time = Some(parse_duration(&v, name)?),
                        'T' => {
                            return Err(Error::Usage(
                                "option -T is not supported in this build (see README)".to_string(),
                            ))
                        }
                        _ => unreachable!(),
                    }
                }
                _ => {
                    return Err(Error::Usage(format!("option -{c} is unknown")));
                }
            }
        }
    }

    if cfg.head && cfg.method.is_none() {
        // -I implies showing headers like -i
        cfg.include_headers = true;
    }

    match urls.len() {
        0 => Err(Error::Usage(
            "no URL specified. Try 'rcurl --help' for more information.".to_string(),
        )),
        1 => {
            cfg.url = urls.remove(0);
            Ok(ParseResult::Run(Box::new(cfg)))
        }
        _ => Err(Error::Usage("only one URL is supported".to_string())),
    }
}

enum BodyKind {
    Form,
    Binary,
    Json,
}

fn short_name(c: char) -> &'static str {
    match c {
        'X' => "-X",
        'H' => "-H",
        'd' => "-d",
        'o' => "-o",
        'u' => "-u",
        'A' => "-A",
        'e' => "-e",
        'm' => "-m",
        'T' => "-T",
        _ => "unknown",
    }
}

fn value(inline: Option<String>, args: &[String], i: &mut usize, name: &str) -> Result<String> {
    if let Some(v) = inline {
        return Ok(v);
    }
    if *i >= args.len() {
        return Err(Error::Usage(format!(
            "option requires an argument --{name}"
        )));
    }
    let v = args[*i].clone();
    *i += 1;
    Ok(v)
}

/// Append data to the request body. Multiple pieces are joined with `&`,
/// matching curl behaviour.
fn append_data(cfg: &mut Config, piece: String, kind: BodyKind) -> Result<()> {
    let mut data = match (cfg.body.take(), &kind) {
        (Some(BodyData::Form(mut acc)), BodyKind::Form)
        | (Some(BodyData::Binary(mut acc)), BodyKind::Binary)
        | (Some(BodyData::Json(mut acc)), BodyKind::Json) => {
            if !acc.is_empty() {
                acc.push(b'&');
            }
            acc
        }
        (Some(prev), _) => prev.bytes().to_vec(),
        (None, _) => Vec::new(),
    };

    if let Some(path) = piece.strip_prefix('@') {
        // @file: read contents from disk.
        let contents = std::fs::read(path)
            .map_err(|e| Error::Usage(format!("failed to open '{path}': {e}")))?;
        let contents = match kind {
            // curl's -d @file strips newlines.
            BodyKind::Form => contents
                .into_iter()
                .filter(|b| *b != b'\r' && *b != b'\n')
                .collect(),
            _ => contents,
        };
        data.extend(contents);
    } else {
        data.extend_from_slice(piece.as_bytes());
    }

    cfg.body = Some(match kind {
        BodyKind::Form => BodyData::Form(data),
        BodyKind::Binary => BodyData::Binary(data),
        BodyKind::Json => BodyData::Json(data),
    });
    Ok(())
}

fn split_auth(v: &str) -> Result<(String, String)> {
    match v.split_once(':') {
        Some((u, p)) => Ok((u.to_string(), p.to_string())),
        None => Err(Error::Usage(format!(
            "bad -u/--user format, expected user:password (got '{v}')"
        ))),
    }
}

fn parse_duration(v: &str, name: &str) -> Result<Duration> {
    let secs: f64 = v
        .parse()
        .map_err(|_| Error::Usage(format!("invalid value '{v}' for --{name}")))?;
    if !secs.is_finite() || secs < 0.0 {
        return Err(Error::Usage(format!("invalid value '{v}' for --{name}")));
    }
    Ok(Duration::from_secs_f64(secs))
}

pub fn help() -> String {
    format!(
        "rcurl {VERSION} (x86_64-pc-windows-msvc) - a curl-like HTTP client in Rust

Usage: rcurl [options...] <url>

Options:
  -X, --request <method>      HTTP method to use (GET, POST, PUT, DELETE, ...)
  -H, --header <header>       Add a header ('Name: value'), repeatable
  -d, --data <data>           Body data (repeatable, joined with &), @file reads a file
      --data-binary <data>    Body data without newline stripping
      --json <data>           Body data, sets Content-Type/Accept: application/json
  -I, --head                  Use HEAD and show response headers
  -o, --output <file>         Write body to file instead of stdout
  -O, --remote-name           Write body to file named after the remote URL
  -i, --include               Include response headers in the output
  -v, --verbose               Verbose mode (request/response headers on stderr)
  -s, --silent                Silent mode (no progress, no error messages)
  -S, --show-error            Show errors even in silent mode
  -L, --location              Follow redirects (max 10)
  -u, --user <user:password>  HTTP Basic authentication
  -A, --user-agent <string>   User-Agent header (default: rcurl/{VERSION})
  -e, --referer <url>         Referer header
  -k, --insecure              Skip TLS certificate verification
      --compressed            Send Accept-Encoding: gzip, deflate and decompress
      --connect-timeout <sec> Connection timeout in seconds
  -m, --max-time <sec>        Whole-operation timeout in seconds
      --no-progress           Disable the progress meter
  -h, --help                  Show this help
  -V, --version               Show version

Exit codes: 0 ok, 2 usage, 3 bad URL, 6 DNS, 7 connect, 28 timeout,
            35 SSL, 47 too many redirects, 52 empty reply, 55 send, 56 recv

Not supported: -F, -w, -b/-c cookies, -r, --retry (see README)"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(args: &[&str]) -> Result<ParseResult> {
        parse(args.iter().map(|s| s.to_string()))
    }

    fn ok(args: &[&str]) -> Config {
        match run(args) {
            Ok(ParseResult::Run(c)) => *c,
            other => panic!("expected Run, got {other:?}"),
        }
    }

    #[test]
    fn minimal_get() {
        let c = ok(&["rcurl", "http://example.com"]);
        assert_eq!(c.url, "http://example.com");
        assert_eq!(c.effective_method(), "GET");
        assert!(c.body.is_none());
        assert_eq!(c.output, OutputTarget::Stdout);
    }

    #[test]
    fn data_implies_post() {
        let c = ok(&["rcurl", "-d", "a=1", "http://example.com"]);
        assert_eq!(c.effective_method(), "POST");
        assert_eq!(c.body.unwrap().bytes(), b"a=1");
    }

    #[test]
    fn multiple_data_joined_with_ampersand() {
        let c = ok(&["rcurl", "-d", "a=1", "-d", "b=2", "http://x.com"]);
        assert_eq!(c.body.unwrap().bytes(), b"a=1&b=2");
    }

    #[test]
    fn explicit_method_wins() {
        let c = ok(&["rcurl", "-X", "DELETE", "http://x.com"]);
        assert_eq!(c.effective_method(), "DELETE");
        // -XPOST style (inline value)
        let c = ok(&["rcurl", "-XPUT", "http://x.com"]);
        assert_eq!(c.effective_method(), "PUT");
    }

    #[test]
    fn head_sets_method_and_include() {
        let c = ok(&["rcurl", "-I", "http://x.com"]);
        assert_eq!(c.effective_method(), "HEAD");
        assert!(c.include_headers);
    }

    #[test]
    fn clustered_short_flags() {
        let c = ok(&["rcurl", "-sLi", "http://x.com"]);
        assert!(c.silent && c.follow && c.include_headers);
    }

    #[test]
    fn headers_repeatable() {
        let c = ok(&["rcurl", "-H", "X-A: 1", "-H", "X-B: 2", "http://x.com"]);
        assert_eq!(c.headers, vec!["X-A: 1".to_string(), "X-B: 2".to_string()]);
    }

    #[test]
    fn json_body_sets_kind() {
        let c = ok(&["rcurl", "--json", "{\"a\":1}", "http://x.com"]);
        assert_eq!(c.effective_method(), "POST");
        assert_eq!(
            c.body.as_ref().unwrap().content_type(),
            Some("application/json")
        );
    }

    #[test]
    fn auth_and_flags() {
        let c = ok(&[
            "rcurl",
            "-u",
            "bob:secret",
            "-k",
            "--compressed",
            "-L",
            "http://x.com",
        ]);
        assert_eq!(c.auth, Some(("bob".into(), "secret".into())));
        assert!(c.insecure && c.compressed && c.follow);
        // user without password is an error
        assert!(run(&["rcurl", "-u", "bob", "http://x.com"]).is_err());
    }

    #[test]
    fn timeouts() {
        let c = ok(&[
            "rcurl",
            "--connect-timeout",
            "3",
            "-m",
            "10.5",
            "http://x.com",
        ]);
        assert_eq!(c.connect_timeout.unwrap().as_secs(), 3);
        assert_eq!(c.max_time.unwrap().as_secs_f64(), 10.5);
        assert!(run(&["rcurl", "-m", "abc", "http://x.com"]).is_err());
    }

    #[test]
    fn output_targets() {
        let c = ok(&["rcurl", "-o", "body.txt", "http://x.com"]);
        assert_eq!(c.output, OutputTarget::File(PathBuf::from("body.txt")));
        let c = ok(&["rcurl", "-O", "http://x.com"]);
        assert_eq!(c.output, OutputTarget::RemoteName);
    }

    #[test]
    fn data_at_file_is_read() {
        let path = std::env::temp_dir().join("rcurl_cli_test.txt");
        std::fs::write(&path, "hello\nworld\r\n").unwrap();
        let c = ok(&[
            "rcurl",
            "-d",
            &format!("@{}", path.display()),
            "http://x.com",
        ]);
        // -d strips newlines
        assert_eq!(c.body.unwrap().bytes(), b"helloworld");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_url_is_error() {
        assert!(run(&["rcurl"]).is_err());
        assert!(run(&["rcurl", "-X", "GET"]).is_err());
    }

    #[test]
    fn unknown_option_is_error() {
        assert!(run(&["rcurl", "--bogus", "http://x.com"]).is_err());
        assert!(run(&["rcurl", "-Z", "http://x.com"]).is_err());
    }

    #[test]
    fn help_and_version() {
        assert!(matches!(run(&["rcurl", "--help"]), Ok(ParseResult::Help)));
        assert!(matches!(run(&["rcurl", "-V"]), Ok(ParseResult::Version)));
    }

    #[test]
    fn unsupported_option_hint() {
        let e = run(&["rcurl", "-F", "a=b", "http://x.com"]).unwrap_err();
        assert!(e.code() == 2);
    }
}
