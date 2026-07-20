+++
title = "Release Checklist"
+++

## Preparation

1. Update the product **version** ([details](../product-versioning/)). Ensure it's at the version you want to release.

## Build and Test the Docker Image

See [Overview](../docker-release-overview/).

1. Run the CI workflow [Release: Create Docker Image](../publish-test-docker-candidate/) to **build** the Docker image and move the `test` tag to it.
   - Don't override the product version in the CI workflow.
1. **Test** the newly built image (pull it via the `test` tag).

## Documentation

1. Review the **homepage** content and update it where necessary.
1. **Docs:**
   - Verify [Supported File Formats](../../../user-guide/reference/supported-file-formats/) and update as necessary.
   - Finalize the target release's [What's New](/release-info/news-and-changes/whats-new/) page.
   - Mark the target version as current in `website/data/docs-versions.toml`.
   - Run the VS Code task **Website: Refresh Docs Derived Artifacts**.
   - Review the Docs Structure Report this creates in `/workspace/website-meta/docs-reports/docs-structure-report.html`.
1. Git merge all changes.

## Publish the Docker Image

See [Overview](../docker-release-overview/).

1. Create a Git tag on the commit the tested image was built from.
1. Publish a GitHub release from that tag.
   - Release publication triggers [Release: Publish Docker Image](../promote-docker-candidate/), which tags the image built earlier as `beta` (prereleases) or `stable` and adds version tags for stable releases.

## Publish the Companion

See [Overview](../companion-release-overview/)

1. Run [Release: Build Companion Artifact](../build-companion-release/) to build Companion for the target platforms.
   - Publish the Companion GitHub Release created by the workflow.
1. Run [Release: Promote Companion Release](../promote-companion-release/) to promote the release to the `test`, `beta`, and/or `stable` update channels and to update the Sambee download-metadata feed.
