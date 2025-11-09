# GitHub Actions Workflows

## Test Workflow

The `test.yml` workflow runs comprehensive tests on every push and pull request to the `main` branch.

### Caching Strategy

**Multi-Layer Caching for Optimal Performance:**

1. **Built-in Setup Caching:**
   - `actions/setup-python` caches pip downloads
   - `actions/setup-node` caches npm registry data
   - Cache keys based on dependency file hashes

2. **Virtual Environment Caching:**
   - Path: `backend/.venv`
   - Key: `{OS}-python-3.13-venv-{hash(requirements*.txt)}`
   - Saves: ~15-20 seconds per run
   - Only reinstalls if requirements change

3. **Node Modules Caching:**
   - Path: `frontend/node_modules`
   - Key: `{OS}-node-20-modules-{hash(package-lock.json)}`
   - Saves: ~20-25 seconds per run
   - Only reinstalls if package-lock changes

### Performance Metrics

**Cache Miss (First Run):**
- Setup: ~30s
- Install Python deps: ~15-20s
- Install Node deps: ~20-25s
- Tests (parallel): ~22s (backend) + ~15s (frontend)
- **Total: ~100-120s**

**Cache Hit (Subsequent Runs):**
- Setup: ~30s
- Verify Python deps: ~2-3s
- Verify Node deps: ~3-5s
- Tests (parallel): ~22s (backend) + ~15s (frontend)
- **Total: ~70-80s**
- **Savings: ~30-40s (30-40% faster)**

### Parallel Test Execution

Backend tests run with `pytest-xdist`:
- Auto-detects worker count (typically 4 on GitHub runners)
- Distributes 310 tests across workers
- ~35% faster than sequential execution
- Compatible with coverage collection

### Cache Invalidation

Caches are automatically invalidated when:
- `backend/requirements.txt` changes
- `backend/requirements-dev.txt` changes
- `frontend/package-lock.json` changes
- Python version changes (3.13)
- Node version changes (20)

### Manual Cache Management

To clear all caches:
1. Go to repository Settings → Actions → Caches
2. Delete specific caches or all caches
3. Next workflow run will rebuild caches

### Troubleshooting

**Tests fail after dependency update:**
- Cache might be stale - delete and rebuild
- Check that `package-lock.json` was committed

**Slow installation despite cache:**
- Check cache restore logs in workflow
- Verify cache key matches
- Check available storage quota

**Virtual environment issues:**
- Ensure `.venv` is in `.gitignore`
- Check that activation script exists
- Verify Python version consistency
