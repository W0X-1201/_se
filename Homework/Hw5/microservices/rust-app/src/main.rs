use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

fn handle(mut stream: TcpStream) {
    let mut buffer = [0u8; 1024];
    let _ = stream.read(&mut buffer);

    let body = r#"{"service":"rust-app","language":"Rust","message":"Hello from Rust! \ud83e\udd80","hostname":"rust-app"}"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn main() {
    let addr = "0.0.0.0:8080";
    let listener = TcpListener::bind(addr).expect("failed to bind address");
    println!("rust-app listening on {addr}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle(stream),
            Err(err) => eprintln!("connection error: {err}"),
        }
    }
}
