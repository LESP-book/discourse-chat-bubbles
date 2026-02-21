# Repository Guidelines

## Project Structure & Module Organization
This repository is a Discourse theme component focused on mobile chat bubble styling.
- `about.json`: component metadata and asset mapping (for example `chat-background`).
- `settings.yml`: theme settings (colors, pattern toggle, upload field).
- `javascripts/discourse/api-initializers/chat-bubbles.js`: client initializer entrypoint.
- `common/color_definitions.scss`: shared color helpers and CSS variable wiring.
- `mobile/mobile.scss`: primary chat UI overrides.
- `locales/en.yml`: theme metadata text.
- `assets/`: static files such as `assets/circuit-board.svg`.

Keep changes scoped: new visual behavior should usually touch `settings.yml` + relevant SCSS/JS + locale text.

## Build, Test, and Development Commands
This component is loaded by a host Discourse instance; there is no standalone build artifact.
- `yarn install`: install lint tooling.
- `npx eslint javascripts/discourse/api-initializers/chat-bubbles.js`: lint JavaScript.
- `npx ember-template-lint .`: run template lint rules from Discourse config.
- `discourse_theme watch .`: live-preview in a local Discourse site (requires Theme CLI).

## Coding Style & Naming Conventions
- Use 2-space indentation in JS, SCSS, and YAML.
- Follow `.eslintrc` (`eslint-config-discourse`) and `.template-lintrc.js`.
- Theme setting keys use `snake_case` (for example `light_bubble_color_1`).
- CSS custom properties use kebab-case (for example `--bubble-bg-1`); keep selectors aligned with Discourse chat classes (`.chat-*`).
- Keep initializer logic idempotent and minimal; prefer declarative styling in SCSS.

## Testing Guidelines
There is no automated test suite in this repo. Validate via lint + manual UI checks.
- Verify light/dark schemes, message ownership states, reactions, onebox rendering, and thread view.
- Test with `enable_pattern` both true/false and with uploaded pattern assets.
- When adding settings, include defaults and user-facing description updates in `settings.yml` and `locales/en.yml`.

## Commit & Pull Request Guidelines
Git history favors short, imperative subjects, sometimes with prefixes (for example `UX: fix link oneboxing`).
- Keep commits focused on one concern.
- PRs should include: concise summary, linked issue (if any), changed setting keys, and before/after screenshots (mobile + dark mode when relevant).
- Add a short manual test checklist in the PR description.

## Security & Configuration Tips
- Do not commit local environment files (for example `.discourse-site`) or secrets.
- Prefer optimized SVG/background assets for mobile performance.
- Implement behavior through theme APIs/settings; avoid modifying Discourse core code.
