use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct TodoItem {
    pub id: usize,
    pub title: String,
    pub completed: bool,
}

#[derive(Clone, Default)]
pub struct TodoStore {
    items: Arc<Mutex<Vec<TodoItem>>>,
}

impl TodoStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&self, title: String) -> TodoItem {
        let mut items = self.items.lock().unwrap();
        let new_item = TodoItem {
            id: items.len() + 1,
            title,
            completed: false,
        };
        items.push(new_item.clone());
        new_item
    }

    pub fn list(&self) -> Vec<TodoItem> {
        self.items.lock().unwrap().clone()
    }
}

// ==========================================
// 1. 單元測試 (Unit Test)
// ==========================================
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_todo_item() {
        let store = TodoStore::new();
        let item = store.add("寫 Rust 單元測試".to_string());

        assert_eq!(item.id, 1);
        assert_eq!(item.title, "寫 Rust 單元測試");
        assert_eq!(item.completed, false);

        let list = store.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0], item);
    }
}
