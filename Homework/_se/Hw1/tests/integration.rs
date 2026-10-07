//! End-to-end tests: spawn the `rcurl` binary against a tiny local HTTP/1.1
//! server built from `std::net`.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Command, Output, Stdio};
use std::sync::Arc;
use std::thread;

/// A parsed client request handed to test handlers.
#[derive(Debug)]
struct Req {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Req {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

type Handler = Arc<dyn Fn(&Req) -> Vec<u8> + Send + Sync>;

/// Start a server that answers every connection with `handler(req)`'s bytes.
fn serve(handler: impl Fn(&Req) -> Vec<u8> + Send + Sync + 'static) -> SocketAddr {
    let handler: Handler = Arc::new(handler);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let handler = Arc::clone(&handler);
            // Sequential is fine for tests; each rcurl call is one connection.
            if let Ok(req) = read_request(&mut stream) {
                let resp = handler(&req);
                let _ = stream.write_all(&resp);
            }
            let _ = stream.flush();
        }
    });
    addr
}

fn read_request(stream: &mut TcpStream) -> std::io::Result<Req> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut head_lines: Vec<String> = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_end().to_string();
        if line.is_empty() {
            break;
        }
        head_lines.push(line);
    }
    let request_line = head_lines.first().cloned().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut headers = Vec::new();
    for line in &head_lines[1..] {
        if let Some((n, v)) = line.split_once(':') {
            headers.push((n.trim().to_string(), v.trim().to_string()));
        }
    }
    let len = headers
        .iter()
        .find(|(n, _)| n.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; len];
    if len > 0 {
        reader.read_exact(&mut body)?;
    }
    Ok(Req {
        method,
        path,
        headers,
        body,
    })
}

/// Convenience: `Content-Length` response builder.
fn resp(status: u16, reason: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

/// Run the rcurl binary and capture the result.
fn rcurl(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_rcurl"))
        .args(args)
        .stdin(Stdio::null())
        .output()
        .expect("failed to run rcurl")
}

fn stdout(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

#[test]
fn get_returns_body() {
    let addr = serve(|req| {
        assert_eq!(req.method, "GET");
        assert_eq!(req.path, "/hello?x=1");
        resp(200, "OK", "text/plain", b"hello world")
    });
    let out = rcurl(&[&format!("http://{addr}/hello?x=1")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "hello world");
}

#[test]
fn post_sends_body_and_headers() {
    let addr = serve(|req| {
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/api");
        assert_eq!(req.body, b"a=1&b=2");
        assert_eq!(
            req.header("content-type"),
            Some("application/x-www-form-urlencoded")
        );
        assert_eq!(req.header("content-length"), Some("7"));
        resp(200, "OK", "text/plain", b"posted")
    });
    let out = rcurl(&[
        "-d",
        "a=1",
        "-d",
        "b=2",
        "-H",
        "X-Custom: yes",
        &format!("http://{addr}/api"),
    ]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "posted");
}

#[test]
fn custom_method_and_header() {
    let addr = serve(|req| {
        assert_eq!(req.method, "PUT");
        assert_eq!(req.header("x-test"), Some("42"));
        resp(200, "OK", "text/plain", b"put done")
    });
    let out = rcurl(&["-X", "PUT", "-H", "X-Test: 42", &format!("http://{addr}/x")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "put done");
}

#[test]
fn head_returns_headers_without_body() {
    let addr = serve(|req| {
        assert_eq!(req.method, "HEAD");
        resp(200, "OK", "text/plain", b"ignored body")
    });
    let out = rcurl(&["-I", &format!("http://{addr}/")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    // -I implies -i: status line + headers are printed, body is not.
    let text = stdout(&out);
    assert!(text.starts_with("HTTP/1.1 200 OK"), "got: {text}");
    assert!(text.contains("Content-Length: 12"));
    assert!(!text.contains("ignored body"));
}

#[test]
fn redirect_followed_with_location() {
    let addr = serve(|req| match req.path.as_str() {
        "/start" => {
            let mut r = "HTTP/1.1 302 Found\r\nLocation: /final\r\nContent-Length: 12\r\n\r\n"
                .to_string()
                .into_bytes();
            r.extend_from_slice(b"redirecting!");
            r
        }
        "/final" => {
            assert_eq!(req.method, "GET", "303/302 must downgrade POST to GET");
            resp(200, "OK", "text/plain", b"arrived")
        }
        other => panic!("unexpected path {other}"),
    });

    // 302 on POST => curl follows with GET
    let out = rcurl(&["-L", "-d", "x=1", &format!("http://{addr}/start")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "arrived");

    // Without -L the redirect body is returned as-is.
    let out = rcurl(&["-d", "x=1", &format!("http://{addr}/start")]);
    assert!(out.status.success());
    assert_eq!(stdout(&out), "redirecting!");
}

#[test]
fn too_many_redirects_is_exit_47() {
    let addr =
        serve(|_| b"HTTP/1.1 302 Found\r\nLocation: /loop\r\nContent-Length: 0\r\n\r\n".to_vec());
    let out = rcurl(&["-L", &format!("http://{addr}/loop")]);
    assert_eq!(out.status.code(), Some(47), "stderr: {}", stderr(&out));
    assert!(stderr(&out).contains("(47)"));
}

#[test]
fn chunked_response_is_decoded() {
    let addr = serve(|_| {
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n chunk\r\n0\r\n\r\n"
            .to_vec()
    });
    let out = rcurl(&[&format!("http://{addr}/")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "hello chunk");
}

#[test]
fn gzip_response_is_decompressed() {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    let addr = serve(|_| {
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        use std::io::Write as _;
        enc.write_all(b"gzip payload").unwrap();
        let gz = enc.finish().unwrap();
        let mut head = format!(
            "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\n\r\n",
            gz.len()
        )
        .into_bytes();
        head.extend_from_slice(&gz);
        head
    });

    // --compressed decodes
    let out = rcurl(&["--compressed", &format!("http://{addr}/")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "gzip payload");

    // without it, raw bytes are passed through
    let out = rcurl(&[&format!("http://{addr}/")]);
    assert!(out.status.success());
    assert_ne!(stdout(&out), "gzip payload");
}

#[test]
fn output_to_file_and_remote_name() {
    let addr = serve(|_| resp(200, "application/octet-stream", "text/plain", b"file body"));

    // -o
    let dest = std::env::temp_dir().join("rcurl_it_out.bin");
    let _ = std::fs::remove_file(&dest);
    let out = rcurl(&[
        "-o",
        &dest.to_string_lossy(),
        &format!("http://{addr}/data"),
    ]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert!(stdout(&out).is_empty(), "stdout must stay empty with -o");
    assert_eq!(std::fs::read(&dest).unwrap(), b"file body");
    let _ = std::fs::remove_file(&dest);

    // -O uses the remote file name (in the current directory => use cwd temp)
    let cwd = std::env::temp_dir().join("rcurl_it_cwd");
    std::fs::create_dir_all(&cwd).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_rcurl"))
        .current_dir(&cwd)
        .args(["-O", &format!("http://{addr}/remote-name.txt")])
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    let saved = cwd.join("remote-name.txt");
    assert_eq!(std::fs::read(&saved).unwrap(), b"file body");
    let _ = std::fs::remove_file(&saved);
    let _ = std::fs::remove_dir(&cwd);
}

#[test]
fn include_headers_printed() {
    let addr = serve(|_| resp(201, "Created", "application/json", b"{}"));
    let out = rcurl(&["-i", &format!("http://{addr}/")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    let text = stdout(&out);
    assert!(text.starts_with("HTTP/1.1 201 Created"));
    assert!(text.contains("Content-Type: application/json"));
    assert!(text.ends_with("{}"), "got: {text}");
}

#[test]
fn verbose_dumps_headers_to_stderr() {
    let addr = serve(|_| resp(200, "OK", "text/plain", b"hi"));
    let out = rcurl(&["-v", &format!("http://{addr}/verbose")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    let log = stderr(&out);
    assert!(log.contains("> GET /verbose HTTP/1.1"), "got: {log}");
    assert!(log.contains("> Host: "), "got: {log}");
    assert!(log.contains("< HTTP/1.1 200 OK"), "got: {log}");
    assert!(log.contains("< Content-Type: text/plain"), "got: {log}");
    // body still on stdout only
    assert_eq!(stdout(&out), "hi");
}

#[test]
fn silent_sends_nothing_to_stderr() {
    let addr = serve(|_| resp(200, "OK", "text/plain", b"quiet"));
    let out = rcurl(&["-s", &format!("http://{addr}/")]);
    assert!(out.status.success());
    assert!(stderr(&out).is_empty(), "got: {}", stderr(&out));
    assert_eq!(stdout(&out), "quiet");

    // -s -S still reports connection failures
    let out = rcurl(&["-sS", "http://127.0.0.1:1/"]);
    assert!(!out.status.success());
    assert!(!stderr(&out).is_empty());
}

#[test]
fn basic_auth_header_sent() {
    let addr = serve(|req| {
        assert_eq!(req.header("authorization"), Some("Basic dXNlcjpwYXNz"));
        resp(200, "OK", "text/plain", b"authed")
    });
    let out = rcurl(&["-u", "user:pass", &format!("http://{addr}/")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
    assert_eq!(stdout(&out), "authed");
}

#[test]
fn user_agent_and_referer_headers() {
    let addr = serve(|req| {
        assert_eq!(req.header("user-agent"), Some("my-agent/1.0"));
        assert_eq!(req.header("referer"), Some("http://ref.example/"));
        resp(200, "OK", "text/plain", b"ok")
    });
    let out = rcurl(&[
        "-A",
        "my-agent/1.0",
        "-e",
        "http://ref.example/",
        &format!("http://{addr}/"),
    ]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
}

#[test]
fn json_body() {
    let addr = serve(|req| {
        assert_eq!(req.method, "POST");
        assert_eq!(req.header("content-type"), Some("application/json"));
        assert_eq!(req.header("accept"), Some("application/json"));
        assert_eq!(req.body, br#"{"k":"v"}"#);
        resp(200, "OK", "application/json", b"{\"ok\":true}")
    });
    let out = rcurl(&["--json", "{\"k\":\"v\"}", &format!("http://{addr}/")]);
    assert!(out.status.success(), "stderr: {}", stderr(&out));
}

#[test]
fn connect_failure_exit_code_7() {
    // Nothing listens on port 1 (privileged, unreachable).
    let out = rcurl(&["--connect-timeout", "5", "http://127.0.0.1:1/"]);
    assert_eq!(out.status.code(), Some(7), "stderr: {}", stderr(&out));
}

#[test]
fn dns_failure_exit_code_6() {
    let out = rcurl(&["http://this-host-does-not-exist.invalid/"]);
    assert_eq!(out.status.code(), Some(6), "stderr: {}", stderr(&out));
}

#[test]
fn bad_url_exit_code_3() {
    let out = rcurl(&["not-a-url"]);
    assert_eq!(out.status.code(), Some(3), "stderr: {}", stderr(&out));
}

#[test]
fn usage_error_exit_code_2() {
    let out = rcurl(&["--definitely-not-an-option"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("unknown"));
}

#[test]
fn max_time_exit_code_28() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    // Accept but never respond => rcurl must time out.
    thread::spawn(move || {
        let mut held: Vec<TcpStream> = Vec::new();
        for s in listener.incoming().flatten() {
            held.push(s);
        }
    });
    let out = rcurl(&["-m", "1", &format!("http://{addr}/")]);
    assert_eq!(out.status.code(), Some(28), "stderr: {}", stderr(&out));
}
