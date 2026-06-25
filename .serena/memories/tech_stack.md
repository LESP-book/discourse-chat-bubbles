# Tech Stack

- Discourse theme component: metadata in `about.json`, settings in `settings.yml`, SCSS compiled by Discourse theme pipeline, JS initializer loaded through `discourse/lib/api`.
- JavaScript uses Discourse frontend conventions and `apiInitializer("0.11.1", callback)`.
- Styling uses SCSS plus Discourse CSS variables/classes such as `.chat-*`, `var(--primary-*)`, and theme setting variables injected from `settings.yml`.
- Package manager/tooling: Yarn lockfile; `package.json` only declares `eslint-config-discourse` as dev dependency.
- No local app server or standalone test harness in this repo; integration behavior depends on a host Discourse instance.