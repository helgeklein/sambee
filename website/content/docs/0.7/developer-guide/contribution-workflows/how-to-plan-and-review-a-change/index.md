+++
title = "How to Plan and Review a Change"
+++

The safest Sambee changes start from the contract that is changing, not from the first file you happened to open.

## Start with the Contract

Ask which part of the system's behavior is actually moving.

- browser app workflow
- backend API or SMB behavior
- companion trust, local-drive, or native-app editing behavior
- release-sensitive metadata or dependency policy

That answer tells you which subsystems might need to move together.

## Scope the Change by Boundary

Before you implement anything, identify:

1. which subsystem changes directly
2. which other subsystem consumes the changed contract

For example:

- a backend response-shape change usually also needs frontend service updates and matching validation
- a companion pairing change may affect browser app behavior and tests in more than one project

## Prefer the Smallest Change That Fixes the Right Problem

- fix the root cause instead of layering extra workarounds on top
- avoid mixing unrelated refactors into a behavior change unless they are required for correctness
- do not treat lockfiles, version metadata, or generated navigation inputs as incidental noise when they are part of the reviewed workflow

## Review with Regression Risk in Mind

The highest-value review questions are usually:

- did the changed contract stay coherent across browser app, backend, and companion?
- are new or changed validation checks proportional to the risk?
- did a version-sensitive or dependency-sensitive workflow change without the matching metadata review?

## Typical Review Checklist

- the change goal is stated in terms of behavior, not just files touched
- cross-boundary contracts were updated together
- validation covers the actual risk surface
- release-sensitive files were reviewed intentionally when touched
