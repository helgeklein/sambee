from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class SystemSettingKey(StrEnum):
    SMB_READ_CHUNK_SIZE_BYTES = "smb.read_chunk_size_bytes"
    PREPROCESSOR_IMAGEMAGICK_MAX_FILE_SIZE_BYTES = "preprocessors.imagemagick.max_file_size_bytes"
    PREPROCESSOR_IMAGEMAGICK_TIMEOUT_SECONDS = "preprocessors.imagemagick.timeout_seconds"
    PREPROCESSOR_GRAPHICSMAGICK_MAX_FILE_SIZE_BYTES = "preprocessors.graphicsmagick.max_file_size_bytes"
    PREPROCESSOR_GRAPHICSMAGICK_TIMEOUT_SECONDS = "preprocessors.graphicsmagick.timeout_seconds"


class SystemSettingSource(StrEnum):
    DATABASE = "database"
    CONFIG_FILE = "config_file"
    DEFAULT = "default"


@dataclass(frozen=True)
class IntegerSystemSettingDefinition:
    key: SystemSettingKey
    config_attr: str
    label: str
    description: str
    default_value: int
    min_value: int
    max_value: int
    step: int


SYSTEM_SETTING_DEFINITIONS: dict[SystemSettingKey, IntegerSystemSettingDefinition] = {
    SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.SMB_READ_CHUNK_SIZE_BYTES,
        config_attr="smb_read_chunk_size_bytes",
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
    SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_MAX_FILE_SIZE_BYTES: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_MAX_FILE_SIZE_BYTES,
        config_attr="preprocessor_graphicsmagick_max_file_size_bytes",
        label="Maximum file size",
        description="Largest input file GraphicsMagick is allowed to preprocess.",
        default_value=100 * 1024 * 1024,
        min_value=1 * 1024 * 1024,
        max_value=1024 * 1024 * 1024,
        step=1 * 1024 * 1024,
    ),
    SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_TIMEOUT_SECONDS: IntegerSystemSettingDefinition(
        key=SystemSettingKey.PREPROCESSOR_GRAPHICSMAGICK_TIMEOUT_SECONDS,
        config_attr="preprocessor_graphicsmagick_timeout_seconds",
        label="Conversion timeout",
        description="Maximum time allowed for a GraphicsMagick preprocessing run.",
        default_value=30,
        min_value=5,
        max_value=600,
        step=1,
    ),
}
