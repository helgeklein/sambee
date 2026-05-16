# GHCR SBOM And Provenance Implementation Spec

Purpose: implement the Option B decision with a two-repository layout while preserving a reviewable release verification chain.

## Final Scope

- Keep `ghcr.io/<owner>/sambee` for runnable images and image tags only.
- Use `ghcr.io/<owner>/sambee-signatures` as the single non-runnable-artifacts repository.
- Move SBOM and provenance publication out of the main image package.
- Replace inline-attestation verification in release promotion with bundle verification in the dedicated artifacts repository.
- Mirror the generated bundle files into GitHub release assets as a convenience copy.

Non-goals:

- do not change runtime image contents
- do not change release tag names or channel-tag promotion behavior
- do not rely on cross-repository OCI referrer discovery
- do not make GitHub Actions workflow artifacts the canonical store

## Repository And Tag Contract

- Runnable images remain in `ghcr.io/<owner>/sambee`.
- Signatures and metadata bundles live in `ghcr.io/<owner>/sambee-signatures`.
- The metadata bundle tag is derived from the promoted image digest.
- For an image digest `sha256:<hex>`, the metadata tag is `sha256-<hex>.meta`.
- The canonical metadata bundle reference is therefore:
  - `ghcr.io/<owner>/sambee-signatures:sha256-<hex>.meta`
- Cosign continues to manage `sha256-<digest>.sig` and any future `sha256-<digest>.att` tags in the same repository.
- Custom metadata publication must never reuse the `.sig` or `.att` suffix namespaces.

## Bundle Format

### Required files

- `metadata.json`
- `provenance/intoto.jsonl`
- `sbom/linux-amd64.spdx.json`
- `sbom/linux-arm64.spdx.json`

### `metadata.json` schema

`metadata.json` is the verification entry point. It must contain, at minimum:

```json
{
  "schema_version": 1,
  "bundle_type": "sambee.image-metadata",
  "image_repository": "ghcr.io/<owner>/sambee",
  "image_digest": "sha256:<index-hex>",
  "metadata_repository": "ghcr.io/<owner>/sambee-signatures",
  "metadata_tag": "sha256-<index-hex>.meta",
  "version": "<release-version>",
  "revision": "<git-sha>",
  "source_url": "https://github.com/<owner>/<repo>",
  "created": "<UTC RFC3339 timestamp>",
  "platforms": [
    {
      "platform": "linux/amd64",
      "manifest_digest": "sha256:<amd64-manifest-hex>",
      "sbom_path": "sbom/linux-amd64.spdx.json"
    },
    {
      "platform": "linux/arm64",
      "manifest_digest": "sha256:<arm64-manifest-hex>",
      "sbom_path": "sbom/linux-arm64.spdx.json"
    }
  ],
  "provenance": {
    "path": "provenance/intoto.jsonl",
    "predicate_type_prefix": "https://slsa.dev/provenance/"
  },
  "checksums": {
    "provenance/intoto.jsonl": "sha256:<hex>",
    "sbom/linux-amd64.spdx.json": "sha256:<hex>",
    "sbom/linux-arm64.spdx.json": "sha256:<hex>"
  }
}
```

Required rules:

- `image_digest` is the multi-arch index digest that release promotion already resolves.
- `metadata_tag` must match the digest-to-tag transformation exactly.
- `platforms` must list every runnable manifest present in the promoted image index.
- `checksums` must cover the extracted payload files referenced by the bundle: `provenance/intoto.jsonl` and each SBOM file.
- `created` is the bundle creation time, not the git commit time.

### Provenance content rules

- `provenance/intoto.jsonl` contains newline-delimited in-toto statements extracted from the Buildx attestation output.
- At least one provenance statement must exist for each runnable platform manifest.
- Every provenance statement must have a `predicateType` beginning with `https://slsa.dev/provenance/`.
- Every provenance statement subject digest must match one of the manifest digests listed in `metadata.json`.

### SBOM content rules

- Each SBOM file must be valid SPDX JSON.
- The file naming convention is fixed to `linux-amd64.spdx.json` and `linux-arm64.spdx.json`.
- Each platform listed in `metadata.json.platforms` must reference exactly one SBOM file.

## Publication Mechanism

- Publish metadata bundles as OCI artifacts in `ghcr.io/<owner>/sambee-signatures`.
- Use ORAS for custom artifact publication and retrieval.
- Artifact type for the bundle is `application/vnd.sambee.image-metadata.v1`.
- Preserve the file paths listed above when pushing and pulling the artifact.

Concrete workflow command shape:

```bash
oras push "$METADATA_REPOSITORY:$METADATA_TAG" \
  --artifact-type application/vnd.sambee.image-metadata.v1 \
  metadata.json:application/json \
  provenance/intoto.jsonl:application/json \
  sbom/linux-amd64.spdx.json:application/spdx+json \
  sbom/linux-arm64.spdx.json:application/spdx+json
```

Concrete verification command shape:

```bash
oras pull "$METADATA_REPOSITORY:$METADATA_TAG" --output "$BUNDLE_DIR"
```

## Workflow Changes

### 1. Preview publication workflow

Update `.github/workflows/docker-image-preview-publish.yml` as follows:

- In `prepare`, keep emitting `image_name` and `signature_repository`.
- Treat `signature_repository` as the metadata repository; do not add a third repository.
- In `build-and-publish-immutable`, disable inline publication by changing:
  - `provenance: false`
  - `sbom: false`
- Add a new `build-metadata-bundle` job that runs after the immutable image is pushed.

`build-metadata-bundle` responsibilities:

- Check out the same git ref used for the image build.
- Set up Docker Buildx, crane, jq, and ORAS.
- Produce a second, non-pushed OCI layout build with Buildx using the same inputs as the published image, but with attestation generation enabled.
- Use an OCI-layout output such as `type=oci,dest=$RUNNER_TEMP/attested-image.oci`.
- Keep `provenance: true` and `sbom: true` on this local export build so the bundle content still originates from Buildx.
- Resolve the pushed image index digest and runnable child manifest digests from `ghcr.io/<owner>/sambee@<digest>` using `crane manifest` and `jq`.
- Extract the attestation blobs from the local OCI layout into:
  - `provenance/intoto.jsonl`
  - `sbom/linux-amd64.spdx.json`
  - `sbom/linux-arm64.spdx.json`
- Generate `metadata.json` using the pushed image digest, pushed platform manifest digests, version, revision, and source URL.
- Compute file checksums and embed them into `metadata.json`.
- Publish the bundle to `ghcr.io/<owner>/sambee-signatures:sha256-<index-hex>.meta`.

Gating rule:

- `promote-test-tag` must depend on successful metadata bundle publication, not only on image publication.

### 2. Release publication workflow

Update `.github/workflows/docker-image-publish.yml` as follows:

- In `prepare`, keep using the same `signature_repository` output as the metadata repository.
- In `verify-candidate-artifact`, replace the `Verify candidate attestations` step with a new `Verify candidate metadata bundle` step.
- Verification must fetch the metadata bundle derived from the candidate digest and fail the workflow if the bundle is absent or malformed.
- Keep image metadata verification in `verify_candidate_image.sh` unchanged.
- Keep image tag promotion unchanged.
- Keep Cosign image signing unchanged.
- After release tags are published, upload the exact bundle files to the GitHub release as assets with `gh release upload --clobber`.

### 3. Backfill workflow

Update `.github/workflows/docker-image-backfill.yml` as follows:

- Reuse the same metadata repository contract as the release workflow.
- Replace inline attestation verification with metadata bundle verification.
- If the target release predates the new bundle format and the metadata tag is absent, generate and publish the bundle before promoting tags.
- After publication, run the same metadata bundle verification used by the release workflow.
- Upload the bundle files to the GitHub release if they are missing.

## Scripts To Add Or Replace

Add:

- `.github/scripts/metadata_bundle_tag.sh`
  - Input: image digest in `sha256:<hex>` form
  - Output: `sha256-<hex>.meta`
- `.github/scripts/extract_metadata_bundle_from_oci.sh`
  - Reads the local OCI layout produced by the attested export build
  - Extracts Buildx-generated provenance and SBOM blobs into the canonical file layout
  - Emits `metadata.json` with checksums and manifest-digest mapping
- `.github/scripts/publish_metadata_bundle.sh`
  - Pushes the bundle via ORAS with the fixed artifact type
- `.github/scripts/verify_candidate_metadata_bundle.sh`
  - Pulls the bundle for a candidate image digest
  - Verifies metadata contract, file checksums, platform mapping, SBOM presence, and provenance presence

Retire after rollout:

- `.github/scripts/verify_candidate_attestations.sh`
  - Keep temporarily during the preview-only dual-publication phase
  - Remove once bundle verification is the only production path

## Verification Contract

`verify_candidate_metadata_bundle.sh` must accept:

```text
--image-ref <ghcr.io/...@sha256:...>
--metadata-repository <ghcr.io/...>
--expected-version <version>
--expected-revision <git-sha>
--expected-source <https://github.com/...>
```

It must perform these checks, in order:

1. Derive the metadata tag from the image digest.
2. Pull the matching bundle from the metadata repository.
3. Verify that all required files exist.
4. Verify that `metadata.json` is valid JSON and `schema_version == 1`.
5. Verify that `image_repository`, `image_digest`, `metadata_repository`, `metadata_tag`, `version`, `revision`, and `source_url` match the expected values.
6. Fetch the candidate image index manifest from GHCR and derive the runnable platform manifest digests.
7. Verify that `metadata.json.platforms` matches the runnable platform manifests exactly.
8. Verify file checksums for `metadata.json`, `provenance/intoto.jsonl`, and both SBOM files.
9. Verify that each SBOM file parses as JSON and carries an SPDX JSON document marker.
10. Verify that `provenance/intoto.jsonl` contains at least one provenance statement per runnable platform manifest.
11. Verify that every provenance subject digest is one of the platform manifest digests listed in `metadata.json`.
12. Fail on any extra platform entry, missing platform entry, checksum mismatch, or predicate-type mismatch.

## Test Plan

Add unit coverage for the new verifier script in `backend/tests/test_verify_candidate_metadata_bundle_script.py`.

Required test cases:

- accepts a complete bundle for both platforms
- fails when the metadata tag does not match the candidate digest
- fails when one SBOM file is missing
- fails when provenance is missing for one platform
- fails when `metadata.json` revision or source URL does not match the expected value
- fails when a provenance subject digest is not one of the candidate platform manifests
- fails when any recorded checksum does not match the pulled file

Keep the existing `test_verify_candidate_attestations_script.py` tests until the old verifier is removed.

## Rollout Plan

### Phase 1: Publish metadata bundles from preview builds

- Disable inline Buildx attestation publication in the main image package.
- Generate the replacement metadata bundle from a local attested OCI export build.
- Publish the bundle into `ghcr.io/<owner>/sambee-signatures` under the digest-derived `.meta` tag.

### Phase 2: Verify bundles in release and backfill workflows

- Replace release and backfill attestation verification with metadata bundle verification.
- Keep Cosign signing behavior unchanged.
- Upload the bundle files to the GitHub release as convenience assets.

### Phase 3: Remove legacy verifier and update docs

- Remove `verify_candidate_attestations.sh` and its tests.
- Update the published docs to describe the final two-repository model.
- Confirm GHCR main-package pages no longer show the `unknown` attestation row for new versions.

## Done Criteria

- New preview publishes create a metadata bundle tag in `ghcr.io/<owner>/sambee-signatures`.
- Release promotion fails if the expected metadata bundle is missing or inconsistent.
- GitHub releases carry the same bundle files as convenience assets.
- `ghcr.io/<owner>/sambee` contains runnable image content only for newly published versions.
- Security metadata remains addressable by immutable digest-derived tags.
