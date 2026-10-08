use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use crate::cli::Config;
use crate::error::{Error, Result};
use crate::url::Url;

pub enum Transport {
    Plain(TcpStream),
    Tls(Box<native_tls::TlsStream<TcpStream>>),
}

impl Read for Transport {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Transport::Plain(s) => s.read(buf),
            Transport::Tls(s) => s.read(buf),
        }
    }
}

impl Write for Transport {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Transport::Plain(s) => s.write(buf),
            Transport::Tls(s) => s.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Transport::Plain(s) => s.flush(),
            Transport::Tls(s) => s.flush(),
        }
    }
}

/// Time left until the `-m` deadline, or `Ok(None)` when no deadline exists.
/// An expired deadline becomes exit code 28.
fn remaining(deadline: Option<Instant>) -> Result<Option<Duration>> {
    match deadline {
        None => Ok(None),
        Some(d) => {
            let left = d.saturating_duration_since(Instant::now());
            if left.is_zero() {
                Err(Error::Timeout("max time (-m) was reached".into()))
            } else {
                Ok(Some(left))
            }
        }
    }
}

/// Resolve `host:port`, bounded by `timeout` (the DNS part of
/// `--connect-timeout`). Runs the blocking resolver on a helper thread so a
/// hung resolver still produces exit code 28.
fn resolve(host: &str, port: u16, timeout: Option<Duration>) -> Result<Vec<SocketAddr>> {
    let query = format!("{host}:{port}");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(query.to_socket_addrs().map(|it| it.collect::<Vec<_>>()));
    });

    let result = match timeout {
        Some(t) if !t.is_zero() => rx.recv_timeout(t).map_err(|_| {
            Error::Timeout(format!(
                "resolving host '{host}' timed out after {}s",
                t.as_secs()
            ))
        })?,
        _ => rx
            .recv()
            .map_err(|_| Error::Dns(format!("resolver thread died for '{host}'")))?,
    };
    result.map_err(|e| Error::Dns(format!("{host} ({e})")))
}

/// Connect to `url`: DNS, TCP connect and (for https) the TLS handshake.
/// `start` is when the whole operation began, used for `-m`.
pub fn connect(url: &Url, cfg: &Config, start: Instant) -> Result<Transport> {
    let deadline = cfg.max_time.map(|m| start + m);

    // 1. DNS (bounded by --connect-timeout, or the remaining -m budget)
    let dns_budget = match cfg.connect_timeout {
        Some(t) => Some(t),
        None => remaining(deadline)?,
    };
    let addrs = resolve(&url.host, url.port, dns_budget)?;
    if addrs.is_empty() {
        return Err(Error::Dns(url.host.clone()));
    }

    // 2. TCP connect (try each address, like curl does)
    let mut last_err: Option<std::io::Error> = None;
    let mut connected: Option<TcpStream> = None;
    for addr in &addrs {
        let budget = match cfg.connect_timeout {
            Some(t) => Some(t.min(remaining(deadline)?.unwrap_or(t))),
            None => remaining(deadline)?,
        };
        let attempt = match budget {
            Some(b) => TcpStream::connect_timeout(addr, b),
            None => TcpStream::connect(addr),
        };
        match attempt {
            Ok(s) => {
                connected = Some(s);
                break;
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::TimedOut {
                    return Err(Error::Timeout(format!(
                        "connection to {} timed out after {}s",
                        url.host,
                        cfg.connect_timeout.map(|t| t.as_secs()).unwrap_or(0)
                    )));
                }
                last_err = Some(e);
            }
        }
    }
    let stream = connected.ok_or_else(|| {
        let e = last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "no addresses".into());
        Error::Connect(format!("{e} ({}:{})", url.host, url.port))
    })?;

    stream.set_nodelay(true).ok();
    if let Some(left) = remaining(deadline)? {
        stream.set_read_timeout(Some(left)).ok();
        stream.set_write_timeout(Some(left)).ok();
    }

    // 3. TLS
    if url.is_https() {
        let host = url.host.clone();
        let tls = crate::tls::handshake(stream, &host, cfg.insecure).map_err(Error::Tls)?;
        Ok(Transport::Tls(Box::new(tls)))
    } else {
        Ok(Transport::Plain(stream))
    }
}

/// Write the whole request, mapping errors to curl-compatible codes.
pub fn write_all(w: &mut impl Write, data: &[u8]) -> Result<()> {
    w.write_all(data).map_err(|e| Error::from_io(&e, true))?;
    w.flush().map_err(|e| Error::from_io(&e, true))
}
