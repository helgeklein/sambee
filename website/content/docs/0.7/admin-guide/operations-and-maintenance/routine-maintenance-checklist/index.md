+++
title = "Routine Maintenance Checklist"
description = "Use a compact operational checklist for regular health review, planned changes, and post-change verification."
+++

This page is a compact checklist for routine service ownership.

It is not a replacement for the full task pages. It exists so administrators can review the normal maintenance steps without reopening every detailed page each time.

## Regular Health Review

Review these on a normal cadence that fits your environment:

- confirm the `sambee` service is running as expected
- review recent logs for repeated startup, storage, or connectivity errors
- confirm the frontend still loads and administrator sign-in still works
- confirm the key SMB workflows your users depend on still behave normally

## Before Planned Changes

Before an update, config change, or controlled restart, confirm:

- you know exactly what change you are making
- your backup posture is acceptable for the risk of that change
- the local deployment files are in the state you expect
- you know whether the change also affects proxy behavior, companion support, or user-facing workflows

## After Planned Changes

After the change is live, verify:

- `docker compose ps` shows the expected service state
- recent logs do not show an obvious new fault
- the frontend loads on the expected URL or hostname
- sign-in still works
- the key SMB workflows still behave as expected

## When To Stop Treating It As Routine

Move out of checklist mode and into troubleshooting when:

- the service will not stay up
- direct application access and proxied access behave differently in unexpected ways
- login recovery is now the real task
- the issue is affecting multiple users or looks like a broader deployment fault

## Related Pages

- [View Logs And Restart Services](../view-logs-and-restart-services/): use this when the checklist turns into hands-on service work
- [Update Sambee Safely](../update-sambee-safely/): use this when the planned change is an actual version upgrade
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the deployment is already unhealthy
