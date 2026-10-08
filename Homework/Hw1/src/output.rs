use std::fs::File;
use std::io::{IsTerminal, Write};

use crate::cli::{Config, OutputTarget};
use crate::error::{Error, Result};
use crate::http::response::Response;
use crate::url::Url;

/// Verbosity state shared across the transfer.
pub struct Term {
    pub verbose: bool,
    pub progress: bool,
}

impl Term {
    pub fn new(cfg: &Config) -> Term {
        Term {
            verbose: cfg.verbose,
            progress: !cfg.silent && !cfg.no_progress && std::io::stderr().is_terminal(),
        }
    }

    /// `* note` status lines (stderr), shown in verbose or non-silent mode.
    pub fn note(&self, msg: &str) {
        if self.verbose {
            eprintln!("* {msg}");
        }
    }

    /// The `>` request head dump shown by `-v`.
    pub fn dump_request(&self, raw: &[u8]) {
        if !self.verbose {
            return;
        }
        let text = String::from_utf8_lossy(raw);
        // Only the head: stop at the blank line that ends the headers.
        let head = match text.find("\r\n\r\n") {
            Some(i) => &text[..i + 2],
            None => text.as_ref(),
        };
        for line in head.trim_end().split("\r\n") {
            eprintln!("> {line}");
        }
        eprintln!(">");
    }

    /// The `<` response head dump shown by `-v`.
    pub fn dump_response(&self, resp: &Response) {
        if !self.verbose {
            return;
        }
        eprintln!("< {} {} {}", resp.version, resp.status, resp.reason);
        let text = String::from_utf8_lossy(&resp.raw_head);
        for line in text.trim_end().split('\n').skip(1) {
            eprintln!("< {}", line.trim_end_matches('\r'));
        }
        eprintln!("<");
    }

    /// Progress meter: running byte total on stderr.
    pub fn tick(&self, total: u64) {
        if self.progress {
            eprint!("\rProgress: {total} bytes received");
            let _ = std::io::stderr().flush();
        }
    }

    pub fn progress_done(&self) {
        if self.progress {
            eprintln!();
        }
    }
}

/// Derive the file name for `-O`.
pub fn remote_filename(url: &Url) -> String {
    url.remote_filename()
}

/// Write the final output (optional header block + body).
pub fn emit(cfg: &Config, resp: &Response, body: &[u8]) -> Result<()> {
    let mut head = Vec::new();
    if cfg.include_headers {
        head.extend_from_slice(&resp.raw_head);
    }

    match &cfg.output {
        OutputTarget::Stdout => {
            let stdout = std::io::stdout();
            let mut lock = stdout.lock();
            write_out(&mut lock, &head, body, "stdout")
        }
        OutputTarget::File(path) => {
            let mut f =
                File::create(path).map_err(|e| Error::Write(format!("{}: {e}", path.display())))?;
            write_out(&mut f, &head, body, &path.display().to_string())
        }
        OutputTarget::RemoteName => unreachable!("resolved by caller"),
    }
}

/// Create the target file for `-O`.
pub fn create_remote_file(name: &str) -> Result<File> {
    File::create(name).map_err(|e| Error::Write(format!("{name}: {e}")))
}

/// Write head + body to any sink, mapping failures to exit code 23.
pub fn write_out<W: Write>(sink: &mut W, head: &[u8], body: &[u8], what: &str) -> Result<()> {
    if !head.is_empty() {
        sink.write_all(head)
            .map_err(|e| Error::Write(format!("{what}: {e}")))?;
    }
    sink.write_all(body)
        .map_err(|e| Error::Write(format!("{what}: {e}")))?;
    sink.flush()
        .map_err(|e| Error::Write(format!("{what}: {e}")))
}
