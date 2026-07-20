+++
title = "Release and Versioning"
+++

This section covers version changes and the main-only release process that binds every publishable `X.Y.Z` candidate to one immutable source commit.

For a complete Sambee product release, start here:

- [Release Checklist](./release-checklist/)
- [Product Versioning](./product-versioning/)

For dependency changes, use:

- [Dependency Update Workflow](./dependency-update-workflow/)

For Sambee Docker image releases, read these pages in order:

- [Docker Release Overview](./docker-release-overview/)
- [Publish Test Docker Candidate](./publish-test-docker-candidate/)
- [Promote Docker Candidate](./promote-docker-candidate/)
- [Docker Backfill And Cleanup](./docker-backfill-and-cleanup/)

Build candidates from `main`, test the immutable artifact, then promote only verified pointers. Never rebuild or replace a published candidate under the same version.

For Companion release distribution, read these pages in order:

- [Companion Release Overview](./companion-release-overview/)
- [Build Companion Release](./build-companion-release/)
- [Promote Companion Release](./promote-companion-release/)
- [Companion Channels, Feeds, And Downloads](./companion-channels-feeds-and-downloads/)

Docker and Companion may be built independently, but a coordinated `both` release requires the same version, canonical build tag, and source SHA before either stable pointer moves.
