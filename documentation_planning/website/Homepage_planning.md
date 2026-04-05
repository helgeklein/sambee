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

Sambee provides browser-based access to SMB shares and local drives. Explore, preview, and manage files directly in the browser, while the optional Companion app extends Sambee to the local desktop with local-drive access and native desktop-app editing. Sambee enables browser-first file access without requiring files to be moved into the cloud.

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

## Terminology (Naming And Wording Conventions)

This section exists to standardize how Sambee is described across planning, copy, and future homepage implementation.

### Wording and audience

- The target audience is technical (IT pros, home users comfortable setting up complex systems, enterprise admins)
- Use established IT industry terms wherever possible

### Preferred keywords

Do:

- "browser-based" is crucial
   - Alternatively, mention the browser as the environment Sambee runs in

Don't:

- Sambee is a tool to browse files (much too weak, doesn't emphasize that it's browser-based)

### Preferred patterns for describing Sambee

Prefer verb-led descriptions over weak category nouns.

Preferred examples:

- Sambee provides browser-based access to SMB shares and local drives
- Sambee brings SMB shares and local drives into the browser

Use these when possible because they explain the job Sambee does instead of forcing an abstract label.

## Terms to prefer and avoid

### Nouns for Sambee

Avoid these as the primary noun for Sambee:

- way
- interface
- platform

Use with caution:

- solution
- tool
- app
- product

Guidance:

- `way` is too vague and sounds like placeholder wording
- `interface` is too narrow and misleading
- `platform` sounds inflated for the current positioning
- `solution` is acceptable in planning, but generic in copy
- `tool` is simple, but can undersell Sambee
- `app` is acceptable when a noun is needed
- `product` is acceptable for internal planning language, but usually too generic for homepage copy

Default rule:

- Do not force a noun if a verb-led sentence is clearer

### How to refer to Companion

Preferred framing:

- Sambee Companion extends Sambee to the local desktop
- Companion adds local-drive access and native desktop-app editing

Avoid framing Companion as:

- a handoff away from Sambee
- a separate replacement for Sambee
- the main product story

### Cloud wording

Preferred:

- cloud storage
- moving files into the cloud

Avoid unless specifically needed:

- third-party cloud
- anti-cloud or ideological phrasing
- language that implies all cloud tools are bad fits

### Desktop wording

Preferred:

- desktop apps
- native desktop apps
- installed desktop apps

Avoid:

- traditional apps
- native apps when it is ambiguous whether desktop or mobile is meant

### What users do with Sambee

Preferred:

- explore (alludes to Windows File Explorer)

Avoid:

- "file work"

### Tone guardrails

Prefer:

- concrete product behavior
- precise scope
- practical benefits

Avoid:

- generic marketing nouns
- inflated category labels
- absolute claims
- placeholder phrasing that sounds internal rather than user-facing

### Work styles and industry trends

Prefer:

- browser-first

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
Explain the product in one sentence and point visitors to the clearest next step.

Recommended message territory:

- Browser-based access to SMB shares and local drives
- Fast previews for images, PDFs, and Markdown
- Self-hosted alternative to cloud-first file access tools
- Optional desktop-app editing when needed

Hero copy direction:

- Browser-based file access without cloud storage. Explore, preview, and manage files on SMB shares and local drives, with fast previews and optional editing in native desktop apps.

Hero supporting points:

- Self-hosted
- Desktop and mobile
- Companion optional

Primary CTA label:

- See Features

Secondary CTA label:

- Deployment Guide

Tertiary CTA label:

- Read Documentation

### 2. Problem / Value Section

Goal:
State what Sambee replaces or improves.

Message ideas:

- Many teams want browser access to internal files without adopting a cloud-first storage model
- Traditional file managers work well on local desktops, but they are weak for browser access, mobile access, and preview-first file handling
- Sambee gives users browser access to NAS devices and file servers while keeping the deployment under their control

Recommended copy direction:

- Present Sambee as a practical alternative for environments that want cloud-like convenience without cloud-first storage or access patterns.
- Contrast Sambee with cloud-first tools on control and deployment model, not on ideology alone.
- Contrast Sambee with traditional file managers on browser access, mobile access, and built-in previews.
- Emphasize that Sambee reduces downloading, context switching, and dependency on desktop-only access for routine file tasks.

### 3. Core Benefits

Use 3 to 5 cards with concrete claims.

Recommended cards:

- Self-hosted control
  - Keep file access in your own environment instead of routing day-to-day file handling through cloud storage
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
- It extends Sambee to the local desktop without browser extensions

Suggested framing:

- Most browsing, previewing, and managing happens in the browser
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
- Broad preview support
- Self-hosted deployment model
- Free and open-source

Possible proof elements:

- Screenshot of SMB browsing on desktop
- Screenshot of mobile browsing or previewing
- Screenshot of Markdown or PDF viewing/editing
- Screenshot of Companion-backed desktop editing
- Named file examples such as PDF, Markdown, PSD, HEIC, and TIFF
- Direct links to feature, documentation, and deployment pages
- Short proof statements tied to visible capabilities rather than abstract claims
- If a public demo exists later, add it here or near the hero rather than forcing it into the first version

### 9. Final CTA

The page should end with one clear primary path and a small number of secondary paths.

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
