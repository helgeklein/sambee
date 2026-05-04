+++
title = "First Sign-In And Interface Tour"
description = "See what the main screen shows after sign-in and confirm that SMB sources or local drives appear as expected and basic file access works."
+++

Sign-in can look a little different depending on how your organization set up Sambee. This page starts after you have signed in successfully.

New to SMB shares, local drives in the browser, or desktop-app workflows through Sambee Companion? Read [What Sambee Can Access](../../getting-started/what-sambee-can-access/) first.

After sign-in, you should be able to do three things:

- see at least one source or connection, such as an SMB source or local drives on your computer
- open a folder
- preview a supported file

On a phone or tablet, local drives and desktop-app editing will not appear. Use a desktop browser for those workflows.

## Three Checks To Confirm Setup

### 1. Can You See A Source?

You should be able to see at least one place to explore, such as an SMB share or a local source.

If you cannot:

- no SMB share may mean the connection has not been shared with you yet, or you have not added your own private SMB connection yet
- missing local drives on a desktop browser usually means Sambee Companion is not installed, not running, or this browser is not paired yet
- missing local drives on a phone or tablet is expected

### 2. Can You Open A Folder?

Open one folder and make sure the file list changes.

If the folder will not open or never loads:

- refresh once
- make sure you selected the correct source
- treat repeated failures as an access or service problem rather than a navigation problem

### 3. Can You Preview A Supported File?

Open a supported image, PDF, or Markdown file and confirm that Sambee shows it.

If preview does not work:

- the file type may not support in-browser preview
- the preview service may have failed temporarily
- if several supported files fail, the problem is probably broader than that one file

## What You Need First

Before Sambee is useful, you normally need at least one of these:

- access to one or more SMB connections, shared with you or created by you
- Sambee Companion installed and a paired desktop browser if you plan to show files on your computer in Sambee

If you sign in and do not see the storage you expect, that is usually an access or setup issue rather than a browser problem.

## What You Usually See On Screen

The exact layout can change by screen size, but the main file browser usually includes these areas:

- a source picker or connection list for choosing an SMB share or local drive
- breadcrumbs and directory navigation for moving through folders
- the main file list or details view
- sort and view controls
- search and quick-action tools for moving through the interface faster
- a status area that shows item counts, filters, or selection state

## A Simple First Tour

With those checks done, use this short tour to get comfortable:

1. Choose a connection or local source.
2. Open a folder and confirm you can move deeper into the directory tree.
3. Use the breadcrumbs or parent-directory navigation to move back out.
4. Open a supported file to confirm preview works.
5. Return to the file list and try a simple task such as download or rename, if you have permission.

## If Nothing Useful Appears

These situations usually point to missing setup rather than a bug in the page you are on:

- no SMB connections are listed
- the expected local drives are missing
- you can sign in, but every file action fails immediately

When that happens:

- check whether you are in the right browser and on the right account
- if you need SMB access, check whether the connection should be shared with you or added as your own private SMB connection
- if you need local drives, confirm Sambee Companion is installed, running, and paired so this browser can connect to your computer
- if you need SMB access and cannot add the connection yourself, ask an administrator whether the shared connection and your permissions are in place

## If You Need Help From An Administrator

When you report a getting-started problem, include:

- whether you are on desktop or mobile
- whether you expected an SMB share or local drives
- whether Sambee Companion is installed, running, and paired, if local drives on your computer are involved
- whether you can see any source at all
- the exact message or action that failed

## Next Steps

- Network shares: [Connect To An SMB Share](../../accessing-files/connect-to-an-smb-share/).
- Local files on your computer: [Access Local Drives And Pair Your Browser](../../accessing-files/access-local-drives-and-pair-your-browser/).
- Browser preview overview: [Preview Supported Files](../../viewing-and-previewing/preview-supported-files/).
- Faster folder navigation: [Explore, Search, And Use Dual Pane](../../browsing-and-navigation/browse-search-and-use-dual-pane/).
- Failed basic check: [Common User Problems](../../troubleshooting/common-user-problems/).
