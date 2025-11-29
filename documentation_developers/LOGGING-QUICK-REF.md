# 🔍 Sambee Logging Quick Reference

## 📊 View Logs

```bash
# All logs with status
/workspace/scripts/logs

# Follow in real-time
/workspace/scripts/logs -f

# More lines
/workspace/scripts/logs -n 200

# Individual logs
tail -f /tmp/backend.log
tail -f /tmp/frontend.log
tail -f /tmp/dev-start.log
tail -f /tmp/post-start.log
```

## 🚦 Check Status

```bash
# Quick check
pgrep -f uvicorn && echo "✅ Backend" || echo "❌ Backend"
pgrep -f vite && echo "✅ Frontend" || echo "❌ Frontend"

# What's on ports?
lsof -i :3000,8000

# Full process info
ps aux | grep -E "uvicorn|vite" | grep -v grep
```

## 🔄 Control Servers

```bash
# Start both
/workspace/scripts/dev-start

# Stop both
/workspace/scripts/dev-stop

# Restart
/workspace/scripts/dev-stop && /workspace/scripts/dev-start

# Individual control
pkill -f uvicorn    # Stop backend
pkill -f vite       # Stop frontend
```

## 🔍 Search Logs

```bash
# Find errors
grep -i error /tmp/*.log

# Find warnings
grep -i warning /tmp/*.log

# Find SMB issues
grep -i smb /tmp/backend.log

# Find slow requests (>1000ms)
grep -E "\([0-9]{4,}\.[0-9]+ms\)" /tmp/backend.log

# Search all logs
grep -r "search term" /tmp/*.log
```

## 🧹 Maintenance

```bash
# Rotate logs (when >1MB)
```bash
/workspace/scripts/rotate-logs
```

# Clear logs
> /tmp/backend.log
> /tmp/frontend.log
> /tmp/dev-start.log
> /tmp/post-start.log

# View archived logs
ls -lh /tmp/logs-archive/
```

## 📚 Documentation

- **Startup Info:** `.devcontainer/STARTUP.md`
- **Troubleshooting:** `.devcontainer/TROUBLESHOOTING.md`
- **Full Logging Docs:** `.devcontainer/LOGGING.md`

## 🆘 Emergency Checklist

1. ✅ Check logs: `/workspace/scripts/logs`
2. ✅ Verify processes: `pgrep -f "uvicorn|vite"`
3. ✅ Check ports: `lsof -i :3000,8000`
4. ✅ Look for errors: `grep -i error /tmp/*.log`
5. ✅ Try restart: `dev-stop.sh && dev-start.sh`
6. ✅ Check docs: `.devcontainer/TROUBLESHOOTING.md`
