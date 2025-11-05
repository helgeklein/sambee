#!/usr/bin/env python3
"""
Test script for SMB change notification monitoring.
Tests that the FileSystemWatcher properly detects changes.
"""

import time

from smbprotocol.change_notify import (
    ChangeNotifyFlags,
    CompletionFilter,
    FileSystemWatcher,
)
from smbprotocol.connection import Connection
from smbprotocol.open import (
    CreateDisposition,
    CreateOptions,
    DirectoryAccessMask,
    FileAttributes,
    ImpersonationLevel,
    Open,
    ShareAccess,
)
from smbprotocol.session import Session
from smbprotocol.tree import TreeConnect

# Test configuration - update these with your actual SMB server details
TEST_HOST = "your-smb-server"
TEST_SHARE = "your-share"
TEST_USERNAME = "your-username"
TEST_PASSWORD = "your-password"
TEST_PORT = 445
TEST_PATH = ""  # Root of share, or specific directory like "testdir"


def test_change_notification():
    """Test that SMB change notifications work."""
    print(f"Connecting to SMB: //{TEST_HOST}/{TEST_SHARE}")

    # Establish connection
    connection = Connection(guid=None, server_name=TEST_HOST, port=TEST_PORT)
    connection.connect()
    print("✅ Connection established")

    # Create session
    session = Session(connection, username=TEST_USERNAME, password=TEST_PASSWORD)
    session.connect()
    print("✅ Session created")

    # Connect to tree (share)
    tree = TreeConnect(session, rf"\\{TEST_HOST}\{TEST_SHARE}")
    tree.connect()
    print("✅ Tree connected")

    # Open directory for monitoring
    windows_path = TEST_PATH.replace("/", "\\") if TEST_PATH else ""
    open_handle = Open(tree, windows_path)
    open_handle.create(
        impersonation_level=ImpersonationLevel.Impersonation,
        desired_access=DirectoryAccessMask.FILE_LIST_DIRECTORY
        | DirectoryAccessMask.SYNCHRONIZE,
        file_attributes=FileAttributes.FILE_ATTRIBUTE_DIRECTORY,
        share_access=ShareAccess.FILE_SHARE_READ
        | ShareAccess.FILE_SHARE_WRITE
        | ShareAccess.FILE_SHARE_DELETE,
        create_disposition=CreateDisposition.FILE_OPEN,
        create_options=CreateOptions.FILE_DIRECTORY_FILE,
    )
    print(f"✅ Directory opened: {TEST_PATH or '(root)'}")

    # Create watcher
    watcher = FileSystemWatcher(open_handle)
    print("✅ FileSystemWatcher created")

    # Start watching
    completion_filter = (
        CompletionFilter.FILE_NOTIFY_CHANGE_FILE_NAME
        | CompletionFilter.FILE_NOTIFY_CHANGE_DIR_NAME
        | CompletionFilter.FILE_NOTIFY_CHANGE_SIZE
        | CompletionFilter.FILE_NOTIFY_CHANGE_LAST_WRITE
    )

    flags = ChangeNotifyFlags.SMB2_WATCH_TREE

    print("\n" + "=" * 60)
    print("🔍 Watching for changes...")
    print(f"   Monitoring: //{TEST_HOST}/{TEST_SHARE}/{TEST_PATH}")
    print("   - Create/delete files or directories")
    print("   - Modify files")
    print("   - Rename items")
    print("   Waiting for changes (Ctrl+C to stop)...")
    print("=" * 60 + "\n")

    try:
        while True:
            # Start watching (blocks until change occurs)
            watcher.start(
                completion_filter=completion_filter,
                flags=flags,
                output_buffer_length=4096,
                send=True,
            )

            # Wait for response
            result = watcher.wait()

            if result:
                print(f"\n🔔 CHANGE DETECTED at {time.strftime('%Y-%m-%d %H:%M:%S')}")
                print("-" * 60)
                for action_info in result:
                    action = action_info["action"].get_value()
                    filename = action_info["file_name"].get_value()
                    action_names = {
                        1: "ADDED",
                        2: "REMOVED",
                        3: "MODIFIED",
                        4: "RENAMED_OLD",
                        5: "RENAMED_NEW",
                    }
                    action_name = action_names.get(action, f"UNKNOWN({action})")
                    print(f"   {action_name}: {filename}")
                print("-" * 60)

                # Create new watcher for next change
                watcher = FileSystemWatcher(open_handle)

    except KeyboardInterrupt:
        print("\n\nStopping...")

    finally:
        # Clean up
        print("Cleaning up...")
        try:
            open_handle.close()
            print("✅ Directory closed")
        except Exception as e:
            print(f"⚠️  Error closing directory: {e}")

        try:
            tree.disconnect()
            print("✅ Tree disconnected")
        except Exception as e:
            print(f"⚠️  Error disconnecting tree: {e}")

        try:
            session.disconnect()
            print("✅ Session disconnected")
        except Exception as e:
            print(f"⚠️  Error disconnecting session: {e}")

        try:
            connection.disconnect()
            print("✅ Connection closed")
        except Exception as e:
            print(f"⚠️  Error closing connection: {e}")

        print("\nTest complete!")


if __name__ == "__main__":
    print("SMB Change Notification Test")
    print("=" * 60)
    print("\n⚠️  UPDATE the test configuration in this script first!")
    print("   Edit TEST_HOST, TEST_SHARE, TEST_USERNAME, TEST_PASSWORD\n")

    input("Press Enter to continue (or Ctrl+C to cancel)...")

    try:
        test_change_notification()
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback

        traceback.print_exc()
