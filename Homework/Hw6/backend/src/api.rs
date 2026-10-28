use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::todo::TodoStore;

#[derive(Deserialize)]
pub struct CreateTodo {
    pub title: String,
}

pub fn create_router(store: TodoStore) -> Router {
    Router::new()
        .route("/api/todos", get(get_todos))
        .route("/api/todos", post(create_todo))
        .with_state(store)
}

async fn get_todos(State(store): State<TodoStore>) -> impl IntoResponse {
    Json(store.list())
}

async fn create_todo(
    State(store): State<TodoStore>,
    Json(payload): Json<CreateTodo>,
) -> impl IntoResponse {
    let new_item = store.add(payload.title);
    (StatusCode::CREATED, Json(new_item))
}
