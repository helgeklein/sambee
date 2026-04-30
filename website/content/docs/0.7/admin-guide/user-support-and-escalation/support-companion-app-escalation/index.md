+++
title = "Support Companion-App Escalation"
description = "Handle the companion-app problems that have moved beyond normal end-user setup and into admin-level support or environment checks."
+++

Most normal Companion usage belongs in the User Guide. This page is for the cases where a user-facing problem has become an admin support task.

## When An Issue Belongs Here

Move from the User Guide into this admin path when the next step involves:

- environment checks rather than normal user steps
- repeated failures across more than one user or machine
- deployment policy questions such as downloads, trusted environments, or certificate handling
- support diagnostics such as log locations or platform-specific crash investigation

## Typical Escalation Cases

Examples include:

- users can no longer open files in desktop apps even though their normal steps are correct
- local-drive access fails in a way that suggests a machine, browser, trust, or policy issue
- Companion launches but repeatedly fails to upload files back
- Companion itself will not start on a supported desktop system

## What To Check Before Going Deeper

Start with the fastest separation between user issue and environment issue.

- confirm the user is following the normal User Guide workflow
- confirm the problem is on a supported desktop platform for Companion workflows
- confirm the Sambee service is reachable from the user environment
- confirm there is no broader service outage or connectivity problem affecting multiple users

## Environment And Trust Considerations

For HTTPS-based environments, Companion depends on the local operating system's network and trust settings.

That matters especially when:

- a proxy is required in the environment
- internal or company-managed certificates are involved
- the user machine has drifted away from the expected desktop trust configuration

## When This Stops Being A Companion-Only Issue

Move out of the companion-specific support path when:

- the Sambee deployment itself is unavailable
- the failure affects multiple users in the same way
- the real problem is hostname, HTTPS, or reverse-proxy reachability rather than a local desktop workflow

## Where The Support Details Live

Keep the workflow decisions on this page, but use the dedicated companion reference page for the stable support details such as:

- log file locations
- preference file locations
- platform-specific crash-diagnostic entry points
- Windows WebView2 runtime-data notes

## Related Pages

- [Companion Support Reference](../../reference/companion-support-reference/): use this for log paths, preference locations, verbose logging, and crash-diagnostic entry points
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the problem is broader than companion support alone
- [Reverse Proxy Misconfiguration](../../troubleshooting/reverse-proxy-misconfiguration/): use this when the real failure is HTTPS or proxy-side reachability
