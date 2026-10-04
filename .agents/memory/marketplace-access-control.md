---
name: Marketplace access control
description: Security boundaries for marketplace publishing, media uploads, and owner moderation.
---

Require Replit Auth for post creation and media-upload URL requests. Build displayed seller identity from the authenticated account rather than client-submitted values. Web moderation must authorize the authenticated account against the server-side `MARKETPLACE_ADMIN_EMAIL` setting; never trust a client-provided admin identifier.

**Why:** Client-supplied identity and owner headers can be forged. A configured account boundary keeps public publishing attributable and moderation restricted.

**How to apply:** Preserve these checks when changing marketplace routes, API contracts, or auth flows. Telegram moderation is a separate optional channel and must retain its webhook secret and admin-chat checks.