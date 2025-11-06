"""
Debug script to test SMB path construction
"""

from app.storage.smb import SMBBackend

# Test path construction
backend = SMBBackend(
    host="fs1.ad.internal",
    share_name="data",
    username="test",
    password="test",
    port=445,
)

test_paths = [
    "",
    "Album",
    "Album/SubFolder",
    "/Album",
    "/Album/SubFolder",
    "Album\\SubFolder",  # Test backslash
]

print("Testing _build_smb_path:")
for path in test_paths:
    smb_path = backend._build_smb_path(path)
    print(f"  '{path}' -> '{smb_path}'")
