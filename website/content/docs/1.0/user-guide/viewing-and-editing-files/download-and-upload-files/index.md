+++
title = "Download and Upload Files"
+++

Use **Download** to save a file to your computer. Select a folder or several items in the same directory to download them together as `Sambee-download.zip`. The ZIP preserves the selected folders and their contents. Downloads don't create a ZIP in the source share or drive.

Download is available from the file browser toolbar and the compact item or selection menu. You can also select members or folders inside a ZIP stored on an SMB share or a paired local drive and download them as a new ZIP.

To keep a new archive in an SMB share instead, open a ZIP in one pane and a writable folder on the same SMB connection in the other pane. Select files or folders inside the ZIP, then choose **Create archive**. Unlike **Download**, this writes a persistent ZIP to the destination folder. Creating an archive from ZIP members isn't available for local-drive or mixed-connection destinations.

## Upload Files

Open a writable folder in an SMB share or paired local drive and choose **Upload**. Select one or more files from your computer. Sambee uploads them one at a time, shows the current file's progress, and reports completed, skipped, failed, and uncertain transfers at the end.

If a name already exists, choose whether to skip, rename, or replace that file. You can cancel the remaining uploads; an interrupted upload may have an uncertain outcome, so check the destination before retrying it.

## Download Limits

Selected-item ZIPs are prepared in private temporary storage and removed after the download finishes or is cancelled. The default ZIP size limit is 250 MiB; administrators can change it in Advanced Settings. Local ZIP-member downloads also require the selected members' uncompressed data to fit this limit. A download exceeding the limit fails without leaving a partial ZIP in your share or drive. Single-file downloads are separate from this ZIP limit.
