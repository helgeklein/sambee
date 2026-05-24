+++
title = "Release and Versioning"
+++

This section covers the workflows where a small metadata mistake can create cross-boundary drift.

For Sambee Docker image releases, read these pages in order:

- [Dependency and Release Workflow](./dependency-and-release-workflow/)
- [Docker Release Overview](./docker-release-overview/)
- [Publish Test Docker Candidate](./publish-test-docker-candidate/)
- [Promote Docker Candidate](./promote-docker-candidate/)
- [Docker Backfill And Cleanup](./docker-backfill-and-cleanup/)

Use these pages when the goal is to take one reviewed commit all the way to `stable` without rebuilding at release time.

For Companion release distribution, read these pages in order:

- [Companion Release Overview](./companion-release-overview/)
- [Build Companion Release](./build-companion-release/)
- [Promote Companion Release](./promote-companion-release/)
- [Companion Channels, Feeds, And Downloads](./companion-channels-feeds-and-downloads/)

Use this section when you are changing version numbers, updating reviewed dependencies, or touching release-sensitive files.
