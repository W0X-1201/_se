use std::net::TcpStream;

use native_tls::{HandshakeError, TlsConnector, TlsStream};

/// Perform a TLS handshake over `stream`.
///
/// * `host` - used for SNI and certificate hostname verification
/// * `insecure` - `-k`: skip certificate and hostname verification
///
/// Returns a curl-style error message on failure (exit code 35).
pub fn handshake(
    stream: TcpStream,
    host: &str,
    insecure: bool,
) -> Result<TlsStream<TcpStream>, String> {
    let mut builder = TlsConnector::builder();
    if insecure {
        builder.danger_accept_invalid_certs(true);
        builder.danger_accept_invalid_hostnames(true);
    }
    let connector = builder
        .build()
        .map_err(|e| format!("failed to create TLS connector: {e}"))?;

    match connector.connect(host, stream) {
        Ok(tls) => Ok(tls),
        Err(HandshakeError::Failure(e)) => Err(e.to_string()),
        Err(HandshakeError::WouldBlock(_)) => {
            Err("TLS handshake would block (unexpected non-blocking socket)".into())
        }
    }
}
