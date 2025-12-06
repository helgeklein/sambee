# Mobile Log Collection System - Testing Guide

## Overview

The mobile log collection system has been fully implemented to help debug the mobile swipe stutter issue in the image viewer. The system captures detailed logs from mobile devices and sends them to the backend for analysis.

## Architecture

### Backend Components

1. **`backend/app/models/logs.py`**
   - `MobileLogEntry`: Individual log entry with timestamp, level, message, context, component
   - `MobileLogBatch`: Collection of logs with session ID and device info

2. **`backend/app/services/log_manager.py`**
   - `MobileLogManager`: Manages JSONL file storage
   - Auto-cleanup of files older than 24 hours
   - Files stored in `backend/data/mobile_logs/`

3. **`backend/app/api/logs.py`**
   - `POST /api/logs/mobile`: Receive log batches from mobile devices
   - `GET /api/logs/list`: List available log files
   - `GET /api/logs/download/{filename}`: Download specific log file
   - All endpoints require authentication (supports "none" mode)

### Frontend Components

1. **`frontend/src/services/logBuffer.ts`**
   - `LogBuffer`: In-memory buffer for log entries
   - Auto-flush when reaching 100 logs or every 30 seconds
   - Collects device information (screen size, user agent, touch capability)

2. **`frontend/src/services/logTransport.ts`**
   - `LogTransport`: HTTP transport layer using fetch API
   - Includes authentication token if available
   - Direct implementation to avoid circular dependencies

3. **`frontend/src/services/logger.ts`**
   - Enhanced with mobile logging methods: `debugMobile`, `infoMobile`, `warnMobile`, `errorMobile`
   - `enableMobileLogging()`: Start collecting logs
   - `disableMobileLogging()`: Stop and flush logs
   - `flushMobileLogs()`: Manually flush buffer
   - Automatically disabled in test environment

4. **`frontend/src/components/Viewer/ImageViewer.tsx`**
   - Mobile logging enabled on mount if touch device detected
   - Strategic log points:
     - Image viewer mount/unmount
     - Image fetch start/complete (with duration)
     - Touch start/move/end events
     - Slide change events (onSlideChange, onSlideChangeTransitionStart, onSlideChangeTransitionEnd)
     - Scale changes (double-tap zoom)

## Log Points for Swipe Stutter Debugging

The following events are logged to help identify the swipe stutter:

1. **Touch Events**
   - `Touch start on Swiper`: When user touches the screen
   - `Touch move during swipe`: Periodic sampling (10%) during swipe
   - `Touch end on Swiper`: When user releases touch

2. **Slide Transitions**
   - `Slide change started`: When swipe gesture triggers slide change
   - `Slide transition CSS started`: When CSS transition begins
   - `Slide transition ended`: When CSS transition completes

3. **Image Loading**
   - `Image fetch started`: When image fetch begins (with timestamp)
   - `Image fetch completed`: When image fetch completes (with duration and size)

4. **Scale Changes**
   - `Scale changed via double-tap`: When user zooms in/out

All logs include:
- Precise timestamps (milliseconds)
- Component name (e.g., "Swiper", "ImageLoader", "ImageViewer")
- Relevant context (indices, scale values, timing data)

## Testing on Mobile Device

### 1. Access the Application
Open the image viewer on your mobile device and navigate through images using swipe gestures.

### 2. Reproduce the Stutter
Swipe left/right multiple times to trigger the stutter/hiccup that occurs around 20-40% of the swipe gesture.

### 3. Logs are Automatically Collected
- Logs are buffered in memory (max 100 entries)
- Auto-flush every 30 seconds
- Logs are sent to backend when viewer closes

### 4. Download Logs from Backend

#### Option A: Using curl
```bash
# List available log files
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/api/logs/list

# Download a specific log file
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:8000/api/logs/download/mobile_logs_20241206_192505_abc123de.jsonl \
     -o mobile_logs.jsonl
```

#### Option B: Using Python
```python
import requests

# Get token (if auth is enabled)
response = requests.post('http://localhost:8000/api/auth/token',
                        data={'username': 'admin', 'password': 'your_password'})
token = response.json()['access_token']

# List log files
response = requests.get('http://localhost:8000/api/logs/list',
                       headers={'Authorization': f'Bearer {token}'})
files = response.json()['files']
print(files)

# Download first file
filename = files[0]['filename']
response = requests.get(f'http://localhost:8000/api/logs/download/{filename}',
                       headers={'Authorization': f'Bearer {token}'})
with open('mobile_logs.jsonl', 'wb') as f:
    f.write(response.content)
```

#### Option C: Direct File Access
If you have direct access to the server:

**Development (local):**
```bash
ls -lh /workspace/data/mobile_logs/
cat /workspace/data/mobile_logs/mobile_logs_*.jsonl
```

**Production (Docker container):**
```bash
docker exec sambee ls -lh /app/data/mobile_logs/
docker exec sambee cat /app/data/mobile_logs/mobile_logs_*.jsonl
```

### 5. Analyze the Logs

The JSONL file contains:
- First line: Metadata (session_id, device_info)
- Subsequent lines: Individual log entries

Example log entry:
```json
{
  "timestamp": 1733516725432,
  "level": "DEBUG",
  "message": "Slide change started",
  "context": {
    "fromIndex": 5,
    "toIndex": 6,
    "timestamp": 1733516725432
  },
  "component": "Swiper"
}
```

### 6. Look for Stutter Pattern

Analyze the timing between events:
- Time between `Touch start` and `Touch end`
- Time between `Slide change started` and `Slide transition CSS started`
- Time between `Slide transition CSS started` and `Slide transition ended`
- Any `Image fetch started` events occurring during transition
- Any unexpected delays or gaps in the timestamp sequence

## Expected Behavior

**Normal swipe (smooth):**
```
Touch start -> Touch move (periodic) -> Touch end ->
Slide change started -> Slide transition CSS started (immediate) ->
Slide transition ended (after 400ms)
```

**Swipe with stutter:**
Look for:
- Unexpected delay between `Touch start` and `Slide change started`
- Image loading during transition (causing spinner)
- React state updates interrupting the swipe gesture
- Gaps in Touch move events during the 20-40% range

## Log File Format

### Metadata Line (First Line)
```json
{
  "session_id": "1733516725432-abc123de",
  "device_info": {
    "userAgent": "Mozilla/5.0...",
    "screenWidth": 390,
    "screenHeight": 844,
    "devicePixelRatio": 3,
    "platform": "iPhone",
    "isTouchDevice": true
  },
  "timestamp": "2024-12-06T19:25:25.432Z"
}
```

### Log Entry Lines (Subsequent Lines)
```json
{
  "timestamp": 1733516725432,
  "level": "DEBUG|INFO|WARN|ERROR",
  "message": "Event description",
  "context": {
    "key": "value"
  },
  "component": "ComponentName"
}
```

## Cleanup

- Log files older than 24 hours are automatically deleted
- Manual cleanup:
  - **Development:** `rm /workspace/data/mobile_logs/*.jsonl`
  - **Production:** `docker exec sambee rm /app/data/mobile_logs/*.jsonl`

## Notes

- Mobile logging is disabled in test environment to avoid errors
- Logs are not sent if backend is unreachable (fails silently)
- Touch move events are sampled at 10% to avoid excessive logging
- Each log entry includes precise millisecond timestamps for timing analysis
