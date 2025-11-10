# SMB Change Notification Implementation

## Overview

Implemented real-time directory monitoring using SMB2/SMB3 `CHANGE_NOTIFY` protocol feature. When clients subscribe to a directory via WebSocket, the backend starts monitoring that SMB directory for changes and pushes notifications to all subscribers.

## How It Works

### 1. **SMB Protocol Support**
- SMB2/SMB3 has built-in change notification via `SMB2_CHANGE_NOTIFY` request
- The `smbprotocol` library provides full support through `FileSystemWatcher` class
- Can monitor for: file/directory additions, deletions, renames, modifications
- Supports recursive monitoring (subdirectories)

### 2. **Architecture**

```
Frontend (Browser.tsx)
    ↓ WebSocket connection
Backend (websocket.py)
    ↓ Start/Stop monitoring
DirectoryMonitor Service
    ↓ SMB connection per directory
SMB Server
    → Sends notifications on changes
```

### 3. **Key Components**

#### `/backend/app/services/directory_monitor.py`
- **DirectoryMonitor**: Global singleton managing all monitors
  - Tracks subscriber counts per directory
  - Starts monitoring when first subscriber subscribes
  - Stops monitoring when last subscriber unsubscribes
  
- **MonitoredDirectory**: Represents one monitored directory
  - Opens dedicated SMB connection, session, tree, and directory handle
  - Runs background thread with `FileSystemWatcher`
  - Calls callback function when changes detected
  - **Proper cleanup**: Closes handles in reverse order to prevent leaks

#### `/backend/app/api/websocket.py`
- **ConnectionManager**: Manages WebSocket connections
  - `subscribe()`: Starts SMB monitoring for new directories
  - `unsubscribe()`: Stops monitoring when no more subscribers
  - `disconnect()`: Cleans up all subscriptions on WebSocket disconnect
  - `notify_directory_change()`: Pushes notifications to subscribers

#### `/backend/app/main.py`
- Shutdown handler calls `shutdown_monitor()` to clean up all SMB handles

### 4. **Handle Management**

**Critical for preventing resource leaks:**

1. **Creation order**: Connection → Session → Tree → Open → Watcher
2. **Cleanup order**: Watcher → Open → Tree → Session → Connection (reverse)
3. **Subscriber counting**: Only one SMB connection per directory, shared by all subscribers
4. **Thread management**: Proper stop events and thread joins
5. **Error handling**: Try/except with cleanup in finally blocks

### 5. **Message Flow**

#### Client Subscribe:
```
1. Frontend sends: {"action": "subscribe", "connection_id": "uuid", "path": "/dir"}
2. Backend adds to subscriber list
3. If first subscriber: Start SMB FileSystemWatcher
4. Backend responds: {"type": "subscribed", "connection_id": "uuid", "path": "/dir"}
```

#### Change Detected:
```
1. SMB server sends CHANGE_NOTIFY response to watcher
2. Watcher thread processes changes
3. Calls callback: on_change_callback(connection_id, path)
4. Backend sends to all subscribers: {"type": "directory_changed", "connection_id": "uuid", "path": "/dir"}
5. Frontend receives notification → invalidates cache → reloads directory
```

#### Client Unsubscribe:
```
1. Frontend sends: {"action": "unsubscribe", "connection_id": "uuid", "path": "/dir"}
2. Backend removes from subscriber list
3. If last subscriber: Stop SMB monitoring and close handles
```

### 6. **Features**

- ✅ Real-time notifications for external changes (other SMB clients)
- ✅ Recursive monitoring (subdirectories)
- ✅ Multiple clients can subscribe to same directory (shared monitor)
- ✅ Automatic cleanup on disconnect
- ✅ Proper handle management (no leaks)
- ✅ Error recovery with reconnection
- ✅ Thread-safe operations

### 7. **Monitored Events**

```python
CompletionFilter.FILE_NOTIFY_CHANGE_FILE_NAME     # File created/deleted
CompletionFilter.FILE_NOTIFY_CHANGE_DIR_NAME      # Directory created/deleted
CompletionFilter.FILE_NOTIFY_CHANGE_SIZE          # File size changed
CompletionFilter.FILE_NOTIFY_CHANGE_LAST_WRITE    # File modified
```

Can be extended to monitor:
- Attributes changes
- Last access time
- Creation time
- Security/ACL changes
- Extended attributes (EA)
- Named streams

### 8. **Testing**

Use `/backend/test_change_notify.py` to test SMB change notifications:
1. Update configuration (host, share, username, password)
2. Run: `python3 test_change_notify.py`
3. Make changes to the SMB share in another tool
4. See notifications appear in real-time

### 9. **Performance Considerations**

- **Low overhead**: SMB2_CHANGE_NOTIFY is efficient (blocking request, no polling)
- **Shared connections**: Multiple subscribers share one SMB monitor
- **Background threads**: Non-blocking for web server
- **Automatic restart**: Watcher restarts after each notification batch

### 10. **Limitations**

- Requires SMB2 or later (not SMB1)
- Server must support change notifications (most modern SMB servers do)
- Cannot detect changes made directly on the server filesystem (bypassing SMB)
- Network issues may cause missed notifications (clients will see on next manual refresh)

## Testing the Implementation

1. **Start the backend**: Should be running with the new code
2. **Open Sambee in browser**: Connect to an SMB share
3. **Navigate to a directory**: WebSocket subscribes automatically
4. **In another SMB client** (Windows Explorer, macOS Finder, etc.):
   - Create a new file or folder in that directory
   - Delete a file
   - Rename a file
5. **Watch Sambee**: Directory should update automatically!

Check backend logs for:
```
Started SMB monitoring for <connection-id>:<path>
Change detected in <connection-id>:<path> - ADDED: filename.txt
Notified WebSocket <id> about change in <connection-id>:<path>
```

## Clean Shutdown

When stopping the server:
1. `shutdown_monitor()` is called
2. All monitors are stopped
3. Watcher threads are joined
4. SMB handles are closed in proper order
5. No handle leaks!
