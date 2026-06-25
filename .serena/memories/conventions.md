# Conventions

- 2-space indentation in JS, SCSS, YAML.
- Theme setting keys use snake_case; CSS custom properties use kebab-case.
- Prefer declarative SCSS for visual behavior; keep JS initializer idempotent and limited to runtime-only DOM/API integration.
- New visual settings normally require coordinated changes in `settings.yml`, SCSS/JS consumer, and any user-facing description text.
- Selectors should align with Discourse chat DOM classes (`.chat-message-container`, `.chat-message-content`, `.is-by-current-user`, `.chat-reply`, `.cb-read-receipt`).
- Preserve existing user changes in the worktree; do not revert unrelated files.