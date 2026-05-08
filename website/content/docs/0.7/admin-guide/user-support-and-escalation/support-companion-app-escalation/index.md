+++
title = "Support Companion-App Escalation"
+++

Most normal Companion usage belongs in the User Guide. This page is for the cases where a user-facing problem has become an admin task.

Sambee Companion is the optional desktop app used for local-drive access and for opening files in installed desktop applications.

## When an Issue Belongs Here

Move from the User Guide into this admin path when the next step involves:

- Desktop-environment checks rather than normal user steps.
- Repeated failures across more than one user or machine.
- Deployment policy questions such as downloads, trusted environments, or certificate handling.
- Support diagnostics such as log locations or platform-specific crash investigation.

## Typical Escalation Cases

Examples include:

- Users can no longer open files in desktop apps even though their normal steps are correct.
- Local-drive access fails in a way that suggests a machine, browser, trust, or policy issue.
- Companion launches but repeatedly fails to upload files back.
- Companion itself will not start on a supported desktop system.

## What to Check before Going Deeper

Start with the fastest separation between user issue and environment issue.

- Confirm that the user is following the normal User Guide workflow.
- Confirm that the problem is on a supported desktop platform for Companion workflows.
- Confirm that the Sambee service is reachable from the user environment.
- Confirm that there is no broader service outage or connectivity problem affecting multiple users.
- Confirm whether the problem affects one user, one machine, or many users.

## Environment and Trust Considerations

For HTTPS-based environments, Companion depends on the local operating system's network and trust settings.

In normal operation, that means Companion uses:

- The operating system's proxy configuration.
- The operating system's native certificate trust store.

That matters especially when:

- A proxy is required in the environment.
- Internal or company-managed certificates are involved.
- The user machine has drifted away from the expected desktop trust configuration.

In practice, that usually means checking the user's proxy settings, certificate trust store, and whether security software is blocking the local workflow.

## When This Stops Being a Companion-Only Issue

Move out of the companion-specific support path when:

- The Sambee deployment itself is unavailable.
- The failure affects multiple users in the same way.
- The real problem is hostname, HTTPS, or reverse-proxy reachability rather than a local desktop workflow.

## Where the Support Details Live

Keep the workflow decisions on this page, but use the dedicated companion reference page for the stable support details such as:

- Log file locations.
- Preference file locations.
- Platform-specific crash-diagnostic entry points.
- Windows WebView2 runtime-data notes.

## Related Pages

- [Companion Support Reference](../../reference/companion-support-reference/): use this for log paths, preference locations, verbose logging, and crash-diagnostic entry points
- [Troubleshoot Startup and Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the problem is broader than companion support alone
- [Reverse Proxy Misconfiguration](../../troubleshooting/reverse-proxy-misconfiguration/): use this when the real failure is HTTPS or proxy-side reachability
