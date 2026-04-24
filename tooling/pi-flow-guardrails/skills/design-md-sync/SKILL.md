---
name: design-md-sync
description: Create or update DESIGN.md from an existing repository design system. Use when the repo already has UI, styles, components, themes, screenshots, or brand patterns that should become the source of truth. Ends by producing a repo-root DESIGN.md unless another path is requested.
---

# DESIGN.md Sync

Create or update `DESIGN.md` from the design language already present in the repository.

Use this skill when the repo has existing UI patterns, theme tokens, CSS variables, Tailwind/DaisyUI config, components, screenshots, docs, or brand assets that should be captured as the source of truth.

## Goal

Produce a `DESIGN.md` that reflects the repo's actual implemented design system rather than inventing a new one.

Default output path:

```text
DESIGN.md
```

If the user specifies another path, write there instead.

## Discovery Pass

Read first, then write. Inspect relevant files before creating/updating `DESIGN.md`.

Look for:

- Existing `DESIGN.md`, design docs, brand docs, style guides
- App routes/pages/screens
- Shared components
- Theme stores and theme definitions
- CSS/Tailwind/DaisyUI/PostCSS config
- CSS variables and design tokens
- Component libraries and primitives
- Locale/copy tone if relevant
- Screenshots, previews, Storybook, Playwright snapshots, or docs
- Platform-specific UI conventions if applicable

Suggested search targets:

```text
DESIGN.md
README.md
docs/
src/styles/
src/components/
src/app/
tailwind.config.*
postcss.config.*
*.css
*.scss
*.tsx
*.ts
```

For Openread specifically, also inspect likely design sources such as:

```text
apps/openread-app/src/styles/
apps/openread-app/src/styles/themes.ts
apps/openread-app/src/components/
apps/openread-app/src/app/
apps/openread-app/src/store/themeStore.ts
apps/openread-app/src/types/settings.ts
docs/design-system/
```

## Existing DESIGN.md Handling

If `DESIGN.md` already exists:

1. Read it first.
2. Preserve useful, accurate sections.
3. Update stale or vague sections based on actual repo evidence.
4. Do not discard project-specific vocabulary unless it is wrong.
5. Prefer a clear full-file rewrite if the current file is skeletal or inconsistent.

If no `DESIGN.md` exists:

1. Extract the current design language from code and docs.
2. Produce a new `DESIGN.md` using the required structure below.

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

## Evidence Requirements

Ground the document in repo evidence. Use actual tokens, classes, components, and patterns where available.

When extracting, identify:

- Real color values and semantic roles
- Real typography stacks and sizes
- Real component states and variants
- Real spacing/radius/shadow conventions
- Real responsive/platform behavior
- Repeated UI patterns and anti-patterns

Avoid inventing a completely new visual direction unless the user explicitly asks for redesign.

## Section Guidance

### 1. Visual Theme & Atmosphere

Summarize the current implemented design language:

- Mood
- Density
- Surface hierarchy
- Interaction style
- Product-specific tone

### 2. Color Palette & Roles

Document actual colors/tokens/classes. Include hex values when present. If a design system uses named tokens, map names to roles.

### 3. Typography Rules

Capture existing font stacks, heading/body/code treatment, weights, line heights, and any platform-specific typography.

### 4. Component Stylings

Document existing component conventions for:

- Buttons
- Cards/panels
- Inputs/forms
- Navigation
- Modals/popovers
- Lists/tables
- Badges/toasts/alerts
- Loading/empty/error states

### 5. Layout Principles

Capture current spacing, grid, shell, page/container, and density patterns.

### 6. Depth & Elevation

Document shadows, borders, overlays, surface layers, glass/translucency, and modal stacking.

### 7. Do's and Don'ts

Turn existing patterns into explicit guardrails.

### 8. Responsive Behavior

Document actual responsive behavior and platform targets. Include mobile, desktop, and native shell considerations when present.

### 9. Agent Prompt Guide

Provide compact instructions for future AI agents using this repo's design language.

Include:

- Quick token reference
- Component generation rules
- Example prompts
- Anti-pattern warnings

## Quality Checklist

Before writing the final file, verify:

- It matches the repo's current UI rather than an invented redesign.
- It references real tokens/components/patterns where possible.
- It is specific enough for future agents to generate consistent UI.
- It includes component states and responsive rules.
- It preserves useful existing design.md content if present.
- It writes a complete `DESIGN.md`, not just an audit.

## Output Rule

End by writing the complete `DESIGN.md`. If updating an existing file, make the smallest safe update when the file is already high quality; otherwise rewrite it into the required structure.
