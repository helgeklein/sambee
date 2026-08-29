//! Short-lived lifecycle state for Companion-owned local archive executions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use super::archive::{
    build_local_archive_manifest_with_cancellation, create_local_archive_with_cancellation_progress_and_state,
    extract_local_archive_with_checkpoint_and_progress, validate_local_extraction_rename_target, ArchiveCreationManifestState,
    LocalArchiveCreationResult, LocalArchiveError, LocalArchiveExtractionCheckpoint, LocalArchiveExtractionCollision,
    LocalArchiveExtractionCollisionAction, LocalArchiveExtractionMemberError, LocalArchiveExtractionResult,
    LocalArchiveExtractionRunResult,
};
use super::errors::ApiError;

pub const ARCHIVE_SESSION_TIMEOUT: Duration = Duration::from_secs(120);
pub const ARCHIVE_SESSION_STALE_REVISION_CODE: &str = "archive_execution_stale_revision";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArchiveSessionKind {
    Create,
    Extract,
}

impl ArchiveSessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Extract => "extract",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArchiveSessionPhase {
    Accepted,
    Streaming,
    AwaitingUserDecision,
    Completed,
    Cancelled,
    Failed,
}

impl ArchiveSessionPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Streaming => "streaming",
            Self::AwaitingUserDecision => "awaiting_user_decision",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Failed)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArchiveSessionPendingDecision {
    pub member_path: String,
    pub target_path: Option<String>,
    pub is_directory: bool,
    pub member_error: Option<LocalArchiveExtractionMemberError>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArchiveSessionProgress {
    Creation(LocalArchiveCreationResult),
    Extraction(LocalArchiveExtractionResult),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArchiveSessionDecisionAction {
    Skip,
    SkipAll,
    Replace,
    ReplaceAll,
    ReplaceOlder,
    Rename,
    Retry,
    Ignore,
}

pub struct ArchiveSessionDecision {
    pub member_path: String,
    pub action: ArchiveSessionDecisionAction,
    pub target_path: Option<String>,
}

enum ArchiveSessionCompletion {
    Completed(ArchiveSessionProgress),
    CreationCompleted {
        result: LocalArchiveCreationResult,
        state: ArchiveCreationManifestState,
    },
    AwaitingCollision {
        checkpoint: LocalArchiveExtractionCheckpoint,
        collision: LocalArchiveExtractionCollision,
    },
    AwaitingMemberError {
        checkpoint: LocalArchiveExtractionCheckpoint,
        error: LocalArchiveExtractionMemberError,
    },
}

#[derive(Clone, Debug)]
pub struct ArchiveSessionStatus {
    pub execution_id: String,
    pub kind: ArchiveSessionKind,
    pub phase: ArchiveSessionPhase,
    pub revision: u64,
    pub cancellation_requested: bool,
    pub progress: ArchiveSessionProgress,
    pub result: Option<ArchiveSessionProgress>,
    pub error: Option<String>,
    pub pending_decision: Option<ArchiveSessionPendingDecision>,
}

#[derive(Clone)]
enum ArchiveSessionWork {
    Creation { source_paths: Vec<PathBuf>, target_path: PathBuf },
    Extraction { archive_path: PathBuf, destination_path: PathBuf },
}

impl ArchiveSessionWork {
    fn kind(&self) -> ArchiveSessionKind {
        match self {
            Self::Creation { .. } => ArchiveSessionKind::Create,
            Self::Extraction { .. } => ArchiveSessionKind::Extract,
        }
    }

    fn initial_progress(&self) -> ArchiveSessionProgress {
        match self {
            Self::Creation { .. } => ArchiveSessionProgress::Creation(LocalArchiveCreationResult {
                files_created: 0,
                directories_created: 0,
                source_bytes: 0,
            }),
            Self::Extraction { .. } => ArchiveSessionProgress::Extraction(LocalArchiveExtractionResult {
                files_extracted: 0,
                directories_created: 0,
                extracted_bytes: 0,
                files_skipped: 0,
                files_replaced: 0,
                files_failed: 0,
                partial_members: 0,
            }),
        }
    }
}

struct ArchiveSession {
    execution_id: String,
    drive: String,
    owner_origin: String,
    kind: ArchiveSessionKind,
    phase: ArchiveSessionPhase,
    revision: u64,
    drive_root: PathBuf,
    work: ArchiveSessionWork,
    creation_state: Option<ArchiveCreationManifestState>,
    extraction_checkpoint: Option<LocalArchiveExtractionCheckpoint>,
    cancellation_requested: Arc<AtomicBool>,
    progress: ArchiveSessionProgress,
    result: Option<ArchiveSessionProgress>,
    error: Option<String>,
    pending_decision: Option<ArchiveSessionPendingDecision>,
    expires_at: Option<Instant>,
}

impl ArchiveSession {
    fn status(&self) -> ArchiveSessionStatus {
        ArchiveSessionStatus {
            execution_id: self.execution_id.clone(),
            kind: self.kind,
            phase: self.phase,
            revision: self.revision,
            cancellation_requested: self.cancellation_requested.load(Ordering::Acquire),
            progress: self.progress,
            result: self.result,
            error: self.error.clone(),
            pending_decision: self.pending_decision.clone(),
        }
    }

    fn complete(&mut self, result: Result<ArchiveSessionCompletion, LocalArchiveError>) {
        match result {
            Ok(ArchiveSessionCompletion::Completed(result)) => {
                self.progress = result;
                self.phase = ArchiveSessionPhase::Completed;
                self.result = Some(result);
            }
            Ok(ArchiveSessionCompletion::CreationCompleted { result, state }) => {
                let result = ArchiveSessionProgress::Creation(result);
                self.creation_state = Some(state);
                self.progress = result;
                self.phase = ArchiveSessionPhase::Completed;
                self.result = Some(result);
            }
            Ok(ArchiveSessionCompletion::AwaitingCollision { checkpoint, collision }) => {
                self.progress = ArchiveSessionProgress::Extraction(checkpoint.result());
                self.extraction_checkpoint = Some(checkpoint);
                self.pending_decision = Some(ArchiveSessionPendingDecision {
                    member_path: collision.member_path,
                    target_path: Some(collision.target_path),
                    is_directory: collision.is_directory,
                    member_error: None,
                });
                self.phase = ArchiveSessionPhase::AwaitingUserDecision;
                self.revision += 1;
                return;
            }
            Ok(ArchiveSessionCompletion::AwaitingMemberError { checkpoint, error }) => {
                self.progress = ArchiveSessionProgress::Extraction(checkpoint.result());
                self.extraction_checkpoint = Some(checkpoint);
                self.pending_decision = Some(ArchiveSessionPendingDecision {
                    member_path: error.member_path.clone(),
                    target_path: None,
                    is_directory: false,
                    member_error: Some(error),
                });
                self.phase = ArchiveSessionPhase::AwaitingUserDecision;
                self.revision += 1;
                return;
            }
            Err(LocalArchiveError::Cancelled) => {
                self.phase = ArchiveSessionPhase::Cancelled;
            }
            Err(error) => {
                self.phase = ArchiveSessionPhase::Failed;
                self.error = Some(error.to_string());
            }
        }
        self.revision += 1;
        self.expires_at = Some(Instant::now() + ARCHIVE_SESSION_TIMEOUT);
    }
}

pub struct ArchiveSessionManager {
    sessions: Mutex<HashMap<String, ArchiveSession>>,
    #[cfg(test)]
    phase_transitions: Mutex<HashMap<String, Vec<ArchiveSessionPhase>>>,
    #[cfg(test)]
    pending_decisions: Mutex<HashMap<String, String>>,
}

/// Coordinate direct-local archive work while keeping lifecycle records in memory only.
pub struct LocalArchiveOperationCoordinator {
    state_store: Arc<ArchiveSessionManager>,
}

impl LocalArchiveOperationCoordinator {
    pub fn new(state_store: Arc<ArchiveSessionManager>) -> Self {
        Self { state_store }
    }
}

impl ArchiveSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            #[cfg(test)]
            phase_transitions: Mutex::new(HashMap::new()),
            #[cfg(test)]
            pending_decisions: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    async fn recorded_phase_transitions(&self, execution_id: &str) -> Vec<String> {
        self.phase_transitions
            .lock()
            .await
            .get(execution_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(ArchiveSessionPhase::as_str)
            .map(str::to_string)
            .collect()
    }

    #[cfg(test)]
    async fn record_phase_transition(&self, execution_id: &str, phase: ArchiveSessionPhase) {
        if let Some(transitions) = self.phase_transitions.lock().await.get_mut(execution_id) {
            transitions.push(phase);
        }
    }

    #[cfg(test)]
    async fn recorded_pending_decision(&self, execution_id: &str) -> Option<String> {
        self.pending_decisions.lock().await.get(execution_id).cloned()
    }

    #[cfg(test)]
    async fn record_pending_decision(&self, execution_id: &str, decision: &ArchiveSessionPendingDecision) {
        let category = if decision.member_error.is_some() {
            "member_error"
        } else {
            "collision"
        };
        self.pending_decisions
            .lock()
            .await
            .insert(execution_id.to_string(), category.to_string());
    }

    fn remove_expired(sessions: &mut HashMap<String, ArchiveSession>) {
        let now = Instant::now();
        sessions.retain(|_, session| !session.phase.is_terminal() || session.expires_at.is_some_and(|expires_at| expires_at > now));
    }

    pub async fn create_extraction(
        &self,
        drive: String,
        owner_origin: String,
        drive_root: PathBuf,
        archive_path: PathBuf,
        destination_path: PathBuf,
    ) -> ArchiveSessionStatus {
        self.create(
            drive,
            owner_origin,
            drive_root,
            ArchiveSessionWork::Extraction {
                archive_path,
                destination_path,
            },
        )
        .await
    }

    pub async fn create_creation(
        &self,
        drive: String,
        owner_origin: String,
        drive_root: PathBuf,
        source_paths: Vec<PathBuf>,
        target_path: PathBuf,
    ) -> ArchiveSessionStatus {
        self.create(
            drive,
            owner_origin,
            drive_root,
            ArchiveSessionWork::Creation { source_paths, target_path },
        )
        .await
    }

    async fn create(&self, drive: String, owner_origin: String, drive_root: PathBuf, work: ArchiveSessionWork) -> ArchiveSessionStatus {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        let execution_id = Uuid::new_v4().to_string();
        let session = ArchiveSession {
            execution_id: execution_id.clone(),
            drive,
            owner_origin,
            kind: work.kind(),
            phase: ArchiveSessionPhase::Accepted,
            revision: 0,
            drive_root,
            progress: work.initial_progress(),
            work,
            creation_state: None,
            extraction_checkpoint: None,
            cancellation_requested: Arc::new(AtomicBool::new(false)),
            result: None,
            error: None,
            pending_decision: None,
            expires_at: None,
        };
        let status = session.status();
        sessions.insert(execution_id, session);
        #[cfg(test)]
        self.phase_transitions
            .lock()
            .await
            .insert(status.execution_id.clone(), vec![ArchiveSessionPhase::Accepted]);
        status
    }

    pub async fn get(&self, drive: &str, owner_origin: &str, execution_id: &str) -> Result<ArchiveSessionStatus, ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        sessions
            .get(execution_id)
            .filter(|session| session.drive == drive && session.owner_origin == owner_origin)
            .map(ArchiveSession::status)
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))
    }

    async fn start_state(
        &self,
        execution_id: &str,
    ) -> Result<
        (
            PathBuf,
            ArchiveSessionWork,
            Arc<AtomicBool>,
            Option<LocalArchiveExtractionCheckpoint>,
        ),
        ApiError,
    > {
        let (drive_root, work, cancellation_requested, checkpoint) = {
            let mut sessions = self.sessions.lock().await;
            Self::remove_expired(&mut sessions);
            let session = sessions
                .get_mut(execution_id)
                .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
            if session.phase != ArchiveSessionPhase::Accepted {
                return Err(ApiError::conflict_message("Archive execution has already started"));
            }
            session.phase = ArchiveSessionPhase::Streaming;
            session.revision += 1;
            (
                session.drive_root.clone(),
                session.work.clone(),
                session.cancellation_requested.clone(),
                session.extraction_checkpoint.take(),
            )
        };
        #[cfg(test)]
        self.record_phase_transition(execution_id, ArchiveSessionPhase::Streaming).await;
        Ok((drive_root, work, cancellation_requested, checkpoint))
    }
}

impl LocalArchiveOperationCoordinator {
    async fn apply_decision(
        &self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
        expected_revision: u64,
        decision: ArchiveSessionDecision,
    ) -> Result<
        (
            PathBuf,
            ArchiveSessionWork,
            Arc<AtomicBool>,
            Option<LocalArchiveExtractionCheckpoint>,
            ArchiveSessionStatus,
        ),
        ApiError,
    > {
        let (drive_root, work, cancellation_requested, checkpoint, status) = {
            let mut sessions = self.state_store.sessions.lock().await;
            ArchiveSessionManager::remove_expired(&mut sessions);
            let session = sessions
                .get_mut(execution_id)
                .filter(|session| session.drive == drive && session.owner_origin == owner_origin)
                .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
            if session.revision != expected_revision {
                return Err(ApiError::conflict_code(
                    "Archive execution changed before the decision could be applied",
                    ARCHIVE_SESSION_STALE_REVISION_CODE,
                ));
            }
            if session.phase != ArchiveSessionPhase::AwaitingUserDecision {
                return Err(ApiError::conflict_message("Archive execution is not awaiting a user decision"));
            }
            let pending_decision = session
                .pending_decision
                .as_ref()
                .ok_or_else(|| ApiError::Internal("Archive extraction decision details are unavailable".to_string()))?;
            if pending_decision.member_path != decision.member_path {
                return Err(ApiError::conflict_message("Archive decision does not match the pending member"));
            }
            let is_member_error = pending_decision.member_error.is_some();
            let is_directory = pending_decision.is_directory;
            if !matches!(
                (is_member_error, decision.action),
                (false, ArchiveSessionDecisionAction::Skip)
                    | (false, ArchiveSessionDecisionAction::SkipAll)
                    | (false, ArchiveSessionDecisionAction::Replace)
                    | (false, ArchiveSessionDecisionAction::ReplaceAll)
                    | (false, ArchiveSessionDecisionAction::ReplaceOlder)
                    | (false, ArchiveSessionDecisionAction::Rename)
                    | (true, ArchiveSessionDecisionAction::Retry)
                    | (true, ArchiveSessionDecisionAction::Ignore)
            ) {
                return Err(ApiError::conflict_message("Archive decision is not allowed for the pending member"));
            }
            if is_directory && !matches!(decision.action, ArchiveSessionDecisionAction::Rename) {
                return Err(ApiError::conflict_message("Directory collisions may only be resolved by renaming"));
            }
            let rename_target = if matches!(decision.action, ArchiveSessionDecisionAction::Rename) {
                Some(
                    decision
                        .target_path
                        .ok_or_else(|| ApiError::BadRequest("Archive rename decisions require a target path".to_string()))?,
                )
            } else {
                if decision.target_path.is_some() {
                    return Err(ApiError::BadRequest(
                        "Only archive rename decisions may include a target path".to_string(),
                    ));
                }
                None
            };
            if let ArchiveSessionDecisionAction::Rename = decision.action {
                let (archive_path, extraction_checkpoint) = match (&session.work, session.extraction_checkpoint.as_ref()) {
                    (ArchiveSessionWork::Extraction { archive_path, .. }, Some(checkpoint)) => (archive_path, checkpoint),
                    _ => return Err(ApiError::Internal("Archive extraction checkpoint is unavailable".to_string())),
                };
                validate_local_extraction_rename_target(
                    archive_path,
                    extraction_checkpoint,
                    &decision.member_path,
                    rename_target
                        .as_deref()
                        .ok_or_else(|| ApiError::Internal("Archive rename target is unavailable".to_string()))?,
                    is_directory,
                )
                .map_err(|_| {
                    ApiError::BadRequest("Archive rename target is invalid or conflicts with another archive member".to_string())
                })?;
            }
            let checkpoint = session
                .extraction_checkpoint
                .take()
                .ok_or_else(|| ApiError::Internal("Archive extraction checkpoint is unavailable".to_string()))?;
            let mut checkpoint = checkpoint;
            match decision.action {
                ArchiveSessionDecisionAction::Skip => {
                    checkpoint.resolve_collision(decision.member_path, LocalArchiveExtractionCollisionAction::Skip);
                }
                ArchiveSessionDecisionAction::SkipAll => {
                    checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::Skip);
                }
                ArchiveSessionDecisionAction::Replace => {
                    checkpoint.resolve_collision(decision.member_path, LocalArchiveExtractionCollisionAction::Replace);
                }
                ArchiveSessionDecisionAction::ReplaceAll => {
                    checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::Replace);
                }
                ArchiveSessionDecisionAction::ReplaceOlder => {
                    checkpoint.resolve_all_collisions(LocalArchiveExtractionCollisionAction::ReplaceOlder);
                }
                ArchiveSessionDecisionAction::Rename => {
                    checkpoint.rename_member(
                        decision.member_path,
                        rename_target.ok_or_else(|| ApiError::Internal("Archive rename target is unavailable".to_string()))?,
                    );
                }
                ArchiveSessionDecisionAction::Retry => {}
                ArchiveSessionDecisionAction::Ignore => checkpoint.ignore_member_error(decision.member_path),
            }
            session.pending_decision = None;
            session.phase = ArchiveSessionPhase::Streaming;
            session.revision += 1;
            (
                session.drive_root.clone(),
                session.work.clone(),
                session.cancellation_requested.clone(),
                Some(checkpoint),
                session.status(),
            )
        };
        #[cfg(test)]
        self.state_store
            .record_phase_transition(execution_id, ArchiveSessionPhase::Streaming)
            .await;
        Ok((drive_root, work, cancellation_requested, checkpoint, status))
    }
}

impl ArchiveSessionManager {
    pub async fn cancel(
        &self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
        expected_revision: u64,
    ) -> Result<ArchiveSessionStatus, ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        let session = sessions
            .get_mut(execution_id)
            .filter(|session| session.drive == drive && session.owner_origin == owner_origin)
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
        if session.revision != expected_revision {
            return Err(ApiError::conflict_code(
                "Archive execution changed before cancellation could be applied",
                ARCHIVE_SESSION_STALE_REVISION_CODE,
            ));
        }
        if session.phase == ArchiveSessionPhase::AwaitingUserDecision {
            session.cancellation_requested.store(true, Ordering::Release);
            session.phase = ArchiveSessionPhase::Cancelled;
            session.revision += 1;
            session.expires_at = Some(Instant::now() + ARCHIVE_SESSION_TIMEOUT);
        } else if !session.phase.is_terminal() {
            session.cancellation_requested.store(true, Ordering::Release);
            session.revision += 1;
        }
        let status = session.status();
        let _terminal_phase = status.phase.is_terminal().then_some(status.phase);
        drop(sessions);
        #[cfg(test)]
        if let Some(phase) = _terminal_phase {
            self.record_phase_transition(execution_id, phase).await;
        }
        Ok(status)
    }

    async fn complete(&self, execution_id: &str, result: Result<ArchiveSessionCompletion, LocalArchiveError>) {
        let mut sessions = self.sessions.lock().await;
        let _phase = if let Some(session) = sessions.get_mut(execution_id) {
            session.complete(result);
            Some((session.phase, session.pending_decision.clone()))
        } else {
            None
        };
        drop(sessions);
        #[cfg(test)]
        if let Some((phase, pending_decision)) = _phase {
            self.record_phase_transition(execution_id, phase).await;
            if let Some(pending_decision) = pending_decision {
                self.record_pending_decision(execution_id, &pending_decision).await;
            }
        }
    }

    async fn update_progress(&self, execution_id: &str, progress: ArchiveSessionProgress) {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(execution_id) {
            if session.phase == ArchiveSessionPhase::Streaming
                && std::mem::discriminant(&session.progress) == std::mem::discriminant(&progress)
            {
                session.progress = progress;
                session.revision += 1;
            }
        }
    }
}

impl LocalArchiveOperationCoordinator {
    pub async fn start(&self, execution_id: &str) -> Result<(), ApiError> {
        let (drive_root, work, cancellation_requested, checkpoint) = self.state_store.start_state(execution_id).await?;
        self.spawn_worker(execution_id.to_string(), drive_root, work, cancellation_requested, checkpoint);
        Ok(())
    }

    pub async fn decide(
        &self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
        expected_revision: u64,
        decision: ArchiveSessionDecision,
    ) -> Result<ArchiveSessionStatus, ApiError> {
        let (drive_root, work, cancellation_requested, checkpoint, status) = self
            .apply_decision(drive, owner_origin, execution_id, expected_revision, decision)
            .await?;
        self.spawn_worker(execution_id.to_string(), drive_root, work, cancellation_requested, checkpoint);
        Ok(status)
    }

    fn spawn_worker(
        &self,
        execution_id: String,
        drive_root: PathBuf,
        work: ArchiveSessionWork,
        cancellation_requested: Arc<AtomicBool>,
        checkpoint: Option<LocalArchiveExtractionCheckpoint>,
    ) {
        let state_store = self.state_store.clone();
        tokio::spawn(async move {
            let (progress_sender, mut progress_receiver) = mpsc::unbounded_channel();
            let mut archive_task = tokio::task::spawn_blocking(move || match work {
                ArchiveSessionWork::Creation { source_paths, target_path } => {
                    if cancellation_requested.load(Ordering::Acquire) {
                        return Err(LocalArchiveError::Cancelled);
                    }
                    let entries = build_local_archive_manifest_with_cancellation(&source_paths, &target_path, || {
                        cancellation_requested.load(Ordering::Acquire)
                    })?;
                    create_local_archive_with_cancellation_progress_and_state(
                        &drive_root,
                        &target_path,
                        &entries,
                        || cancellation_requested.load(Ordering::Acquire),
                        |progress| {
                            let _ = progress_sender.send(ArchiveSessionProgress::Creation(progress));
                        },
                    )
                    .map(|(result, state)| ArchiveSessionCompletion::CreationCompleted { result, state })
                }
                ArchiveSessionWork::Extraction {
                    archive_path,
                    destination_path,
                } => extract_local_archive_with_checkpoint_and_progress(
                    &drive_root,
                    &archive_path,
                    &destination_path,
                    checkpoint.unwrap_or_default(),
                    || cancellation_requested.load(Ordering::Acquire),
                    |progress| {
                        let _ = progress_sender.send(ArchiveSessionProgress::Extraction(progress));
                    },
                )
                .map(|result| match result {
                    LocalArchiveExtractionRunResult::Completed(checkpoint) => {
                        ArchiveSessionCompletion::Completed(ArchiveSessionProgress::Extraction(checkpoint.result()))
                    }
                    LocalArchiveExtractionRunResult::AwaitingCollision { checkpoint, collision } => {
                        ArchiveSessionCompletion::AwaitingCollision { checkpoint, collision }
                    }
                    LocalArchiveExtractionRunResult::AwaitingMemberError { checkpoint, error } => {
                        ArchiveSessionCompletion::AwaitingMemberError { checkpoint, error }
                    }
                }),
            });
            let result = loop {
                tokio::select! {
                    Some(progress) = progress_receiver.recv() => state_store.update_progress(&execution_id, progress).await,
                    result = &mut archive_task => {
                        break result
                            .map_err(|error| LocalArchiveError::Io(std::io::Error::other(format!("Archive execution task failed: {error}"))))
                            .and_then(|result| result);
                    }
                }
            };
            state_store.complete(&execution_id, result).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use tempfile::tempdir;

    use super::{
        ArchiveSessionDecision, ArchiveSessionDecisionAction, ArchiveSessionManager, ArchiveSessionPhase, ArchiveSessionProgress,
        LocalArchiveOperationCoordinator,
    };
    use crate::server::archive::{build_local_archive_manifest, create_local_archive};

    fn expected_trace(case_name: &str) -> serde_json::Value {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-execution-traces-v1.json"))
                .expect("topology trace fixture should be valid JSON");
        fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .find(|case| case["name"] == case_name)
            .unwrap_or_else(|| panic!("topology trace fixture should define {case_name}"))["expected_trace"]
            .clone()
    }

    async fn direct_local_trace(
        manager: &ArchiveSessionManager,
        execution_id: &str,
        status: &super::ArchiveSessionStatus,
        manifest_snapshot: Vec<&str>,
        member_outcomes: Vec<&str>,
    ) -> serde_json::Value {
        let terminal_summary = match status.result {
            Some(ArchiveSessionProgress::Creation(result)) => serde_json::json!({
                "files_created": result.files_created,
                "directories_created": result.directories_created,
                "source_bytes": result.source_bytes,
            }),
            Some(ArchiveSessionProgress::Extraction(result)) => serde_json::json!({
                "files_extracted": result.files_extracted,
                "files_skipped": result.files_skipped,
                "extracted_bytes": result.extracted_bytes,
            }),
            None => serde_json::Value::Null,
        };
        serde_json::json!({
            "owner": "companion",
            "manifest_snapshot": manifest_snapshot,
            "phase_transitions": manager.recorded_phase_transitions(execution_id).await,
            "pending_decision": manager.recorded_pending_decision(execution_id).await,
            "member_outcomes": member_outcomes,
            "terminal_summary": terminal_summary,
            "error_category": match status.phase {
                ArchiveSessionPhase::Cancelled => serde_json::Value::String("cancelled".to_string()),
                ArchiveSessionPhase::Failed => serde_json::Value::String("source_changed".to_string()),
                ArchiveSessionPhase::AwaitingUserDecision if status.pending_decision.as_ref().is_some_and(|decision| decision.member_error.is_some()) => {
                    serde_json::Value::String("partial_write".to_string())
                }
                _ => serde_json::Value::Null,
            },
        })
    }

    #[tokio::test]
    async fn cancellation_requires_current_revision_and_reaches_terminal_state() {
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                PathBuf::from("/drive"),
                PathBuf::from("/drive/archive.zip"),
                PathBuf::from("/drive/output"),
            )
            .await;

        assert_eq!(session.phase, ArchiveSessionPhase::Accepted);
        assert!(manager
            .cancel("c", "https://sambee.example", &session.execution_id, session.revision + 1)
            .await
            .is_err());

        assert!(manager.get("c", "https://other.example", &session.execution_id).await.is_err());

        let cancelled = manager
            .cancel("c", "https://sambee.example", &session.execution_id, session.revision)
            .await
            .unwrap();
        assert_eq!(cancelled.revision, 1);
        assert!(cancelled.cancellation_requested);

        manager
            .complete(&session.execution_id, Err(super::LocalArchiveError::Cancelled))
            .await;
        let terminal = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
        assert_eq!(terminal.phase, ArchiveSessionPhase::Cancelled);
        assert_eq!(terminal.revision, 2);
    }

    #[tokio::test]
    async fn creation_progress_updates_are_visible_with_a_new_revision() {
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_creation(
                "c".to_string(),
                "https://sambee.example".to_string(),
                PathBuf::from("/drive"),
                vec![PathBuf::from("/drive/source.txt")],
                PathBuf::from("/drive/archive.zip"),
            )
            .await;

        {
            let mut sessions = manager.sessions.lock().await;
            let state = sessions.get_mut(&session.execution_id).unwrap();
            state.phase = ArchiveSessionPhase::Streaming;
            state.revision = 1;
        }

        manager
            .update_progress(
                &session.execution_id,
                ArchiveSessionProgress::Creation(super::LocalArchiveCreationResult {
                    files_created: 1,
                    directories_created: 1,
                    source_bytes: 5,
                }),
            )
            .await;

        let updated = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
        assert_eq!(updated.revision, 2);
        assert!(matches!(
            updated.progress,
            ArchiveSessionProgress::Creation(progress) if progress.files_created == 1 && progress.source_bytes == 5
        ));
    }

    #[tokio::test]
    async fn starts_a_creation_session_and_reports_its_typed_terminal_result() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        let target = directory.path().join("archive.zip");
        fs::write(&source, b"source").unwrap();
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_creation(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                vec![source],
                target.clone(),
            )
            .await;

        LocalArchiveOperationCoordinator::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let status = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("archive creation session should terminate");

        assert_eq!(status.phase, ArchiveSessionPhase::Completed);
        assert!(matches!(
            status.result,
            Some(ArchiveSessionProgress::Creation(progress)) if progress.files_created == 1 && progress.source_bytes == 6
        ));
        let sessions = manager.sessions.lock().await;
        let creation_state = sessions
            .get(&session.execution_id)
            .and_then(|session| session.creation_state.as_ref())
            .expect("completed creation sessions must retain their manifest outcome ledger");
        assert_eq!(
            creation_state.terminal_summary().unwrap(),
            super::LocalArchiveCreationResult {
                files_created: 1,
                directories_created: 0,
                source_bytes: 6,
            }
        );
        assert!(target.is_file());
        let expected = expected_trace("create_local_to_local_success");
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &status, vec!["source.txt"], vec!["source.txt"]).await,
            expected
        );
    }

    #[tokio::test]
    async fn direct_local_extraction_coordinator_matches_shared_success_trace() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        let archive_path = directory.path().join("archive.zip");
        let destination = directory.path().join("output");
        fs::write(&source, b"source").unwrap();
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                archive_path,
                destination.clone(),
            )
            .await;

        LocalArchiveOperationCoordinator::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let completed = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("direct local archive extraction should terminate");

        let expected = expected_trace("extract_local_to_local_success");
        assert!(matches!(
            completed.result,
            Some(ArchiveSessionProgress::Extraction(progress))
                if progress.files_extracted == expected["terminal_summary"]["files_extracted"]
                    && progress.extracted_bytes == expected["terminal_summary"]["extracted_bytes"]
        ));
        assert_eq!(fs::read(destination.join("source.txt")).unwrap(), b"source");
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &completed, vec!["source.txt"], vec!["source.txt"]).await,
            expected
        );
    }

    #[tokio::test]
    async fn cancelled_creation_session_does_not_create_its_target() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        let target = directory.path().join("archive.zip");
        fs::write(&source, b"source").unwrap();
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_creation(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                vec![source],
                target.clone(),
            )
            .await;

        manager
            .cancel("c", "https://sambee.example", &session.execution_id, session.revision)
            .await
            .unwrap();
        LocalArchiveOperationCoordinator::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let status = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("cancelled archive creation session should terminate");

        assert_eq!(status.phase, ArchiveSessionPhase::Cancelled);
        assert!(!target.exists());
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &status, vec!["source.txt"], vec![]).await,
            expected_trace("create_cancellation")
        );
    }

    #[tokio::test]
    async fn collision_decision_requires_ownership_and_current_revision_then_resumes() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("source.txt"), b"existing contents").unwrap();
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                archive_path,
                destination.clone(),
            )
            .await;

        LocalArchiveOperationCoordinator::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let paused = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase == ArchiveSessionPhase::AwaitingUserDecision {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("archive extraction session should pause for a collision");
        assert_eq!(paused.pending_decision.unwrap().member_path, "source.txt");
        assert!(LocalArchiveOperationCoordinator::new(manager.clone())
            .decide(
                "c",
                "https://sambee.example",
                &session.execution_id,
                paused.revision + 1,
                ArchiveSessionDecision {
                    member_path: "source.txt".to_string(),
                    action: ArchiveSessionDecisionAction::ReplaceOlder,
                    target_path: None
                },
            )
            .await
            .is_err());
        assert!(LocalArchiveOperationCoordinator::new(manager.clone())
            .decide(
                "c",
                "https://other.example",
                &session.execution_id,
                paused.revision,
                ArchiveSessionDecision {
                    member_path: "source.txt".to_string(),
                    action: ArchiveSessionDecisionAction::Skip,
                    target_path: None
                },
            )
            .await
            .is_err());

        let resumed = LocalArchiveOperationCoordinator::new(manager.clone())
            .decide(
                "c",
                "https://sambee.example",
                &session.execution_id,
                paused.revision,
                ArchiveSessionDecision {
                    member_path: "source.txt".to_string(),
                    action: ArchiveSessionDecisionAction::Skip,
                    target_path: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(resumed.phase, ArchiveSessionPhase::Streaming);
        let completed = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("resumed archive extraction should terminate");
        assert_eq!(completed.phase, ArchiveSessionPhase::Completed);
        assert!(matches!(
            completed.result,
            Some(ArchiveSessionProgress::Extraction(progress)) if progress.files_skipped == 1
        ));
        let expected = expected_trace("extract_collision");
        assert_eq!(fs::read(destination.join("source.txt")).unwrap(), b"existing contents");
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &completed, vec!["source.txt"], vec!["source.txt"]).await,
            expected
        );
    }

    #[tokio::test]
    async fn collision_rename_validates_its_target_and_extracts_without_overwriting() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let destination = directory.path().join("output");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("source.txt"), b"existing contents").unwrap();
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                archive_path,
                destination.clone(),
            )
            .await;

        LocalArchiveOperationCoordinator::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let paused = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase == ArchiveSessionPhase::AwaitingUserDecision {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("archive extraction session should pause for a collision");
        assert!(LocalArchiveOperationCoordinator::new(manager.clone())
            .decide(
                "c",
                "https://sambee.example",
                &session.execution_id,
                paused.revision,
                ArchiveSessionDecision {
                    member_path: "source.txt".to_string(),
                    action: ArchiveSessionDecisionAction::Rename,
                    target_path: Some("../outside.txt".to_string())
                },
            )
            .await
            .is_err());

        LocalArchiveOperationCoordinator::new(manager.clone())
            .decide(
                "c",
                "https://sambee.example",
                &session.execution_id,
                paused.revision,
                ArchiveSessionDecision {
                    member_path: "source.txt".to_string(),
                    action: ArchiveSessionDecisionAction::Rename,
                    target_path: Some("renamed.txt".to_string()),
                },
            )
            .await
            .unwrap();
        let completed = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("renamed archive extraction should terminate");
        assert_eq!(completed.phase, ArchiveSessionPhase::Completed);
        assert_eq!(fs::read(destination.join("source.txt")).unwrap(), b"existing contents");
        assert_eq!(fs::read(destination.join("renamed.txt")).unwrap(), b"archive contents");
    }

    #[tokio::test]
    async fn member_error_rejects_collision_actions_and_retries_from_its_checkpoint() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        fs::write(&source, b"archive contents").unwrap();
        let archive_path = directory.path().join("archive.zip");
        let entries = build_local_archive_manifest(&[source], &archive_path).unwrap();
        create_local_archive(directory.path(), &archive_path, &entries, || false).unwrap();
        let original_archive = fs::read(&archive_path).unwrap();
        let content_offset = original_archive
            .windows(b"archive contents".len())
            .position(|window| window == b"archive contents")
            .expect("stored archive member should contain its source bytes");
        let mut corrupted_archive = original_archive.clone();
        corrupted_archive[content_offset] = b'X';
        fs::write(&archive_path, corrupted_archive).unwrap();
        let destination = directory.path().join("output");
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                archive_path.clone(),
                destination.clone(),
            )
            .await;

        LocalArchiveOperationCoordinator::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let paused = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase == ArchiveSessionPhase::AwaitingUserDecision {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("archive extraction session should pause for a member error");
        assert!(
            paused
                .pending_decision
                .as_ref()
                .unwrap()
                .member_error
                .as_ref()
                .unwrap()
                .partial_output
        );
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &paused, vec!["source.txt"], vec![]).await,
            expected_trace("extract_partial_write")
        );
        assert!(LocalArchiveOperationCoordinator::new(manager.clone())
            .decide(
                "c",
                "https://sambee.example",
                &session.execution_id,
                paused.revision,
                ArchiveSessionDecision {
                    member_path: "source.txt".to_string(),
                    action: ArchiveSessionDecisionAction::Skip,
                    target_path: None
                },
            )
            .await
            .is_err());

        fs::write(&archive_path, original_archive).unwrap();
        LocalArchiveOperationCoordinator::new(manager.clone())
            .decide(
                "c",
                "https://sambee.example",
                &session.execution_id,
                paused.revision,
                ArchiveSessionDecision {
                    member_path: "source.txt".to_string(),
                    action: ArchiveSessionDecisionAction::Retry,
                    target_path: None,
                },
            )
            .await
            .unwrap();
        let completed = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("retried archive extraction should terminate");
        assert_eq!(completed.phase, ArchiveSessionPhase::Failed);
        assert_eq!(completed.error.as_deref(), Some("archive source changed since extraction began"));
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &completed, vec!["source.txt"], vec![]).await,
            expected_trace("extract_source_changed")
        );
    }

    #[tokio::test]
    async fn cancellation_transitions_a_paused_session_to_terminal() {
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                PathBuf::from("/drive"),
                PathBuf::from("/drive/archive.zip"),
                PathBuf::from("/drive/output"),
            )
            .await;
        {
            let mut sessions = manager.sessions.lock().await;
            let state = sessions.get_mut(&session.execution_id).unwrap();
            state.phase = ArchiveSessionPhase::AwaitingUserDecision;
            state.revision = 2;
        }

        let cancelled = manager
            .cancel("c", "https://sambee.example", &session.execution_id, 2)
            .await
            .unwrap();
        assert_eq!(cancelled.phase, ArchiveSessionPhase::Cancelled);
        assert!(cancelled.cancellation_requested);
        assert_eq!(cancelled.revision, 3);
    }
}
