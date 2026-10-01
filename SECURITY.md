# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3.0 | :x:                |

Only the latest minor release receives security fixes.

## Reporting a vulnerability

**Do not open a public issue.** Report privately via GitHub:
repository `Security` tab → `Report a vulnerability`
(private security advisory, visible only to maintainers).

Include: affected version, what leaks or bypasses protection, minimal
reproduction steps. We aim to acknowledge within 72 hours and will
coordinate a fix and disclosure timeline with you.

## Scope notes

DataCloak is a client-side privacy layer, not a security boundary:
cloaked values still reach the model provider as realistic fakes, and
page-DOM restore is display-only (see README). Reports about the
threat model itself (e.g. "the model sees fake IPs") are usage questions,
not vulnerabilities — open a discussion instead.
