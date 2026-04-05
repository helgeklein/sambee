# Sambee

Sambee provides browser-based access to SMB shares and local drives. It lets you explore, preview, and manage files in the browser, with the optional companion app extending Sambee to the local desktop when native app integration is needed.

## What Sambee Does

- Browse SMB shares from the browser
- Access local drives through Sambee Companion
- Preview images, PDFs, and Markdown before downloading
- Manage files with upload, download, copy, move, rename, delete, and folder creation
- Open files in installed desktop applications when browser-based work is not enough
- Support desktop and mobile workflows from the same system

## How It Fits

Sambee is a self-hosted system for environments that want browser-based file access without moving storage into the cloud. It is designed for teams that already rely on SMB shares, NAS devices, Samba servers, or Windows file servers and want a browser-first way to work with those files.

## Companion

Sambee Companion is optional for browser-based SMB access. It is required for local-drive access and for opening files in native desktop applications and returning edited files to their source location.

## Deployment

Sambee is designed to fit into existing infrastructure. You can deploy it with Docker, place it behind your reverse proxy, and connect it to the SMB storage you already use.

## Project Scope

Sambee focuses on file access and file handling rather than cloud storage replacement. The browser UI covers common browsing, preview, and management workflows, while Companion extends the system to the local desktop when access to local drives or installed applications is needed.

## License

MIT
