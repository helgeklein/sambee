# AI Visual Design Plan For Sambee Website

## Purpose

Define a practical AI-assisted workflow for the next major phase of the Sambee website: visual design.

This plan assumes:

- the Hugo site and custom theme foundation already exist
- the site structure and documentation model are already planned
- the next problem is visual direction, brand translation, and component styling

## Goal

Use AI to accelerate visual design exploration without letting AI make core brand or product decisions.

The output of this phase should be:

- one approved visual direction for the website
- a website-specific design token system aligned with Sambee branding
- approved desktop and mobile mockups for the homepage and docs shell
- a component styling plan that can be implemented in the Hugo theme

## Non-Goals

This phase is not about:

- rewriting site information architecture
- migrating content in depth
- generating production-ready code directly from AI tools
- accepting generic AI-generated SaaS aesthetics without review

## Current Context

The current website foundation is structurally usable, but the visual system is still transitional.

Relevant facts:

- the website already has a working Sambee-specific Hugo theme and layout shell
- the homepage and docs pages already exist as placeholders
- the docs structure is versioned and routed correctly
- the current website token file still reflects donor-era palette and typography choices more than the product brand
- the product itself already has stronger branding cues than the website does today

This means AI should be used first for visual direction and token design, not for code generation.

## Recommended AI Role

AI should be used as:

- a fast concept generator
- a visual exploration partner
- a style-system drafting assistant
- a design critique assistant

AI should not be treated as:

- the final art director
- the source of brand truth
- a reliable source of implementation-ready front-end code

## Recommended Tool Roles

### Figma AI

Best for:

- editable visual concepts
- layout and component exploration
- design iteration with real design files
- critique and refinement inside a collaborative design workflow

Use when:

- exploring page compositions
- refining selected directions
- preparing handoff-quality mockups

### Relume

Best for:

- rapid sitemap-to-wireframe generation
- quick style-guide experimentation
- generating alternate marketing-site structures and section layouts

Use when:

- comparing multiple homepage structures quickly
- testing different section patterns before detailed design work

### Uizard

Best for:

- rough prompt-to-mockup generation
- screenshot-to-editable-draft workflows
- early broad exploration when speed matters more than fidelity

Use when:

- generating multiple low-commitment page directions quickly

### v0

Best for:

- coded visual experiments
- component-level exploration after a design direction already exists
- pressure-testing layout ideas in responsive HTML/CSS

Use when:

- the visual direction is already chosen
- the goal is to evaluate implementation patterns, not invent the brand

### Adobe Firefly Or Canva

Best for:

- moodboards
- art direction support
- background or supporting imagery exploration

Use when:

- the site needs supporting visuals or stylistic reference material
- the team wants fast image-based exploration without touching layout structure

## Sambee Design Constraints

Any AI-generated direction must respect these constraints:

- Sambee is a practical technical product, not a lifestyle brand
- the site is docs-first, not marketing-only
- documentation readability matters as much as homepage appeal
- the docs are effectively text-only and should not depend on illustration-heavy or image-heavy layouts
- the design must work for both landing pages and dense docs pages
- the design should feel trustworthy, precise, efficient, and desktop-adjacent
- the design should express visual elegance through typography, spacing, rhythm, proportion, and restraint rather than decorative excess
- avoid generic purple-gradient SaaS styling
- avoid overly playful illustration-heavy startup aesthetics
- avoid visual systems that depend on one-off hero tricks and collapse in docs pages

## Deliverables

The visual design phase should produce these concrete outputs.

### Deliverable 1: Three Distinct Art Directions

Each direction should include:

- palette
- typography pairing
- component character
- page mood
- imagery direction
- rationale

The directions should be meaningfully different from each other.

### Deliverable 2: Selected Design Token System

The chosen direction should be converted into:

- semantic color tokens
- typography tokens
- spacing scale
- border radius rules
- elevation and border treatment rules
- component state styling rules
- light and dark theme guidance if both will be supported on the website

### Deliverable 3: Key Page Mockups

At minimum:

- homepage desktop
- homepage mobile
- docs landing page desktop
- docs book page desktop
- docs book page mobile

### Deliverable 4: Component Styling Spec

At minimum:

- header and navigation
- hero section
- buttons and links
- cards
- docs sidebar
- version switcher
- metadata chips
- callouts and banners
- code block framing
- footer

## Content Anchors For AI Prompts

AI-generated visual work will be more relevant if it is grounded in real Sambee messaging instead of abstract product descriptions.

Do not paste the entire homepage copy document into every prompt.

Use selected content anchors from `Homepage_text_copy.md` so the tool has:

- a real headline and subheadline
- real benefit language
- real CTA labels
- real product constraints and value framing

Recommended content to include in generation prompts:

- hero headline:
	- `Browser-based file access for SMB shares and local drives`
- hero subheadline:
	- `Sambee provides browser-based access to SMB shares and local drives. Explore, preview, and manage files directly in the browser, with the companion app extending Sambee to the local desktop when needed. Sambee enables browser-first file access without requiring files to be moved into the cloud.`
- supporting points:
	- `Self-hosted`
	- `Desktop and mobile`
	- `Companion optional`
- CTA labels:
	- `See Features`
	- `Admin Docs`
	- `Read Docs`
- core value statement:
	- `Sambee gives teams browser-based file access without forcing them into a cloud-first storage model.`
- deployment framing:
	- `Deploy Sambee where your files already live and keep access under your control.`

If the tool supports longer context well, also include selected benefit themes:

- self-hosted control
- better everyday file handling
- rich previews before download
- native editing when needed
- built for desktop and mobile
- fits existing infrastructure

These content anchors help the AI choose layouts, emphasis, and hierarchy that fit the real product instead of a generic SaaS landing page.

## Execution Plan

### Step 1: Write The Brief

Create one strong brief before touching any AI tool.

Why:

- weak prompts produce generic work
- the same brief should be reused across tools for comparable output

Output:

- one approved design brief
- one approved set of content anchors taken from homepage copy

### Step 2: Generate Multiple Directions

Use the brief to generate 3 to 5 clearly different visual directions.

Rules:

- do not ask for one direction only
- require explicit contrast between directions
- ask each tool for rationale, not just visuals

Output:

- a shortlist of directions worth review

### Step 3: Human Review And Selection

Review directions against product fit.

Review criteria:

- trustworthiness
- clarity
- docs readability
- brand distinctiveness
- implementation realism

Output:

- one primary direction
- optionally one backup direction

### Step 4: Convert Direction Into Tokens

Use AI to help translate the selected direction into a design system.

Output:

- a token proposal that can replace the current transitional website palette and typography

### Step 5: Design The Critical Surfaces

Apply the selected system to:

- homepage
- docs landing page
- docs article page

Output:

- reviewable page mockups with desktop and mobile coverage

### Step 6: Critique And Stress-Test

Use AI and human review to critique the mockups.

Test for:

- accessibility and contrast risk
- mobile density problems
- weak hierarchy
- over-designed hero sections
- docs fatigue over long reading sessions
- inconsistency between marketing and docs pages

Output:

- revision list

### Step 7: Prepare For Implementation

Turn the approved design into implementation-ready guidance.

Output:

- design tokens
- component rules
- page priorities
- notes for Hugo theme implementation

## Decision Framework

When comparing AI-generated directions, use this scorecard.

Rate each direction from 1 to 5 on:

- brand fit
- trust and professionalism
- docs readability
- visual distinctiveness
- implementation realism
- mobile adaptability
- reuse across homepage and docs

Directions that score well visually but poorly on docs readability should be rejected.

## Risks

### Risk: Generic SaaS Output

AI often defaults to polished but interchangeable startup visuals.

Mitigation:

- explicitly ban generic SaaS patterns in the brief
- require multiple differentiated directions
- keep a human review gate before any implementation work

### Risk: Marketing-Landing Bias

AI tools often optimize for splashy landing pages, not documentation-heavy surfaces.

Mitigation:

- require docs page mockups early
- evaluate design directions on article-page readability, not just hero design

### Risk: Brand Drift From The Product

The website could drift away from the actual Sambee application identity.

Mitigation:

- anchor the brief to Sambee product values and existing product branding
- treat website tokens as an extension of the product identity, not a separate brand

### Risk: Low-Fidelity Code Generation Too Early

If code generation starts before the visual direction is chosen, the project will converge on generic implementation patterns.

Mitigation:

- do not use AI code generation as the first design step
- use coded experiments only after direction and tokens are chosen

## Concrete AI Design Brief

Use this brief as the baseline prompt for Figma AI, Relume, Uizard, v0, or similar tools.

### Brief

Design a visual direction for the Sambee website.

Sambee is a browser-based product for accessing SMB shares and local drives. The website is a docs-first product site, not a pure marketing landing page. It must support both a product homepage and dense versioned documentation. The product logo will be uploaded together with this prompt and should be used as a brand anchor.

Use these real homepage content anchors when deciding hierarchy and emphasis:

- headline: `Browser-based file access for SMB shares and local drives`
- subheadline: `Sambee provides browser-based access to SMB shares and local drives. Explore, preview, and manage files directly in the browser, with the companion app extending Sambee to the local desktop when needed. Sambee enables browser-first file access without requiring files to be moved into the cloud.`
- supporting points: `Self-hosted`, `Desktop and mobile`, `Companion optional`
- CTA labels: `See Features`, `Admin Docs`, `Read Docs`
- core value statement: `Sambee gives teams browser-based file access without forcing them into a cloud-first storage model.`
- deployment framing: `Deploy Sambee where your files already live and keep access under your control.`

Treat these content anchors as real copy constraints, not placeholder text.

The visual tone should feel:

- trustworthy
- precise
- efficient
- technical without feeling cold
- desktop-adjacent and productivity-oriented
- distinctive, but not flashy
- typographically strong
- visually elegant through restraint, proportion, and polish

The design must avoid:

- generic startup SaaS aesthetics
- purple gradients
- playful cartoon illustrations
- crypto or AI-brand visual clichés
- visual systems that look good only in hero sections and fail on docs pages

The website should feel more like a serious tool for real work than a hype-driven product launch. Favor strong typography, careful spacing, confident composition, and elegant visual hierarchy over heavy decoration.

Base the visual language on these brand cues:

- warm golden yellow accents
- charcoal or deep neutral structure
- cream or warm light surfaces where appropriate
- strong typography and restrained color use
- clean technical layouts with a sense of craft
- editorial clarity and refined page rhythm

Create 3 distinct visual directions for the website. For each direction, include:

- a color palette with semantic roles
- typography recommendations
- homepage art direction
- docs page art direction for documentation that is effectively text-only
- component styling notes for cards, navigation, sidebar, buttons, chips, and callouts
- imagery or illustration direction if used
- a short rationale explaining why the direction fits Sambee

Make the homepage concepts feel plausible for the supplied copy, especially the long subheadline and the text-first documentation emphasis.

All directions must work across:

- homepage desktop and mobile
- documentation landing page
- documentation article page with sidebar and version switcher

Optimize for:

- readability
- strong hierarchy
- typographic quality
- visual elegance without ornament for its own sake
- calm but confident branding
- responsive behavior
- consistency between marketing and docs surfaces
- realistic implementation in a Hugo-based website with reusable theme tokens

### Short Prompt Variant

Create 3 distinct visual directions for a docs-first product website for Sambee, a browser-based SMB and local-drive access tool. The product logo will be uploaded with this prompt and should be used as a brand anchor. Use these content anchors as real homepage copy constraints: headline `Browser-based file access for SMB shares and local drives`; supporting points `Self-hosted`, `Desktop and mobile`, `Companion optional`; CTA labels `See Features`, `Admin Docs`, `Read Docs`; core message `browser-based file access without forcing a cloud-first storage model`. The site must feel trustworthy, technical, efficient, desktop-adjacent, typographically strong, and visually elegant through restraint. Use warm golden accents, charcoal structure, cream or warm light surfaces, and refined typography-led design. The docs are effectively text-only, so the system must rely on hierarchy, spacing, rhythm, and component discipline rather than imagery. Avoid generic SaaS visuals, purple gradients, cartoon illustration, and over-designed hero sections. Each direction must include homepage and docs-page styling, semantic palette, type choices, component character, and rationale.

### Critique Prompt Variant

Review this Sambee website concept as a senior product designer. Evaluate brand fit, trustworthiness, docs readability, visual hierarchy, mobile behavior, accessibility risk, and consistency between homepage and docs pages. Identify weak points and propose concrete revisions.

## Recommended Next Action

Run the concrete brief through one design-file-first tool and one structure-first tool.

Recommended pair:

- Figma AI for editable visual exploration
- Relume for alternate homepage and section structures

After that, compare outputs and choose one direction before writing any implementation CSS.
