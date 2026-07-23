+++
title = "What's New"
+++

## Internals

### Release Workflow v2: Docker & Companion Version Lockstep

Sambee has a sophisticated build and release system (see for yourself, the [docs](../../../developer-guide/release-and-versioning/release-overview/) are public). Previously, releases and version numbers of the Docker image and the Companion app were (deliberately) independent. However, it turned out that it's more efficient and natural to increment the versions of both components in sync.

This led to quite the architecture change that started with a redefinition of the version number ([details](../../..//developer-guide/release-and-versioning/product-versioning/)), followed by a second step where the release processes were reworked so that they now follow a straightforward pattern:

 1. Increment the version number.
 1. Create a build with that version (Docker image and/or Companion app).
 1. Promote that build to the `test` channel and test.
 1. Promote the build to the `beta` and/or `stable` channels.

 Crucially, in this new model a build is created only once. Releases happen through promoting existing builds. This guarantees that the version that was tested is exactly what is released later on.
