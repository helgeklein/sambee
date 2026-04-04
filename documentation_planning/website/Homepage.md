# Homepage Plan

This file plans the marketing and information architecture for the public homepage.

The homepage should answer the following questions quickly:

1. What is Sambee?
2. Who is it for?
3. Why is it a better fit than cloud-first file access tools for some environments?
4. What should the visitor do next?

## Target Audience

Primary audiences:

- Self-hosters with NAS devices, Samba servers, or Windows file servers
- Organizations with digital sovereignty, compliance, or infrastructure-control requirements
- Teams that need browser access to internal files from desktop and mobile

Secondary audiences:

- Individuals who prefer self-hosting over cloud services
- Power users who want faster, preview-first file management for SMB-based storage

## Positioning

Core idea:

Sambee provides access to SMB shares and local drives from any browser. It gives users fast previews and optional desktop-app editing without moving files into a third-party cloud.

Primary strategic contrast:

- Cloud-first file access tools are the main comparison target
- The homepage should emphasize control, self-hosting, and keeping file access inside the user's own environment

Secondary contrast:

- Traditional file manager tools are still relevant as a supporting comparison
- They are weaker for browser access, mobile access, preview-first use, and lightweight sharing across devices

Key differentiators:

- Secure SMB share access from your browser
- Broad file preview support across images, PDFs, and Markdown
- Optional Companion app for local drive access and editing in natively installed desktop apps
- Works well on desktop and mobile
- Designed for fast preview-first use instead of slow download-first habits
- Self-hosted deployment that fits existing infrastructure

## Messaging Principles

- Lead with user value, not implementation details
- Keep self-hosting and infrastructure control visible throughout the page
- Be specific about supported use cases and tasks
- Avoid generic phrases like "modern UI" or "great UX"
- Avoid absolute claims
- Keep technical details for lower sections or linked docs
- Companion: clearly explain what it unlocks. Where there is room, mention that it is optional.
- Use the cloud comparison carefully: position Sambee as a better fit for some environments, not as a universal replacement for all cloud tools

## Messaging Strategy

Primary message:

- Self-hosted, browser-based access to SMB shares and local drives

Primary contrast:

- Better fit than cloud-first file access tools when you want infrastructure control, internal access, and self-hosted deployment

Secondary contrast:

- More convenient than traditional file managers when users need browser access, mobile access, and fast in-browser previews

Supporting proof:

- Broad preview support
- Native desktop editing through Companion
- Desktop and mobile usability
- Lightweight Docker deployment

## Homepage Structure

### 1. Hero

Goal:
Explain the product in one sentence and provide a clear call to action.

Recommended message territory:

- Browser-based access to SMB shares and local drives
- Fast previews for images, PDFs, and Markdown
- Self-hosted alternative to cloud-first file access tools
- Optional desktop-app editing when needed

Hero copy direction:

- Browser-based file access without cloud storage. Manage files on SMB shares and local drives, with fast previews and optional editing in native desktop apps.

Hero supporting points:

- Self-hosted
- Desktop and mobile
- Companion optional

Primary CTA:

- See Features

Secondary CTA:

- Deployment Guide

Tertiary CTA:

- Read Documentation

### 2. Problem / Value Section

Goal:
State what Sambee replaces or improves.

Message ideas:

- Many teams want browser access to internal files without adopting a cloud-first storage model
- Traditional file managers work well on local desktops, but they are weak for browser access, mobile access, and preview-first file handling
- Sambee gives users browser access to NAS devices and file servers while keeping the deployment under their control

Recommended copy direction:

- TODO

### 3. Core Benefits

Use 3 to 5 cards with concrete claims.

Recommended cards:

- Self-hosted control
  - Keep file access in your own environment instead of routing day-to-day file work through a third-party cloud service
- Better everyday file handling
  - Browse large SMB directories with search, keyboard shortcuts, and dual-pane navigation
- Rich previews before download
  - View images, PDFs, and Markdown directly in the browser, including formats browsers do not support natively
- Native editing when needed
  - Open files in Word, Photoshop, LibreOffice, and other installed desktop apps through Sambee Companion
- Built for desktop and mobile
  - Use the same system from a workstation, tablet, or phone without giving up core functionality

Optional sixth card if needed:

- Fits existing infrastructure
  - Deploy with Docker, place it behind your reverse proxy, and connect it to the SMB storage you already use

### 4. Feature Deep Dive

This section should group features by user task, not by subsystem.

Recommended groups:

- Access and navigate
  - SMB shares and local drives
  - single-pane and dual-pane layouts
  - keyboard navigation
  - fast search and navigation
- Preview and review
  - image gallery and viewer controls
  - PDF search
  - Markdown viewing and editing
  - preview-first use before download or editing
- Manage files
  - copy, move, rename, delete, create folder, upload, download
- Continue work in desktop apps
  - native editing via Companion
  - upload-back workflow
  - conflict handling and recovery

Editorial note:

- This section should still read like homepage content, not reference documentation
- Keep each group benefit-led and use only a few high-value examples

### 5. Supported Formats Highlight

Goal:
Show range without dumping a full matrix on the homepage.

Recommended copy shape:

- In-browser:
   - Wide range of supported image formats
   - PDF search and Markdown editing
- Via Companion:
   - Open and edit files in their native desktop apps
- Link to the full viewer support page for exact format details

Suggested examples to name explicitly:

- PSD
- TIFF
- HEIC
- EPS
- AI
- PDF
- Markdown

### 6. Companion Section

Goal:
Explain the optional desktop app clearly.

Must answer:

- What it is
- When users need it
- What they get from it

Key points:

- It is a small optional desktop app
- It is required for local drives access
- It enables editing in natively installed desktop apps
- It handles the upload-back workflow after editing
- It bridges browser and desktop workflows without browser extensions

Suggested framing:

- Most browsing and preview work happens in the browser
- Install Companion when you need local drives or editing in native desktop apps

Suggested prominence:

- Medium prominence on the homepage
- Important enough to deserve its own section
- Not so dominant that it distracts from the core browser-based value proposition

### 7. Deployment / Admin Section

Goal:
Support self-hosting and evaluation without cluttering the hero.

Key points:

- Lightweight Docker deployment
- Works well behind a reverse proxy
- Fits self-hosted environments
- Secure credential handling
- Logging and admin-friendly operation

Message angle:

- Keep deployment practical and trustworthy, not flashy
- Emphasize that Sambee is designed to fit into existing infrastructure
- Reinforce that self-hosting is a first-class part of the product story, not an afterthought

### 8. Proof / Trust Section

Candidates:

- Supported environments: NAS, Samba, Windows SMB shares
- Mobile and desktop support
- Broad file format support
- Self-hosted deployment model
- Free and open-source

Possible proof elements:

- Named file formats such as PSD, HEIC, TIFF, EPS, AI, PDF, Markdown
- Concrete screenshots instead of abstract diagrams
- Direct links to documentation and deployment guidance
- If a public demo exists later, add it here or near the hero rather than forcing it into the first version

### 9. Final CTA

The page should end with one clear primary path and a few secondary paths.

Primary recommendation:

- See Features

Secondary options:

- Deployment Guide
- Read Documentation

Editorial note:

- The hero and the final CTA should use the same primary action unless there is a strong reason not to

## Keep Off The Homepage

- Low-level backend implementation details
- Detailed logging internals
- Deep image-conversion pipeline details
- Exhaustive supported-format tables
- Setup steps that belong in docs
- Claims about speed or UX without concrete support nearby

## Assets To Prepare Later

- Hero screenshot for desktop
- Mobile screenshot
- Image viewer screenshot showing advanced format support
- Companion editing screenshot
- Deployment diagram only if it helps adoption
- Optional comparison visual showing browser access versus traditional file manager use

## Strategic Decisions

- The homepage is for both self-hosters and sovereignty-focused organizations
- The homepage should explicitly position Sambee against cloud-first file access tools
- The Companion should have medium prominence: important, but not the main story
- A public demo may exist later, but the first homepage version should not depend on it

## Next Draft Goals

- Turn this plan into actual homepage copy
- Keep the hero concise and infrastructure-aware
- Make the cloud-first comparison clear without sounding defensive
- Use screenshots and concrete examples as proof instead of generic claims
