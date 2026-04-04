# Homepage Plan

This file plans the marketing and information architecture for the public homepage.

The homepage should answer the following questions quickly:

1. What is Sambee?
2. Who is it for?
3. Why is it better than traditional file manager tools?
4. What should the visitor do next?

## Target Audience

- Anyone who stores files on NAS devices, Samba or Windows file servers
- People who prefer self-hosting over cloud services
- Organizations of any size who are focused on digital sovereignity
- Individuals or teams that need fast browser access to files
- Users who want to access files from desktop and mobile

## Positioning

Core idea:

Sambee gives you browser-based access to SMB shares and local drives with fast previews, Markdown editing, and native desktop editing.

Key differentiators:

- Secure SMB share access from your browser
- Broad file preview support, especially for image formats of any kind
- Optional Companion app for local drive access and editing in natively installed desktop apps
- Excellent mobile usability
- Optimized for speed and UX

## Messaging Principles

- Lead with user value, not implementation details
- Be specific about supported workflows
- Avoid generic phrases like "modern UI" or "great UX"
- Keep technical details for lower sections or linked docs
- Companion: clearly explain what it unlocks. Where there's room, mention that it's optional.

## Homepage Structure

### 1. Hero

Goal:
Explain the product in one sentence and provide a clear call to action.

Recommended message territory:

- Browser-based access to SMB shares and local drives
- Fast previews for images, PDFs, and Markdown
- Self-hosted alternative to traditional file manager workflows for remote access
- Native desktop editing when needed

Possible hero copy directions:

- Browser-based access to SMB shares and local drives with fast previews, Markdown editing, and native desktop editing.
- A self-hosted file workspace for SMB shares and local drives, built for fast access from desktop and mobile.
- Browse, preview, and manage files from SMB shares and local drives without relying on cloud storage or traditional file manager tools.

Primary CTA ideas:

- See How It Works
- Read Documentation
- Deployment Guide

Secondary CTA ideas:

- Install Companion
- Viewer Support

### 2. Problem / Value Section

Goal:
State what Sambee replaces or improves.

Message ideas:

- Traditional file manager tools are optimized for local desktops, not secure browser-based access to SMB shares
- Cloud-sync products are not the right answer for every self-hosted or sovereignty-focused environment
- Preview files before downloading or opening them in a desktop app
- Use the browser for routine file work and switch to native apps only when necessary
- Reduce context switching between file explorers, VPN sessions, office apps, and ad hoc remote access tools

### 3. Core Benefits

Use 3 to 5 cards with concrete claims.

Recommended cards:

- Self-hosted control
  - Keep file access in your own environment instead of routing workflows through a third-party cloud service
- Faster everyday file work
  - Browse large SMB directories with search, keyboard shortcuts, and dual-pane workflows
- Rich previews before download
  - View images, PDFs, and Markdown directly in the browser, including formats browsers do not support natively
- Native editing when needed
  - Open files in Word, Photoshop, LibreOffice, and other installed desktop apps through Sambee Companion
- Built for desktop and mobile
  - Use the same system from a workstation, tablet, or phone without giving up core functionality

### 4. Feature Deep Dive

This section should group features by workflow, not by subsystem.

Recommended groups:

- Access and navigate
  - SMB shares and Local Drives
  - single-pane and dual-pane layouts
  - keyboard navigation
  - fast path navigation and directory search
- Preview and review
  - image gallery and viewer controls
  - PDF search
  - Markdown viewing and editing
  - preview-first workflow before download or editing
- Manage files
  - copy, move, rename, delete, create folder, upload, download
- Continue work in desktop apps
  - native editing via Companion
  - upload-back workflow
  - conflict handling and recovery

### 5. Supported Formats Highlight

Goal:
Show range without dumping a full matrix on the homepage.

Recommended copy shape:

- Native browser and server-converted image formats
- Strong support for professional and uncommon image formats
- PDF and Markdown support today
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
- It is required for Local Drives access
- It enables editing in natively installed desktop apps
- It handles the upload-back workflow after editing
- It bridges browser and desktop workflows without browser extensions

Suggested framing:

- Most browsing and preview work happens in the browser
- Install Companion when you need Local Drives or native desktop editing

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

### 8. Proof / Trust Section

Candidates:

- Supported environments: NAS, Samba, Windows SMB shares
- Mobile and desktop support
- Broad file format support
- Self-hosted deployment model
- Open-source repository link if that is part of the public positioning

Possible proof elements:

- Named file formats such as PSD, HEIC, TIFF, EPS, AI
- Concrete screenshots instead of abstract diagrams
- Direct links to documentation and deployment guidance

### 9. Final CTA

The page should end with one clear path for each visitor type:

- Explore features
- Read documentation
- Plan deployment
- Install Companion

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
- Companion workflow screenshot
- Deployment diagram only if it helps adoption
- Optional comparison visual showing browser workflow versus traditional file manager workflow

## Open Questions

- Is the homepage primarily for self-hosters, sovereignty-focused organizations, or both?
- Should the homepage explicitly position Sambee against cloud-first file access tools?
- Should the primary CTA be documentation or deployment?
- How prominently should the Companion be featured on the homepage?
- Is there a public demo environment planned?
