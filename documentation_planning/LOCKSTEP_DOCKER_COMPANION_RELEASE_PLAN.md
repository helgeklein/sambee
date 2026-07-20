# Lockstep Docker and Companion Release Plan

## Purpose

Simplify Sambee and Companion releases while preserving the separate Companion release repository and its Tauri update feeds.

The release process must provide these outcomes:

- Docker and Companion use the same product version whenever both are released for a candidate.
- Every published Docker candidate and Tauri release has an immutable version and source commit.
- The approved artifact is promoted without rebuilding it.
- Docker and Companion publishing remain independent because each build is expensive and most work affects only one of them.
- Only builds originating from `main` may publish release artifacts.
- A later independent component build can reuse an existing candidate even after `main` has advanced.
- Companion can still be packaged in CI for feature branches, but those builds are verification-only and are never published to the Companion release repository or updater feeds.
- A version already associated with a source commit cannot be associated with a different source commit.
- A failed Docker build may be retried with the same version until its candidate marker exists. A failed Companion matrix build may be retried until its finalizer creates the external draft; an interrupted finalizer resumes only from the retained artifacts of its original workflow run.

This plan deliberately changes the operational meaning of the three numeric version components. Sambee keeps a SemVer-compatible `X.Y.Z` syntax for tooling and Tauri ordering, but does not claim strict SemVer release semantics:

| Component | Sambee meaning |
|---|---|
| `X` | User-visible product release number. Increment for every normal, non-maintenance release, including backward-compatible releases. |
| `Y` | Maintenance release number within product release `X`. Reset to `0` for a new product release. |
| `Z` | Immutable build sequence for the current `X.Y` release train. Increment before every new publishable candidate build. |

Examples:

```text
1.0.0  first publishable candidate for product release 1
1.0.1  next publishable candidate for product release 1
1.1.0  first publishable candidate for maintenance release 1 of product release 1
2.0.0  first publishable candidate for product release 2
```

## Decisions

### Source of truth

- `VERSION` remains the only product-version source of truth.
- `./scripts/sync-version` continues to synchronize frontend and Companion metadata.
- Every publishable build must use a committed, synchronized version from `main`.
- Remove all publishing-workflow version overrides. A workflow must never temporarily rewrite `VERSION` to produce a publishable Docker or Companion artifact.
- An optional build selector may choose an existing `build-v<version>` tag. It is not a version override: the workflow reads `VERSION` from that canonical commit and rejects a selector that does not name an existing canonical build tag.

### Publish boundary

- Manually dispatched Docker and Companion **candidate-building** workflows must be dispatched from `refs/heads/main`; reject any other dispatch ref before checking out build dependencies or exposing release credentials.
- Event-driven and manually dispatched **promotion** workflows do not apply the candidate-build `github.ref == refs/heads/main` guard. They must not build. They instead resolve the requested release/tag, its canonical build tag, and the immutable source commit, then require all three identities to agree before moving any pointer.
- A new candidate uses the immutable `github.sha` captured at that `main` dispatch. Do not compare it with the moving `origin/main` tip later in the run.
- A later component build may select only an existing canonical build tag. The preflight resolves that tag, verifies its commit is an ancestor of `origin/main`, and checks out that immutable commit for every build job.
- A caller may not supply an arbitrary branch, pull-request ref, Git tag, or source SHA. The only permitted source selector is an existing, validated `build-v<version>` tag.
- The workflow records the resolved build tag and source SHA, rather than a moving branch name, in all artifact metadata and summaries.

This removes the conflict between feature-branch testing and squash merges: published artifacts are always built after the squashed change is present on `main`.

### Companion feature-branch CI

- Add a nonpublishing Companion CI workflow for pull requests and optionally manual dispatches against non-`main` branches.
- It builds and validates the Companion so development can be tested on CI, where the maintainer cannot build the desktop application locally.
- It must not create a GitHub Release, upload to `helgeklein/sambee-companion`, alter Tauri feeds, use production updater signing, or claim a release version.
- Upload build outputs only as GitHub Actions artifacts with short retention.
- For pull requests from forks, use no repository secrets. Build unsigned and skip platform code-signing/notarization steps that require secrets.
- Keep release packaging and signing in the trusted `main` publishing workflow.

### Canonical version-to-source registry

Use one canonical Git tag in the main repository:

```text
build-v<version> -> immutable main commit used for release artifacts
```

Examples:

```text
build-v1.0.4 -> 3d7c0d4...
build-v1.1.0 -> b3ca2eb...
```

The tag is a shared registry, not a component completion marker. Do not add Docker- or Companion-specific build tags.

For each publishing workflow preflight:

1. Require `github.ref == refs/heads/main`. This checks the immutable dispatch context and does not depend on whether another commit reaches `main` after dispatch.
2. Fetch `origin/main` and `refs/tags/build-v*` with tags available for ancestry verification.
3. When the optional `build_version` selector is empty, use `github.sha` as the proposed source. Check out that SHA, verify synchronized metadata with `sync-version-check`, and read/validate its plain `X.Y.Z` value from `VERSION`.
4. When `build_version` is supplied, require a strict plain `X.Y.Z` value, resolve exactly `refs/tags/build-v<build_version>`, dereference the annotated tag to its commit, and require that commit to be an ancestor of `origin/main`. Check out that commit, verify synchronized metadata, and require its `VERSION` to equal `build_version`.
5. For a new candidate, resolve the expected tag `build-v<version>`. If absent, create a local **annotated** tag at the checked-out `github.sha` containing the version, full SHA, workflow run URL, and creation time. Push `refs/tags/build-v<version>` without force.
6. If that push reports that the remote tag already exists, fetch it again, dereference it to its target commit, and continue only when it targets the same commit. Otherwise fail before expensive work; the version is bound to another source commit.
7. For an existing selected build, do not recreate or move the tag. Output the canonical version, annotated tag name, full source SHA, and source tree SHA.

The annotated-tag push is the concurrent reservation operation. It replaces the prior lightweight-tag proposal. A check before the push is only an optimization; the push result and post-conflict fetch decide correctness.

The tag remains permanently after a failed build. It establishes source identity, but it does not by itself mean a Docker image or Companion release was published.

### Independent Docker and Companion publication

Each workflow owns only its component's artifact-existence check after the shared canonical-tag check:

| Workflow | Already-published artifact check | Retry rule |
|---|---|---|
| Docker | Check the immutable `build-v<version>` marker in GHCR. It is the release-publication commit point and is written only after the final digest is validated, metadata is published, and that digest is signed. | Retry from scratch only while the marker is absent. Any run-scoped staging images are never a candidate artifact. Once the marker exists, perform repair-only alias operations without rebuilding. |
| Companion | Check for any existing `companion-v<version>` draft or published release. Matrix builds do not contact the release repository. A single finalizer creates and completes the draft after every selected platform build has succeeded. | Retry matrix builds while no draft exists. After draft creation, retry only the original workflow run's idempotent finalizer, which can upload missing assets whose hashes match the retained manifest; it must reject replacement assets. |

The component check must occur in the first preflight job before platform matrices, signing, or packaging work begins. A finalizer must recheck immediately before its one-way commit point to handle concurrent workflows.

The Docker version marker must point to the exact candidate digest, alongside the existing immutable `sha-<full-commit-sha>` tag. The existing `test`, `beta`, and `stable` tags remain mutable channel aliases and must not be used for uniqueness checks.

### Docker publication state machine

Docker registry tags do not offer a portable compare-and-set operation. The Docker publishing workflow must therefore use a non-cancelling, repository-wide GitHub Actions concurrency group such as `docker-release-publication`. This serializes the full publishing workflow, including preflight, candidate-marker creation, and repair-only alias work. It does not serialize Companion builds.

Within that lock, preflight resolves exactly one of these states:

| State | Required workflow path |
|---|---|
| `build-v<version>` absent | Build path: build staging images, validate, assemble, attest, sign, verify, then create the immutable marker. |
| Marker exists and its provenance matches the selected canonical candidate | Repair path: skip every build job, verify the already signed digest, and create or verify only missing immutable source-SHA and mutable channel aliases. |
| Marker exists but provenance, digest, signature, or metadata does not match | Fail closed. Do not retag, rebuild, or repair it. Investigate the corrupted publication state and use a new `Z` version for a replacement artifact. |

The marker is assigned only while this workflow lock is held. A preflight existence check is advisory; the locked final marker assignment and post-assignment verification establish correctness.

Metadata bundles and Cosign signatures may remain after a failure before marker creation. Those digest-addressed artifacts are idempotent intermediate state, not publication commit points. A retry may reuse an existing metadata bundle only after verifying its complete contents and candidate provenance, and may accept an existing signature only after verifying the required digest, identity, and issuer. Conflicting digest-addressed metadata fails closed. Document retention for orphaned bundles and signatures associated with abandoned pre-marker digests.

Docker tags have explicit mutation classes:

| Class | Tags | Mutation rule |
|---|---|---|
| Immutable identity | `build-v<version>`, `sha-<source-sha>`, exact `X.Y.Z` | Create when absent, accept idempotently when already equal, and fail closed when the existing tag resolves to another digest. Never overwrite. |
| Mutable pointer | `test`, `beta`, `stable`, `X.Y` | Move only from a digest returned by the shared published-candidate verifier and only while holding `docker-release-publication`. |

### Companion publication state machine

The Companion publishing workflow must use a non-cancelling, repository-wide GitHub Actions concurrency group named `companion-release-publication`. Hold it for the full workflow so two dispatches cannot both spend time building the same version and then race to create `companion-v<version>`. It does not serialize Docker builds or nonpublishing Companion verification builds.

Within that lock, preflight resolves exactly one of these states:

| State | Required workflow path |
|---|---|
| No `companion-v<version>` release exists | Build path: run the selected matrix, validate its manifest, then create and complete one draft release. |
| Matching incomplete draft exists, has no valid completion marker, and records the same original workflow run ID and manifest digest | Finalizer-recovery path: skip all matrix builds, retrieve retained artifacts from that original run, and resume only missing byte-identical uploads. |
| Matching draft has a valid completion marker, or a published release has the same verified provenance | Complete path: skip all builds and uploads; report the existing immutable release for review or promotion. |
| Existing release metadata, source SHA, run ID, or manifest conflicts | Fail closed. Do not rebuild, upload, delete, or replace assets; use a new `Z` version for replacement artifacts. |

The finalizer must query the external release repository again immediately before creating or resuming a draft. The release body and mandatory provenance manifest must record the originating workflow run ID and run attempt so recovery can prove which retained artifacts are authoritative. Each private Actions artifact name includes run ID, run attempt, platform, and target; provenance records its GitHub artifact ID and digest. Recovery downloads only those exact artifact IDs and rejects missing, expired, replaced, or ambiguous artifacts. Matrix retries use a new run-attempt-qualified artifact name and never overwrite a prior attempt's artifact.

Upload a small completion-marker JSON asset last. It contains the release tag, manifest digest, provenance digest, and a digest of the expected release asset set. The expected asset set is defined canonically as every manifest/provenance/installer/updater/signature asset **excluding the completion marker itself**, avoiding a circular digest. A draft is complete only when that marker and every referenced asset verify. A published release without a valid completion marker is conflicting state and fails closed.

### Concurrency queue behavior

GitHub Actions concurrency is a mutual-exclusion mechanism, not a FIFO work queue. A concurrency group can have one running and one pending run; a newly queued run can replace an older pending run even when `cancel-in-progress` is `false`.

Operational rules:

- Do not dispatch another workflow using `docker-release-publication` or `companion-release-publication` while one in that group is running or pending.
- A superseded pending run has published nothing and is safe to dispatch again.
- Every preflight summary must show the concurrency group name, current run URL, canonical version/tag, selected source SHA, and chosen build/repair/complete state.
- Documentation must tell operators to inspect the Actions run list before dispatch and to rerun a superseded pending operation rather than changing the version solely because it never started.

### Retry and recovery policy

| Situation | Required behavior |
|---|---|
| Canonical build tag absent | Create an annotated tag at the immutable `main` dispatch SHA and proceed. |
| Canonical build tag exists and is selected | Check out its target commit, require it to remain reachable from `main`, and proceed with that source even if `main` has advanced. |
| Canonical tag exists at a different SHA during new-candidate reservation | Fail. Increment `Z`, synchronize metadata, commit on `main`, and build a new candidate. |
| Docker version marker exists | Do not rebuild or overwrite it. Permit only a repair-only job that verifies the signed digest and completes missing mutable aliases such as `test`. |
| Docker fails before marker creation | Discard or expire its unique run-scoped staging tags and retry from the same canonical source/version. Never create or overwrite `sha-<source-sha>` before the marker exists. |
| Companion matrix fails before finalization | Retry matrix build jobs from the same canonical source/version; no external Companion release exists. |
| Companion draft exists but finalization was interrupted | Rerun only the finalizer. It validates an artifact manifest and uploads only absent, byte-identical assets; any existing asset with a mismatched checksum fails and requires a new `Z` version. |
| Completed Companion draft or published release exists | Never rebuild or replace its assets. Review/publish/promote the immutable release, or use the next `Z` version for replacement assets. |
| Publishing run was superseded while pending in a concurrency group | Confirm it never started or published state, then dispatch it again with the same canonical candidate. |

This permits retries for infrastructure failures before publication while preserving immutable published artifacts. A gap in build sequence numbers is valid and preferable to overwriting an artifact identity.

### Promotion

- Promotion remains a pointer-only operation. It must never rebuild Docker or Companion artifacts.
- Docker promotion continues to move `test`, `beta`, and `stable` aliases to the selected immutable digest.
- Companion promotion continues to rewrite independent Tauri channel feeds and Sambee direct-download metadata in `helgeklein/sambee-companion`.
- Promotion inputs must identify the immutable artifact version/release, not a branch head.
- Before promotion, validate that artifact metadata records the same canonical source SHA and build tag as `build-v<version>`.
- Every public Sambee release carries a required versioned `sambee-release.json` asset containing at least `schema_version`, `version`, `build_tag`, `source_sha`, and `component_scope`. `component_scope` has exactly one value: `docker`, `companion`, or `both`. Release creation uploads and validates this asset while the release is a draft, then publishes the release only after it is complete. Promotion workflows fail if the asset is missing, malformed, or inconsistent with the Git release tag/target.
- For scope `both`, require both immutable artifacts to exist and pass their shared verifiers for the same version, canonical build tag, and source SHA before promoting either component to stable or updating public download metadata.
- For scope `docker` or `companion`, permit stable promotion only for the named component and reject attempts to promote the excluded component from that release.
- Docker-only and Companion-only maintenance candidates remain allowed; only promote the component that was built and approved.

### Release tag and release notes

- Keep the existing main Sambee Git release/tag creation after the approved candidate is selected, but change its source reference to the canonical `build-v<version>` commit.
- Since publishing only originates from `main`, that tag always points to a `main` commit and remains compatible with squash-merge history.
- The Docker and Companion release metadata must state the product version and full source SHA.
- Continue using one Sambee "What's New" page per public product version. Candidate builds are not separate public release-note entries; the promoted build's final version is the page identity.

## Implementation Phases

### Phase 1: Version policy and shared validation

1. Add a small release-candidate helper, preferably `.github/scripts/prepare_release_candidate.py` or a focused shell helper with automated tests.
2. Give it an optional `--build-version` selector, the dispatch SHA/ref, and the remote URL. It must never accept an arbitrary source SHA, ref, or tag.
3. Implement plain publishable-version validation:
   - Accept exactly `X.Y.Z`, with non-negative numeric components and no leading zeroes other than `0` itself.
   - Reject `-prerelease` and `+build` suffixes for release-publishing workflows.
   - Emit actionable failures that name the required next step: update `VERSION`, run `./scripts/sync-version`, commit, and rerun from `main`.
4. Implement annotated canonical-tag reservation, dereferencing, ancestry verification, and comparison against the remote repository.
5. Add the helper's tests for absent tags, an existing tag selected after `main` advances, mismatched tags, concurrent annotated-tag creation conflicts, invalid versions, non-`main` dispatch, and remote/API failures.
6. Add a reusable composite action, for example `.github/actions/release-candidate-preflight/action.yml`, only if it cleanly prevents duplication between Docker and Companion workflows. Its responsibilities should be limited to:
   - verify version synchronization;
   - select or reserve the canonical build source from a `main` dispatch;
   - verify the selected source is reachable from `main`;
   - resolve and output the version, build tag, full SHA, and tree SHA;
   - expose outputs needed by the caller.
7. Keep component-specific published-artifact checks outside the shared action, because Docker registry state and GitHub Release state are different concerns.

### Phase 2: Docker publishing workflow

Target: `.github/workflows/docker-image-preview-publish.yml`.

1. Remove the `source_ref` and `publish_version_override` dispatch inputs. Add an optional `build_version` selector whose only valid values are existing canonical build versions.
2. Require workflow dispatch from `main`. Use `github.ref` and `github.sha` as the new-candidate authority; do not compare the dispatch SHA to the later moving branch tip.
3. Replace the current override branches with the shared preflight action. All jobs check out its resolved canonical source SHA.
4. Add a repository-wide, non-cancelling GitHub Actions concurrency group named `docker-release-publication`. Keep it for the entire workflow so no two runs can race on the same registry marker or aliases. Use this exact same group in every workflow that mutates Docker candidate or release aliases, including `docker-image-publish.yml` and any backfill/repair workflow.
5. Move the Docker-specific existence check into the preflight stage and branch by the Docker publication state machine:
   - absent marker: enter the build path;
   - matching marker: enter the repair-only path and skip all builds;
   - mismatched marker: fail closed with provenance diagnostics.
6. Replace the early public `sha-<commit>` publication with valid, unique same-repository staging tags in the exact form `staging-<github-run-id>-<github-run-attempt>-<platform>`. Staging references may be used for cross-runner validation and index assembly, but are never version markers, channels, or promotion inputs. An `always()` cleanup job deletes those staging tags with `crane delete` after a terminal outcome; if cleanup fails, it emits an actionable warning and scheduled registry retention removes stale `staging-*` tags after a documented maximum age.
7. Assemble the final multi-platform index by digest from the validated staging outputs. Verify labels, manifests, SBOM/provenance bundle, and required metadata against that digest. Sign the final digest before any public candidate alias is created.
8. Add the custom OCI label and index annotation `org.sambee.build-tag=build-v<version>` alongside the existing version, revision, source, and timestamp fields.
9. Recheck that `build-v<version>` is absent, then create it as the Docker publication commit point. Verify it resolves to the signed final digest. This tag must never be overwritten.
10. Only after the candidate marker exists, create or verify the immutable `sha-<source-sha>` tag and move `test` to that same digest. If either operation fails, a repair-only rerun resolves the existing candidate marker, verifies the digest/signature, and completes missing immutable identities or mutable aliases without rebuilding. An existing immutable tag at another digest is corruption and fails closed.
11. Extend `verify_candidate_image.sh`, or add a focused wrapper such as `verify_published_candidate_image.sh`, so repair and promotion use the same verification contract. It must:
   - resolve `build-v<version>` to its digest;
   - verify `org.opencontainers.image.version`, `org.opencontainers.image.revision`, and `org.sambee.build-tag` on the index and platform manifests;
   - require the revision to equal the canonical Git build-tag target SHA;
   - verify the required metadata bundle exists for the digest;
   - verify the Cosign signature using the repository's required identity and issuer policy; and
   - output the verified digest for alias promotion.
12. Add OCI labels for:
   - product version;
   - resolved source SHA;
   - canonical build tag;
   - source repository URL;
   - build timestamp.
13. Add a workflow summary containing the canonical source tag, SHA, final digest, Docker version marker, staging references, and movable test tag.
14. Update Docker promotion and repair scripts to call the shared published-candidate verifier before copying any alias. Promotion must consume the verifier's resolved digest, never a caller-supplied unchecked digest.
15. Make pre-marker ancillary publication idempotent. Before publishing a digest-keyed metadata bundle or signature, detect existing state, verify it completely, reuse it only when identical and valid, and fail closed on conflicts. Add documented cleanup/retention for orphaned pre-marker digest artifacts.

### Phase 3: Companion publishing workflow

Target: `.github/workflows/build-companion.yml`.

1. Remove `publish_version_override` from `workflow_dispatch` and concurrency naming. Add the same optional existing `build_version` selector as Docker.
2. Add a `main` dispatch guard and use the shared preflight action before matrix construction. Every matrix job checks out the preflight's canonical source SHA.
3. Replace the existing cancel-in-progress concurrency expression with the repository-wide, non-cancelling `companion-release-publication` group and keep it for the full workflow.
4. Remove all temporary `VERSION` rewrite and `sync-version` branches. Require the committed checked-in `VERSION` and `sync-version-check` result.
5. Replace the simple release-absence check with the Companion publication state machine. Preflight outputs `build`, `recover-finalizer`, `complete`, or fails closed; matrix jobs run only for `build`.
6. Revise release-state messages so they:
   - no longer recommend prerelease suffixes;
   - instruct the maintainer to increment the third build-sequence component in `VERSION`, synchronize, commit on `main`, and rerun.
7. Replace `tauri-action` release creation in matrix jobs with direct Tauri packaging commands. Matrix jobs sign/package their selected platform, generate updater artifacts, write an artifact manifest containing names and SHA-256 checksums, and upload only private GitHub Actions artifacts. Artifact names include workflow run ID, run attempt, platform, and target; retries never overwrite an artifact from an earlier attempt.
8. Add one finalizer job after all selected matrix jobs succeed. It downloads every selected artifact and manifest, verifies the complete installer/updater/signature set and all checksums, then rechecks the external release state while the workflow lock is still held.
9. The finalizer creates the one draft release in `helgeklein/sambee-companion`, uploads the verified manifest as its first asset, then uploads and verifies every other asset by name, size, and checksum. It uploads the completion-marker JSON last. The draft becomes complete only after every manifest entry is present and verified and the marker binds the release tag, manifest digest, provenance digest, and complete expected asset set.
10. Configure retained Actions artifacts long enough for audited recovery. For `recover-finalizer`, fetch the exact GitHub artifact IDs and digests recorded in the draft provenance, require their run ID, run attempt, platform, target, and manifest digest to match, accept only missing remote assets or remote assets with the same checksum, and reject conflicts. A recovery run never rebuilds matrix artifacts. Missing or expired retained artifacts require a new `Z` version; they must not be reconstructed.
11. Set `releaseCommitish` only to the release repository's required branch if GitHub requires it; do not misrepresent it as the Sambee source. Instead, make the canonical Sambee tag/SHA first-class release metadata and attach a provenance JSON asset.
12. Include the following in the draft GitHub Release body:
   - Sambee version;
   - canonical build tag;
   - full Sambee source SHA;
   - originating GitHub Actions run ID, run attempt, and run URL;
   - exact retained GitHub artifact IDs and digests;
   - artifact-manifest digest;
   - artifact platform matrix;
   - statement that the release is immutable once created.
13. Keep the draft-release model and existing platform selection, unless a focused review concludes that partial platform release artifacts should be disallowed for the normal release path. A selected partial-platform set must be explicit in the manifest and release body.
14. Add an Actions summary listing concurrency group, workflow state, version, canonical build tag, source SHA, Companion release URL/tag, originating/recovery run IDs, artifact manifest digest, and built platforms.
15. Confirm the feed promotion script uses the release tag's normalized version unchanged and that it will correctly order numeric `Z` updates through Tauri's standard version comparison.
16. Add a shared Companion release verifier used by finalization and every promotion path. It verifies the provenance and completion-marker schemas, exact manifested asset names/sizes/SHA-256 values, expected platform/signature pairs, build tag, source SHA, version, and absence of unmanifested assets unless an explicit schema rule allows them.

### Phase 4: Nonpublishing Companion CI workflow

1. Add `.github/workflows/verify-companion-build.yml` with `pull_request` and optional manual `workflow_dispatch` triggers.
2. Trigger it for Companion source, Tauri configuration, shared version-sync logic, and workflow dependency changes. Use path filters to avoid unnecessary expensive CI work.
3. Run Companion checks first:
   - `npm ci`;
   - TypeScript check and lint;
   - Rust tests and/or the existing validation suite where practical.
4. Build an unsigned package for the agreed baseline platform(s), initially Linux x64 where GitHub-hosted CI can run it reliably. Generate a temporary CI-only Tauri config file that overrides `bundle.createUpdaterArtifacts` to `false`, then invoke `npx tauri build --config <temporary-config>` with the supported Linux bundle set. This prevents the configured production updater-artifact path from requiring `TAURI_SIGNING_PRIVATE_KEY`.
5. Do not pass production signing, notarization, release-repository, or updater-signing secrets. Assert in the workflow that `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, Apple signing variables, and Azure signing variables are unset before packaging.
6. Do not invoke `tauri-action` release creation and do not contact `helgeklein/sambee-companion`.
7. Upload resulting verification artifacts to the workflow run with a short, explicit retention period, then delete the temporary Tauri configuration in an `always()` cleanup step.
8. Document that those artifacts are for test/diagnostic use only and must never be distributed through a public channel or installed as a supported update.
9. Add a proof-of-concept test for this override before relying on it: Linux packaging must succeed without updater/signing secrets, produce no `.sig` updater artifacts, and leave no updater-release output. Decide separately whether trusted same-repository PRs need optional signed Windows/macOS verification. Do not use `pull_request_target`; it would execute untrusted PR code with secrets.

### Phase 5: Promotion and cross-artifact consistency

1. Review `.github/workflows/promote-companion-release.yml` and `.github/scripts/promote_companion_release.py`.
2. Require Companion promotion to call the shared Companion release verifier. It must validate the completion marker and every manifested asset, then resolve `build-v<version>` and fail if the verified source SHA differs from its target.
3. Update `.github/workflows/docker-image-publish.yml` explicitly:
   - join the same non-cancelling `docker-release-publication` concurrency group as candidate publication;
   - retain its `release: published` trigger and do not apply the manual candidate-build `github.ref == refs/heads/main` guard;
   - derive the plain version and canonical `build-v<version>` marker from the published Sambee release tag;
   - resolve the build marker first instead of resolving `sha-<commit>`;
   - run the shared published-candidate verifier and use only its output digest for mutable stable, beta, and major/minor aliases and the immutable exact-version identity;
   - require the candidate revision to equal both the canonical Git tag target and the Sambee release tag target;
   - treat `sha-<commit>` as a consistency/repair alias rather than the candidate source of truth; and
   - fail with an instruction to complete/retry candidate repair before rerunning release publication when required aliases are missing.
4. Add the required versioned `sambee-release.json` asset to Sambee release creation. It records schema version, version, canonical build tag, full source SHA, and component scope (`docker`, `companion`, or `both`) before the draft is published. The Docker release-event workflow reads the asset from its event release; Companion stable/Sambee-download promotion resolves the Sambee release for the Companion version and reads the same asset. Scope `both` requires both shared verifiers to succeed for the same identity before either stable pointer moves; single-component scopes reject promotion of the excluded component. A Docker release-event workflow for `companion` scope exits successfully without mutating Docker tags.
5. Keep individual channel promotion possible. The system must not force a Docker build when only Companion changed, or vice versa.
6. Put every Docker workflow that creates an immutable identity or moves a mutable pointer into `docker-release-publication`. This includes release publishing and any backfill/repair workflow; read-only validation and cleanup workflows do not need the lock. Update the tag helper so immutable destinations are create-or-verify and mutable destinations are verified moves.
7. Ensure all promotion failures leave immutable artifacts untouched and explain which pointer/feed was not updated.

### Phase 6: Documentation update

Follow the `docs-update` skill while editing the versioned website documentation. Use the docs editor tooling, update the earliest applicable documentation version, refresh derived artifacts, and review the generated structure report.

Update these pages as one coherent documentation change:

| Page | Required update |
|---|---|
| `website/content/docs/0.7/developer-guide/release-and-versioning/product-versioning/index.md` | Define the Sambee three-part release-numbering policy, state that it is SemVer-compatible syntax but not strict SemVer semantics, explain `X`, `Y`, and `Z`, and prohibit prerelease/build-metadata suffixes for publishable candidates. Keep `VERSION` and `sync-version` as the source-of-truth procedure. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/release-checklist/index.md` | Replace the separate loosely coupled release steps with the end-to-end candidate loop: increment `Z`, sync and commit on `main`, build only affected component(s), test, repeat as needed, then promote the exact approved artifacts. State that no post-approval rebuild occurs. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/docker-release-overview/index.md` | Explain the Docker candidate identity: canonical candidate tag, immutable source SHA/digest/version marker, valid run-scoped staging tags, shared provenance verification, and mutable channel aliases. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/publish-test-docker-candidate/index.md` | Remove source/version override instructions. Document `main` dispatch, the optional existing-candidate selector, canonical-tag reservation, repository-wide Docker publication lock, valid staging-tag lifecycle, late Docker marker commit point, automatic repair-only path, retry-before-marker rule, and exact test-tag behavior. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/promote-docker-candidate/index.md` | Explain pointer-only promotion, `build-v<version>` as the source of truth, shared source/version/signature verification, the repository-wide mutation lock, and release-workflow retry behavior. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/companion-release-overview/index.md` | Present the separate release repository as immutable artifact/feed infrastructure while defining lockstep version/source identity, independent component builds, and main-only publication. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/build-companion-release/index.md` | Remove `publish_version_override`, prerelease-candidate guidance, and arbitrary source assumptions. Document `main` dispatch, optional existing-candidate selection, canonical candidate tag, matrix-to-finalizer publication, manifest-checked draft repair, release metadata, and platform selection. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/promote-companion-release/index.md` | Document pointer-only promotion, required release source identity, independent channel/feed targets, and coordinated-release checks where applicable. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/companion-channels-feeds-and-downloads/index.md` | Clarify that feeds expose immutable versioned artifacts, never replacements under equal version, and that `test`/`beta`/`stable` select visibility rather than create different binaries. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/_index.md` | Update the guide navigation/summary to describe the main-only candidate and promotion model. |
| Relevant CI/developer documentation outside this directory | Add the nonpublishing Companion PR build path, including its unsigned-artifact and no-secrets constraints. |

Document GitHub Actions concurrency behavior on the Docker and Companion build pages: only one pending run is retained per group, operators must avoid stacking publishing dispatches, and a superseded pending run is safe to dispatch again because it never reached a publication step.

Document the required `docker`/`companion`/`both` release scope, immutable versus mutable Docker tag classes, exact Companion release verification contract, retained-artifact recovery identifiers, and the production release freeze during workflow cutover.

Also update workflow input descriptions, summaries, and failure text so the GitHub Actions UI matches the written process. Remove all documentation that recommends rebuilding a release under the same version or using `-beta`, `-rc`, `-test`, or `+build` suffixes for normal publishable candidates.

### Phase 7: Tests and validation

Add focused automated coverage before enabling the changed publishing workflows:

1. Unit-test the canonical-tag helper:
   - valid and invalid version forms;
   - absent tag reservation;
   - annotated-tag creation and dereferencing;
   - matching tag acceptance after `main` advances;
   - mismatched tag rejection;
   - concurrent annotated-tag push collision handling;
   - remote access failures and actionable diagnostics.
2. Unit-test Docker publication state selection, the shared mutation lock across candidate/release/backfill workflows, marker assignment, immutable create-or-verify behavior, mutable alias moves, valid staging-tag lifecycle, repair-only alias behavior, idempotent metadata/signature reuse, conflicting ancillary state, and the shared published-candidate verifier, using mocked registry/API responses where feasible.
3. Add tests for the Companion publication state machine, cross-run lock, artifact manifest, shared release verifier, and idempotent finalizer: concurrent dispatches, complete upload, interrupted upload recovery by exact artifact ID/digest, multiple run attempts, artifact-name collisions, expired retained artifacts, missing asset, extra asset, checksum mismatch, conflicting provenance, non-circular completion-marker calculation, and complete draft/published release handling.
4. Add workflow-level static checks that ensure release workflows do not expose version/source override inputs and that their preflight job runs before matrix build jobs.
5. Test the nonpublishing Companion workflow in a same-repository pull request:
   - it produces an Actions artifact;
   - it creates no release in the Companion repository;
   - it receives no production secrets;
   - it does not create a canonical candidate tag.
6. Perform controlled staging/manual validation with a new test version:
   - first Docker build creates the candidate tag and Docker marker only after a signed final digest exists;
   - a second Docker dispatch for the same matching version takes the repair-only path, performs no build, and verifies or restores aliases;
   - a conflicting marker provenance fails before build or alias mutation;
   - Docker release publication resolves `build-v<version>`, not `sha-<commit>`, and blocks behind the same mutation lock;
   - a release-triggered Docker promotion validates release/candidate/source identity without applying the manual-dispatch main-ref guard;
   - existing immutable Docker tags at the same digest are accepted and at another digest fail closed;
   - matching pre-marker metadata/signatures are reused and conflicting residue fails closed;
   - Companion build from the same canonical candidate succeeds once after `main` advances;
   - a retry after a deliberately pre-marker Docker failure succeeds without overwriting a source-SHA alias, and its `staging-*` tags are cleaned up;
   - a partially uploaded Companion draft finalizes idempotently from the same manifest;
   - recovery selects exact retained artifact IDs from the recorded run attempt and rejects ambiguous or expired artifacts;
   - Companion promotion rejects any post-completion asset mutation or unmanifested asset;
   - two Companion dispatches cannot build or finalize concurrently, and a superseded pending dispatch can be rerun safely;
   - a mismatched commit with the same `VERSION` fails;
   - promotion moves only pointers/feeds and does not rebuild;
   - `both` scope blocks either stable promotion until both artifacts verify, while single-component scopes allow only their named component.
7. Validate Tauri behavior with two successive versions on the test channel, confirming that the later `Z` value is offered and installed as an update.
8. Run repository checks appropriate to each touched area:
   - Python tests for helper scripts;
   - workflow YAML/actionlint validation if available;
   - Companion validation suite for Companion workflow/configuration changes;
   - documentation derived-artifact refresh and docs structure report after docs edits.

## Rollout Sequence

1. Land the shared preflight helper and its tests without changing workflow entry points.
2. Add the nonpublishing Companion CI workflow and validate it on a pull request.
3. Start a documented production release freeze. During the freeze, permit only explicitly identified controlled test candidates and prohibit stable/beta promotion through legacy workflows.
4. Change the Docker publishing workflow, validate one controlled Docker-only candidate, and confirm marker/retry behavior.
5. Change the Companion publishing workflow, validate a matrix failure retry, a finalizer retry, one controlled Companion-only candidate, and feed promotion to `test`.
6. Add both shared promotion verifiers, required release scope, and coordinated identity checks; validate a coordinated candidate where both artifacts share one canonical tag.
7. Disable legacy override entry points atomically with enabling the new production workflows. Do not permit a mixed-mode production publication window.
8. Update all release/versioning documentation in one coherent documentation change and regenerate derived artifacts.
9. Announce the cutover rules, end the production release freeze, and monitor the first production publication and recovery paths.

## Acceptance Criteria

The change is complete when all of the following are true:

- `VERSION` is the only input that determines a publishable Docker or Companion version.
- New candidates have no version or source override. Existing candidates can only be selected by a validated canonical candidate version.
- A Docker or Companion release workflow cannot publish from a feature branch, pull-request ref, arbitrary Git tag, or arbitrary SHA.
- A feature-branch Companion CI build works without creating public/release artifacts or consuming a candidate version.
- The first release workflow for `X.Y.Z` atomically binds `build-vX.Y.Z` to a `main` commit.
- A later workflow for the other component can select and reuse that tag after `main` advances, only when it resolves to a commit reachable from `main`.
- Reusing `X.Y.Z` from another commit fails before expensive work begins.
- Docker cannot publish a second immutable version marker for the same version.
- Companion cannot create a second release for the same version.
- A pre-marker Docker failure and a pre-finalizer Companion matrix failure can be retried with the same version and source commit.
- Docker stages images only under unique run-scoped references until the signed candidate marker is committed; source-SHA and channel aliases are never overwritten by a retry.
- Docker serializes candidate publication repository-wide and validates marker provenance, metadata, and signature before either repair or promotion changes an alias.
- Docker release publication resolves the immutable candidate marker first and shares the mutation lock with candidate, backfill, and repair operations.
- Exact Docker version, candidate, and source-SHA tags are create-or-verify immutable identities; only channel and major/minor pointers may move.
- Pre-marker Docker metadata and signatures are safely reusable only after complete verification, and conflicts fail closed.
- Companion serializes publishing workflows repository-wide and publishes assets only through one manifest-validated finalizer; an interrupted finalizer can resume only from the exact recorded retained artifact IDs/digests and only with byte-identical assets.
- Every Companion promotion revalidates the completion marker and the complete manifested release asset set.
- Every public release records a valid component scope, and stable promotion enforces it before moving any pointer.
- Operators understand that GitHub concurrency retains only one pending run per group and safely redispatch superseded runs.
- The nonpublishing Companion CI package succeeds with a generated updater-artifacts-disabled configuration and no production signing or updater secrets.
- Promotion moves existing Docker aliases or Companion feed pointers only; it never triggers a build.
- A coordinated Docker/Companion promotion verifies identical version and source identity.
- The release checklist describes a build-test-repeat-promote loop with no final rebuild.
- All relevant release/versioning docs, workflow labels, inputs, and error messages use the new terminology and rules.

## Open Implementation Decisions

Resolve these small operational details during implementation, with the defaults below unless a platform limitation requires another choice:

| Decision | Default |
|---|---|
| Docker immutable version marker name | `build-v<version>` so it is visibly distinct from mutable stable/beta channel tags. |
| Docker publication lock | Repository-wide non-cancelling `docker-release-publication` workflow concurrency group. |
| Companion publication lock | Repository-wide non-cancelling `companion-release-publication` workflow concurrency group. |
| Docker staging tags | Same-repository tags named `staging-<run-id>-<attempt>-<platform>`, deleted in an `always()` cleanup job and covered by stale-tag retention. |
| Build tag annotation | Annotated Git tag containing version, full SHA, workflow URL/run ID, and creation timestamp; reserve by creating and non-force-pushing that annotated tag, then dereference and compare it after a collision. |
| Candidate tag creation permission | `contents: write` only in trusted `main` publishing workflows. |
| Candidate-build main-only guard | Require manually dispatched candidate builds to have `github.ref == refs/heads/main`. A new candidate uses captured `github.sha`; an existing candidate is allowed only when its tag target is an ancestor of current `origin/main`. Release/promotion events validate immutable release metadata instead. |
| Companion PR package platform | Linux x64 unsigned package first; add more platforms only when the cost and test value justify them. |
| Release metadata format | Human-readable GitHub Release body, mandatory machine-readable Companion provenance and completion-marker JSON assets, and machine-readable OCI labels/annotations for Docker. |
| Public release metadata and component scope | Required versioned `sambee-release.json` release asset with version, build tag, source SHA, and `docker`/`companion`/`both` scope; promotion fails when absent, malformed, or inconsistent. |
| Docker tag mutation classes | Immutable create-or-verify: candidate, source SHA, exact version. Mutable verified pointers: test, beta, stable, major/minor. |
| Companion retained artifact identity | Record GitHub artifact ID, digest, run ID, run attempt, platform, and target; recovery downloads exact IDs only. |
| Version-marker publication point | After final digest verification, required metadata, and signing complete; before `sha-<source-sha>` and mutable channel aliases. |

## Non-Goals

- Do not merge Docker and Companion release repositories or move Tauri feeds into the main Sambee deployment.
- Do not force both expensive components to build for every candidate.
- Do not allow equal-version artifact replacement as an updater strategy.
- Do not change the public updater key or feed-host architecture.
- Do not use feature-branch or pull-request builds as published Tauri update artifacts.
- Do not rely on SemVer prerelease/build metadata for normal candidate sequencing.
