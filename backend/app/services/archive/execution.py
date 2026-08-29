"""Language-neutral archive execution topology selection for backend bindings."""

from dataclasses import dataclass
from enum import StrEnum

from app.models.archive_operation import ArchiveOperationKind
from app.services.history_common import LOCAL_DRIVE_PREFIX


class ArchiveExecutionDriver(StrEnum):
    BACKEND = "backend"
    COMPANION = "companion"


class ArchiveCompanionRelayPurpose(StrEnum):
    """Mixed-topology role authorized for one Companion relay capability."""

    LOCAL_ZIP_TO_SMB_EXTRACT = "local_zip_to_smb_extract"
    SMB_ZIP_TO_LOCAL_EXTRACT = "smb_zip_to_local_extract"
    SMB_TO_LOCAL_ZIP_CREATE = "smb_to_local_zip_create"
    LOCAL_TO_SMB_ZIP_CREATE = "local_to_smb_zip_create"

    @property
    def kind(self) -> ArchiveOperationKind:
        return (
            ArchiveOperationKind.EXTRACT
            if self
            in {
                self.LOCAL_ZIP_TO_SMB_EXTRACT,
                self.SMB_ZIP_TO_LOCAL_EXTRACT,
            }
            else ArchiveOperationKind.CREATE
        )

    @property
    def source_is_local(self) -> bool:
        return self in {
            self.LOCAL_ZIP_TO_SMB_EXTRACT,
            self.LOCAL_TO_SMB_ZIP_CREATE,
        }

    @property
    def destination_is_local(self) -> bool:
        return not self.source_is_local


@dataclass(frozen=True)
class ArchiveExecutionTopology:
    """Resolved executor and adapter direction for one immutable operation plan."""

    driver: ArchiveExecutionDriver
    source_is_local: bool
    destination_is_local: bool
    companion_purpose: ArchiveCompanionRelayPurpose | None


@dataclass(frozen=True)
class ArchiveOperationTopologyPlan:
    """Immutable topology selection consumed before an operation coordinator starts."""

    kind: ArchiveOperationKind
    topology: ArchiveExecutionTopology


def resolve_archive_execution_topology(
    *,
    kind: ArchiveOperationKind,
    source_connection_id: str,
    destination_connection_id: str,
) -> ArchiveExecutionTopology:
    """Select one coordinator driver without interpreting source or output paths."""

    source_is_local = source_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    destination_is_local = destination_connection_id.startswith(LOCAL_DRIVE_PREFIX)
    if source_is_local == destination_is_local:
        if source_connection_id != destination_connection_id:
            raise ValueError("Archive execution across distinct same-provider connections is unavailable")
        return ArchiveExecutionTopology(
            driver=ArchiveExecutionDriver.COMPANION if source_is_local else ArchiveExecutionDriver.BACKEND,
            source_is_local=source_is_local,
            destination_is_local=destination_is_local,
            companion_purpose=None,
        )

    purpose = next(
        purpose for purpose in ArchiveCompanionRelayPurpose if purpose.kind == kind and purpose.source_is_local == source_is_local
    )
    return ArchiveExecutionTopology(
        driver=ArchiveExecutionDriver.COMPANION,
        source_is_local=source_is_local,
        destination_is_local=destination_is_local,
        companion_purpose=purpose,
    )


def resolve_archive_operation_topology_plan(
    *,
    kind: ArchiveOperationKind,
    source_connection_id: str,
    destination_connection_id: str,
) -> ArchiveOperationTopologyPlan:
    """Build the single immutable topology decision for an archive operation."""

    return ArchiveOperationTopologyPlan(
        kind=kind,
        topology=resolve_archive_execution_topology(
            kind=kind,
            source_connection_id=source_connection_id,
            destination_connection_id=destination_connection_id,
        ),
    )
