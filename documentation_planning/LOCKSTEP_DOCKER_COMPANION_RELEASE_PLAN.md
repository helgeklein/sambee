# Lockstep Docker and Companion Release Plan

## Purpose

Simplify Sambee and Companion releases while preserving the separate Companion release repository and its Tauri update feeds.

The release process must provide these outcomes:

- Docker and Companion use the same product version whenever both are released for a candidate.
- Every published Docker candidate and Tauri release has an immutable version and source commit.
- The approved artifact is promoted without rebuilding it.
- Docker and Companion publishing remain independent because each build is expensive and most work affects only one of them.
- Only builds originating from `main` may publish release artifacts.
- Companion can still be packaged in CI for feature branches, but those builds are verification-only and are never published to the Companion release repository or updater feeds.
- A version already associated with a source commit cannot be associated with a different source commit.
- A failed build may be retried with the same version only until that component has published an immutable artifact.

This plan deliberately changes the operational meaning of the three numeric version components. Sambee keeps a SemVer-compatible `X.Y.Z` syntax for tooling and Tauri ordering, but does not claim strict SemVer release semantics:

| Component | Sambee meaning |
|---|---|
| `X` | User-visible product release number. Increment for every normal, non-hotfix release, including backward-compatible releases. |
| `Y` | Maintenance/hotfix release number within product release `X`. Reset to `0` for a new product release. |
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

### Publish boundary

- Docker and Companion release-publishing workflows run only from commits reachable from `main`.
- Prefer requiring the workflow dispatch ref to be `main` and resolving its exact `HEAD` SHA in the initial preflight job.
- A caller may not supply an arbitrary branch, pull-request ref, tag, or source SHA to a publishing workflow.
- The workflow records the resolved `main` SHA in all release metadata and summaries.

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
candidate-v<version> -> immutable main commit used for release artifacts
```

Examples:

```text
candidate-v1.0.4 -> 3d7c0d4...
candidate-v1.1.0 -> b3ca2eb...
```

The tag is a shared registry, not a component completion marker. Do not add Docker- or Companion-specific candidate tags.

For each publishing workflow preflight:

1. Check out the `main` commit selected for the dispatch.
2. Verify the checked-in version metadata with the existing `sync-version-check` action.
3. Read and validate the plain `X.Y.Z` version from `VERSION`. Reject prerelease and build-metadata forms for publishable candidates.
4. Resolve `HEAD` to the full source SHA.
5. Fetch `refs/tags/candidate-v<version>` from `origin`.
6. If it does not exist, create and push it atomically at `HEAD`.
7. If it exists at `HEAD`, continue. This supports the other component's build and retries before publication.
8. If it exists at another SHA, fail before any expensive build. The version is already bound to another source commit.

Use a direct `git push origin <sha>:refs/tags/candidate-v<version>` for reservation. Treat an existing remote ref error as a normal concurrency case: fetch it again, compare its SHA to the resolved SHA, continue only if equal, otherwise fail. Do not use a check-then-create sequence as the only protection.

The tag remains permanently after a failed build. It establishes source identity, but it does not by itself mean a Docker image or Companion release was published.

### Independent Docker and Companion publication

Each workflow owns only its component's artifact-existence check after the shared canonical-tag check:

| Workflow | Already-published artifact check | Retry rule |
|---|---|---|
| Docker | Check an immutable version-specific Docker marker in GHCR. Add an OCI image tag such as `candidate-v<version>` or `v<version>` that is written only after all candidate publication and metadata/signing steps succeed. | Retry the same version when the marker is absent. Refuse overwrite once it exists. |
| Companion | Keep the existing check that rejects an existing `companion-v<version>` GitHub Release, draft or published, in `helgeklein/sambee-companion`. | Retry the same version while no release exists. Refuse a new build once the release exists. |

The component check must occur in the first preflight job before platform matrices, signing, or packaging work begins.

The Docker version marker must point to the exact candidate digest, alongside the existing immutable `sha-<full-commit-sha>` tag. The existing `test`, `beta`, and `stable` tags remain mutable channel aliases and must not be used for uniqueness checks.

### Retry and recovery policy

| Situation | Required behavior |
|---|---|
| Canonical candidate tag absent | Reserve it at the resolved `main` commit and proceed. |
| Canonical tag exists at the same SHA; component artifact absent | Proceed. This covers the other component's first build and retries after a prepublication failure. |
| Canonical tag exists at a different SHA | Fail. Increment `Z`, synchronize metadata, commit on `main`, and build a new candidate. |
| Docker version marker exists | Fail the Docker workflow. Never overwrite a published version-specific image marker. |
| Companion release exists, draft or published | Fail the Companion workflow. Never replace released assets under the same tag. |
| Docker publication succeeds but a later workflow notification/check fails | Treat the Docker marker as consumed. Repair by creating the next `Z` version if a different artifact is required. |
| Companion release is created but not published or promoted | Treat the version as consumed for Companion. Review/publish/promote that immutable release, or use the next `Z` version for replacement assets. |

This permits retries for infrastructure failures before publication while preserving immutable published artifacts. A gap in build sequence numbers is valid and preferable to overwriting an artifact identity.

### Promotion

- Promotion remains a pointer-only operation. It must never rebuild Docker or Companion artifacts.
- Docker promotion continues to move `test`, `beta`, and `stable` aliases to the selected immutable digest.
- Companion promotion continues to rewrite independent Tauri channel feeds and Sambee direct-download metadata in `helgeklein/sambee-companion`.
- Promotion inputs must identify the immutable artifact version/release, not a branch head.
- Before promotion, validate that artifact metadata records the same canonical source SHA as `candidate-v<version>`.
- When both Docker and Companion are intended to form one release, require both artifacts to exist for the same version and canonical tag before promoting either to stable or updating public download metadata.
- Docker-only and Companion-only maintenance candidates remain allowed; only promote the component that was built and approved.

### Release tag and release notes

- Keep the existing main Sambee Git release/tag creation after the approved candidate is selected, but change its source reference to the canonical `candidate-v<version>` commit.
- Since publishing only originates from `main`, that tag always points to a `main` commit and remains compatible with squash-merge history.
- The Docker and Companion release metadata must state the product version and full source SHA.
- Continue using one Sambee "What's New" page per public product version. Candidate builds are not separate public release-note entries; the promoted build's final version is the page identity.

## Implementation Phases

### Phase 1: Version policy and shared validation

1. Add a small release-candidate helper, preferably `.github/scripts/prepare_release_candidate.py` or a focused shell helper with automated tests.
2. Give it explicit inputs for `--version`, `--source-sha`, and `--component` only where the component-specific check needs it.
3. Implement plain publishable-version validation:
   - Accept exactly `X.Y.Z`, with non-negative numeric components and no leading zeroes other than `0` itself.
   - Reject `-prerelease` and `+build` suffixes for release-publishing workflows.
   - Emit actionable failures that name the required next step: update `VERSION`, run `./scripts/sync-version`, commit, and rerun from `main`.
4. Implement canonical tag reservation and comparison against the remote repository.
5. Add the helper's tests for absent tags, matching tags, mismatched tags, concurrent creation conflicts, invalid versions, and remote/API failures.
6. Add a reusable composite action, for example `.github/actions/release-candidate-preflight/action.yml`, only if it cleanly prevents duplication between Docker and Companion workflows. Its responsibilities should be limited to:
   - verify version synchronization;
   - resolve and output the version and full SHA;
   - verify the selected source is an allowed `main` commit;
   - create or validate the canonical candidate tag;
   - expose outputs needed by the caller.
7. Keep component-specific published-artifact checks outside the shared action, because Docker registry state and GitHub Release state are different concerns.

### Phase 2: Docker publishing workflow

Target: `.github/workflows/docker-image-preview-publish.yml`.

1. Remove the `source_ref` and `publish_version_override` dispatch inputs.
2. Restrict workflow dispatch to `main` operationally and add an explicit runtime guard that resolves `origin/main` and rejects any checked-out source not equal to its intended `main` commit.
3. Replace the current override branches with the shared preflight action. All jobs use its resolved version and source SHA.
4. Move the Docker-specific existence check into the preflight stage:
   - query GHCR for the planned immutable version marker;
   - fail with a clear message if it exists;
   - tolerate absence so failed prepublication runs can be retried.
5. Preserve existing digest-first multi-platform build, health validation, Trivy scan, provenance/SBOM, Cosign signing, and `sha-<commit>` publication behavior.
6. After all immutable candidate publication and required metadata/signing steps succeed, create the Docker version marker pointing at the final multi-platform digest.
7. Only after the marker succeeds, move `test` to the digest. Define and document whether a failure moving `test` is retried without rebuilding or repaired operationally; do not create another image for the same marker.
8. Add OCI labels for:
   - product version;
   - resolved source SHA;
   - canonical candidate tag;
   - source repository URL;
   - build timestamp.
9. Add a workflow summary containing the canonical tag, SHA, immutable digest, version marker, and movable test tag.
10. Review the existing Docker promotion workflow and scripts to ensure they can select the version marker or digest unambiguously and that they never rebuild.

### Phase 3: Companion publishing workflow

Target: `.github/workflows/build-companion.yml`.

1. Remove `publish_version_override` from `workflow_dispatch` and concurrency naming.
2. Add a `main` source guard and use the shared preflight action before matrix construction.
3. Remove all temporary `VERSION` rewrite and `sync-version` branches. Require the committed checked-in `VERSION` and `sync-version-check` result.
4. Retain the existing early GitHub Release uniqueness check, but revise its message:
   - no longer recommend prerelease suffixes;
   - instruct the maintainer to increment the third build-sequence component in `VERSION`, synchronize, commit on `main`, and rerun.
5. Make the Tauri action's release commitish the canonical source SHA or canonical candidate tag instead of the release repository's `main` branch. Confirm the action can create the release in `helgeklein/sambee-companion` while the tag points to the intended Sambee source reference; if not, include the SHA in the release body and create a lightweight companion-repository tag only when required by GitHub's release API.
6. Include the following in the draft GitHub Release body:
   - Sambee version;
   - canonical candidate tag;
   - full Sambee source SHA;
   - artifact platform matrix;
   - statement that the release is immutable once created.
7. Keep the draft-release model and existing platform selection, unless a focused review concludes that partial platform release artifacts should be disallowed for the normal release path.
8. Add an Actions summary listing version, canonical tag, source SHA, Companion release URL/tag, and built platforms.
9. Confirm the feed promotion script uses the release tag's normalized version unchanged and that it will correctly order numeric `Z` updates through Tauri's standard version comparison.

### Phase 4: Nonpublishing Companion CI workflow

1. Add `.github/workflows/verify-companion-build.yml` with `pull_request` and optional manual `workflow_dispatch` triggers.
2. Trigger it for Companion source, Tauri configuration, shared version-sync logic, and workflow dependency changes. Use path filters to avoid unnecessary expensive CI work.
3. Run Companion checks first:
   - `npm ci`;
   - TypeScript check and lint;
   - Rust tests and/or the existing validation suite where practical.
4. Build an unsigned package for the agreed baseline platform(s), initially Linux x64 where GitHub-hosted CI can run it reliably.
5. Do not pass production signing, notarization, release-repository, or updater-signing secrets.
6. Do not invoke `tauri-action` release creation and do not contact `helgeklein/sambee-companion`.
7. Upload resulting verification artifacts to the workflow run with a short, explicit retention period.
8. Document that those artifacts are for test/diagnostic use only and must never be distributed through a public channel or installed as a supported update.
9. Decide separately whether trusted same-repository PRs need optional signed Windows/macOS verification. Do not use `pull_request_target`; it would execute untrusted PR code with secrets.

### Phase 5: Promotion and cross-artifact consistency

1. Review `.github/workflows/promote-companion-release.yml` and `.github/scripts/promote_companion_release.py`.
2. Add a pre-promotion source-identity check for Companion:
   - resolve the Companion release's recorded Sambee source SHA;
   - resolve `candidate-v<version>`;
   - fail if they differ or release metadata is missing.
3. Review the Docker promotion workflow and add an analogous digest-label/source-SHA check.
4. For an operation that promotes both components to stable or updates Sambee's public Companion metadata as part of a coordinated release, add an optional validation step requiring:
   - same version;
   - same canonical candidate tag;
   - same full source SHA;
   - both immutable component artifacts exist.
5. Keep individual channel promotion possible. The system must not force a Docker build when only Companion changed, or vice versa.
6. Ensure all promotion failures leave immutable artifacts untouched and explain which pointer/feed was not updated.

### Phase 6: Documentation update

Follow the `docs-update` skill while editing the versioned website documentation. Use the docs editor tooling, update the earliest applicable documentation version, refresh derived artifacts, and review the generated structure report.

Update these pages as one coherent documentation change:

| Page | Required update |
|---|---|
| `website/content/docs/0.7/developer-guide/release-and-versioning/product-versioning/index.md` | Define the Sambee three-part release-numbering policy, state that it is SemVer-compatible syntax but not strict SemVer semantics, explain `X`, `Y`, and `Z`, and prohibit prerelease/build-metadata suffixes for publishable candidates. Keep `VERSION` and `sync-version` as the source-of-truth procedure. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/release-checklist/index.md` | Replace the separate loosely coupled release steps with the end-to-end candidate loop: increment `Z`, sync and commit on `main`, build only affected component(s), test, repeat as needed, then promote the exact approved artifacts. State that no post-approval rebuild occurs. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/docker-release-overview/index.md` | Explain the Docker candidate identity: canonical candidate tag, immutable source SHA/digest/version marker, and mutable channel aliases. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/publish-test-docker-candidate/index.md` | Remove source/version override instructions. Document `main`-only publishing, canonical-tag reservation, Docker marker collision failure, retry-before-publication rule, and exact test-tag behavior. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/promote-docker-candidate/index.md` | Explain pointer-only promotion and source/version verification before promotion. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/companion-release-overview/index.md` | Present the separate release repository as immutable artifact/feed infrastructure while defining lockstep version/source identity, independent component builds, and main-only publication. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/build-companion-release/index.md` | Remove `publish_version_override`, prerelease-candidate guidance, and arbitrary source assumptions. Document main-only build, canonical candidate tag, duplicate-release failure, retry rules, release metadata, and platform selection. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/promote-companion-release/index.md` | Document pointer-only promotion, required release source identity, independent channel/feed targets, and coordinated-release checks where applicable. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/companion-channels-feeds-and-downloads/index.md` | Clarify that feeds expose immutable versioned artifacts, never replacements under equal version, and that `test`/`beta`/`stable` select visibility rather than create different binaries. |
| `website/content/docs/0.7/developer-guide/release-and-versioning/_index.md` | Update the guide navigation/summary to describe the main-only candidate and promotion model. |
| Relevant CI/developer documentation outside this directory | Add the nonpublishing Companion PR build path, including its unsigned-artifact and no-secrets constraints. |

Also update workflow input descriptions, summaries, and failure text so the GitHub Actions UI matches the written process. Remove all documentation that recommends rebuilding a release under the same version or using `-beta`, `-rc`, `-test`, or `+build` suffixes for normal publishable candidates.

### Phase 7: Tests and validation

Add focused automated coverage before enabling the changed publishing workflows:

1. Unit-test the canonical-tag helper:
   - valid and invalid version forms;
   - absent tag reservation;
   - matching tag acceptance;
   - mismatched tag rejection;
   - concurrent push collision handling;
   - remote access failures and actionable diagnostics.
2. Unit-test Docker artifact-marker lookup and state interpretation, using mocked registry/API responses where feasible.
3. Retain and extend tests for `check_companion_release_tag_absent.py` to cover draft and published releases, pagination, authorization failures, and the revised message.
4. Add workflow-level static checks that ensure release workflows do not expose version/source override inputs and that their preflight job runs before matrix build jobs.
5. Test the nonpublishing Companion workflow in a same-repository pull request:
   - it produces an Actions artifact;
   - it creates no release in the Companion repository;
   - it receives no production secrets;
   - it does not create a canonical candidate tag.
6. Perform controlled staging/manual validation with a new test version:
   - first Docker build creates the candidate tag and Docker marker;
   - second Docker build of the same version fails before build;
   - Companion build from the same `main` commit succeeds once;
   - a retry after a deliberately prepublication failure succeeds;
   - a mismatched commit with the same `VERSION` fails;
   - promotion moves only pointers/feeds and does not rebuild.
7. Validate Tauri behavior with two successive versions on the test channel, confirming that the later `Z` value is offered and installed as an update.
8. Run repository checks appropriate to each touched area:
   - Python tests for helper scripts;
   - workflow YAML/actionlint validation if available;
   - Companion validation suite for Companion workflow/configuration changes;
   - documentation derived-artifact refresh and docs structure report after docs edits.

## Rollout Sequence

1. Land the shared preflight helper and its tests without changing workflow entry points.
2. Add the nonpublishing Companion CI workflow and validate it on a pull request.
3. Change the Docker publishing workflow, validate one controlled Docker-only candidate, and confirm marker/retry behavior.
4. Change the Companion publishing workflow, validate one controlled Companion-only candidate and feed promotion to `test`.
5. Add promotion identity checks and validate a coordinated candidate where both artifacts share one canonical tag.
6. Update all release/versioning documentation in one coherent documentation change and regenerate derived artifacts.
7. Announce the cutover rules to release operators. Disable or remove legacy overrides only after the new path has been validated.

## Acceptance Criteria

The change is complete when all of the following are true:

- `VERSION` is the only input that determines a publishable Docker or Companion version.
- Normal release-publishing workflows accept no version or source override.
- A Docker or Companion release workflow cannot publish from a feature branch, pull-request ref, tag, or arbitrary SHA.
- A feature-branch Companion CI build works without creating public/release artifacts or consuming a candidate version.
- The first release workflow for `X.Y.Z` atomically binds `candidate-vX.Y.Z` to a `main` commit.
- A later workflow for the other component can reuse that tag only when it resolves to the same commit.
- Reusing `X.Y.Z` from another commit fails before expensive work begins.
- Docker cannot publish a second immutable version marker for the same version.
- Companion cannot create a second release for the same version.
- A prepublication failure can be retried with the same version and source commit.
- Promotion moves existing Docker aliases or Companion feed pointers only; it never triggers a build.
- A coordinated Docker/Companion promotion verifies identical version and source identity.
- The release checklist describes a build-test-repeat-promote loop with no final rebuild.
- All relevant release/versioning docs, workflow labels, inputs, and error messages use the new terminology and rules.

## Open Implementation Decisions

Resolve these small operational details during implementation, with the defaults below unless a platform limitation requires another choice:

| Decision | Default |
|---|---|
| Docker immutable version marker name | `candidate-v<version>` so it is visibly distinct from mutable stable/beta channel tags. |
| Candidate tag annotation | Annotated Git tag containing version, full SHA, workflow URL/run ID, and creation timestamp. |
| Candidate tag creation permission | `contents: write` only in trusted `main` publishing workflows. |
| Main-only guard | Validate both dispatch context and resolved source SHA against `origin/main`; document that manual dispatch must start from `main`. |
| Companion PR package platform | Linux x64 unsigned package first; add more platforms only when the cost and test value justify them. |
| Release metadata format | Human-readable GitHub Release body plus machine-readable OCI labels; add a small JSON provenance asset only if promotion cannot reliably read those fields. |
| Version-marker publication point | After final candidate digest, required metadata, and signing complete; before moving the mutable `test` tag. |

## Non-Goals

- Do not merge Docker and Companion release repositories or move Tauri feeds into the main Sambee deployment.
- Do not force both expensive components to build for every candidate.
- Do not allow equal-version artifact replacement as an updater strategy.
- Do not change the public updater key or feed-host architecture.
- Do not use feature-branch or pull-request builds as published Tauri update artifacts.
- Do not rely on SemVer prerelease/build metadata for normal candidate sequencing.
