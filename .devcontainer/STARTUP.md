# Sambee Dev Environment Startup

## How Servers Start

Sambee uses **VS Code Auto-Run Tasks** as the single, reliable startup method:

### VS Code Auto-Run Tasks (Primary & Only)
When you open the workspace **inside the container**, VS Code automatically runs:
- **Backend: Start Dev Server** task → `/workspace/scripts/start-backend.sh`
- **Frontend: Start Dev Server** task → `/workspace/scripts/start-frontend.sh`

Both tasks have:
- `"runOptions": { "runOn": "folderOpen" }` - Auto-start on folder open
- `"panel": "dedicated"` - Reuse existing terminal, prevent duplicates
- `"isBackground": true` - Run as background processes
- **Container detection** - Wrapper scripts check for `/.dockerenv` and skip if not in container

**When it runs:** Every time you open the workspace folder in VS Code (inside container)  
**Reliability:** ⭐⭐⭐⭐⭐ Most reliable - always runs on folder open  
**Duplicate Prevention:** Uses dedicated panels to prevent multiple instances  
**Host Safety:** Gracefully skips if opened on host (before "Reopen in Container")

### postStartCommand (Setup Only)
When the container starts:
```bash
bash .devcontainer/post-start.sh
```

**What it does:** 
- Configures git safe directory
- Ensures frontend dependencies (node_modules) exist
- **Does NOT start servers** (leaves that to VS Code tasks)

**When it runs:** Only when container is first created or explicitly started  
**Purpose:** Environment setup, not server management

## Checking Server Status

```bash
# Check if servers are running
pgrep -f uvicorn && echo "✅ Backend running" || echo "❌ Backend stopped"
pgrep -f vite && echo "✅ Frontend running" || echo "❌ Frontend stopped"

# Check which ports are listening
lsof -i :3000 -i :8000

# View server logs
tail -f /tmp/backend.log
tail -f /tmp/frontend.log
```

## Manual Start/Stop

```bash
# Start both servers
/workspace/scripts/dev-start.sh

# Stop both servers
/workspace/scripts/dev-stop.sh

# Or run VS Code tasks:
# - Press Ctrl+Shift+P
# - Type "Tasks: Run Task"
# - Select "Backend: Start Dev Server" or "Frontend: Start Dev Server"
```

## Troubleshooting

### Frontend not accessible at localhost:3000

**Check if it's running:**
```bash
pgrep -f vite
```

**If not running, start it:**
```bash
cd /workspace/frontend
npm run dev
# Or use the VS Code task
```

**Check for errors:**
```bash
tail -50 /tmp/frontend.log
```

### Backend not accessible at localhost:8000

**Check if it's running:**
```bash
pgrep -f uvicorn
```

**If not running, start it:**
```bash
cd /workspace/backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Or use the VS Code task
```

**Check for errors:**
```bash
tail -50 /tmp/backend.log
```

### Error: "uvicorn: command not found" or "npm: command not found"

**Symptoms:**
- Tasks fail with "command not found" errors
- Happens when opening workspace on host (before reopening in container)

**Cause:**
- VS Code auto-run tasks tried to execute on the host machine
- Host doesn't have Python/Node.js dev environment

**Solution:**
1. **Ignore the error** - It's expected behavior
2. **Reopen in Container:** Ctrl+Shift+P → "Dev Containers: Reopen in Container"
3. **Tasks will run correctly** once inside the container

The wrapper scripts detect this and show a friendly message instead of erroring.

### Both servers not starting automatically

1. **Check if VS Code tasks auto-ran:**
   - Look at the Terminal panel
   - You should see two terminals: "Backend: Start Dev Server" and "Frontend: Start Dev Server"

2. **If tasks didn't auto-run:**
   - Reload the window: Ctrl+Shift+P → "Developer: Reload Window"
   - Or manually run: `/workspace/scripts/dev-start.sh`

3. **If inside container but tasks show skip message:**
   - The container detection may have failed
   - Manually start: `/workspace/scripts/dev-start.sh`

## Why Only One Startup Method?

**The Problem:** Multiple startup methods cause conflicts:
- Running `postStartCommand`, `postAttachCommand`, AND auto-run tasks creates race conditions
- Multiple instances try to bind to the same ports (3000, 8000)
- Zombie processes accumulate
- Difficult to debug which instance is actually running

**The Solution:** Single, reliable method:
1. ✅ **VS Code auto-run tasks** = Always runs on folder open, reuses terminals, prevents duplicates
2. ✅ **postStartCommand** = Only handles environment setup (git, node_modules)
3. ❌ **No postAttachCommand** = Removed to prevent duplicate starts

This ensures exactly ONE instance of each server starts cleanly! 🎯
