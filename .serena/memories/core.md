# Core

- Discourse theme component for chat bubble styling; loaded by host Discourse, no standalone build artifact.
- Main source map: `about.json` metadata/assets, `settings.yml` theme settings, `common/color_definitions.scss` setting-to-CSS-variable wiring, `common/common.scss` shared chat/read-receipt styling, `mobile/mobile.scss` mobile-only tweaks, `javascripts/discourse/api-initializers/chat-bubbles.js` runtime initializer, `locales/en.yml` metadata copy.
- Stable module notes exist in repository CLAUDE docs; read them when touching matching folders.
- Keep behavior inside theme APIs/settings; do not modify Discourse core for this component.
- For module-specific style contracts, read `mem:conventions`; for tools and completion checks, read `mem:task_completion`.
- For Discourse 2026.06 read receipt API limitations, read `mem:chat/read_receipts_2026_06`.