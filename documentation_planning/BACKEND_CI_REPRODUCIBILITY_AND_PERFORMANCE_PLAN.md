# Backend CI Reproducibility And Performance Plan

## Goal

Make the backend GitHub Actions job fast on ordinary changes while preserving
one defined and auditable platform dependency set for the devcontainer, CI test
image, and production image.

Before Phase 1, the backend job took about 12 minutes, with more than 10
minutes in the `Build backend test image` step. The test commands were not the
primary cause: a CI-like run of 1,655 non-performance tests with coverage took
about 30 seconds locally, 17 performance tests took about 8 seconds, and mypy
took about 7 seconds. The workflow passed a unique `APT_REFRESH_KEY`,
invalidating the Docker layer that installs and upgrades OS packages and every
layer derived from it.

Phase 1 is implemented. Phases 2 through 6 remain planned work.

## Desired Outcome

- A backend-only source change reuses the cached system, language, and toolchain
  layers. It rebuilds only the copied application/test layers and runs checks.
- Every image target resolves its OS packages from the same immutable Debian
  repository snapshot.
- Updating operating-system packages is a deliberate, reviewable maintenance
  change, not an incidental consequence of a pull-request build.
- Security updates remain routine and visible, with a bounded response path for
  urgent rebuilds.
- The backend test target retains the production runtime contract and required
  Companion interoperability coverage.
- No phase reduces test coverage, skips security checks, or relies on an
  unpinned moving package repository for normal CI builds.

## Constraints And Invariants

- Keep the current base images pinned by digest.
- Keep Python dependencies installed from the existing hash-locked requirement
  files.
- Use one Dockerfile-defined system dependency input for `devcontainer`,
  `backend-test`, and `production`; CI must not silently select a different
  package set.
- A Git commit must be sufficient to identify the intended base-image digest,
  Debian snapshot, named packages, and Python dependency hashes.
- Do not use a GitHub run ID, time, branch name, or other per-run value as a
  Docker build input in the normal backend workflow.
- Preserve the GHA BuildKit cache and retain `load: true`, which is required by
  the later `docker run` step.
- Treat a system package update as a compatibility change: rebuild and test all
  image targets before merging it.

## Ranked Measures

The phases below implement the first four rows in order. Later rows are
conditional optimizations, not prerequisites for fixing the current regression.

| Rank | Measure | ROI | Effort | Risk | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | Remove the per-run APT cache key from the backend test build | Very high | Low | Low | Restores reuse of the existing BuildKit cache without disabling the existing scheduled image-refresh workflows. |
| 2 | Stop producing duplicate and unused coverage reports | Medium | Low | Low | CI uploads XML only; current defaults also request HTML and duplicate terminal/XML reports. |
| 3 | Resolve APT packages from an immutable Debian snapshot and remove `apt-get upgrade` | High | Medium | Medium | Makes the restored cache compatible with actual reproducibility rather than relying on the first build's moving APT result. |
| 4 | Add a scheduled, validated system dependency refresh process | High | Medium | Medium | Keeps immutable inputs secure without returning to per-run package refreshes. |
| 5 | Give `backend-test` a purpose-built toolchain stage instead of inheriting all devcontainer tooling | Medium | Medium | Medium | Reduces the cost of intentional cache misses and isolates test requirements. |
| 6 | Persist or prebuild Cargo dependencies for Companion source changes | Low to medium | Medium to high | Medium | Helps only when Companion inputs change; measure after the first four phases. |
| 7 | Publish and consume a shared prebuilt test-toolchain image | Low | High | High | Adds registry, retention, provenance, and promotion complexity; defer unless cache misses remain material. |
| 8 | Split or remove tests, reduce coverage, or use larger runners | Low | Medium | Medium to high | Does not address the observed bottleneck and either weakens assurance or adds recurring cost. |

## Phase 1: Restore Cache Reuse

Status: implemented. This is the independent, immediate remediation.

### Changes

1. Remove the `APT_REFRESH_KEY=${{ github.run_id }}-${{ github.run_attempt }}`
   build argument from the backend job in `.github/workflows/test.yml`.
2. Retain the Dockerfile's `APT_REFRESH_KEY=static` default. This preserves the
  existing opt-in refresh contract for scheduled image-validation and security
  workflows while the backend test workflow uses the stable value.
3. Keep the existing `cache-from` and `cache-to` entries in the
   `backend-test` scope.
4. Keep the cache key independent of PR metadata, retries, and workflow runs.

### Acceptance Criteria

- Two builds from the same commit show cache hits for the runtime base,
  devcontainer/toolchain, Python environment, and Companion precompile layers.
- A backend application or test-only change does not rerun system package
  installation, Node/Rust bootstrap, or Python dependency installation.
- The backend CI checks still run inside `sambee:backend-test` and produce the
  coverage artifact.
- The workflow YAML remains valid and the backend test job completes
  successfully.

### Rollback

Restore the backend workflow build argument only. Because the Dockerfile still
consumes `APT_REFRESH_KEY`, this intentionally forces a fresh APT resolution on
each backend test run. Use it only while a separate image-build issue is
diagnosed.

## Phase 2: Make Coverage Outputs Intentional

This phase is independent of Phase 1 and may be merged separately.

### Changes

1. Remove coverage report options from the global pytest `addopts` in
   `backend/pyproject.toml`. Keep stable test-discovery, warning, traceback,
   and strictness settings there.
2. Make each caller request only the reports it consumes:
   - local full-suite scripts may request terminal and HTML reports when a
     developer opts into coverage;
   - the GitHub Actions backend job requests terminal output and XML only;
   - focused local test commands run without coverage unless explicitly asked.
3. Avoid passing the same `--cov` or `--cov-report` option both through config
   and the command line.

### Acceptance Criteria

- CI uploads the same XML coverage artifact as before.
- CI does not create `backend/htmlcov`.
- The developer coverage path still produces the reports documented by
  `scripts/test` when `COVERAGE=1` is set.
- The non-coverage local test path does not instrument application code.

## Phase 3: Make System Packages Immutable

Phase 1 restores performance immediately. This phase is the durable
reproducibility improvement and should be implemented in a dedicated change.

### Dependency Model

Use an immutable Debian snapshot timestamp as the system dependency revision.
Configure every Debian APT use in both `runtime-base` and `devcontainer` to
point to matching Debian and Debian security snapshot archives. `backend-test`
inherits `devcontainer`, so freezing only the shared runtime layer is
insufficient. Preserve the snapshot timestamp in a Dockerfile `ARG` with a
checked-in default, for example `DEBIAN_SNAPSHOT=YYYYMMDDTHHMMSSZ`.

The snapshot is the resolver lock for direct packages and their transitive APT
dependencies. The package names in `scripts/install-system-deps` remain the
human-readable dependency declaration. A separate long list of exact
transitive package versions is unnecessary and would be harder to maintain.

The same phase must also freeze the non-Debian toolchain inputs in
`devcontainer`: Node.js is currently selected through a moving NodeSource major
repository and Rust is selected through the moving `stable` toolchain. These
inputs are inherited by `backend-test` and are part of its platform contract.

### Changes

1. Add snapshot-source setup before the first `apt-get update`, and apply it to
  the later `devcontainer` package installation as well. Support the Debian
  source-file format used by the pinned Python base image and fail clearly if
  the expected source definition is absent.
2. Use snapshot archive URLs for both normal Debian and security repositories.
  Configure APT's snapshot-validity behavior deliberately rather than allowing
  an expired metadata check to make historical rebuilds fail.
3. Remove `UPGRADE_EXISTING_PACKAGES=1` from the Dockerfile invocation and
   remove the conditional `apt-get upgrade` path from the common install helper
   when no other supported caller requires it. The pinned base image and APT
   snapshot together define the intended OS state.
4. Replace the moving NodeSource major repository with either an official
  Node.js image pinned by digest or a versioned, checksum-verified Node.js
  distribution. Pin one full Node.js version, rather than a major line, and
  update the existing runtime verifier to require that exact version.
5. Pin the Rust toolchain to a full release and verify the Rust installer by
  checksum, or copy the toolchain from an official Rust image pinned by digest.
  Pin required Rust components and targets to that toolchain revision.
6. Replace `APT_REFRESH_KEY` with the canonical `DEBIAN_SNAPSHOT` input and
  remove the timestamp-generated refresh-key preparation and build arguments
  from every image workflow in the same change. No image workflow may retain a
  per-run system dependency input after the snapshot is authoritative.
7. Keep installation non-interactive and retain cache mounts for APT downloads.
8. Add a lightweight verification command that prints the configured snapshot,
  exact Node.js and Rust versions where installed, and a sorted package
  inventory (`dpkg-query`) from each image target. Store it as a CI artifact
  for system-update pull requests.

### Compatibility Checks

- Build the `devcontainer`, `backend-test`, and `production` targets from the
  same revision.
- Run the backend job checks in `backend-test`.
- Run the image conversion tests, because the system dependency set includes
  ImageMagick, Ghostscript, libvips, and codecs.
- Verify the exact pinned Node.js and Rust versions in `devcontainer` and
  `backend-test`, including required Rust components and targets.
- Verify the production image starts and passes its existing health endpoint
  check.
- Rebuild the same commit twice with a cleared local cache and compare the
  package inventories. They must match.

### Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Snapshot repository availability or source syntax differs from the pinned base image | Validate with all three targets in the introducing PR; keep the source setup small and emit actionable errors. |
| Security package is not present at an arbitrarily chosen timestamp | The refresh process selects a verified snapshot, runs full image tests, and merges only a passing update. |
| A package name disappears or changes between Debian releases | The image build fails at dependency installation with the package name; update the shared package list in the same reviewed change. |
| Historical snapshot metadata expires | Configure APT specifically for immutable snapshot use and test a rebuild before adopting the implementation. |
| NodeSource or Rustup serves different content for the same moving selector | Replace moving selectors with exact version-and-digest or checksum-verified inputs and verify installed versions in CI. |

## Phase 4: System Dependency Update Process

This process begins only after Phase 3. It balances reproducibility, security,
and low ongoing maintenance.

### Cadence And Ownership

- Run a scheduled weekly workflow that checks whether a newer Debian snapshot
  is available and opens one system-dependency update pull request. Do not
  rebuild all normal PRs against it.
- Allow a maintainer-dispatched urgent refresh for published security advisories
  or an unavailable package.
- Keep the snapshot revision, base-image digest, and exact Node.js/Rust inputs
  in the pull request diff. They are the authoritative records of the chosen
  platform.
- Treat a missed scheduled update as visible CI maintenance debt, not as a
  reason to restore per-run APT updates.

### Refresh Workflow

1. Select one candidate Debian snapshot timestamp from the Debian snapshot
  service, allowing enough publication delay for both normal and security
  archive metadata to be available.
2. Update the checked-in snapshot revision and any intentionally refreshed
  pinned base-image, Node.js, or Rust toolchain input. Do not update unrelated
  application dependencies in the same pull request.
3. Build all three Docker targets without relying on the prior runtime-base
   layer. Save their sorted installed-package inventories and image digests as
   workflow artifacts.
4. Run the backend checks, image conversion coverage, and production smoke
   check.
5. Run the repository's vulnerability scanner against the production and
   backend-test images. A finding is triaged in the update PR; it does not
   silently alter dependencies during another PR's build.
6. Merge only when the test, smoke, and scan policies pass. Tag the PR as a
   dependency/system update so its intent is obvious in history.
7. Let normal PR builds consume the resulting cacheable immutable revision.

### Required Automation

Add a small script or workflow action with these responsibilities:

- validate that the candidate timestamp resolves every required Debian source;
- update the canonical snapshot and selected exact toolchain inputs;
- build targets and emit package, Node.js, and Rust inventories; and
- fail on missing packages, source errors, or an inconsistent target inventory.

The automation should propose the update, not merge it autonomously. A human
reviews image size changes, package deltas, test results, and vulnerability
findings. This keeps the process robust without turning operating-system
updates into manual archaeology.

### Acceptance Criteria

- A normal backend CI job performs no network-dependent APT resolution when
  its immutable Docker layer is cached.
- An intentional snapshot update invalidates the runtime-base layer exactly
  once and produces reviewable inventories.
- The devcontainer, backend-test, and production targets report the same
  snapshot revision and identical versions of their shared system packages.
- The devcontainer and backend-test targets report the configured exact Node.js
  and Rust toolchain versions.
- The scheduled workflow can be rerun safely and produces no change when the
  chosen candidate is already recorded.

## Phase 5: Right-Size The Backend Test Image

Begin this phase only after Phase 1 and Phase 3 timings show that intentional
cache misses are still a material contributor to CI time.

### Changes

1. Introduce a `backend-test-tools` stage derived directly from the shared
   runtime base.
2. Install only what backend tests and Companion relay interoperability require:
   Python test dependencies, Rust/Cargo tooling, and any compiler or system
   libraries they demonstrably use.
3. Do not inherit Node, Hugo, editor extensions, shell conveniences, or other
   devcontainer-only dependencies merely because they are available there.
4. Keep the existing backend-test application, test data, archive contract, and
   Companion copy ordering so backend-only edits do not invalidate the
   Companion precompile layer.
5. Compare both the cold-build time and final image size against the current
   target before merging.

### Acceptance Criteria

- All backend and Companion interoperability tests that currently run in
  `backend-test` continue to run there.
- The stage no longer contains tools used exclusively for website builds or
  interactive development unless a test demonstrates a dependency.
- A cold `backend-test` build improves by an agreed threshold; otherwise revert
  the refactor rather than retaining extra stage complexity.

## Phase 6: Conditional Cargo Optimization

Only undertake this work if timings show Companion-source changes remain slow
after Phase 5.

1. Record build-step timings separately for a backend-only edit and a
   Companion-source edit.
2. Evaluate a Cargo dependency cache that is compatible with the GHA BuildKit
  cache exporter, including registry, git checkout, and target artifacts.
3. Prefer a simple Docker-layer dependency cache if it is sufficient. Do not
   add a cache-persistence action or a new image registry solely to save a small
   amount of time on infrequent Companion changes.
4. Verify cached artifacts are target-architecture specific and cannot be
   consumed across incompatible Rust toolchain or lockfile revisions.

## Explicit Non-Goals

- Do not remove performance tests or reduce their assertions. They take only
  seconds and protect behavior that ordinary unit tests do not cover.
- Do not remove coverage collection merely to shorten CI. Make its generated
  artifacts precise instead.
- Do not move the backend suite to a host environment as the primary speed
  optimization; the container validates the shared runtime contract.
- Do not use a moving APT mirror with a cache-busting value as a substitute for
  a security update process.
- Do not introduce a permanently maintained fleet of prebuilt toolchain images
  unless measured cache misses justify their operational cost.

## Measurement And Rollout

Record GitHub Actions step durations for a representative backend-only pull
request before and after each phase. Track at least:

- `Build backend test image` duration and BuildKit cache-hit lines;
- runtime of mypy, non-performance pytest, and performance pytest separately;
- image size for `backend-test` and `production`; and
- package inventory delta and vulnerability scan result for every system update.

Do not use wall-clock performance assertions in application tests. CI timings
are operational metrics; correctness remains protected by the existing test
suite and the phase-specific build/inventory checks above.
