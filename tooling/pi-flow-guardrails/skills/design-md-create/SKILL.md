---
name: design-md-create
description: Create a new DESIGN.md from scratch for a product, app, or website. Use when no reliable design system exists yet or when starting a fresh visual direction. Ends by producing a repo-root DESIGN.md unless another path is requested.
---

# DESIGN.md Create

Create a new `DESIGN.md` from scratch using the DESIGN.md/Stitch-style structure popularized by Google Stitch and the VoltAgent awesome-design-md collection.

Use this skill when the user wants a fresh design system, new brand direction, new product UI language, or a blank-slate `DESIGN.md`.

## Goal

Produce a complete `DESIGN.md` that an AI design/coding agent can read to generate consistent UI.

Default output path:

```text
DESIGN.md
```

If the user specifies another path, write there instead.

## Intake

If information is missing, ask concise questions or infer from repo/product context. Prefer progress over long interviews.

Capture or infer:

- Product name and category
- Target users and primary use cases
- Brand personality: e.g. calm, technical, editorial, premium, playful
- Desired visual references: apps/sites/brands the UI should evoke
- Light/dark preference
- Accessibility expectations
- Primary surfaces: marketing site, app dashboard, reader, editor, mobile, etc.
- Existing constraints: fonts, framework, component library, brand colors, platform targets

## Required DESIGN.md Structure

The final file must include these sections:

```markdown
# DESIGN.md

## 1. Visual Theme & Atmosphere

## 2. Color Palette & Roles

## 3. Typography Rules

## 4. Component Stylings

## 5. Layout Principles

## 6. Depth & Elevation

## 7. Do's and Don'ts

## 8. Responsive Behavior

## 9. Agent Prompt Guide
```

## Section Guidance

### 1. Visual Theme & Atmosphere

Define the overall design philosophy:

- Mood and emotional tone
- Density and rhythm
- Surface style
- Iconography and imagery direction
- Motion/interaction feel

### 2. Color Palette & Roles

Provide semantic tokens with hex values and roles. Include at least:

- Backgrounds
- Text colors
- Muted text
- Borders
- Primary/accent
- Success/warning/error/info
- Focus ring
- Selection/highlight

Use tables when helpful:

```markdown
| Token        | Hex    | Role                |
| ------------ | ------ | ------------------- |
| `--color-bg` | `#...` | Main app background |
```

### 3. Typography Rules

Specify:

- Font families or fallback stacks
- Type scale
- Weights
- Letter spacing
- Heading/body/code behavior
- Line-height rules

### 4. Component Stylings

Define component rules for:

- Buttons
- Cards/panels
- Inputs/selects/textareas
- Navigation
- Dialogs/popovers
- Tables/lists
- Badges/toasts/alerts
- Empty/loading/error states

Include states: hover, active, focus, disabled, selected.

### 5. Layout Principles

Define:

- Spacing scale
- Grid/container behavior
- Page structure
- Gutters
- Density
- Alignment rules

### 6. Depth & Elevation

Define:

- Shadow system
- Layering/z-index principles
- Borders vs shadows
- Overlays and modals
- Glass/translucency rules if any

### 7. Do's and Don'ts

Provide explicit design guardrails:

```markdown
Do:

- ...

Don't:

- ...
```

### 8. Responsive Behavior

Define:

- Breakpoints
- Mobile nav behavior
- Touch target sizes
- Table/list/card collapse behavior
- Platform-specific considerations

### 9. Agent Prompt Guide

Include concise instructions agents can reuse:

- Quick palette reference
- UI generation rules
- Example prompts
- Anti-pattern reminder

## Quality Checklist

Before writing the final file, verify:

- The file is specific enough for an AI agent to generate UI without guessing.
- Tokens have functional names and hex values.
- Components include states.
- Responsive rules are actionable.
- The design has clear do/don't guardrails.
- The document avoids vague phrases like "modern and clean" without concrete implementation details.

## Output Rule

End by writing the complete `DESIGN.md`. Do not stop at an outline unless the user explicitly asks for a draft only.
