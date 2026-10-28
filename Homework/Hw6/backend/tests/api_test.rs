// ==========================================
// 2. 系統測試 (Web API Test)
// ==========================================
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt; // 用於讀取 Response body
use serde_json::{json, Value};
use tower::ServiceExt; // 提供 oneshot() 方法

// 引用 backend 中的模組
#[path = "../src/api.rs"]
mod api;
#[path = "../src/todo.rs"]
mod todo;

use todo::TodoStore;

#[tokio::test]
async fn test_web_api_create_and_get_todos() {
    let store = TodoStore::new();
    let app = api::create_router(store);

    // 1. 測試 POST /api/todos (建立項目)
    let payload = json!({ "title": "系統測試 API" }).to_string();
    let request = Request::builder()
        .method("POST")
        .uri("/api/todos")
        .header("content-type", "application/json")
        .body(Body::from(payload))
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // 2. 測試 GET /api/todos (取得清單)
    let request = Request::builder()
        .method("GET")
        .uri("/api/todos")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 驗證回傳的 JSON 結構
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let todos: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(todos[0]["title"], "系統測試 API");
}
