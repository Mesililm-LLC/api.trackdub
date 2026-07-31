---
kind: frontend_style
name: No frontend styling system — backend-only API
category: frontend_style
scope:
    - '**'
---

This repository is a Cloudflare Workers backend (Hono + Better Auth + D1 + Drizzle) and contains no frontend code, CSS, or UI styling. A search for CSS/SCSS/Less/Sass files and styling-related imports found zero matches in source code; the only references to style preprocessors appear in package-lock.json as transitive dependencies of other tools. The package.json confirms this is a private API project with no frontend dependencies (no React, Vue, Svelte, Tailwind, styled-components, or any CSS framework). There are no HTML templates, static assets, or design tokens present. Consequently, the frontend_style category does not apply to this repository.