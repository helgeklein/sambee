from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class SystemSettingKey(StrEnum):
    SMB_READ_CHUNK_SIZE_BYTES = "smb.read_chunk_size_bytes"
    SMB_POLICY = "smb.policy"
    PREPROCESSOR_IMAGEMAGICK_MAX_FILE_SIZE_BYTES = "preprocessors.imagemagick.max_file_size_bytes"
    PREPROCESSOR_IMAGEMAGICK_TIMEOUT_SECONDS = "preprocessors.imagemagick.timeout_seconds"
    PDF_VIEWER_CACHE_QUOTA_BYTES = "pdf.viewer.cache_quota_bytes"
    PDF_VIEWER_CACHE_INACTIVITY_TTL_SECONDS = "pdf.viewer.cache_inactivity_ttl_seconds"
    PDF_NORMALIZER_MAX_SOURCE_SIZE_BYTES = "pdf.normalizer.max_source_size_bytes"
    PDF_NORMALIZER_MAX_OUTPUT_SIZE_BYTES = "pdf.normalizer.max_output_size_bytes"
    PDF_NORMALIZER_ADDRESS_SPACE_BYTES = "pdf.normalizer.address_space_bytes"
    PDF_NORMALIZER_TEMPORARY_DISK_BYTES = "pdf.normalizer.temporary_disk_bytes"
    PDF_NORMALIZER_TIMEOUT_SECONDS = "pdf.normalizer.timeout_seconds"
    PDF_NORMALIZER_CPU_TIME_SECONDS = "pdf.normalizer.cpu_time_seconds"
    PDF_NORMALIZER_MAX_CONCURRENT = "pdf.normalizer.max_concurrent"
    PDF_NORMALIZER_QUEUE_WAIT_SECONDS = "pdf.normalizer.queue_wait_seconds"
    PDF_SCREEN_DERIVATIVE_ENABLED = "pdf.screen_derivative.enabled"
    PDF_SCREEN_MAX_DECODED_PIXELS = "pdf.screen_derivative.max_decoded_pixels"
    FILE_SEARCH_POLICY = "file_search.policy"


class SystemSettingSource(StrEnum):
    DATABASE = "database"
    CONFIG_FILE = "config_file"
    DEFAULT = "default"


@dataclass(frozen=True)
class IntegerSystemSettingDefinition:
    key: SystemSettingKey
    config_attr: str | None
    label: str
    description: str
    default_value: int
    min_value: int
    max_value: int
    step: int


SYSTEM_SETTING_DEFINITIONS: dict[SystemSettingKey, IntegerSystemSettingDefinition] = {
    SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES,
        config_attr=None,
        label="SMB read chunk size",
        description="Chunk size used when streaming files from SMB shares.",
        default_value=4 * 1024 * 1024,
        min_value=64 * 1024,
        max_value=16 * 1024 * 1024,
        step=64 * 1024,
    ),
    SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_MAX_FILE_SIZE_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_MAX_FILE_SIZE_BYTES,
        config_attr="preprocessor_imagemagick_max_file_size_bytes",
        label="Maximum file size",
        description="Largest input file ImageMagick is allowed to preprocess.",
        default_value=100 * 1024 * 1024,
        min_value=1 * 1024 * 1024,
        max_value=1024 * 1024 * 1024,
        step=1 * 1024 * 1024,
    ),
    SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_TIMEOUT_SECONDS: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PREPROCESSOR_IMAGEMAGICK_TIMEOUT_SECONDS,
        config_attr="preprocessor_imagemagick_timeout_seconds",
        label="Conversion timeout",
        description="Maximum time allowed for an ImageMagick preprocessing run.",
        default_value=30,
        min_value=5,
        max_value=600,
        step=1,
    ),
    SystemSettingKey.PDF_VIEWER_CACHE_QUOTA_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_VIEWER_CACHE_QUOTA_BYTES,
        config_attr=None,
        label="PDF derivative cache quota",
        description="Maximum local compatibility-derivative storage for each user. Zero disables the cache.",
        default_value=50 * 1024 * 1024,
        min_value=0,
        max_value=1024 * 1024 * 1024,
        step=1024 * 1024,
    ),
    SystemSettingKey.PDF_VIEWER_CACHE_INACTIVITY_TTL_SECONDS: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_VIEWER_CACHE_INACTIVITY_TTL_SECONDS,
        config_attr=None,
        label="PDF derivative cache inactivity TTL",
        description="Delete an unused PDF compatibility derivative after this many seconds.",
        default_value=7 * 24 * 60 * 60,
        min_value=60,
        max_value=90 * 24 * 60 * 60,
        step=60,
    ),
    SystemSettingKey.PDF_NORMALIZER_MAX_SOURCE_SIZE_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_MAX_SOURCE_SIZE_BYTES,
        config_attr=None,
        label="PDF compatibility source-size limit",
        description="Largest source PDF that compatibility processing may read.",
        default_value=250 * 1024 * 1024,
        min_value=1 * 1024 * 1024,
        max_value=2 * 1024 * 1024 * 1024,
        step=1024 * 1024,
    ),
    SystemSettingKey.PDF_NORMALIZER_MAX_OUTPUT_SIZE_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_MAX_OUTPUT_SIZE_BYTES,
        config_attr=None,
        label="PDF compatibility output-size limit",
        description="Largest derivative Ghostscript may write.",
        default_value=512 * 1024 * 1024,
        min_value=1 * 1024 * 1024,
        max_value=2 * 1024 * 1024 * 1024,
        step=1024 * 1024,
    ),
    SystemSettingKey.PDF_NORMALIZER_ADDRESS_SPACE_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_ADDRESS_SPACE_BYTES,
        config_attr=None,
        label="PDF compatibility address-space limit",
        description="Maximum virtual memory available to one Ghostscript compatibility conversion.",
        default_value=512 * 1024 * 1024,
        min_value=128 * 1024 * 1024,
        max_value=8 * 1024 * 1024 * 1024,
        step=64 * 1024 * 1024,
    ),
    SystemSettingKey.PDF_NORMALIZER_TEMPORARY_DISK_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_TEMPORARY_DISK_BYTES,
        config_attr=None,
        label="PDF compatibility temporary-disk limit",
        description="Maximum temporary space reserved for one compatibility conversion input and output.",
        default_value=1024 * 1024 * 1024,
        min_value=128 * 1024 * 1024,
        max_value=8 * 1024 * 1024 * 1024,
        step=64 * 1024 * 1024,
    ),
    SystemSettingKey.PDF_NORMALIZER_TIMEOUT_SECONDS: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_TIMEOUT_SECONDS,
        config_attr=None,
        label="PDF compatibility timeout",
        description="Maximum time allowed for one Ghostscript compatibility conversion.",
        default_value=60,
        min_value=5,
        max_value=600,
        step=1,
    ),
    SystemSettingKey.PDF_NORMALIZER_CPU_TIME_SECONDS: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_CPU_TIME_SECONDS,
        config_attr=None,
        label="PDF compatibility CPU-time limit",
        description="Maximum CPU time allocated to one Ghostscript compatibility conversion.",
        default_value=60,
        min_value=5,
        max_value=600,
        step=1,
    ),
    SystemSettingKey.PDF_NORMALIZER_MAX_CONCURRENT: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_MAX_CONCURRENT,
        config_attr=None,
        label="Concurrent PDF compatibility conversions",
        description="Maximum Ghostscript compatibility conversions running in this backend process.",
        default_value=2,
        min_value=1,
        max_value=16,
        step=1,
    ),
    SystemSettingKey.PDF_NORMALIZER_QUEUE_WAIT_SECONDS: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_NORMALIZER_QUEUE_WAIT_SECONDS,
        config_attr=None,
        label="PDF compatibility queue wait",
        description="Maximum time a compatibility request waits for a Ghostscript slot.",
        default_value=15,
        min_value=0,
        max_value=120,
        step=1,
    ),
    SystemSettingKey.PDF_SCREEN_DERIVATIVE_ENABLED: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_SCREEN_DERIVATIVE_ENABLED,
        config_attr=None,
        label="Enable screen PDF derivatives",
        description="Allow a display-profiled derivative for PDFs with oversized image placements. Zero keeps the feature disabled.",
        default_value=0,
        min_value=0,
        max_value=1,
        step=1,
    ),
    SystemSettingKey.PDF_SCREEN_MAX_DECODED_PIXELS: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PDF_SCREEN_MAX_DECODED_PIXELS,
        config_attr=None,
        label="Screen derivative decoded-pixel budget",
        description="Image decoded-pixel budget before a display-profiled screen derivative is considered.",
        default_value=64 * 1024 * 1024,
        min_value=4 * 1024 * 1024,
        max_value=1024 * 1024 * 1024,
        step=1024 * 1024,
    ),
}
