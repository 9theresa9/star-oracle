# Third-party notices

## Xuandu

Source: https://github.com/cnc876297794-arch/xuandu
License: MIT
Copyright (c) 2026 cnc876297794-arch

packages/domain/data.js adapts these source files:
- app/lib/tarot.ts (Git blob ba8c84996acaac69ab66782faf31c17c2b5c9afb): 22 major cards, four suits, 14 ranks, and 56 compositional minor cards.
- app/lib/iching.ts (Git blob 24a654b85b8a0faf8f031dc50345c40d6c6610bf): King Wen mask mapping, Chinese names, trigrams, and modern reflection prompts.

The full MIT license is included in licenses/xuandu-MIT.txt. No deck scans, proprietary illustrations, or classical-text translation assets are included.

## Architecture references and runtime dependencies

The business modules were developed for this project using NestJS, React, Prisma and Better Auth. Architecture references include brocoders/nestjs-boilerplate and alan2207/bulletproof-react (MIT). No claim is made that the application is an unmodified fork of these templates.

NestJS, React, Better Auth, TanStack Query, React Router, Vite, Zod, Express, Helmet, ioredis, Nodemailer, lucide-react and qrcode.react use their published open-source licenses; Prisma and RxJS include Apache-2.0 notices. npm packages carry their own license files. Redis 7.4 and MySQL container distributions have their own licensing terms; review the selected images' notices for redistribution.

## Development-only tools

GitHub Actions installs Playwright 1.56.1 to run browser checks. Playwright is licensed under Apache-2.0; it is not included in the application's runtime or frontend runtime.

GitHub Actions uses actions/checkout, actions/setup-node and actions/upload-artifact. Their code runs in CI and is not bundled into the website.
