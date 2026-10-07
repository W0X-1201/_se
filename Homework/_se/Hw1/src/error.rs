use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    /// Bad command line usage (exit code 2)
    Usage(String),
    /// Malformed URL (exit code 3)
    Url(String),
    /// Could not resolve host (exit code 6)
    Dns(String),
    /// Failed to connect (exit code 7)
    Connect(String),
    /// Operation timed out (exit code 28)
    Timeout(String),
    /// TLS/SSL problem (exit code 35)
    Tls(String),
    /// Failed sending data (exit code 55)
    Send(String),
    /// Failed receiving data (exit code 56)
    Recv(String),
    /// Malformed/empty server response (exit code 52)
    Protocol(String),
    /// Too many redirects (exit code 47)
    Redirect(String),
    /// Local file write error (exit code 23)
    Write(String),
}

impl Error {
    pub fn code(&self) -> i32 {
        match self {
            Error::Usage(_) => 2,
            Error::Url(_) => 3,
            Error::Dns(_) => 6,
            Error::Connect(_) => 7,
            Error::Timeout(_) => 28,
            Error::Redirect(_) => 47,
            Error::Protocol(_) => 52,
            Error::Send(_) => 55,
            Error::Recv(_) => 56,
            Error::Tls(_) => 35,
            Error::Write(_) => 23,
        }
    }

    /// Map a low level I/O error to a curl-compatible error class.
    pub fn from_io(err: &std::io::Error, during_send: bool) -> Error {
        use std::io::ErrorKind;
        match err.kind() {
            ErrorKind::TimedOut | ErrorKind::WouldBlock => {
                Error::Timeout(format!("operation timed out: {err}"))
            }
            _ if during_send => Error::Send(format!("send failed: {err}")),
            _ => Error::Recv(format!("recv failed: {err}")),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Usage(m) => write!(f, "rcurl: {m}"),
            Error::Url(m) => write!(f, "rcurl: (3) Malformed URL: {m}"),
            Error::Dns(m) => write!(f, "rcurl: (6) Could not resolve host: {m}"),
            Error::Connect(m) => write!(f, "rcurl: (7) Failed to connect: {m}"),
            Error::Timeout(m) => write!(f, "rcurl: (28) {m}"),
            Error::Tls(m) => write!(f, "rcurl: (35) SSL connect error: {m}"),
            Error::Send(m) => write!(f, "rcurl: (55) Failed sending data: {m}"),
            Error::Recv(m) => write!(f, "rcurl: (56) Recv failure: {m}"),
            Error::Protocol(m) => write!(f, "rcurl: (52) Empty reply from server: {m}"),
            Error::Redirect(m) => write!(f, "rcurl: (47) Maximum ({m}) redirects followed"),
            Error::Write(m) => write!(
                f,
                "rcurl: (23) Failed writing received data to disk/application: {m}"
            ),
        }
    }
}

impl std::error::Error for Error {}
