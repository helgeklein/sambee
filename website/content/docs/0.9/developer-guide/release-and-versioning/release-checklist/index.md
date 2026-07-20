+++
title = "Release Checklist"
+++

## Candidate Loop

1. Update `VERSION` to the next plain numeric `X.Y.Z` build sequence and run `./scripts/sync-version`.
1. Commit the synchronized metadata on `main`.
1. Build only the affected component. Candidate workflows reserve or select the immutable `build-vX.Y.Z` source tag; they never accept a source or version override.
1. Test the exact Docker digest through `test`, or test the Companion draft assets and promote them to the Companion `test` feed.
1. Repeat the loop with a new `Z` value when a new candidate is required. Never rebuild or replace a published artifact under the same version.

Docker and Companion candidates may be built independently. Select an existing canonical build version when the second component must use a source commit that `main` has already advanced past.

## Documentation

1. Review the **homepage** content and update it where necessary.
1. **Docs:**
   - Verify [Supported File Formats](../../../user-guide/reference/supported-file-formats/) and update as necessary.
   - Finalize the target release's [What's New](/release-info/news-and-changes/whats-new/) page.
   - Mark the target version as current in `website/data/docs-versions.toml`.
   - Run the VS Code task **Website: Refresh Docs Derived Artifacts**.
   - Review the Docs Structure Report this creates in `/workspace/website-meta/docs-reports/docs-structure-report.html`.
1. Git merge all changes.

## Create The Public Release

See [Overview](../docker-release-overview/).

1. Run `Release: Create Public Sambee Release` with the approved canonical build version and the intended `docker`, `companion`, or `both` scope.
1. Review the generated draft and its required `sambee-release.json` identity asset.
1. Publish the draft only after the approved immutable artifacts exist. For `both`, both artifact verifiers must agree on the version, build tag, and source SHA.
1. Publishing a Docker-authorized release triggers [Release: Publish Docker Image](../promote-docker-candidate/), which moves only verified aliases. It never rebuilds the image.

## Publish the Companion

See [Overview](../companion-release-overview/)

1. Run [Release: Build Companion Artifact](../build-companion-release/) from `main` or select an existing canonical build version.
1. Test and publish its immutable external draft release.
1. Run [Release: Promote Companion Release](../promote-companion-release/) to move `test`, `beta`, `stable`, and/or Sambee download metadata feeds without rebuilding binaries.
