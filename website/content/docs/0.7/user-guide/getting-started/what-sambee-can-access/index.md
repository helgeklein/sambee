+++
title = "What Sambee Can Access"
description = "Understand which workflows work in the browser, which require Companion, and what changes on mobile devices."
+++

Sambee supports both browser-only workflows and companion-backed desktop workflows.

Use this page as the canonical capability matrix for the User Guide.

## Capability Matrix

| Workflow | Works directly in the browser | Requires Sambee Companion | Notes |
|---|---|---|---|
| Browse SMB shares | Yes | No | This is the default browser-based access path. |
| Access local drives on this computer | No | Yes | Use a desktop browser on Windows, macOS, or Linux. |
| Preview supported images, PDFs, and Markdown | Yes | No | Preview support depends on file type and format support. |
| Edit Markdown in the browser | Yes | No | Use the browser editor for Markdown files. |
| Open files in installed desktop apps | No | Yes | The file opens on the same computer that is running Companion. |
| Upload desktop-app edits back to the source location | No | Yes | Complete this through the Companion editing flow. |
| Use Sambee on mobile | Yes, with limits | No | Mobile supports browsing and previewing, but not local-drive or desktop-app workflows. |

## Choose The Right Path

Use browser-only workflows when you want to:

- browse SMB shares
- preview supported files quickly
- manage common file tasks in the web interface
- edit Markdown without leaving the browser

Use Companion-backed workflows when you want to:

- browse local drives from the same computer
- continue work in Word, Photoshop, LibreOffice, or another installed desktop app
- return those desktop edits to the original Sambee location

## Desktop And Mobile Expectations

Sambee works on desktop and mobile, but the experience is not identical.

- Desktop browsers support the full browser-based SMB workflow.
- Desktop browsers can also use Companion for local drives and desktop-app editing.
- Mobile browsers are a good fit for browsing, previewing, downloading, and other lighter tasks.
- Mobile browsers are not the primary path for Companion-dependent workflows.

## If You Are Still Not Sure

Start with the simplest path that matches your goal.

- If you only need a network share, go to [Connect To An SMB Share](../../accessing-files/connect-to-an-smb-share/).
- If you need files from this computer, go to [Access Local Drives And Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/).
- If you need to keep working in an installed desktop app, go to [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).

If the required share, drive, or permission is missing entirely, involve an administrator.
