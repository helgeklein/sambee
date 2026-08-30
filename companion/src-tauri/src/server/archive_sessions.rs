//! Short-lived lifecycle state for Companion-owned local archive executions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use uuid::Uuid;

use super::archive::{
    ArchiveCreationManifestState, LocalArchiveCreationExecutionPlan, LocalArchiveCreationResult, LocalArchiveEntry, LocalArchiveError,
    LocalArchiveExtractionCheckpoint, LocalArchiveExtractionCollision, LocalArchiveExtractionExecutionPlan,
    LocalArchiveExtractionMemberError, LocalArchiveExtractionResult,
};
use super::errors::ApiError;
use super::models::ArchiveContractVersion;

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

pub(crate) struct ArchiveSessionDecisionState {
    pub phase: ArchiveSessionPhase,
    pub revision: u64,
    pub pending_decision: Option<ArchiveSessionPendingDecision>,
    pub archive_path: Option<PathBuf>,
    pub checkpoint: Option<LocalArchiveExtractionCheckpoint>,
}

pub(crate) enum ArchiveSessionCompletion {
    ExtractionCompleted {
        result: LocalArchiveExtractionResult,
        checkpoint: LocalArchiveExtractionCheckpoint,
    },
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
    pub contract_version: ArchiveContractVersion,
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
pub(crate) enum ArchiveSessionWork {
    Creation { source_paths: Vec<PathBuf>, target_path: PathBuf },
    Extraction { archive_path: PathBuf, destination_path: PathBuf },
}

pub(crate) struct PreparedLocalArchiveCreation {
    pub source_paths: Vec<PathBuf>,
    pub target_path: PathBuf,
    pub entries: Vec<LocalArchiveEntry>,
    pub execution_plan: LocalArchiveCreationExecutionPlan,
}

#[cfg(test)]
#[derive(Clone)]
pub(crate) enum CreationPreWriteAction {
    RemoveFirstSource,
    ModifyFirstSource,
    Cancel,
}

#[cfg(test)]
impl CreationPreWriteAction {
    pub(crate) fn apply(self, source_paths: &[PathBuf], cancellation_requested: &AtomicBool) -> Result<(), LocalArchiveError> {
        if matches!(self, Self::Cancel) {
            cancellation_requested.store(true, Ordering::Release);
            return Ok(());
        }
        let source_path = source_paths.first().ok_or(LocalArchiveError::UnsupportedSource)?;
        match self {
            Self::RemoveFirstSource => std::fs::remove_file(source_path).map_err(LocalArchiveError::Io),
            Self::ModifyFirstSource => std::fs::write(source_path, b"changed source").map_err(LocalArchiveError::Io),
            Self::Cancel => unreachable!("cancellation action returns above"),
        }
    }
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
    contract_version: ArchiveContractVersion,
    drive: String,
    owner_origin: String,
    kind: ArchiveSessionKind,
    phase: ArchiveSessionPhase,
    revision: u64,
    drive_root: PathBuf,
    work: ArchiveSessionWork,
    creation_plan: Option<LocalArchiveCreationExecutionPlan>,
    creation_manifest_entries: Option<Vec<LocalArchiveEntry>>,
    creation_state: Option<ArchiveCreationManifestState>,
    extraction_plan: Option<LocalArchiveExtractionExecutionPlan>,
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
            contract_version: self.contract_version,
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
            Ok(ArchiveSessionCompletion::ExtractionCompleted { result, checkpoint }) => {
                let result = ArchiveSessionProgress::Extraction(result);
                self.extraction_checkpoint = Some(checkpoint);
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

/// Test-only compatibility executor for direct-local archive session coverage.
#[cfg(test)]
pub struct FixtureDirectLocalInvocation {
    state_store: Arc<ArchiveSessionManager>,
}

#[cfg(test)]
impl FixtureDirectLocalInvocation {
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

    #[cfg(test)]
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
            None,
            None,
        )
        .await
    }

    pub async fn create_prepared_extraction(
        &self,
        drive: String,
        owner_origin: String,
        drive_root: PathBuf,
        archive_path: PathBuf,
        destination_path: PathBuf,
        execution_plan: LocalArchiveExtractionExecutionPlan,
    ) -> ArchiveSessionStatus {
        self.create(
            drive,
            owner_origin,
            drive_root,
            ArchiveSessionWork::Extraction {
                archive_path,
                destination_path,
            },
            None,
            Some(execution_plan),
        )
        .await
    }

    #[cfg(test)]
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
            None,
            None,
        )
        .await
    }

    pub async fn create_prepared_creation(
        &self,
        drive: String,
        owner_origin: String,
        drive_root: PathBuf,
        prepared: PreparedLocalArchiveCreation,
    ) -> ArchiveSessionStatus {
        self.create(
            drive,
            owner_origin,
            drive_root,
            ArchiveSessionWork::Creation {
                source_paths: prepared.source_paths,
                target_path: prepared.target_path,
            },
            Some((prepared.entries, prepared.execution_plan)),
            None,
        )
        .await
    }

    async fn create(
        &self,
        drive: String,
        owner_origin: String,
        drive_root: PathBuf,
        work: ArchiveSessionWork,
        creation_plan: Option<(Vec<LocalArchiveEntry>, LocalArchiveCreationExecutionPlan)>,
        extraction_plan: Option<LocalArchiveExtractionExecutionPlan>,
    ) -> ArchiveSessionStatus {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        let execution_id = Uuid::new_v4().to_string();
        let session = ArchiveSession {
            execution_id: execution_id.clone(),
            contract_version: ArchiveContractVersion::V2,
            drive,
            owner_origin,
            kind: work.kind(),
            phase: ArchiveSessionPhase::Accepted,
            revision: 0,
            drive_root,
            progress: work.initial_progress(),
            work,
            creation_plan: creation_plan.as_ref().map(|(_, plan)| plan.clone()),
            creation_manifest_entries: creation_plan.map(|(entries, _)| entries),
            creation_state: None,
            extraction_plan,
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

    /// Read an in-memory session only when it is pinned to the V2 contract.
    pub async fn get_v2(&self, drive: &str, owner_origin: &str, execution_id: &str) -> Result<ArchiveSessionStatus, ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        sessions
            .get(execution_id)
            .filter(|session| {
                session.drive == drive && session.owner_origin == owner_origin && session.contract_version == ArchiveContractVersion::V2
            })
            .map(ArchiveSession::status)
            .ok_or_else(|| ApiError::NotFound("Archive V2 execution not found or expired".to_string()))
    }

    #[cfg(test)]
    pub(crate) async fn session_kind(&self, execution_id: &str) -> Result<ArchiveSessionKind, ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        sessions
            .get(execution_id)
            .map(|session| session.kind)
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))
    }

    pub(crate) async fn direct_local_creation_plan(
        &self,
        execution_id: &str,
    ) -> Result<Option<(Vec<LocalArchiveEntry>, LocalArchiveCreationExecutionPlan)>, ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        sessions
            .get(execution_id)
            .map(|session| session.creation_manifest_entries.clone().zip(session.creation_plan.clone()))
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))
    }

    pub(crate) async fn direct_local_creation_work(&self, execution_id: &str) -> Result<(PathBuf, Vec<PathBuf>, PathBuf), ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        let session = sessions
            .get(execution_id)
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
        let ArchiveSessionWork::Creation { source_paths, target_path } = &session.work else {
            return Err(ApiError::conflict_message("Archive execution is not a creation operation"));
        };
        Ok((session.drive_root.clone(), source_paths.clone(), target_path.clone()))
    }

    pub(crate) async fn direct_local_extraction_plan(
        &self,
        execution_id: &str,
    ) -> Result<Option<LocalArchiveExtractionExecutionPlan>, ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        sessions
            .get(execution_id)
            .map(|session| session.extraction_plan.clone())
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))
    }

    pub(crate) async fn direct_local_extraction_work(&self, execution_id: &str) -> Result<(PathBuf, PathBuf, PathBuf), ApiError> {
        let mut sessions = self.sessions.lock().await;
        Self::remove_expired(&mut sessions);
        let session = sessions
            .get(execution_id)
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
        let ArchiveSessionWork::Extraction {
            archive_path,
            destination_path,
        } = &session.work
        else {
            return Err(ApiError::conflict_message("Archive execution is not an extraction operation"));
        };
        Ok((session.drive_root.clone(), archive_path.clone(), destination_path.clone()))
    }

    pub(crate) async fn start_state(
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

impl ArchiveSessionManager {
    pub(crate) async fn decision_state(
        &self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
    ) -> Result<ArchiveSessionDecisionState, ApiError> {
        let mut sessions = self.sessions.lock().await;
        ArchiveSessionManager::remove_expired(&mut sessions);
        let session = sessions
            .get(execution_id)
            .filter(|session| session.drive == drive && session.owner_origin == owner_origin)
            .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
        let archive_path = match &session.work {
            ArchiveSessionWork::Extraction { archive_path, .. } => Some(archive_path.clone()),
            ArchiveSessionWork::Creation { .. } => None,
        };
        Ok(ArchiveSessionDecisionState {
            phase: session.phase,
            revision: session.revision,
            pending_decision: session.pending_decision.clone(),
            archive_path,
            checkpoint: session.extraction_checkpoint.clone(),
        })
    }

    pub(crate) async fn resume_extraction(
        &self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
        expected_revision: u64,
    ) -> Result<(PathBuf, ArchiveSessionWork, Arc<AtomicBool>, ArchiveSessionStatus), ApiError> {
        let (drive_root, work, cancellation_requested, status) = {
            let mut sessions = self.sessions.lock().await;
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
            session.pending_decision = None;
            session.extraction_checkpoint = None;
            session.phase = ArchiveSessionPhase::Streaming;
            session.revision += 1;
            (
                session.drive_root.clone(),
                session.work.clone(),
                session.cancellation_requested.clone(),
                session.status(),
            )
        };
        #[cfg(test)]
        self.record_phase_transition(execution_id, ArchiveSessionPhase::Streaming).await;
        Ok((drive_root, work, cancellation_requested, status))
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

    pub(crate) async fn complete(&self, execution_id: &str, result: Result<ArchiveSessionCompletion, LocalArchiveError>) {
        let mut sessions = self.sessions.lock().await;
        let _phase = if let Some(session) = sessions.get_mut(execution_id) {
            if let Ok(completion) = result.as_ref() {
                let checkpoint = match completion {
                    ArchiveSessionCompletion::ExtractionCompleted { checkpoint, .. }
                    | ArchiveSessionCompletion::AwaitingCollision { checkpoint, .. }
                    | ArchiveSessionCompletion::AwaitingMemberError { checkpoint, .. } => Some(checkpoint),
                    ArchiveSessionCompletion::CreationCompleted { .. } => None,
                };
                if let Some(checkpoint) = checkpoint {
                    session.extraction_plan = match session.extraction_plan.as_ref() {
                        Some(plan) => plan.with_checkpoint(checkpoint.clone()).ok(),
                        None => checkpoint.execution_plan().ok(),
                    };
                }
            }
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

    pub(crate) async fn record_creation_plan(
        &self,
        execution_id: &str,
        entries: Vec<LocalArchiveEntry>,
        execution_plan: LocalArchiveCreationExecutionPlan,
    ) {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(execution_id) {
            session.creation_manifest_entries = Some(entries);
            session.creation_plan = Some(execution_plan);
        }
    }

    pub(crate) async fn update_progress(&self, execution_id: &str, progress: ArchiveSessionProgress) {
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

#[cfg(test)]
impl FixtureDirectLocalInvocation {
    pub async fn start(&self, execution_id: &str) -> Result<(), ApiError> {
        crate::server::handlers::start_direct_local_archive_session(self.state_store.clone(), execution_id).await
    }

    #[cfg(test)]
    async fn start_with_creation_pre_write_action(&self, execution_id: &str, action: CreationPreWriteAction) -> Result<(), ApiError> {
        crate::server::handlers::start_direct_local_archive_session_with_creation_pre_write_action(
            self.state_store.clone(),
            execution_id,
            action,
        )
        .await
    }

    pub async fn decide(
        &self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
        expected_revision: u64,
        decision: ArchiveSessionDecision,
    ) -> Result<ArchiveSessionStatus, ApiError> {
        crate::server::handlers::decide_direct_local_archive_session(
            self.state_store.clone(),
            drive,
            owner_origin,
            execution_id,
            expected_revision,
            decision,
        )
        .await
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
        FixtureDirectLocalInvocation,
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
                ArchiveSessionPhase::Failed => serde_json::Value::String(
                    if status.error.as_deref().is_some_and(|error| error.contains("source changed")) {
                        "source_changed"
                    } else if status.error.as_deref().is_some_and(|error| error.contains("partial output")) {
                        "partial_write"
                    } else if status.error.as_deref().is_some_and(|error| error.contains("output already exists")) {
                        "collision"
                    } else if status.error.as_deref().is_some_and(|error| error.contains("No such file or directory")) {
                        "transport_failure"
                    } else {
                        "invalid_input"
                    }
                    .to_string(),
                ),
                ArchiveSessionPhase::AwaitingUserDecision if status.pending_decision.as_ref().is_some_and(|decision| decision.member_error.is_some()) => {
                    serde_json::Value::String("partial_write".to_string())
                }
                _ => serde_json::Value::Null,
            },
        })
    }

    async fn direct_local_creation_trace(
        manager: &ArchiveSessionManager,
        execution_id: &str,
        status: &super::ArchiveSessionStatus,
    ) -> serde_json::Value {
        let (manifest_snapshot, member_outcomes) = {
            let sessions = manager.sessions.lock().await;
            let session = sessions
                .get(execution_id)
                .expect("creation session should remain available while its trace is read");
            let mut manifest_snapshot = session
                .creation_manifest_entries
                .as_ref()
                .map(|entries| entries.iter().map(|entry| entry.archive_path.clone()).collect::<Vec<_>>())
                .unwrap_or_default();
            let mut member_outcomes = session
                .creation_state
                .as_ref()
                .map(|state| state.completed_member_paths().map(str::to_owned).collect::<Vec<_>>())
                .unwrap_or_default();
            manifest_snapshot.sort();
            member_outcomes.sort();
            (manifest_snapshot, member_outcomes)
        };
        direct_local_trace(
            manager,
            execution_id,
            status,
            manifest_snapshot.iter().map(String::as_str).collect(),
            member_outcomes.iter().map(String::as_str).collect(),
        )
        .await
    }

    fn local_trajectory_scenario_names(operation: &str) -> Vec<String> {
        let topology_fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-execution-traces-v1.json"))
                .expect("topology trace fixture should be valid JSON");
        let trace_fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-trajectory-traces-v1.json"))
                .expect("trajectory trace fixture should be valid JSON");
        assert_eq!(trace_fixture["version"], 1);
        assert_eq!(trace_fixture["trace_fields"], topology_fixture["trace_fields"]);
        let declared = topology_fixture["trajectory_cases"]
            .as_array()
            .expect("topology trace fixture should define trajectory cases")
            .iter()
            .filter(|case| case["operation"] == operation && case["topology"] == "local_to_local")
            .map(|case| {
                case["scenario"]
                    .as_str()
                    .expect("trajectory case should name a scenario")
                    .to_string()
            })
            .collect::<std::collections::HashSet<_>>();
        let dispatched = trace_fixture["cases"]
            .as_array()
            .expect("trajectory trace fixture should define cases")
            .iter()
            .filter(|case| case["operation"] == operation && case["topology"] == "local_to_local")
            .map(|case| {
                case["scenario"]
                    .as_str()
                    .expect("trajectory trace case should name a scenario")
                    .to_string()
            })
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            dispatched, declared,
            "local trajectory fixture coverage must match the dispatcher corpus"
        );
        let mut scenarios = dispatched.into_iter().collect::<Vec<_>>();
        scenarios.sort();
        scenarios
    }

    fn expected_local_trajectory_trace(operation: &str, scenario_name: &str) -> serde_json::Value {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-trajectory-traces-v1.json"))
                .expect("trajectory trace fixture should be valid JSON");
        fixture["cases"]
            .as_array()
            .expect("trajectory trace fixture should define cases")
            .iter()
            .find(|case| case["operation"] == operation && case["topology"] == "local_to_local" && case["scenario"] == scenario_name)
            .unwrap_or_else(|| panic!("trajectory trace fixture should define {operation}/local_to_local/{scenario_name}"))
            ["expected_trace"]
            .clone()
    }

    async fn wait_for_terminal_session(manager: &ArchiveSessionManager, execution_id: &str) -> super::ArchiveSessionStatus {
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("local archive session should terminate")
    }

    async fn wait_for_pending_decision(manager: &ArchiveSessionManager, execution_id: &str) -> super::ArchiveSessionStatus {
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", execution_id).await.unwrap();
                if status.phase == ArchiveSessionPhase::AwaitingUserDecision {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("local archive session should pause for a decision")
    }

    fn terminal_phase(name: &str) -> ArchiveSessionPhase {
        match name {
            "completed" => ArchiveSessionPhase::Completed,
            "cancelled" => ArchiveSessionPhase::Cancelled,
            _ => panic!("unsupported corpus terminal phase {name}"),
        }
    }

    fn decision_action(name: &str) -> ArchiveSessionDecisionAction {
        match name {
            "rename" => ArchiveSessionDecisionAction::Rename,
            "skip" => ArchiveSessionDecisionAction::Skip,
            "replace" => ArchiveSessionDecisionAction::Replace,
            "replace_older" => ArchiveSessionDecisionAction::ReplaceOlder,
            "retry" => ArchiveSessionDecisionAction::Retry,
            "ignore" => ArchiveSessionDecisionAction::Ignore,
            _ => panic!("unsupported corpus decision action {name}"),
        }
    }

    #[tokio::test]
    async fn local_to_local_trajectory_matrix_dispatches_actual_coordinator() {
        let creation_corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v1/creation-trajectory-scenarios-v1.json"
        ))
        .expect("creation trajectory corpus should be valid JSON");
        for scenario_name in local_trajectory_scenario_names("create") {
            let expected_trace = expected_local_trajectory_trace("create", &scenario_name);
            let scenario = creation_corpus["scenarios"]
                .as_array()
                .expect("creation corpus should define scenarios")
                .iter()
                .find(|scenario| scenario["name"] == scenario_name)
                .unwrap_or_else(|| panic!("creation corpus should define {scenario_name}"));
            let directory = tempdir().unwrap();
            let source_root = directory.path().join("source");
            fs::create_dir(&source_root).unwrap();
            let mut source_paths = Vec::new();
            for entry in scenario["entries"].as_array().unwrap() {
                let archive_path = entry["archive_path"].as_str().unwrap();
                let path = source_root.join(archive_path);
                if entry["is_directory"].as_bool().unwrap() {
                    fs::create_dir_all(&path).unwrap();
                } else {
                    fs::create_dir_all(path.parent().unwrap()).unwrap();
                    fs::write(&path, vec![b'x'; entry["source_size"].as_u64().unwrap() as usize]).unwrap();
                }
                let top_level = archive_path.split('/').next().unwrap();
                let top_level_path = source_root.join(top_level);
                if !source_paths.contains(&top_level_path) {
                    source_paths.push(top_level_path);
                }
            }
            let target = source_root.join("archive.zip");
            let manager = Arc::new(ArchiveSessionManager::new());
            let session = manager
                .create_creation(
                    "c".to_string(),
                    "https://sambee.example".to_string(),
                    source_root,
                    source_paths,
                    target.clone(),
                )
                .await;
            if scenario["steps"].as_array().unwrap().iter().any(|step| step["event"] == "cancel") {
                manager
                    .cancel("c", "https://sambee.example", &session.execution_id, session.revision)
                    .await
                    .unwrap();
            }
            FixtureDirectLocalInvocation::new(manager.clone())
                .start(&session.execution_id)
                .await
                .unwrap();
            let status = wait_for_terminal_session(&manager, &session.execution_id).await;
            assert_eq!(status.phase, terminal_phase(scenario["terminal_phase"].as_str().unwrap()));
            let progress = scenario["progress"].as_object().unwrap();
            if status.phase == ArchiveSessionPhase::Completed {
                assert!(matches!(
                    status.result,
                    Some(ArchiveSessionProgress::Creation(result))
                        if result.files_created == progress["files_created"].as_u64().unwrap()
                            && result.directories_created == progress["directories_created"].as_u64().unwrap()
                            && result.source_bytes == progress["source_bytes"].as_u64().unwrap()
                ));
            } else {
                assert!(status.result.is_none());
            }
            let sessions = manager.sessions.lock().await;
            let expected_members = scenario["completed_members"]
                .as_array()
                .unwrap()
                .iter()
                .map(|member| member.as_str().unwrap())
                .collect::<std::collections::HashSet<_>>();
            let completed_members = sessions
                .get(&session.execution_id)
                .and_then(|session| session.creation_state.as_ref())
                .map(|state| {
                    let mut manifest_snapshot = state.manifest_member_paths().map(str::to_string).collect::<Vec<_>>();
                    let mut member_outcomes = state.completed_member_paths().map(str::to_string).collect::<Vec<_>>();
                    manifest_snapshot.sort();
                    member_outcomes.sort();
                    (manifest_snapshot, member_outcomes)
                })
                .unwrap_or_default();
            assert_eq!(
                completed_members
                    .1
                    .iter()
                    .map(String::as_str)
                    .collect::<std::collections::HashSet<_>>(),
                expected_members
            );
            drop(sessions);
            assert_eq!(
                direct_local_trace(
                    &manager,
                    &session.execution_id,
                    &status,
                    completed_members.0.iter().map(String::as_str).collect(),
                    completed_members.1.iter().map(String::as_str).collect(),
                )
                .await,
                expected_trace,
                "creation trajectory {scenario_name}"
            );
            assert_eq!(target.exists(), status.phase == ArchiveSessionPhase::Completed);
        }

        let extraction_corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v1/extraction-trajectory-scenarios-v1.json"
        ))
        .expect("extraction trajectory corpus should be valid JSON");
        for scenario_name in local_trajectory_scenario_names("extract") {
            let expected_trace = expected_local_trajectory_trace("extract", &scenario_name);
            let scenario = extraction_corpus["scenarios"]
                .as_array()
                .expect("extraction corpus should define scenarios")
                .iter()
                .find(|scenario| scenario["name"] == scenario_name)
                .unwrap_or_else(|| panic!("extraction corpus should define {scenario_name}"));
            let directory = tempdir().unwrap();
            let source_root = directory.path().join("source");
            fs::create_dir(&source_root).unwrap();
            let mut source_paths = Vec::new();
            for member in scenario["members"].as_array().unwrap() {
                let member_path = member.as_str().unwrap();
                let path = source_root.join(member_path);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                let bytes = match member_path {
                    "renamed.txt" => vec![b'r'; 4],
                    "replaced.txt" => vec![b'p'; 5],
                    _ => vec![b's'; 5],
                };
                fs::write(&path, bytes).unwrap();
                let top_level = member_path.split('/').next().unwrap();
                let top_level_path = source_root.join(top_level);
                if !source_paths.contains(&top_level_path) {
                    source_paths.push(top_level_path);
                }
            }
            let archive_path = source_root.join("archive.zip");
            let entries = build_local_archive_manifest(&source_paths, &archive_path).unwrap();
            create_local_archive(&source_root, &archive_path, &entries, || false).unwrap();
            let destination = directory.path().join("output");
            if scenario_name == "collision_decisions_resume_to_terminal_summary" {
                for member in scenario["members"].as_array().unwrap() {
                    let path = destination.join(member.as_str().unwrap());
                    fs::create_dir_all(path.parent().unwrap()).unwrap();
                    fs::write(path, b"existing").unwrap();
                }
            }
            let original_archive = fs::read(&archive_path).unwrap();
            if scenario_name.starts_with("partial_write") {
                let offset = original_archive
                    .windows(5)
                    .position(|window| window == b"sssss")
                    .expect("stored archive member should contain its source bytes");
                let mut corrupted_archive = original_archive.clone();
                corrupted_archive[offset] = b'X';
                fs::write(&archive_path, corrupted_archive).unwrap();
            }
            let session_source_modified_at = fs::metadata(&archive_path).unwrap().modified().unwrap();
            let manager = Arc::new(ArchiveSessionManager::new());
            let session = manager
                .create_extraction(
                    "c".to_string(),
                    "https://sambee.example".to_string(),
                    directory.path().to_path_buf(),
                    archive_path.clone(),
                    destination,
                )
                .await;
            if scenario["steps"].as_array().unwrap().iter().any(|step| step["event"] == "cancel") {
                manager
                    .cancel("c", "https://sambee.example", &session.execution_id, session.revision)
                    .await
                    .unwrap();
            }
            let coordinator = FixtureDirectLocalInvocation::new(manager.clone());
            coordinator.start(&session.execution_id).await.unwrap();
            for step in scenario["steps"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|step| step["event"] == "decision")
            {
                let paused = wait_for_pending_decision(&manager, &session.execution_id).await;
                if step["action"] == "retry" {
                    fs::write(&archive_path, &original_archive).unwrap();
                    fs::File::open(&archive_path)
                        .unwrap()
                        .set_times(std::fs::FileTimes::new().set_modified(session_source_modified_at))
                        .unwrap();
                }
                coordinator
                    .decide(
                        "c",
                        "https://sambee.example",
                        &session.execution_id,
                        paused.revision,
                        ArchiveSessionDecision {
                            member_path: step["member_path"].as_str().unwrap().to_string(),
                            action: decision_action(step["action"].as_str().unwrap()),
                            target_path: step["target_path"].as_str().map(str::to_string),
                        },
                    )
                    .await
                    .unwrap();
            }
            let status = wait_for_terminal_session(&manager, &session.execution_id).await;
            assert_eq!(
                status.phase,
                terminal_phase(scenario["terminal_phase"].as_str().unwrap()),
                "scenario {scenario_name} failed with {:?}",
                status.error
            );
            let progress = scenario["progress"].as_object().unwrap();
            if status.phase == ArchiveSessionPhase::Completed {
                let ArchiveSessionProgress::Extraction(result) = status.result.expect("extraction corpus case should have a result") else {
                    panic!("extraction corpus case should retain an extraction result");
                };
                assert_eq!(
                    (
                        result.files_extracted,
                        result.files_skipped,
                        result.files_replaced,
                        result.extracted_bytes,
                    ),
                    (
                        progress["files_extracted"].as_u64().unwrap(),
                        progress["files_skipped"].as_u64().unwrap(),
                        progress["files_replaced"].as_u64().unwrap(),
                        progress["extracted_bytes"].as_u64().unwrap(),
                    ),
                    "scenario {scenario_name} returned {result:?}"
                );
            } else {
                assert!(status.result.is_none());
            }
            let expected_members = scenario["completed_members"]
                .as_array()
                .unwrap()
                .iter()
                .map(|member| member.as_str().unwrap().to_string())
                .collect::<std::collections::HashSet<_>>();
            let sessions = manager.sessions.lock().await;
            let completed_members = sessions
                .get(&session.execution_id)
                .and_then(|session| session.extraction_checkpoint.as_ref())
                .map(|checkpoint| {
                    let mut manifest_snapshot = checkpoint.manifest_member_paths().map(str::to_string).collect::<Vec<_>>();
                    let mut member_outcomes = checkpoint.completed_member_paths().map(str::to_string).collect::<Vec<_>>();
                    manifest_snapshot.sort();
                    member_outcomes.sort();
                    (manifest_snapshot, member_outcomes)
                })
                .unwrap_or_default();
            assert_eq!(
                completed_members.1.iter().cloned().collect::<std::collections::HashSet<_>>(),
                expected_members
            );
            drop(sessions);
            assert_eq!(
                direct_local_trace(
                    &manager,
                    &session.execution_id,
                    &status,
                    completed_members.0.iter().map(String::as_str).collect(),
                    completed_members.1.iter().map(String::as_str).collect(),
                )
                .await,
                expected_trace,
                "extraction trajectory {scenario_name}"
            );
        }
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

        FixtureDirectLocalInvocation::new(manager.clone())
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

        FixtureDirectLocalInvocation::new(manager.clone())
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
    async fn direct_local_malformed_archive_matches_shared_trace() {
        let directory = tempdir().unwrap();
        let archive_path = directory.path().join("not-an-archive.bin");
        fs::write(&archive_path, b"not a ZIP archive").unwrap();
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                archive_path,
                directory.path().join("output"),
            )
            .await;
        FixtureDirectLocalInvocation::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let failed = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("malformed local archive should terminate");

        assert_eq!(failed.phase, ArchiveSessionPhase::Failed);
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &failed, vec![], vec![]).await,
            expected_trace("extract_local_to_local_malformed_input")
        );
    }

    #[tokio::test]
    async fn direct_local_missing_archive_source_matches_transport_failure_trace() {
        let directory = tempdir().unwrap();
        let manager = Arc::new(ArchiveSessionManager::new());
        let session = manager
            .create_extraction(
                "c".to_string(),
                "https://sambee.example".to_string(),
                directory.path().to_path_buf(),
                directory.path().join("unavailable.zip"),
                directory.path().join("output"),
            )
            .await;
        FixtureDirectLocalInvocation::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let failed = wait_for_terminal_session(&manager, &session.execution_id).await;

        assert_eq!(failed.phase, ArchiveSessionPhase::Failed);
        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &failed, vec![], vec![]).await,
            expected_trace("extract_local_to_local_transport_failure")
        );
    }

    #[tokio::test]
    async fn direct_local_extraction_cancellation_matches_shared_trace() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.txt");
        let archive_path = directory.path().join("archive.zip");
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
                directory.path().join("output"),
            )
            .await;
        manager
            .cancel("c", "https://sambee.example", &session.execution_id, session.revision)
            .await
            .unwrap();
        FixtureDirectLocalInvocation::new(manager.clone())
            .start(&session.execution_id)
            .await
            .unwrap();
        let cancelled = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let status = manager.get("c", "https://sambee.example", &session.execution_id).await.unwrap();
                if status.phase.is_terminal() {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("cancelled local archive extraction should terminate");

        assert_eq!(
            direct_local_trace(&manager, &session.execution_id, &cancelled, vec!["source.txt"], vec![]).await,
            expected_trace("extract_local_to_local_cancellation")
        );
    }

    #[tokio::test]
    async fn direct_local_extraction_faults_dispatch_every_fixture_case() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-execution-traces-v1.json"))
                .expect("topology trace fixture should be valid JSON");
        let declared_cases = fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .filter(|case| case["operation"] == "extract" && case["topology"] == "local_to_local" && case["fault"].is_string())
            .map(|case| case["name"].as_str().expect("fault case must have a name"))
            .collect::<std::collections::HashSet<_>>();
        let dispatched_cases = [
            "extract_collision",
            "extract_local_to_local_malformed_input",
            "extract_local_to_local_cancellation",
            "extract_partial_write",
            "extract_source_changed",
            "extract_local_to_local_transport_failure",
        ]
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            dispatched_cases, declared_cases,
            "direct-local extraction dispatcher must cover every declared fault"
        );

        for case_name in dispatched_cases {
            let directory = tempdir().expect("temporary archive directory should be created");
            let source = directory.path().join("source.txt");
            let archive_path = directory.path().join("archive.zip");
            let destination = directory.path().join("output");
            let requires_valid_archive = !matches!(
                case_name,
                "extract_local_to_local_malformed_input" | "extract_local_to_local_transport_failure"
            );
            let mut original_archive = None;
            if case_name == "extract_local_to_local_malformed_input" {
                fs::write(&archive_path, b"not a ZIP archive").expect("malformed archive fixture should be written");
            } else if requires_valid_archive {
                fs::write(&source, b"archive contents").expect("source fixture should be written");
                let entries =
                    build_local_archive_manifest(std::slice::from_ref(&source), &archive_path).expect("archive manifest should build");
                create_local_archive(directory.path(), &archive_path, &entries, || false).expect("archive fixture should be created");
                if matches!(case_name, "extract_partial_write" | "extract_source_changed") {
                    let original = fs::read(&archive_path).expect("archive fixture should be readable");
                    let offset = original
                        .windows(b"archive contents".len())
                        .position(|window| window == b"archive contents")
                        .expect("stored archive member should contain its source bytes");
                    let mut corrupted = original.clone();
                    corrupted[offset] = b'X';
                    fs::write(&archive_path, corrupted).expect("partial-write fixture should corrupt the archive member");
                    original_archive = Some(original);
                }
                if case_name == "extract_collision" {
                    fs::create_dir(&destination).expect("collision destination should be created");
                    fs::write(destination.join("source.txt"), b"existing contents")
                        .expect("collision destination member should be written");
                }
            }

            let manager = Arc::new(ArchiveSessionManager::new());
            let session = manager
                .create_extraction(
                    "c".to_string(),
                    "https://sambee.example".to_string(),
                    directory.path().to_path_buf(),
                    if case_name == "extract_local_to_local_transport_failure" {
                        directory.path().join("unavailable.zip")
                    } else {
                        archive_path.clone()
                    },
                    destination,
                )
                .await;
            if case_name == "extract_local_to_local_cancellation" {
                manager
                    .cancel("c", "https://sambee.example", &session.execution_id, session.revision)
                    .await
                    .expect("cancellation fixture should request cancellation");
            }
            let coordinator = FixtureDirectLocalInvocation::new(manager.clone());
            coordinator
                .start(&session.execution_id)
                .await
                .expect("extraction fixture should start");
            let status = match case_name {
                "extract_collision" => {
                    let paused = wait_for_pending_decision(&manager, &session.execution_id).await;
                    coordinator
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
                        .expect("collision fixture should accept its skip decision");
                    wait_for_terminal_session(&manager, &session.execution_id).await
                }
                "extract_partial_write" => wait_for_pending_decision(&manager, &session.execution_id).await,
                "extract_source_changed" => {
                    let paused = wait_for_pending_decision(&manager, &session.execution_id).await;
                    fs::write(
                        &archive_path,
                        original_archive
                            .as_ref()
                            .expect("source-change fixture should retain the original archive"),
                    )
                    .expect("source-change fixture should restore the archive");
                    coordinator
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
                        .expect("source-change fixture should accept its retry decision");
                    wait_for_terminal_session(&manager, &session.execution_id).await
                }
                _ => wait_for_terminal_session(&manager, &session.execution_id).await,
            };
            let manifest_snapshot = requires_valid_archive.then_some("source.txt").into_iter().collect::<Vec<_>>();
            let member_outcomes = (case_name == "extract_collision")
                .then_some("source.txt")
                .into_iter()
                .collect::<Vec<_>>();
            assert_eq!(
                direct_local_trace(&manager, &session.execution_id, &status, manifest_snapshot, member_outcomes).await,
                expected_trace(case_name),
                "{case_name} must be traced by the direct-local extraction coordinator"
            );
        }
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
        FixtureDirectLocalInvocation::new(manager.clone())
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
    async fn direct_local_creation_faults_dispatch_every_fixture_case() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../../archive-contract/v1/topology-execution-traces-v1.json"))
                .expect("topology trace fixture should be valid JSON");
        let expected_cases = fixture["cases"]
            .as_array()
            .expect("topology trace fixture should define cases")
            .iter()
            .filter(|case| case["operation"] == "create" && case["topology"] == "local_to_local" && case["fault"].is_string())
            .map(|case| case["name"].as_str().expect("fault case must have a name"))
            .collect::<std::collections::HashSet<_>>();
        let dispatched_cases = [
            "create_local_to_local_malformed_input",
            "create_local_to_local_collision",
            "create_local_to_local_partial_write",
            "create_cancellation",
            "create_local_to_local_source_changed",
            "create_local_to_local_transport_failure",
        ]
        .into_iter()
        .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            dispatched_cases, expected_cases,
            "direct-local creation dispatcher must cover every declared fault"
        );

        for case_name in dispatched_cases {
            let directory = tempdir().expect("temporary archive directory should be created");
            let source = directory.path().join("entry.txt");
            std::fs::write(&source, b"entry").expect("source should be written");
            let target = directory.path().join("archive.zip");
            let manager = Arc::new(ArchiveSessionManager::new());
            let (source_paths, target, action) = match case_name {
                "create_local_to_local_malformed_input" => (vec![PathBuf::new()], target, None),
                "create_local_to_local_collision" => {
                    std::fs::write(&target, b"existing").expect("collision target should be written");
                    (vec![source], target, None)
                }
                "create_local_to_local_partial_write" => (vec![source], target, Some(super::CreationPreWriteAction::RemoveFirstSource)),
                "create_cancellation" => {
                    let source = directory.path().join("source.txt");
                    std::fs::write(&source, b"source").expect("cancellation source should be written");
                    (vec![source], target, Some(super::CreationPreWriteAction::Cancel))
                }
                "create_local_to_local_source_changed" => (vec![source], target, Some(super::CreationPreWriteAction::ModifyFirstSource)),
                "create_local_to_local_transport_failure" => {
                    (vec![source], directory.path().join("missing-parent").join("archive.zip"), None)
                }
                _ => unreachable!("fixture set was asserted above"),
            };
            let session = manager
                .create_creation(
                    "c".to_string(),
                    "https://sambee.example".to_string(),
                    directory.path().to_path_buf(),
                    source_paths,
                    target,
                )
                .await;
            let coordinator = FixtureDirectLocalInvocation::new(manager.clone());
            match action {
                Some(action) => coordinator
                    .start_with_creation_pre_write_action(&session.execution_id, action)
                    .await
                    .expect("creation session should start"),
                None => coordinator
                    .start(&session.execution_id)
                    .await
                    .expect("creation session should start"),
            }
            let status = wait_for_terminal_session(&manager, &session.execution_id).await;
            assert_eq!(
                direct_local_creation_trace(&manager, &session.execution_id, &status).await,
                expected_trace(case_name),
                "{case_name} must be traced by the direct-local session coordinator"
            );
        }
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

        FixtureDirectLocalInvocation::new(manager.clone())
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
        assert!(FixtureDirectLocalInvocation::new(manager.clone())
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
        assert!(FixtureDirectLocalInvocation::new(manager.clone())
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

        let resumed = FixtureDirectLocalInvocation::new(manager.clone())
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

        FixtureDirectLocalInvocation::new(manager.clone())
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
        assert!(FixtureDirectLocalInvocation::new(manager.clone())
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

        FixtureDirectLocalInvocation::new(manager.clone())
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

        FixtureDirectLocalInvocation::new(manager.clone())
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
        assert!(FixtureDirectLocalInvocation::new(manager.clone())
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
        FixtureDirectLocalInvocation::new(manager.clone())
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
