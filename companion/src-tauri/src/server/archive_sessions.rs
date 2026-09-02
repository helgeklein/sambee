//! Short-lived lifecycle state for Companion-owned local archive executions.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use uuid::Uuid;

use super::archive::{
    ArchiveCreationManifestState, LocalArchiveCreationExecutionPlan, LocalArchiveCreationResult, LocalArchiveEntry, LocalArchiveError,
    LocalArchiveExtractionDestinationResult, LocalArchiveExtractionDestinationStatus, LocalArchiveExtractionMemberError,
    LocalArchiveExtractionResult, LocalArchiveReadEntry, LocalArchiveReader, LocalArchiveTargetWritePolicy,
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

/// One explicit source-owned phase for a retained local ZIP extraction reader.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LiveLocalArchiveSourcePhase {
    Ready,
    Current,
    StreamingCurrent,
    AwaitingResult,
    AwaitingDecision,
    Completed,
    Failed,
    Cancelled,
}

/// One delivery leased to a destination from the retained local ZIP reader.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LiveLocalArchiveSourceMember {
    pub entry: LocalArchiveReadEntry,
    pub delivery_sequence: u64,
}

/// Process-local extraction source state. It is intentionally non-serializable.
pub(crate) struct LiveLocalArchiveSourceSession {
    source_session_id: String,
    reader: LocalArchiveReader,
    phase: LiveLocalArchiveSourcePhase,
    current: Option<LiveLocalArchiveSourceMember>,
    current_target_path: Option<String>,
    current_target_policy: LocalArchiveTargetWritePolicy,
    global_target_policy: LocalArchiveTargetWritePolicy,
    directory_rename_prefixes: Vec<(String, String)>,
    next_delivery_sequence: u64,
    next_decision_revision: u64,
    pending_decision_revision: Option<u64>,
    pending_decision_target_path: Option<String>,
    pending_decision_message: Option<String>,
    pending_member_error: bool,
    aggregate: LocalArchiveExtractionResult,
}

impl LiveLocalArchiveSourceSession {
    pub(crate) fn open(archive_path: &std::path::Path) -> Result<Self, LocalArchiveError> {
        Ok(Self {
            source_session_id: Uuid::new_v4().to_string(),
            reader: LocalArchiveReader::open_pinned(archive_path)?,
            phase: LiveLocalArchiveSourcePhase::Ready,
            current: None,
            current_target_path: None,
            current_target_policy: LocalArchiveTargetWritePolicy::Ask,
            global_target_policy: LocalArchiveTargetWritePolicy::Ask,
            directory_rename_prefixes: Vec::new(),
            next_delivery_sequence: 1,
            next_decision_revision: 1,
            pending_decision_revision: None,
            pending_decision_target_path: None,
            pending_decision_message: None,
            pending_member_error: false,
            aggregate: LocalArchiveExtractionResult::default(),
        })
    }

    pub(crate) fn phase(&self) -> LiveLocalArchiveSourcePhase {
        self.phase
    }

    pub(crate) fn source_session_id(&self) -> &str {
        &self.source_session_id
    }

    pub(crate) fn aggregate(&self) -> LocalArchiveExtractionResult {
        self.aggregate
    }

    pub(crate) fn current(&self) -> Option<&LiveLocalArchiveSourceMember> {
        self.current.as_ref()
    }

    pub(crate) fn current_target_path(&self) -> Result<String, LocalArchiveError> {
        let current = self
            .current
            .as_ref()
            .ok_or_else(|| Self::invalid_state("Archive source member is unavailable"))?;
        if let Some(target_path) = &self.current_target_path {
            return Ok(target_path.clone());
        }
        for (source_prefix, target_prefix) in self.directory_rename_prefixes.iter().rev() {
            if current.entry.path == *source_prefix {
                return Ok(target_prefix.clone());
            }
            if let Some(suffix) = current.entry.path.strip_prefix(&format!("{source_prefix}/")) {
                return Ok(format!("{target_prefix}/{suffix}"));
            }
        }
        Ok(current.entry.path.clone())
    }

    pub(crate) fn current_target_policy(&self) -> LocalArchiveTargetWritePolicy {
        self.current_target_policy
    }

    pub(crate) fn pending_member_error(&self) -> bool {
        self.pending_member_error
    }

    pub(crate) fn pending_decision_revision(&self) -> Option<u64> {
        self.pending_decision_revision
    }

    pub(crate) fn pending_decision_target_path(&self) -> Option<&str> {
        self.pending_decision_target_path.as_deref()
    }

    pub(crate) fn pending_decision_message(&self) -> Option<&str> {
        self.pending_decision_message.as_deref()
    }

    pub(crate) fn set_pending_decision_details(
        &mut self,
        target_path: Option<String>,
        message: Option<String>,
    ) -> Result<(), LocalArchiveError> {
        if self.phase != LiveLocalArchiveSourcePhase::AwaitingDecision {
            return Err(Self::invalid_state("Archive source is not awaiting a decision"));
        }
        self.pending_decision_target_path = target_path;
        self.pending_decision_message = message;
        Ok(())
    }

    pub(crate) fn pause_for_decision(&mut self, delivery_sequence: u64) -> Result<(), LocalArchiveError> {
        self.current_for(delivery_sequence)?;
        if !matches!(
            self.phase,
            LiveLocalArchiveSourcePhase::Current | LiveLocalArchiveSourcePhase::AwaitingResult
        ) {
            return Err(Self::invalid_state("Archive source member cannot await a decision"));
        }
        self.pending_member_error = false;
        self.pending_decision_target_path = None;
        self.pending_decision_message = None;
        self.pending_decision_revision = Some(self.next_decision_revision);
        self.next_decision_revision = self
            .next_decision_revision
            .checked_add(1)
            .ok_or_else(|| Self::invalid_state("Archive decision revision overflowed"))?;
        self.phase = LiveLocalArchiveSourcePhase::AwaitingDecision;
        Ok(())
    }

    pub(crate) fn pause_for_member_error(&mut self, delivery_sequence: u64) -> Result<(), LocalArchiveError> {
        self.pause_for_decision(delivery_sequence)?;
        self.pending_member_error = true;
        Ok(())
    }

    pub(crate) fn resolve_collision(
        &mut self,
        action: ArchiveSessionDecisionAction,
        target_path: Option<&str>,
    ) -> Result<(), LocalArchiveError> {
        if self.phase != LiveLocalArchiveSourcePhase::AwaitingDecision {
            return Err(Self::invalid_state("Archive source is not awaiting a collision decision"));
        }
        if self.pending_member_error {
            return Err(Self::invalid_state("Archive source is awaiting a member error decision"));
        }
        let (member_path, is_directory) = self
            .current
            .as_ref()
            .map(|current| (current.entry.path.clone(), current.entry.is_directory))
            .ok_or_else(|| Self::invalid_state("Archive source member is unavailable"))?;
        match action {
            ArchiveSessionDecisionAction::Skip => self.current_target_policy = LocalArchiveTargetWritePolicy::Skip,
            ArchiveSessionDecisionAction::SkipAll => {
                self.global_target_policy = LocalArchiveTargetWritePolicy::Skip;
                self.current_target_policy = LocalArchiveTargetWritePolicy::Skip;
            }
            ArchiveSessionDecisionAction::Replace => self.current_target_policy = LocalArchiveTargetWritePolicy::Replace,
            ArchiveSessionDecisionAction::ReplaceAll => {
                self.global_target_policy = LocalArchiveTargetWritePolicy::Replace;
                self.current_target_policy = LocalArchiveTargetWritePolicy::Replace;
            }
            ArchiveSessionDecisionAction::ReplaceOlder => {
                self.global_target_policy = LocalArchiveTargetWritePolicy::ReplaceOlder;
                self.current_target_policy = LocalArchiveTargetWritePolicy::ReplaceOlder;
            }
            ArchiveSessionDecisionAction::Rename => {
                let target_path = target_path.ok_or_else(|| Self::invalid_state("Archive rename target is unavailable"))?;
                super::archive::validate_local_extraction_member_path(target_path, is_directory)?;
                let target_path = target_path.trim_end_matches('/').to_string();
                if is_directory {
                    self.directory_rename_prefixes.push((member_path, target_path.clone()));
                }
                self.current_target_path = Some(target_path);
                self.current_target_policy = LocalArchiveTargetWritePolicy::Ask;
            }
            ArchiveSessionDecisionAction::Retry | ArchiveSessionDecisionAction::Ignore => {
                return Err(Self::invalid_state("Archive decision is not valid for a collision"));
            }
        }
        self.redeliver_current()
    }

    pub(crate) fn resolve_member_error(&mut self, action: ArchiveSessionDecisionAction) -> Result<(), LocalArchiveError> {
        if self.phase != LiveLocalArchiveSourcePhase::AwaitingDecision {
            return Err(Self::invalid_state("Archive source is not awaiting a member error decision"));
        }
        if !self.pending_member_error {
            return Err(Self::invalid_state("Archive source is awaiting a collision decision"));
        }
        match action {
            ArchiveSessionDecisionAction::Retry => self.redeliver_current(),
            ArchiveSessionDecisionAction::Ignore => {
                self.record_skipped()?;
                self.current = None;
                self.current_target_path = None;
                self.current_target_policy = self.global_target_policy;
                self.pending_decision_revision = None;
                self.pending_decision_target_path = None;
                self.pending_decision_message = None;
                self.pending_member_error = false;
                self.phase = LiveLocalArchiveSourcePhase::Ready;
                Ok(())
            }
            _ => Err(Self::invalid_state("Archive decision is not valid for a member error")),
        }
    }

    /// Advance the central-directory reader only after the preceding member is terminal.
    pub(crate) fn next_member(&mut self) -> Result<Option<LiveLocalArchiveSourceMember>, LocalArchiveError> {
        if self.phase != LiveLocalArchiveSourcePhase::Ready {
            return Err(Self::invalid_state("Archive source is not ready for the next member"));
        }
        loop {
            let Some(entry) = self.reader.next_entry()? else {
                self.phase = LiveLocalArchiveSourcePhase::Completed;
                return Ok(None);
            };
            if !entry.is_safe || !entry.has_supported_file_type {
                self.record_source_terminal(false)?;
                continue;
            }
            if entry.encrypted || !matches!(entry.compression_method, 0 | 8 | 12) {
                self.record_source_terminal(true)?;
                continue;
            }
            let delivery_sequence = self.next_delivery_sequence;
            self.next_delivery_sequence = self
                .next_delivery_sequence
                .checked_add(1)
                .ok_or_else(|| Self::invalid_state("Archive member delivery sequence overflowed"))?;
            let member = LiveLocalArchiveSourceMember { entry, delivery_sequence };
            self.current = Some(member.clone());
            self.current_target_path = None;
            self.current_target_policy = self.global_target_policy;
            self.pending_decision_revision = None;
            self.pending_decision_target_path = None;
            self.pending_decision_message = None;
            self.pending_member_error = false;
            self.phase = LiveLocalArchiveSourcePhase::Current;
            return Ok(Some(member));
        }
    }

    pub(crate) fn mark_directory_delivery_ready(&mut self, delivery_sequence: u64) -> Result<(), LocalArchiveError> {
        let current = self.current_for(delivery_sequence)?;
        if !current.entry.is_directory || self.phase != LiveLocalArchiveSourcePhase::Current {
            return Err(Self::invalid_state("Archive source directory delivery is invalid"));
        }
        self.mark_destination_result_ready(delivery_sequence)
    }

    /// Allow a destination to return a source-content-independent result, such as a collision skip.
    pub(crate) fn mark_destination_result_ready(&mut self, delivery_sequence: u64) -> Result<(), LocalArchiveError> {
        self.current_for(delivery_sequence)?;
        if self.phase != LiveLocalArchiveSourcePhase::Current {
            return Err(Self::invalid_state("Archive source member is not ready for a destination result"));
        }
        self.phase = LiveLocalArchiveSourcePhase::AwaitingResult;
        Ok(())
    }

    /// Stream the current regular member from the pinned source and verify it before accepting a destination result.
    pub(crate) fn stream_current_member(
        &mut self,
        delivery_sequence: u64,
        output: &mut impl std::io::Write,
    ) -> Result<(), LocalArchiveError> {
        let current = self.current_for(delivery_sequence)?.clone();
        if current.entry.is_directory || self.phase != LiveLocalArchiveSourcePhase::Current {
            return Err(Self::invalid_state("Archive source member is not ready to stream"));
        }
        self.phase = LiveLocalArchiveSourcePhase::StreamingCurrent;
        match self.reader.stream_entry(current.entry, output) {
            Ok(()) => {
                self.phase = LiveLocalArchiveSourcePhase::AwaitingResult;
                Ok(())
            }
            Err(error) => {
                self.phase = LiveLocalArchiveSourcePhase::AwaitingResult;
                Err(error.into())
            }
        }
    }

    /// Accept one transient destination outcome after source streaming completed successfully.
    pub(crate) fn apply_destination_result(
        &mut self,
        delivery_sequence: u64,
        result: &LocalArchiveExtractionDestinationResult,
    ) -> Result<(), LocalArchiveError> {
        let current = self.current_for(delivery_sequence)?;
        if self.phase != LiveLocalArchiveSourcePhase::AwaitingResult || current.entry.path != result.member_path {
            return Err(Self::invalid_state("Archive destination result does not match the current member"));
        }
        match result.status {
            LocalArchiveExtractionDestinationStatus::Directory => {
                if !current.entry.is_directory || result.extracted_bytes != 0 {
                    return Err(Self::invalid_state("Archive directory result is invalid"));
                }
                self.record_completed(result)?;
            }
            LocalArchiveExtractionDestinationStatus::Extracted => {
                if current.entry.is_directory || result.extracted_bytes != current.entry.uncompressed_size {
                    return Err(Self::invalid_state("Archive file result is invalid"));
                }
                self.record_completed(result)?;
            }
            LocalArchiveExtractionDestinationStatus::Skipped | LocalArchiveExtractionDestinationStatus::Ignored => {
                self.record_skipped()?;
            }
        }
        self.current = None;
        self.current_target_path = None;
        self.current_target_policy = self.global_target_policy;
        self.pending_decision_revision = None;
        self.pending_decision_target_path = None;
        self.pending_decision_message = None;
        self.pending_member_error = false;
        self.phase = LiveLocalArchiveSourcePhase::Ready;
        Ok(())
    }

    /// End the source session without inventing a member outcome after an unknown destination result.
    pub(crate) fn destination_outcome_unknown(&mut self, delivery_sequence: u64) -> Result<(), LocalArchiveError> {
        self.current_for(delivery_sequence)?;
        if !matches!(
            self.phase,
            LiveLocalArchiveSourcePhase::Current
                | LiveLocalArchiveSourcePhase::StreamingCurrent
                | LiveLocalArchiveSourcePhase::AwaitingResult
        ) {
            return Err(Self::invalid_state("Archive source has no dispatched destination write"));
        }
        self.phase = LiveLocalArchiveSourcePhase::Failed;
        Ok(())
    }

    /// Record one confirmed destination failure for the known current member and end the source session.
    pub(crate) fn fail_current_member(&mut self, delivery_sequence: u64) -> Result<(), LocalArchiveError> {
        self.current_for(delivery_sequence)?;
        if self.phase != LiveLocalArchiveSourcePhase::AwaitingResult {
            return Err(Self::invalid_state("Archive source is not awaiting a destination result"));
        }
        self.record_source_terminal(false)?;
        self.current = None;
        self.phase = LiveLocalArchiveSourcePhase::Failed;
        Ok(())
    }

    /// Stop the retained source without fabricating an unconfirmed member outcome.
    pub(crate) fn abort(&mut self) {
        self.phase = LiveLocalArchiveSourcePhase::Failed;
    }

    fn current_for(&self, delivery_sequence: u64) -> Result<&LiveLocalArchiveSourceMember, LocalArchiveError> {
        self.current
            .as_ref()
            .filter(|current| current.delivery_sequence == delivery_sequence)
            .ok_or_else(|| Self::invalid_state("Archive source delivery is stale or unavailable"))
    }

    fn redeliver_current(&mut self) -> Result<(), LocalArchiveError> {
        let current = self
            .current
            .as_mut()
            .ok_or_else(|| Self::invalid_state("Archive source member is unavailable"))?;
        current.delivery_sequence = self.next_delivery_sequence;
        self.next_delivery_sequence = self
            .next_delivery_sequence
            .checked_add(1)
            .ok_or_else(|| Self::invalid_state("Archive member delivery sequence overflowed"))?;
        self.pending_decision_revision = None;
        self.pending_decision_target_path = None;
        self.pending_decision_message = None;
        self.phase = LiveLocalArchiveSourcePhase::Current;
        Ok(())
    }

    fn record_source_terminal(&mut self, skipped: bool) -> Result<(), LocalArchiveError> {
        self.aggregate.members_processed = Self::checked_increment(self.aggregate.members_processed, "Archive member count overflowed")?;
        if skipped {
            self.aggregate.members_skipped =
                Self::checked_increment(self.aggregate.members_skipped, "Archive skipped member count overflowed")?;
            self.aggregate.files_skipped = Self::checked_increment(self.aggregate.files_skipped, "Archive skipped file count overflowed")?;
        } else {
            self.aggregate.members_failed =
                Self::checked_increment(self.aggregate.members_failed, "Archive failed member count overflowed")?;
            self.aggregate.files_failed = Self::checked_increment(self.aggregate.files_failed, "Archive failed file count overflowed")?;
        }
        Ok(())
    }

    fn record_completed(&mut self, result: &LocalArchiveExtractionDestinationResult) -> Result<(), LocalArchiveError> {
        self.aggregate.members_processed = Self::checked_increment(self.aggregate.members_processed, "Archive member count overflowed")?;
        self.aggregate.members_completed =
            Self::checked_increment(self.aggregate.members_completed, "Archive completed member count overflowed")?;
        self.aggregate.directories_created = Self::checked_add(
            self.aggregate.directories_created,
            result.directories_created,
            "Archive directory count overflowed",
        )?;
        if result.status == LocalArchiveExtractionDestinationStatus::Directory {
            return Ok(());
        }
        self.aggregate.files_extracted =
            Self::checked_increment(self.aggregate.files_extracted, "Archive extracted file count overflowed")?;
        self.aggregate.extracted_bytes = Self::checked_add(
            self.aggregate.extracted_bytes,
            result.extracted_bytes,
            "Archive extracted byte count overflowed",
        )?;
        if result.replaced {
            self.aggregate.files_replaced = Self::checked_increment(self.aggregate.files_replaced, "Archive replacement count overflowed")?;
        }
        Ok(())
    }

    fn record_skipped(&mut self) -> Result<(), LocalArchiveError> {
        self.aggregate.members_processed = Self::checked_increment(self.aggregate.members_processed, "Archive member count overflowed")?;
        self.aggregate.members_skipped =
            Self::checked_increment(self.aggregate.members_skipped, "Archive skipped member count overflowed")?;
        self.aggregate.files_skipped = Self::checked_increment(self.aggregate.files_skipped, "Archive skipped file count overflowed")?;
        Ok(())
    }

    fn checked_increment(value: u64, message: &str) -> Result<u64, LocalArchiveError> {
        Self::checked_add(value, 1, message)
    }

    fn checked_add(value: u64, increment: u64, message: &str) -> Result<u64, LocalArchiveError> {
        value.checked_add(increment).ok_or_else(|| Self::invalid_state(message))
    }

    fn invalid_state(message: &str) -> LocalArchiveError {
        LocalArchiveError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, message))
    }
}

#[derive(Clone)]
pub struct ArchiveSessionDecision {
    pub member_path: String,
    pub action: ArchiveSessionDecisionAction,
    pub target_path: Option<String>,
}

pub(crate) struct ArchiveSessionDecisionState {
    pub phase: ArchiveSessionPhase,
    pub revision: u64,
    pub pending_decision: Option<ArchiveSessionPendingDecision>,
}

pub(crate) enum ArchiveSessionCompletion {
    ExtractionCompletedLive {
        result: LocalArchiveExtractionResult,
    },
    AwaitingLiveCollision {
        result: LocalArchiveExtractionResult,
        pending_decision: ArchiveSessionPendingDecision,
    },
    CreationCompleted {
        result: LocalArchiveCreationResult,
        state: ArchiveCreationManifestState,
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
    pub total_members: Option<u64>,
    pub total_bytes: Option<u64>,
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
                members_processed: 0,
                members_completed: 0,
                members_skipped: 0,
                members_failed: 0,
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
    live_extraction: Option<Arc<Mutex<LiveLocalArchiveSourceSession>>>,
    cancellation_requested: Arc<AtomicBool>,
    progress: ArchiveSessionProgress,
    result: Option<ArchiveSessionProgress>,
    error: Option<String>,
    pending_decision: Option<ArchiveSessionPendingDecision>,
    expires_at: Option<Instant>,
}

impl ArchiveSession {
    fn totals(&self) -> Option<(u64, u64)> {
        match self.kind {
            ArchiveSessionKind::Create => self.creation_manifest_entries.as_ref().map(|entries| {
                (
                    entries.len() as u64,
                    entries.iter().fold(0_u64, |total, entry| total.saturating_add(entry.source_size)),
                )
            }),
            ArchiveSessionKind::Extract => None,
        }
    }

    fn status(&self) -> ArchiveSessionStatus {
        let (total_members, total_bytes) = self.totals().map_or((None, None), |(members, bytes)| (Some(members), Some(bytes)));
        ArchiveSessionStatus {
            execution_id: self.execution_id.clone(),
            contract_version: self.contract_version,
            kind: self.kind,
            phase: self.phase,
            revision: self.revision,
            cancellation_requested: self.cancellation_requested.load(Ordering::Acquire),
            progress: self.progress,
            total_members,
            total_bytes,
            result: self.result,
            error: self.error.clone(),
            pending_decision: self.pending_decision.clone(),
        }
    }

    fn complete(&mut self, result: Result<ArchiveSessionCompletion, LocalArchiveError>) {
        match result {
            Ok(ArchiveSessionCompletion::ExtractionCompletedLive { result }) => {
                let result = ArchiveSessionProgress::Extraction(result);
                self.progress = result;
                self.phase = ArchiveSessionPhase::Completed;
                self.result = Some(result);
            }
            Ok(ArchiveSessionCompletion::AwaitingLiveCollision { result, pending_decision }) => {
                self.progress = ArchiveSessionProgress::Extraction(result);
                self.pending_decision = Some(pending_decision);
                self.phase = ArchiveSessionPhase::AwaitingUserDecision;
                self.revision += 1;
                return;
            }
            Ok(ArchiveSessionCompletion::CreationCompleted { result, state }) => {
                let result = ArchiveSessionProgress::Creation(result);
                self.creation_state = Some(state);
                self.progress = result;
                self.phase = ArchiveSessionPhase::Completed;
                self.result = Some(result);
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
    relay_live_sources: Mutex<HashMap<String, RelayLiveLocalArchiveSource>>,
    expired_relay_source_ids: Mutex<HashSet<String>>,
    expired_relay_capabilities: Mutex<HashMap<String, ExpiredRelayLiveLocalArchiveSource>>,
    #[cfg(test)]
    phase_transitions: Mutex<HashMap<String, Vec<ArchiveSessionPhase>>>,
    #[cfg(test)]
    pending_decisions: Mutex<HashMap<String, String>>,
}

struct RelayLiveLocalArchiveSource {
    drive: String,
    owner_origin: String,
    archive_path: PathBuf,
    server_url: String,
    operation_token: String,
    source: Arc<Mutex<LiveLocalArchiveSourceSession>>,
    expires_at: Instant,
}

struct ExpiredRelayLiveLocalArchiveSource {
    drive: String,
    owner_origin: String,
    server_url: String,
    operation_token: String,
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
            relay_live_sources: Mutex::new(HashMap::new()),
            expired_relay_source_ids: Mutex::new(HashSet::new()),
            expired_relay_capabilities: Mutex::new(HashMap::new()),
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

    async fn expire_relay_sources(&self) {
        let now = Instant::now();
        let expired_sources = {
            let mut sources = self.relay_live_sources.lock().await;
            let expired_ids = sources
                .iter()
                .filter_map(|(operation_id, source)| (source.expires_at <= now).then(|| operation_id.clone()))
                .collect::<Vec<_>>();
            expired_ids
                .into_iter()
                .filter_map(|operation_id| {
                    sources.remove(&operation_id).map(|source| {
                        (
                            operation_id,
                            ExpiredRelayLiveLocalArchiveSource {
                                drive: source.drive,
                                owner_origin: source.owner_origin,
                                server_url: source.server_url,
                                operation_token: source.operation_token,
                            },
                        )
                    })
                })
                .collect::<Vec<_>>()
        };
        if !expired_sources.is_empty() {
            let mut expired_ids = self.expired_relay_source_ids.lock().await;
            let mut expired_capabilities = self.expired_relay_capabilities.lock().await;
            for (operation_id, source) in expired_sources {
                expired_ids.insert(operation_id.clone());
                expired_capabilities.insert(operation_id, source);
            }
        }
    }

    pub(crate) async fn take_expired_relay_capability(
        &self,
        operation_id: &str,
        drive: &str,
        owner_origin: &str,
    ) -> Option<(String, String)> {
        self.expire_relay_sources().await;
        let mut expired_capabilities = self.expired_relay_capabilities.lock().await;
        let belongs_to_request = expired_capabilities
            .get(operation_id)
            .is_some_and(|source| source.drive == drive && source.owner_origin == owner_origin);
        belongs_to_request
            .then(|| expired_capabilities.remove(operation_id))
            .flatten()
            .map(|source| (source.server_url, source.operation_token))
    }

    /// Open or retrieve the retained local ZIP reader for one mixed relay operation.
    pub(crate) async fn start_relay_live_source(
        &self,
        operation_id: &str,
        drive: &str,
        owner_origin: &str,
        archive_path: PathBuf,
        server_url: &str,
        operation_token: &str,
    ) -> Result<Arc<Mutex<LiveLocalArchiveSourceSession>>, ApiError> {
        self.expire_relay_sources().await;
        if self.expired_relay_source_ids.lock().await.contains(operation_id) {
            return Err(ApiError::conflict_message("Archive relay source expired and cannot be resumed"));
        }
        {
            let mut sources = self.relay_live_sources.lock().await;
            if let Some(existing) = sources.get_mut(operation_id) {
                if existing.drive != drive
                    || existing.owner_origin != owner_origin
                    || existing.archive_path != archive_path
                    || existing.server_url != server_url
                    || existing.operation_token != operation_token
                {
                    return Err(ApiError::Forbidden("Archive relay source does not match its operation".to_string()));
                }
                existing.expires_at = Instant::now() + ARCHIVE_SESSION_TIMEOUT;
                return Ok(existing.source.clone());
            }
        }
        let source_path = archive_path.clone();
        let source = tokio::task::spawn_blocking(move || LiveLocalArchiveSourceSession::open(&source_path))
            .await
            .map_err(|error| ApiError::Internal(format!("Local archive relay source task failed: {error}")))?
            .map_err(|error| ApiError::Internal(error.to_string()))?;
        let source = Arc::new(Mutex::new(source));
        let mut sources = self.relay_live_sources.lock().await;
        if let Some(existing) = sources.get_mut(operation_id) {
            if existing.drive != drive
                || existing.owner_origin != owner_origin
                || existing.archive_path != archive_path
                || existing.server_url != server_url
                || existing.operation_token != operation_token
            {
                return Err(ApiError::Forbidden("Archive relay source does not match its operation".to_string()));
            }
            existing.expires_at = Instant::now() + ARCHIVE_SESSION_TIMEOUT;
            return Ok(existing.source.clone());
        }
        sources.insert(
            operation_id.to_string(),
            RelayLiveLocalArchiveSource {
                drive: drive.to_string(),
                owner_origin: owner_origin.to_string(),
                archive_path,
                server_url: server_url.to_string(),
                operation_token: operation_token.to_string(),
                source: source.clone(),
                expires_at: Instant::now() + ARCHIVE_SESSION_TIMEOUT,
            },
        );
        Ok(source)
    }

    pub(crate) async fn remove_relay_live_source(&self, operation_id: &str) {
        self.relay_live_sources.lock().await.remove(operation_id);
    }

    pub(crate) async fn relay_live_source(
        &self,
        operation_id: &str,
        drive: &str,
        owner_origin: &str,
    ) -> Result<Arc<Mutex<LiveLocalArchiveSourceSession>>, ApiError> {
        self.expire_relay_sources().await;
        let mut sources = self.relay_live_sources.lock().await;
        let source = sources
            .get_mut(operation_id)
            .filter(|source| source.drive == drive && source.owner_origin == owner_origin)
            .ok_or_else(|| ApiError::NotFound("Archive relay source not found or expired".to_string()))?;
        source.expires_at = Instant::now() + ARCHIVE_SESSION_TIMEOUT;
        Ok(source.source.clone())
    }

    pub(crate) async fn relay_live_capability(
        &self,
        operation_id: &str,
        drive: &str,
        owner_origin: &str,
    ) -> Result<(String, String), ApiError> {
        self.expire_relay_sources().await;
        self.relay_live_sources
            .lock()
            .await
            .get(operation_id)
            .filter(|source| source.drive == drive && source.owner_origin == owner_origin)
            .map(|source| (source.server_url.clone(), source.operation_token.clone()))
            .ok_or_else(|| ApiError::NotFound("Archive relay source not found or expired".to_string()))
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
            None,
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
            live_extraction: None,
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

    pub(crate) async fn start_state(&self, execution_id: &str) -> Result<(PathBuf, ArchiveSessionWork, Arc<AtomicBool>, ()), ApiError> {
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
                (),
            )
        };
        #[cfg(test)]
        self.record_phase_transition(execution_id, ArchiveSessionPhase::Streaming).await;
        Ok((drive_root, work, cancellation_requested, checkpoint))
    }

    /// Open and retain a local archive source outside the manager mutex, then start its live session.
    pub(crate) async fn start_live_extraction(
        &self,
        execution_id: &str,
    ) -> Result<
        (
            PathBuf,
            PathBuf,
            PathBuf,
            Arc<AtomicBool>,
            Arc<Mutex<LiveLocalArchiveSourceSession>>,
        ),
        ApiError,
    > {
        let archive_path = {
            let mut sessions = self.sessions.lock().await;
            Self::remove_expired(&mut sessions);
            let session = sessions
                .get_mut(execution_id)
                .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
            if session.kind != ArchiveSessionKind::Extract || session.phase != ArchiveSessionPhase::Accepted {
                return Err(ApiError::conflict_message("Archive execution has already started"));
            }
            let ArchiveSessionWork::Extraction { archive_path, .. } = &session.work else {
                return Err(ApiError::conflict_message("Archive execution is not an extraction operation"));
            };
            let archive_path = archive_path.clone();
            session.phase = ArchiveSessionPhase::Streaming;
            session.revision += 1;
            archive_path
        };
        #[cfg(test)]
        self.record_phase_transition(execution_id, ArchiveSessionPhase::Streaming).await;
        let source = tokio::task::spawn_blocking(move || LiveLocalArchiveSourceSession::open(&archive_path))
            .await
            .map_err(|error| ApiError::Internal(format!("Local archive source task failed: {error}")))?
            .map_err(|error| ApiError::Internal(error.to_string()))?;
        let source = Arc::new(Mutex::new(source));
        let (drive_root, archive_path, destination_path, cancellation_requested) = {
            let mut sessions = self.sessions.lock().await;
            Self::remove_expired(&mut sessions);
            let session = sessions
                .get_mut(execution_id)
                .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
            if session.kind != ArchiveSessionKind::Extract || session.phase != ArchiveSessionPhase::Streaming {
                return Err(ApiError::conflict_message("Archive execution is no longer accepting a live source"));
            }
            let ArchiveSessionWork::Extraction {
                archive_path,
                destination_path,
            } = &session.work
            else {
                return Err(ApiError::conflict_message("Archive execution is not an extraction operation"));
            };
            session.live_extraction = Some(source.clone());
            (
                session.drive_root.clone(),
                archive_path.clone(),
                destination_path.clone(),
                session.cancellation_requested.clone(),
            )
        };
        Ok((drive_root, archive_path, destination_path, cancellation_requested, source))
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
        Ok(ArchiveSessionDecisionState {
            phase: session.phase,
            revision: session.revision,
            pending_decision: session.pending_decision.clone(),
        })
    }

    pub(crate) async fn resume_live_extraction(
        &self,
        drive: &str,
        owner_origin: &str,
        execution_id: &str,
        expected_revision: u64,
        decision: ArchiveSessionDecision,
    ) -> Result<
        (
            PathBuf,
            PathBuf,
            Arc<AtomicBool>,
            Arc<Mutex<LiveLocalArchiveSourceSession>>,
            ArchiveSessionStatus,
        ),
        ApiError,
    > {
        let (drive_root, destination_path, cancellation_requested, source) = {
            let mut sessions = self.sessions.lock().await;
            Self::remove_expired(&mut sessions);
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
            let pending = session
                .pending_decision
                .as_ref()
                .ok_or_else(|| ApiError::Internal("Archive extraction decision details are unavailable".to_string()))?;
            if pending.member_path != decision.member_path || pending.member_error.is_some() {
                return Err(ApiError::conflict_message("Archive decision does not match the pending member"));
            }
            let source = session
                .live_extraction
                .clone()
                .ok_or_else(|| ApiError::Internal("Live archive extraction source is unavailable".to_string()))?;
            let ArchiveSessionWork::Extraction { destination_path, .. } = &session.work else {
                return Err(ApiError::conflict_message("Archive execution is not an extraction operation"));
            };
            (
                session.drive_root.clone(),
                destination_path.clone(),
                session.cancellation_requested.clone(),
                source,
            )
        };
        source
            .lock()
            .await
            .resolve_collision(decision.action, decision.target_path.as_deref())
            .map_err(|error| ApiError::BadRequest(error.to_string()))?;
        let status = {
            let mut sessions = self.sessions.lock().await;
            let session = sessions
                .get_mut(execution_id)
                .filter(|session| session.drive == drive && session.owner_origin == owner_origin)
                .ok_or_else(|| ApiError::NotFound("Archive execution not found or expired".to_string()))?;
            if session.revision != expected_revision || session.phase != ArchiveSessionPhase::AwaitingUserDecision {
                return Err(ApiError::conflict_message(
                    "Archive execution changed before the decision could be applied",
                ));
            }
            session.pending_decision = None;
            session.phase = ArchiveSessionPhase::Streaming;
            session.revision += 1;
            session.status()
        };
        #[cfg(test)]
        self.record_phase_transition(execution_id, ArchiveSessionPhase::Streaming).await;
        Ok((drive_root, destination_path, cancellation_requested, source, status))
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
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::{Duration, SystemTime};

    use tempfile::tempdir;

    use super::{
        ArchiveSessionDecision, ArchiveSessionDecisionAction, ArchiveSessionManager, ArchiveSessionPhase, ArchiveSessionProgress,
        FixtureDirectLocalInvocation, LiveLocalArchiveSourcePhase, LiveLocalArchiveSourceSession,
    };
    use crate::server::archive::{
        build_local_archive_manifest, create_local_archive, LocalArchiveExtractionDestinationResult,
        LocalArchiveExtractionDestinationStatus,
    };
    use zip::write::{SimpleFileOptions, ZipWriter};

    fn set_test_file_modified_time(path: &Path, modified_at: SystemTime) {
        fs::OpenOptions::new()
            .write(true)
            .open(path)
            .expect("test file should open for timestamp updates")
            .set_times(fs::FileTimes::new().set_modified(modified_at))
            .expect("test file timestamp should be set");
    }

    fn is_transport_failure(error: &str) -> bool {
        let normalized = error.to_ascii_lowercase();
        [
            "no such file or directory",
            "the system cannot find the file specified",
            "access is denied",
            "permission denied",
        ]
        .iter()
        .any(|message| normalized.contains(message))
    }

    fn expected_trace(case_name: &str) -> serde_json::Value {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
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
                    } else if status.error.as_deref().is_some_and(is_transport_failure) {
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
        let topology_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
        .expect("topology trace fixture should be valid JSON");
        let trace_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-trajectory-traces-v2.json"
        ))
        .expect("trajectory trace fixture should be valid JSON");
        assert_eq!(trace_fixture["version"], 2);
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
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-trajectory-traces-v2.json"
        ))
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

    #[test]
    fn live_source_session_requires_verified_stream_before_accepting_results() {
        let directory = tempdir().unwrap();
        let archive_path = directory.path().join("archive.zip");
        let mut archive = ZipWriter::new(fs::File::create(&archive_path).unwrap());
        archive.start_file("first.txt", SimpleFileOptions::default()).unwrap();
        archive.write_all(b"first").unwrap();
        archive.start_file("second.txt", SimpleFileOptions::default()).unwrap();
        archive.write_all(b"second").unwrap();
        archive.finish().unwrap();

        let mut source = LiveLocalArchiveSourceSession::open(&archive_path).unwrap();
        let first = source.next_member().unwrap().unwrap();
        assert_eq!(first.entry.path, "first.txt");
        assert_eq!(first.delivery_sequence, 1);
        let first_result = LocalArchiveExtractionDestinationResult {
            member_path: first.entry.path.clone(),
            status: LocalArchiveExtractionDestinationStatus::Extracted,
            target_path: "first.txt".to_string(),
            extracted_bytes: first.entry.uncompressed_size,
            directories_created: 0,
            replaced: false,
            renamed: false,
        };
        assert!(source.apply_destination_result(first.delivery_sequence, &first_result).is_err());

        let mut contents = Vec::new();
        source.stream_current_member(first.delivery_sequence, &mut contents).unwrap();
        assert_eq!(contents, b"first");
        source.apply_destination_result(first.delivery_sequence, &first_result).unwrap();

        let second = source.next_member().unwrap().unwrap();
        assert_eq!(second.entry.path, "second.txt");
        assert_eq!(second.delivery_sequence, 2);
        let aggregate = source.aggregate();
        assert_eq!(aggregate.members_processed, 1);
        assert_eq!(aggregate.members_completed, 1);
        assert_eq!(aggregate.members_skipped, 0);
        assert_eq!(aggregate.members_failed, 0);
        assert_eq!(source.phase(), LiveLocalArchiveSourcePhase::Current);
    }

    #[test]
    fn aborting_a_live_source_does_not_replay_or_count_its_current_member() {
        let directory = tempdir().unwrap();
        let archive_path = directory.path().join("archive.zip");
        let mut archive = ZipWriter::new(fs::File::create(&archive_path).unwrap());
        archive.start_file("entry.txt", SimpleFileOptions::default()).unwrap();
        archive.write_all(b"entry").unwrap();
        archive.finish().unwrap();

        let mut source = LiveLocalArchiveSourceSession::open(&archive_path).unwrap();
        let member = source.next_member().unwrap().unwrap();
        source.abort();

        assert_eq!(source.phase(), LiveLocalArchiveSourcePhase::Failed);
        assert!(source.next_member().is_err());
        let aggregate = source.aggregate();
        assert_eq!(aggregate.members_processed, 0);
        assert_eq!(aggregate.members_completed, 0);
        assert_eq!(aggregate.members_skipped, 0);
        assert_eq!(aggregate.members_failed, 0);
        assert_eq!(member.delivery_sequence, 1);
    }

    #[cfg(any())]
    #[tokio::test]
    async fn local_to_local_trajectory_matrix_dispatches_actual_coordinator() {
        let creation_corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/creation-trajectory-scenarios-v2.json"
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
            "../../../../archive-contract/v2/fixtures/extraction-trajectory-scenarios-v2.json"
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
                    set_test_file_modified_time(&archive_path, session_source_modified_at);
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
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
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
                "extract_partial_write" | "extract_source_changed" => wait_for_terminal_session(&manager, &session.execution_id).await,
                _ => wait_for_terminal_session(&manager, &session.execution_id).await,
            };
            if matches!(case_name, "extract_partial_write" | "extract_source_changed") {
                assert_eq!(
                    status.phase,
                    ArchiveSessionPhase::Failed,
                    "{case_name} must terminalize without retry"
                );
                assert!(status.result.is_none());
                continue;
            }
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
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../archive-contract/v2/fixtures/topology-execution-traces-v2.json"
        ))
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

    #[cfg(any())]
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
