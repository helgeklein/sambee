//! Operation-neutral target-resolution policy.
//!
//! This module performs no filesystem or archive I/O. Callers own target
//! observation and must prove any replacement primitive before enabling it.

use chrono::{DateTime, Utc};
use std::future::Future;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetResolutionPolicy {
    Ask,
    Skip,
    Replace,
    ReplaceOlder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetResolutionDisposition {
    CreateNew,
    ReplaceExisting,
    Skip,
    AwaitCollision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetSnapshot {
    Missing,
    RegularFile { modified_at: Option<DateTime<Utc>> },
    Other,
}

/// Immutable policy inputs for one regular-file target mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentTransferPlan {
    pub source_modified_at: Option<DateTime<Utc>>,
    pub policy: TargetResolutionPolicy,
    pub replacement_supported: bool,
}

/// Result of one fresh, target-owned staging and publication attempt.
#[derive(Debug)]
pub enum TargetMutationAttempt<T> {
    Committed { result: T, replaced: bool },
    TargetExistsBeforeMutation,
}

/// Final policy disposition and factual target-mutation result for one plan.
#[derive(Debug)]
pub struct TargetMutationResolution<T> {
    pub disposition: TargetResolutionDisposition,
    pub target: TargetSnapshot,
    pub result: Option<T>,
    pub replaced: bool,
}

pub fn is_strictly_newer(source_modified_at: Option<DateTime<Utc>>, target_modified_at: Option<DateTime<Utc>>) -> bool {
    matches!((source_modified_at, target_modified_at), (Some(source), Some(target)) if source > target)
}

pub fn resolve_target_mutation(
    policy: TargetResolutionPolicy,
    source_modified_at: Option<DateTime<Utc>>,
    target: TargetSnapshot,
) -> TargetResolutionDisposition {
    match target {
        TargetSnapshot::Missing => TargetResolutionDisposition::CreateNew,
        TargetSnapshot::Other => TargetResolutionDisposition::AwaitCollision,
        TargetSnapshot::RegularFile { modified_at } => match policy {
            TargetResolutionPolicy::Ask => TargetResolutionDisposition::AwaitCollision,
            TargetResolutionPolicy::Skip => TargetResolutionDisposition::Skip,
            TargetResolutionPolicy::Replace => TargetResolutionDisposition::ReplaceExisting,
            TargetResolutionPolicy::ReplaceOlder if is_strictly_newer(source_modified_at, modified_at) => {
                TargetResolutionDisposition::ReplaceExisting
            }
            TargetResolutionPolicy::ReplaceOlder => TargetResolutionDisposition::Skip,
        },
    }
}

/// Run up to two fresh, authorized target mutation attempts.
///
/// The attempt factory is called only for a create or a proven guarded
/// replacement. Each call must acquire a new source reader and an owned stage.
pub async fn resolve_target_mutation_attempt<T, E, Observe, ObserveFuture, Attempt, AttemptFuture>(
    plan: ContentTransferPlan,
    mut observe_target: Observe,
    mut attempt_factory: Attempt,
) -> Result<TargetMutationResolution<T>, E>
where
    Observe: FnMut() -> ObserveFuture,
    ObserveFuture: Future<Output = Result<TargetSnapshot, E>>,
    Attempt: FnMut(TargetResolutionDisposition) -> AttemptFuture,
    AttemptFuture: Future<Output = Result<TargetMutationAttempt<T>, E>>,
{
    for attempt_index in 0..2 {
        let target = observe_target().await?;
        let disposition = resolve_target_mutation(plan.policy, plan.source_modified_at, target);
        if matches!(
            disposition,
            TargetResolutionDisposition::Skip | TargetResolutionDisposition::AwaitCollision
        ) {
            return Ok(TargetMutationResolution {
                disposition,
                target,
                result: None,
                replaced: false,
            });
        }
        if disposition == TargetResolutionDisposition::ReplaceExisting && !plan.replacement_supported {
            return Ok(TargetMutationResolution {
                disposition: TargetResolutionDisposition::AwaitCollision,
                target,
                result: None,
                replaced: false,
            });
        }

        match attempt_factory(disposition).await? {
            TargetMutationAttempt::Committed { result, replaced } => {
                return Ok(TargetMutationResolution {
                    disposition,
                    target,
                    result: Some(result),
                    replaced,
                });
            }
            TargetMutationAttempt::TargetExistsBeforeMutation if attempt_index == 0 => continue,
            TargetMutationAttempt::TargetExistsBeforeMutation => {
                return Ok(TargetMutationResolution {
                    disposition: TargetResolutionDisposition::AwaitCollision,
                    target: observe_target().await?,
                    result: None,
                    replaced: false,
                });
            }
        }
    }
    unreachable!("a regular-file transfer must resolve within two attempts")
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::{
        resolve_target_mutation_attempt, ContentTransferPlan, TargetMutationAttempt, TargetResolutionDisposition, TargetResolutionPolicy,
        TargetSnapshot,
    };

    #[tokio::test]
    async fn controller_retries_once_with_a_fresh_attempt_after_a_late_collision() {
        let observations = Cell::new(0);
        let attempts = Cell::new(0);
        let resolution = resolve_target_mutation_attempt(
            ContentTransferPlan {
                source_modified_at: None,
                policy: TargetResolutionPolicy::Ask,
                replacement_supported: false,
            },
            || {
                observations.set(observations.get() + 1);
                async { Ok::<_, ()>(TargetSnapshot::Missing) }
            },
            |_| {
                attempts.set(attempts.get() + 1);
                let attempt = attempts.get();
                async move {
                    Ok::<_, ()>(if attempt == 1 {
                        TargetMutationAttempt::TargetExistsBeforeMutation
                    } else {
                        TargetMutationAttempt::Committed {
                            result: (),
                            replaced: false,
                        }
                    })
                }
            },
        )
        .await
        .expect("controller should return the second committed attempt");

        assert_eq!(resolution.disposition, TargetResolutionDisposition::CreateNew);
        assert_eq!(observations.get(), 2);
        assert_eq!(attempts.get(), 2);
        assert!(resolution.result.is_some());
    }
}
