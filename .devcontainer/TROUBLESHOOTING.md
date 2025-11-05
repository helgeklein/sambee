# Sambee Troubleshooting Guide

This guide helps you diagnose and fix common issues with Sambee.

## 🔍 Quick Diagnostics

Run this command to get a complete status overview:

```bash
/workspace/scripts/logs.sh
```

This shows:
- Server status (running/stopped)
- Recent logs from all components
- Error messages if any

## 🚨 Common Issues

### Issue: Frontend not accessible at localhost:3000

**Symptoms:**
- Browser shows "Connection refused" or "Cannot connect"
- No Vite process running

**Diagnosis:**
```bash
pgrep -f vite || echo "Frontend not running"
lsof -i :3000 || echo "Port 3000 not listening"
tail -50 /tmp/frontend.log
```

**Solutions:**

1. **Start frontend manually:**
   ```bash
   cd /workspace/frontend
   npm run dev
   ```

2. **Check for port conflicts:**
   ```bash
   lsof -i :3000
   # If something else is using port 3000, kill it:
   kill $(lsof -t -i:3000)
   ```

3. **Reinstall dependencies:**
   ```bash
   cd /workspace/frontend
   rm -rf node_modules
   npm install
   npm run dev
   ```

4. **Run VS Code task:**
   - Press `Ctrl+Shift+P`
   - Type "Tasks: Run Task"
   - Select "Frontend: Start Dev Server"

---

### Issue: Backend not accessible at localhost:8000

**Symptoms:**
- API requests fail with connection errors
- No uvicorn process running

**Diagnosis:**
```bash
pgrep -f uvicorn || echo "Backend not running"
lsof -i :8000 || echo "Port 8000 not listening"
tail -50 /tmp/backend.log
```

**Solutions:**

1. **Start backend manually:**
   ```bash
   cd /workspace/backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Check for Python errors:**
   ```bash
   tail -100 /tmp/backend.log | grep -E "ERROR|Exception|Traceback"
   ```

3. **Verify database:**
   ```bash
   ls -lh /workspace/data/sambee.db
   # If missing or corrupted, reset:
   cd /workspace/backend
   rm -f /workspace/data/sambee.db
   python -c 'from app.db.database import init_db; init_db()'
   ```

4. **Run VS Code task:**
   - Press `Ctrl+Shift+P`
   - Type "Tasks: Run Task"
   - Select "Backend: Start Dev Server"

---

### Issue: Servers don't auto-start on workspace open

**Symptoms:**
- Opening workspace doesn't show server terminals
- Servers must be started manually each time

**Diagnosis:**
```bash
# Check if auto-start configuration is correct
cat /workspace/.vscode/tasks.json | grep -A 3 "runOptions"
cat /workspace/.devcontainer/devcontainer.json | grep -A 3 "postAttachCommand"
```

**Solutions:**

1. **Reload VS Code window:**
   - Press `Ctrl+Shift+P`
   - Type "Developer: Reload Window"
   - Wait for tasks to auto-run

2. **Check task configuration:**
   - Both "Backend: Start Dev Server" and "Frontend: Start Dev Server" tasks should have:
     ```json
     "runOptions": {
       "runOn": "folderOpen"
     }
     ```

3. **Rebuild container:**
   - Press `Ctrl+Shift+P`
   - Type "Dev Containers: Rebuild Container"
   - Wait for rebuild and auto-start

4. **Manual fallback:**
   ```bash
   /workspace/scripts/dev-start.sh
   ```

---

### Issue: SMB connection fails

**Symptoms:**
- Cannot browse SMB shares
- "Connection failed" errors in UI
- SMB errors in backend log

**Diagnosis:**
```bash
# Check backend logs for SMB errors
tail -100 /tmp/backend.log | grep -i smb

# Test SMB connection from command line
smbclient -L //your-server -U your-username
```

**Solutions:**

1. **Verify credentials:**
   - Check username and password in the connection settings
   - Ensure the account has access to the share

2. **Check network connectivity:**
   ```bash
   # Ping the server
   ping your-server
   
   # Check if SMB port is open
   nc -zv your-server 445
   ```

3. **Check backend logs for details:**
   ```bash
   grep -i "smb\|connection" /tmp/backend.log | tail -50
   ```

4. **Test connection in admin UI:**
   - Click the gear icon (⚙️) in the browser
   - Select a connection and click "Test Connection"
   - Check for specific error messages

---

### Issue: "Permission denied" or "Access denied" on files

**Symptoms:**
- Can browse directories but cannot access certain files
- Preview fails with permission errors

**Diagnosis:**
```bash
# Check file permissions on SMB server
# (requires SMB server access)

# Check backend logs for permission errors
grep -i "permission\|access denied" /tmp/backend.log
```

**Solutions:**

1. **Verify user has read permissions** on the SMB server

2. **Check if file is locked** by another user/process

3. **Try accessing as admin user** if available

4. **Check SMB backend logs:**
   ```bash
   tail -100 /tmp/backend.log | grep -E "ERROR.*smb|Permission"
   ```

---

### Issue: Slow directory listing

**Symptoms:**
- Browsing directories takes several seconds
- UI feels sluggish when navigating

**Diagnosis:**
```bash
# Check backend request logs for timing
grep "← GET /api/browse" /tmp/backend.log | tail -20
```

**Solutions:**

1. **Check network latency to SMB server:**
   ```bash
   ping -c 10 your-server
   ```

2. **Check if server is under load:**
   - High CPU/memory usage on SMB server can slow responses

3. **Review backend optimization settings:**
   - Sambee already uses optimized `scandir` for SMB
   - Check if there are excessive API calls in frontend

4. **Enable debug logging to see timing:**
   ```bash
   # In backend logs, look for:
   grep "ms)" /tmp/backend.log | tail -20
   ```

---

## 📊 Monitoring

### Real-time log monitoring

```bash
# Follow all logs in real-time
/workspace/scripts/logs.sh -f

# Or follow specific logs
tail -f /tmp/backend.log
tail -f /tmp/frontend.log
```

### Check server status

```bash
# Quick status check
pgrep -f uvicorn && echo "✅ Backend running" || echo "❌ Backend stopped"
pgrep -f vite && echo "✅ Frontend running" || echo "❌ Frontend stopped"

# Detailed process info
ps aux | grep -E "uvicorn|vite" | grep -v grep
```

### Check ports

```bash
# See what's listening on dev ports
lsof -i :3000,8000

# Check for port conflicts
netstat -tuln | grep -E "3000|8000"
```

---

## 🧹 Maintenance

### Rotate logs when they get large

```bash
/workspace/scripts/rotate-logs.sh
```

This archives current logs and starts fresh files. Useful when logs exceed several MB.

### Clean restart

```bash
# Stop servers
/workspace/scripts/dev-stop.sh

# Clear logs
> /tmp/backend.log
> /tmp/frontend.log
> /tmp/dev-start.log
> /tmp/post-start.log

# Start servers
/workspace/scripts/dev-start.sh

# View fresh logs
/workspace/scripts/logs.sh -f
```

### Reset database

```bash
cd /workspace/backend
/workspace/scripts/dev-stop.sh
rm -f /workspace/data/sambee.db
python -c 'from app.db.database import init_db; init_db()'
/workspace/scripts/dev-start.sh
```

---

## 🔧 Advanced Debugging

### Enable verbose backend logging

Edit `/workspace/backend/app/main.py`:

```python
# Change:
logging.basicConfig(level=logging.INFO, ...)

# To:
logging.basicConfig(level=logging.DEBUG, ...)
```

Then restart backend:
```bash
pkill -f uvicorn
cd /workspace/backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Inspect database

```bash
sqlite3 /workspace/data/sambee.db

# Show tables
.tables

# Show connections
SELECT * FROM connection;

# Show users
SELECT id, username, is_admin FROM user;

# Exit
.quit
```

### Check environment

```bash
# Python version
python --version

# Node version
node --version

# npm version
npm --version

# Check Python packages
pip list | grep -E "fastapi|uvicorn|smbclient"

# Check npm packages
cd /workspace/frontend
npm list --depth=0
```

---

## 🆘 Getting Help

If you're still stuck:

1. **Gather diagnostics:**
   ```bash
   /workspace/scripts/logs.sh -n 100 > /tmp/diagnostics.txt
   ps aux >> /tmp/diagnostics.txt
   lsof -i :3000,8000 >> /tmp/diagnostics.txt
   ```

2. **Check the logs** for specific error messages

3. **Search for similar issues** in the project's issue tracker

4. **Create a new issue** with:
   - Description of the problem
   - Steps to reproduce
   - Output from diagnostics
   - Relevant log excerpts

---

## 📚 Additional Resources

- [Startup Documentation](.devcontainer/STARTUP.md) - How auto-start works
- [Development Guide](../DEVELOPMENT.md) - Development setup details
- [VS Code Tasks](../.vscode/tasks.json) - Available automation tasks
