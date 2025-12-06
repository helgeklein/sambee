"""
Mobile log management service
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.logging import get_logger
from app.models.logs import MobileLogBatch

logger = get_logger(__name__)


#
# MobileLogManager
#
class MobileLogManager:
    """Manages storage and cleanup of mobile logs"""

    def __init__(self, log_dir: Path):
        """
        Initialize log manager

        Args:
            log_dir: Directory to store log files
        """

        self.log_dir = log_dir
        self.log_dir.mkdir(parents=True, exist_ok=True)

    #
    # write_log_batch
    #
    def write_log_batch(self, batch: MobileLogBatch, metadata: dict | None = None) -> str:
        """
        Write a batch of logs to a JSONL file

        Args:
            batch: Batch of log entries
            metadata: Additional metadata (IP, timestamp, etc)

        Returns:
            Filename of created log file
        """

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"mobile_logs_{timestamp}_{batch.session_id[:8]}.jsonl"
        filepath = self.log_dir / filename

        with open(filepath, "w") as f:
            # Write metadata as first line
            meta_entry = {
                "type": "metadata",
                "session_id": batch.session_id,
                "device_info": batch.device_info,
                "server_timestamp": datetime.now(timezone.utc).isoformat(),
                **(metadata or {}),
            }
            f.write(json.dumps(meta_entry) + "\n")

            # Write each log entry as a line
            for log_entry in batch.logs:
                entry_dict = {
                    "type": "log",
                    **log_entry.model_dump(),
                }
                f.write(json.dumps(entry_dict) + "\n")

        logger.info(f"Wrote mobile log batch: {filename} ({len(batch.logs)} logs)")
        return filename

    #
    # cleanup_old_logs
    #
    def cleanup_old_logs(self, hours: int = 24) -> int:
        """
        Delete log files older than specified hours

        Args:
            hours: Maximum age of log files to keep

        Returns:
            Number of files deleted
        """

        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=hours)
        deleted_count = 0

        for log_file in self.log_dir.glob("mobile_logs_*.jsonl"):
            if log_file.stat().st_mtime < cutoff_time.timestamp():
                log_file.unlink()
                deleted_count += 1

        if deleted_count > 0:
            logger.info(f"Cleaned up old mobile logs: {deleted_count} files deleted")

        return deleted_count

    #
    # list_log_files
    #
    def list_log_files(self) -> list[dict]:
        """
        List all available log files with metadata

        Returns:
            List of dictionaries with filename, size, modified time
        """

        log_files = []
        for log_file in sorted(self.log_dir.glob("mobile_logs_*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
            stat = log_file.stat()
            log_files.append(
                {
                    "filename": log_file.name,
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                }
            )

        return log_files
