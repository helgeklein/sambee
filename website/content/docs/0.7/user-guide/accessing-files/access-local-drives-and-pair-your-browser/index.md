+++
title = "Access Local Drives And Pair Your Browser"
description = "Use Sambee Companion to unlock local-drive access on this computer and repair or remove the browser pairing when needed."
+++

Local drives are available through Sambee Companion on the same computer you are using.

This is a desktop workflow. It is not supported on iOS or Android browsers.

## Before You Start

You need all of the following:

- a desktop browser on Windows, macOS, or Linux
- Sambee Companion installed on this computer
- Sambee Companion running

If Companion is not installed yet, start with [Install And Start The Companion App](../../companion-app/install-and-start-the-companion-app/).

## Pair This Browser

1. Open the Local Drives screen in Sambee.
2. Check the current status summary.
3. If local drives are not ready yet, choose **Pair This Browser**.
4. Verify that the code shown in the browser matches the code shown in Companion.
5. Confirm the pairing in both places.
6. Wait for the success message that confirms local drives are now available.

After a successful pairing, this browser can use local-drive access on this computer.

If you also want to open files in installed desktop apps and send the changes back, continue to [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/).

## Verify That Local Access Still Works

If the Local Drives screen shows that this browser is already paired, run **Test Current Pairing** to confirm the browser can still reach Companion correctly.

This is useful when:

- local-drive access worked before but now seems missing
- the browser was updated or reset
- you want to confirm the current computer is still the right one for this workflow

## If The Browser Needs Repair

Sometimes the companion knows this browser origin, but the browser no longer has the local secret it needs to complete access.

In that case, pair this browser again. Sambee treats this as a repair flow rather than a new feature setup.

## Remove Access From This Browser

If you no longer want this browser to access local drives on this computer, use **Unpair This Browser**.

This removes the current browser pairing and forces a new pairing before local-drive access works again.

## Mobile Limitation

On mobile browsers, Sambee shows that local drives require a desktop browser. Use a desktop browser on Windows, macOS, or Linux if you need this feature.

## If Pairing Fails

Check these first:

- Companion is actually running on this computer
- you are pairing from a desktop browser, not a mobile browser
- the verification codes match
- the browser is allowed to communicate with Companion on this computer

If the pairing test fails after a browser was already paired, pair again to restore access.

## Related Pages

- [Install And Start The Companion App](../../companion-app/install-and-start-the-companion-app/): use this if Companion is not installed or not running yet
- [Choose Desktop Apps And Preferences](../../companion-app/choose-desktop-apps-and-preferences/): use this for startup behavior, paired-browser management, and conflict settings
- [Open Files In Desktop Apps And Save Changes Back](../../editing-files/open-files-in-desktop-apps-and-save-changes-back/): use this once local access is working and you want a desktop-app workflow
- [Recover After Interrupted Editing](../../companion-app/recover-after-interrupted-editing/): use this if a companion-backed editing session was interrupted later on
