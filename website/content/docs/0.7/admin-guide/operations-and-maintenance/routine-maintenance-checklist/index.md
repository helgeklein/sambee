+++
title = "Routine Maintenance Checklist"
+++

This page is a compact checklist for routine service ownership.

It exists so administrators can review the normal maintenance steps without reopening every detailed page each time.

## Regular Health Review

Review these on a normal cadence that fits your environment:

- Confirm that the `sambee` service is running as expected.
- Review recent logs for repeated startup, storage, or connectivity errors.
- Confirm that the frontend still loads and administrator sign-in still works.
- Confirm that the key SMB workflows your users depend on still behave normally, such as opening a share, browsing folders, and transferring a test file.

## Before Planned Changes

Before an update, config change, or controlled restart, confirm:

- You know exactly what change you are making.
- Your backup posture is acceptable for the risk of that change.
- The local deployment files are in the state you expect.
- You know whether the change also affects proxy behavior, companion support, or user-facing workflows.

## After Planned Changes

After the change is live, verify:

- The `docker compose ps` output shows the expected service state.
- Recent logs do not show an obvious new fault.
- The frontend loads on the expected URL or hostname.
- Sign-in still works.
- The key SMB workflows still behave as expected.

## When to Stop Treating It as Routine

Move out of checklist mode and into troubleshooting when:

- The service will not stay up.
- Direct application access and proxied access behave differently in unexpected ways.
- Login recovery is now the real task.
- The issue is affecting multiple users or looks like a broader deployment fault.

## Related Pages

- [View Logs and Restart Services](../view-logs-and-restart-services/): use this when the checklist turns into hands-on service work
- [Update Sambee Safely](../update-sambee-safely/): use this when the planned change is an actual version upgrade
- [Troubleshoot Startup and Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the deployment is already unhealthy
