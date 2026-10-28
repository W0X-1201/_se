mod api;
mod todo;

use std::net::SocketAddr;

use todo::TodoStore;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    let store = TodoStore::new();
    let app = api::create_router(store)
        .fallback_service(ServeDir::new("../frontend")); // 託管前端靜態頁面

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("伺服器啟動於 http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
