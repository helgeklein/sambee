# Design System Strategy: The Archival Modernist

## 1. Overview & Creative North Star
This design system is built upon the **"The Archival Modernist"** North Star. It rejects the soft, floating nebulosity of contemporary SaaS interfaces in favor of the permanence and authority found in physical engineering logs and rare technical manuscripts.

The goal is to create a digital environment that feels "printed." By leveraging a rigid, high-density grid and uncompromising structural rules, we translate the "Technical Ledger" concept into a premium editorial experience. We break the standard template look through **Hyper-Structured Asymmetry**: using varying column widths and intentional "ink-heavy" structural borders that give the interface the weight of a physical object. Every element is anchored; nothing floats.

## 2. Colors & Structural Tonality
The palette is a sophisticated interplay between a warm, tactile base and a high-contrast ink-and-gold accent system. 

### The "Rules" of Engagement
*   **The Structural Rule:** Contrary to standard "invisible" UI, this system celebrates the line. Use the `outline` (`#827562`) and `outline_variant` (`#d4c4ae`) tokens to create a literal framework for the content. 
*   **Surface Nesting:** Use `surface` (`#fbf9f4`) as your primary paper stock. When nesting information (like a technical data block), move to `surface_container_low` (`#f5f3ee`). For high-density sidebars or metadata panels, use `surface_container_high` (`#eae8e3`) to create a perceptible but flat shift in importance.
*   **The "No-Gradient" Mandate:** To maintain the technical ledger aesthetic, gradients and shadows are strictly prohibited. Visual depth is achieved solely through color blocking and line weight.
*   **Strategic Gold:** Use `primary` (`#7c5800`) and `primary_container` (`#ebb035`) sparingly. They are not for decoration; they are for "Action" and "Status." A gold block should feel like a hand-applied stamp on a technical drawing.

## 3. Typography
Typography is the cornerstone of this system, functioning as both content and graphic element.

*   **Display & Headlines (Newsreader):** Use the refined serif for high-level categories and page titles. The transition from `display-lg` to `headline-sm` should feel like the headings of a classic broadsheet or a formal ledger.
*   **Body (Work Sans):** The "Workhorse." This sans-serif provides the clarity needed for high-density data. It should feel invisible, efficient, and modern.
*   **Labels (Space Grotesk):** This monospaced-leaning sans is used for all metadata, timestamps, and technical annotations. It provides the "engineering log" flavor. Use `label-md` for data headers to distinguish them from standard body text.

## 4. Elevation & Structural Depth
Since shadows and gradients are prohibited, we convey hierarchy through **Tonal Blueprinting** and **Line Weight**.

*   **The Layering Principle:** Depth is "stacked" rather than "lifted." An active module is not shadowed; it is bordered with a thicker `outline` or filled with `primary_container` to indicate it is the current focus.
*   **Structural Borders:** Every major section must be defined by a solid rule. Use 1px or 2px lines using `outline_variant`.
*   **Intentional Density:** Unlike "Modern Soft" systems that prioritize white space, this system prioritizes "Smart Density." Use tight padding and rigorous alignment to mimic a complex technical schematic.
*   **The "Ink" State:** Interactive elements (like a selected row) should shift the background to `on_surface` (`#1b1c19`) and the text to `inverse_on_surface` (`#f2f1ec`), creating a high-contrast "Inverted" look that feels like an intentional highlight.

## 5. Components

### Buttons
*   **Primary:** Solid `primary_container` background, 0px radius, with `on_primary_container` text. These must be rectangular and feel like "stamps."
*   **Secondary:** No background, 1px `outline` border, 0px radius. 
*   **Tertiary:** Text-only, using `label-md` (Space Grotesk) in uppercase to denote a technical command.

### Input Fields
*   **Structure:** Rectangular boxes with 1px `outline` borders. No rounded corners.
*   **Labels:** Always persistent, positioned above the input in `label-sm`.
*   **Focus State:** The border weight increases to 2px using the `primary` gold token.

### Cards & Lists
*   **Anti-Card Pattern:** Do not use traditional "raised" cards. Use "Cells."
*   **The Cell:** A section of the grid defined by 1px `outline_variant` borders on all sides. 
*   **List Items:** Forbid the use of standard thin dividers. Instead, use a alternating background shift (`surface` to `surface_container_low`) or a heavy `outline` at the bottom of the header.

### Data Tables (The Core Component)
*   The "heart" of the system. Use high-density rows.
*   **Headers:** `surface_container_high` background with `label-md` monospaced text.
*   **Metadata:** Use `label-sm` for all numerical data and timestamps to maintain the "Log" aesthetic.

## 6. Do's and Don'ts

### Do
*   **Do** use 0px border-radius for every single element. Rounding is the enemy of the Ledger.
*   **Do** use vertical and horizontal rules to create a "locked-in" grid.
*   **Do** treat typography as a structural element. Alignment of text is more important than the use of icons.
*   **Do** use `primary_container` (#EBB035) for critical data points or status indicators to draw the eye immediately.

### Don'ts
*   **Don't** use shadows, glows, or blurs. If it doesn't exist on a printed page, it doesn't exist here.
*   **Don't** use standard 8px or 16px "safe" padding. Experiment with tighter, technical spacing (4px, 12px) to achieve high density.
*   **Don't** use icons as primary navigation. Rely on clear, monospaced labels.
*   **Don't** use soft grays for text. Use the high-contrast `on_surface` (#1B1C19) to ensure the interface feels authoritative and "inked."