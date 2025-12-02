"""
Custom exception classes for clean error handling.

All exceptions inherit from SambeeError to enable centralized handling.
"""


#
# SambeeError
#
class SambeeError(Exception):
    """Base exception for all Sambee application errors."""

    pass


#
# ConfigurationError
#
class ConfigurationError(SambeeError):
    """Raised when configuration is invalid or missing."""

    pass


#
# StorageError
#
class StorageError(SambeeError):
    """Raised when SMB or file system operations fail."""

    pass


#
# ValidationError
#
class ValidationError(SambeeError):
    """Raised when user input validation fails."""

    pass


#
# PreprocessorError
#
class PreprocessorError(SambeeError):
    """Raised when file preprocessing/conversion fails."""

    pass
