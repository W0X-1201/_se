mod base64;
mod cli;
mod error;
mod http;
mod net;
mod output;
mod tls;
mod url;

use std::io::BufReader;
use std::process::ExitCode;
use std::time::Instant;

use cli::{Config, OutputTarget, ParseResult};
use error::{Error, Result};
use http::{request, response};
use output::Term;
use url::Url;

/// Maximum number of redirects followed by `-L` (curl's default).
const MAX_REDIRECTS: u32 = 10;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let cfg = match cli::parse(args) {
        Ok(ParseResult::Help) => {
            println!("{}", cli::help());
            return ExitCode::SUCCESS;
        }
        Ok(ParseResult::Version) => {
            println!("rcurl {}", cli::VERSION);
            return ExitCode::SUCCESS;
        }
        Ok(ParseResult::Run(cfg)) => *cfg,
        Err(e) => {
            eprintln!("{e}");
            return exit_code(e.code());
        }
    };

    match run(&cfg) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            if !cfg.silent || cfg.show_error {
                eprintln!("{e}");
            }
            exit_code(e.code())
        }
    }
}

fn exit_code(code: i32) -> ExitCode {
    u8::try_from(code).unwrap_or(1).into()
}

fn run(cfg: &Config) -> Result<()> {
    let start = Instant::now();
    let mut url = Url::parse(&cfg.url)?;
    let origin = (url.scheme.clone(), url.host.clone(), url.port);
    let mut method = cfg.effective_method();
    let mut body: Vec<u8> = cfg
        .body
        .as_ref()
        .map(|b| b.bytes().to_vec())
        .unwrap_or_default();
    let mut redirects: u32 = 0;
    let term = Term::new(cfg);

    loop {
        // Sensitive headers are dropped as soon as the origin changes.
        let strip_auth = (url.scheme.clone(), url.host.clone(), url.port) != origin;

        term.note(&format!("Trying {}:{}...", url.host, url.port));
        let mut transport = net::connect(&url, cfg, start)?;
        term.note(&format!(
            "Connected to {} port {} ({})",
            url.host_header(),
            url.port,
            if url.is_https() { "ssl" } else { "tcp" }
        ));

        let request = request::build(cfg, &url, &method, &body, strip_auth);
        term.dump_request(&request);
        net::write_all(&mut transport, &request)?;
        term.note("Request completely sent off");

        let head_only = method == "HEAD";
        let mut reader = BufReader::new(transport);
        let mut resp = response::read_response(&mut reader, head_only, &mut |n| term.tick(n))?;
        term.dump_response(&resp);

        // --- redirects ----------------------------------------------------
        if cfg.follow && resp.is_redirect() {
            if let Some(location) = resp.location() {
                if redirects >= MAX_REDIRECTS {
                    return Err(Error::Redirect(MAX_REDIRECTS.to_string()));
                }
                let next = url.join(location)?;
                match (resp.status, method.as_str()) {
                    (303, "HEAD") => {}
                    (303, _) => {
                        method = "GET".into();
                        body.clear();
                    }
                    (301 | 302, "POST") => {
                        method = "GET".into();
                        body.clear();
                    }
                    _ => {}
                }
                term.note(&format!(
                    "Issue another request to '{}'...",
                    next.request_target()
                ));
                redirects += 1;
                url = next;
                continue;
            }
        }

        // --- final response ----------------------------------------------
        let mut body_out = std::mem::take(&mut resp.body);
        if cfg.compressed {
            if let Some(enc) = resp.header("content-encoding") {
                if let Some(decoded) = response::decompress(enc, &body_out)? {
                    term.note(&format!("Decoded {enc} response body"));
                    body_out = decoded;
                }
            }
        }

        match &cfg.output {
            OutputTarget::Stdout | OutputTarget::File(_) => {
                output::emit(cfg, &resp, &body_out)?;
            }
            OutputTarget::RemoteName => {
                let name = output::remote_filename(&url);
                let mut f = output::create_remote_file(&name)?;
                let head: &[u8] = if cfg.include_headers {
                    &resp.raw_head
                } else {
                    &[]
                };
                output::write_out(&mut f, head, &body_out, &name)?;
                if !cfg.silent {
                    eprintln!("rcurl: saved to '{name}'");
                }
            }
        }
        term.progress_done();
        return Ok(());
    }
}
