+++
title = "Release and Versioning"
+++

This section covers the workflows where a small metadata mistake can create cross-boundary drift.

For Sambee Docker image releases, read these pages in order:

- [Dependency and Release Workflow](./dependency-and-release-workflow/)
- [Docker Release Overview](./container-image-build-and-publish-workflow/)
- [Publish Test Docker Candidate](./publish-a-preview-docker-image/)
- [Promote Docker Candidate](./promote-a-preview-candidate-to-stable-or-beta/)
- [Docker Backfill And Cleanup](./maintain-docker-release-tags-and-preview-retention/)

Use these pages when the goal is to take one reviewed commit all the way to `stable` without rebuilding at release time.

For Companion release distribution, use:

- [Companion Distribution and Update Workflow](./companion-distribution-and-update-workflow/)

Use this section when you are changing version numbers, updating reviewed dependencies, or touching release-sensitive files.
