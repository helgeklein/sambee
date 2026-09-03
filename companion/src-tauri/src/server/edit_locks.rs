//! Short-lived browser edit leases for Companion-local files.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::errors::ApiError;

pub const EDIT_LOCK_TIMEOUT: Duration = Duration::from_secs(120);
pub const EDIT_LOCK_CONFLICT_CODE: &str = "edit_lock_held";
pub const EDIT_LOCK_LOST_CODE: &str = "edit_lock_lost";

#[derive(Clone)]
pub struct LocalEditLock {
    pub lock_id: String,
    pub lock_capability: String,
    pub operation_id: String,
    pub file_path: String,
    pub locked_by: String,
    pub locked_at: DateTime<Utc>,
    expires_at: Instant,
}

pub struct EditLockManager {
    locks: Mutex<HashMap<String, LocalEditLock>>,
}

struct LockValidationContext<'a> {
    holder: &'a str,
    operation_id: &'a str,
    lock_id: &'a str,
    lock_capability: &'a str,
}

impl EditLockManager {
    pub fn new() -> Self {
        Self {
            locks: Mutex::new(HashMap::new()),
        }
    }

    fn key(drive: &str, path: &str) -> String {
        format!("{drive}\u{0}{path}")
    }

    fn remove_expired(locks: &mut HashMap<String, LocalEditLock>) {
        let now = Instant::now();
        locks.retain(|_, lock| lock.expires_at > now);
    }

    pub async fn acquire(&self, drive: &str, path: &str, holder: String) -> Result<LocalEditLock, ApiError> {
        let mut locks = self.locks.lock().await;
        Self::remove_expired(&mut locks);
        let key = Self::key(drive, path);
        if locks.contains_key(&key) {
            return Err(ApiError::conflict_code(
                "File is already locked for editing",
                EDIT_LOCK_CONFLICT_CODE,
            ));
        }

        let lock = LocalEditLock {
            lock_id: Uuid::new_v4().to_string(),
            lock_capability: Uuid::new_v4().to_string(),
            operation_id: Uuid::new_v4().to_string(),
            file_path: path.to_string(),
            locked_by: holder,
            locked_at: Utc::now(),
            expires_at: Instant::now() + EDIT_LOCK_TIMEOUT,
        };
        locks.insert(key, lock.clone());
        Ok(lock)
    }

    async fn validate_lock(&self, drive: &str, path: &str, context: LockValidationContext<'_>, refresh: bool) -> Result<(), ApiError> {
        let mut locks = self.locks.lock().await;
        Self::remove_expired(&mut locks);
        let key = Self::key(drive, path);
        let lock = locks
            .get_mut(&key)
            .ok_or_else(|| ApiError::not_found_code("Edit lock not found or expired", EDIT_LOCK_LOST_CODE))?;
        if lock.locked_by != context.holder {
            return Err(ApiError::forbidden_code(
                "Edit lock is held by another browser session",
                EDIT_LOCK_LOST_CODE,
            ));
        }
        if lock.operation_id != context.operation_id || lock.lock_id != context.lock_id || lock.lock_capability != context.lock_capability {
            return Err(ApiError::forbidden_code("Edit lock context mismatch", EDIT_LOCK_LOST_CODE));
        }
        if refresh {
            lock.expires_at = Instant::now() + EDIT_LOCK_TIMEOUT;
        }
        Ok(())
    }

    pub async fn heartbeat(
        &self,
        drive: &str,
        path: &str,
        holder: &str,
        operation_id: &str,
        lock_id: &str,
        lock_capability: &str,
    ) -> Result<(), ApiError> {
        self.validate_lock(
            drive,
            path,
            LockValidationContext {
                holder,
                operation_id,
                lock_id,
                lock_capability,
            },
            true,
        )
        .await
    }

    pub async fn validate(
        &self,
        drive: &str,
        path: &str,
        holder: &str,
        operation_id: &str,
        lock_id: &str,
        lock_capability: &str,
    ) -> Result<(), ApiError> {
        self.validate_lock(
            drive,
            path,
            LockValidationContext {
                holder,
                operation_id,
                lock_id,
                lock_capability,
            },
            false,
        )
        .await
    }

    pub async fn release(
        &self,
        drive: &str,
        path: &str,
        holder: &str,
        operation_id: &str,
        lock_id: &str,
        lock_capability: &str,
    ) -> Result<(), ApiError> {
        let mut locks = self.locks.lock().await;
        Self::remove_expired(&mut locks);
        let key = Self::key(drive, path);
        let lock = locks
            .get(&key)
            .ok_or_else(|| ApiError::not_found_code("Edit lock not found or expired", EDIT_LOCK_LOST_CODE))?;
        if lock.locked_by != holder {
            return Err(ApiError::forbidden_code(
                "Edit lock is held by another browser",
                EDIT_LOCK_LOST_CODE,
            ));
        }
        if lock.operation_id != operation_id || lock.lock_id != lock_id || lock.lock_capability != lock_capability {
            return Err(ApiError::forbidden_code("Edit lock context mismatch", EDIT_LOCK_LOST_CODE));
        }
        locks.remove(&key);
        Ok(())
    }

    pub async fn status(&self, drive: &str, path: &str) -> Option<LocalEditLock> {
        let mut locks = self.locks.lock().await;
        Self::remove_expired(&mut locks);
        locks.get(&Self::key(drive, path)).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::EditLockManager;

    #[tokio::test]
    async fn rejects_a_second_browser_session_and_wrong_capability() {
        let manager = EditLockManager::new();
        let lock = manager
            .acquire("c", "docs/readme.md", "https://sambee.example".to_string())
            .await
            .unwrap();

        assert!(manager
            .acquire("c", "docs/readme.md", "https://other.example".to_string())
            .await
            .is_err());
        assert!(manager
            .validate(
                "c",
                "docs/readme.md",
                "https://sambee.example",
                &lock.operation_id,
                &lock.lock_id,
                "wrong"
            )
            .await
            .is_err());
    }
}
