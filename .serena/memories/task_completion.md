# Task Completion

- For JS changes, run `npx eslint javascripts/discourse/api-initializers/chat-bubbles.js`.
- For theme/template structure changes, run `npx ember-template-lint .` when dependencies/config are available.
- For setting changes, verify `settings.yml` has defaults/type/description and consumer code handles the setting.
- Manual validation is expected in a host Discourse chat UI: light/dark schemes, current-user vs other-user messages, replies, reactions, onebox, threads, read receipts.
- There is no repository-local automated test suite; report any unavailable lint/tooling clearly.