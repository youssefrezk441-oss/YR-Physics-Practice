# YR Physics Practice — Internal Visual Identity v1

**North star:** رحلة منظّمة من الفهم إلى الإتقان

## Brand DNA

- Adopt the approved geometric `assets/yr-mastery-mark.svg` (YR with four journey dots, fourth in warm gold); never return to the arrow logo.
- Use YR Physics Practice as the primary wordmark, with مستر يوسف رزق as the teacher byline.
- Main palette: forest `#0E5948`, deep `#133D33`, paper `#F6F8F3`, surface `#FFFFFF`, hairline `#DCE6DD`, gold `#D6A149`. Gold means *mastery*, not a generic status or warning.
- Text: Tajawal first, Tahoma fallback. Equations stay in technical/scientific type and LTR when required. Numeric answer accuracy takes priority over decoration.
- Off-white paper, focused white surfaces, muted green, accessible focus. Avoid saturated purple/blue dashboards, oversized gradients, loud gamification, repeated decorative emojis, or colorful answer options.
- 4 steps: افهم → طبّق → تدرّب → أتقن. This **is the instructional method**, not the student's measured current progress. Never fabricate personal metrics.

## What phase 1 changes

- Actual student application source `student-base.html`; the published `student.html` is **compiled** from it by `tools/build_pages_artifact.mjs`.
- Identity header and mastery mark.
- Personalized landing hero, journey visualization, and three functional primary areas.
- Reusable light and dark design tokens and mobile card/header rules.
- Consistent treatment of common internal navigation/buttons/sections; no scores, learning records or exam logic are changed.
- Accessibility: visible keyboard focus, RTL, reduced motion, legible mobile sizes.

## Later phases — separate pull requests

1. **Workshops / question experience.** Strict physics diagrams and formulas; unify question cards, choices, progress feedback, clock, answer review, error/mistake states. Mobile first, never clip diagrams or math.
2. **Student performance / analytics.** Clarity for absolute results vs relative growth; avoid misleading color-only grades and invented insights. Distinguish quiz, workshop, attendance and mastery.
3. **Honor Arena.** Align recognitions with the same identity while retaining accessible distinction for the real winner or progress status and avoiding fabricated ranks.
4. **Admin surfaces.** Neutral, dense, precise tables/forms; stronger hierarchy and affordances, with shared logo/colors but **not** copying student-card layouts into admin.
5. **Isolated legacy workshops.** Audit each real static HTML entry point and CSS ownership. Use scoped tokens, never large unreviewed global overrides.

## Release gates

- No production publish from this phase until approved visual review.
- Pass layout at desktop 1440px, tablet 768px, mobile 390px and a narrow 320px viewport in **both** light and dark mode.
- No horizontal overflow, clipped scientific diagrams, shrinking touch targets or hidden back navigation.
- All old DOM IDs and student event handlers must remain, including mandatory profile checks, quiz submission, history and logout.
- Validate `tools/build_pages_artifact.mjs`, not only source `student-base.html`.
- Automated test: `node --test tools/tests/yr-internal-identity.test.mjs`.

## Status

Phase 1 is a draft review PR, not yet on the public student dashboard. Student data and Supabase are unchanged.
