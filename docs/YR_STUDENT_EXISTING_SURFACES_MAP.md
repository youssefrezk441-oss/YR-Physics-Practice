# YR Physics — Existing student surfaces → approved navigation (2026-10-30)

## Confirmed implementation facts (GitHub main and branch PR #43)

- **Deployed page** `student.html` is built from `student-base.html` by `tools/build_pages_artifact.mjs`. `student.html` is a transformation loader containing runtime view insertions and permissions checks, not the shipped HTML.
- Supabase `student-practice` populates existing training catalog and attempts, while separate workshop edge functions control certain workshop access.
- The original app currently has separate `firstTermWorkshopsView` and `secondTermWorkshopsView` injected by `student.html`, though their launch buttons are scattered over the landing page. **Grade 3** first chapter links L3/L4/L5/L6 and personal mistakes; second chapter links unified L1 workshop, paper homework and second-chapter mistakes.
- For **grade 2**, existing home buttons `openB2Lesson1Workshop` / `openB2Lesson2Workshop` reflect motion-topic workshops and are exposed only on their backend availability checks. Do not mislabel these as grade 3 content.
- Existing account `student-complete-profile.html` handles profile edits/password change and mandatory profile enforcement.
- Existing Honor Arena uses the deployed `student-honor-board` Edge Function, which already returns `available_cycles` per grade/track, supports `cycles` selection by ID/code, and reads frozen `assessment_cycle_snapshots` for archived editions. The approved PR now surfaces these real rounds; it does **not** invent a separate الفصل الثاني board until a new backend cycle is created.
- Existing `openChapterMistakes` links `student-ch1-mistakes.html`; `openCh2Mistakes` links `student-ch2-mistakes.html`. Both deep links are protected by the profile gate. Second chapter button also needs backend `student-ch2-mistakes?action=ping` permission before showing.
- Existing legacy course menus `trainingMenuView`, `trainingCoursesView`, `availableTrainingsView`, `completedTrainingsView`, `indicatorsMenuView`, `platformIndicatorsView`, `commitmentView`, `classTestsView`, `assessmentCycleView` stay active and preserve student attempt/history functions.

## Architecture mapping

| Approved top-level | Current implementation | Implementation stage / constraint |
|---|---|---|
| مساحتي | `dashboardView` welcome / studentProfileMeta | Replace tile-only shortcuts with task-focused landing; no invented last/next student work |
| التعلّم / الفصل الأول | `openFirstTermWorkshops` → `firstTermWorkshopsView`; course `openChapterTrainings` | Only when the original source button is eligible and visible |
| التعلّم / الفصل الثاني | `openSecondTermWorkshops` → `secondTermWorkshopsView`; grade-2 B2 lesson workshop buttons | Show only matching student grade and server-allowed actions |
| التعلّم / التأسيسي | `openFoundationTrainings` | Independent course, do **not** mistake for an ordinary chapter |
| التعلّم / تدريباتي السابقة | `openCompleted` → `completedTrainingsView`; `student-history-chapters.mjs` | Filter verified chapter metadata and course slugs; keep unknown/foundation separate and expose an explicit combined view. Existing backend history is capped at the latest 100 attempts. |
| مراجعتي / الفصل الأول | `openChapterMistakes` → `student-ch1-mistakes.html` | Grade-3 source button only; direct route available |
| مراجعتي / الفصل الثاني | `openCh2Mistakes` → `student-ch2-mistakes.html` | Grade-3 and availability gate; don't invent access |
| الإنجازات / جولات التقييم | `openHonor` → `honorView`; `student-honor-board` `available_cycles` | The PR lets students select actual grade-specific evaluation rounds. Existing score formulas and rank engine remain server-owned. |
| الإنجازات / لوحات مؤرشفة | `assessment_cycle_snapshots` and `student-honor-board` | Actual frozen rounds are displayed as immutable archives. Cycles without frozen snapshots must be labeled non-archived. |
| مساحتي / تقدّمي | `openIndicators` and existing indicators submenus | Existing performance metrics; keep their calculation untouched |
| حسابي | `student-complete-profile.html`, themeBtn, logoutBtn | Keep current auth/approval and profile completion requirements |

## UI/UX constraints

1. Desktop: permanent RTL right-side sidebar, mobile: fixed four destinations (مساحتي، التعلّم، مراجعتي، المزيد).
2. Navigation shell always reflects active section, preserving legacy practice screens and all event handlers.
3. During `practiceView`, menu collapses/hides to keep wide question/circuit space. During `resultView`/ `reviewView`, context remains accessible.
4. Chapter-scoped cards must invoke the **existing** student-eligible launcher; no direct unverified shortcuts, no fabricated scores or chapters.
5. Existing legacy links/IDs remain for backwards compatibility. Errors in chapter 1/2 are presented under "مراجعتي", not as mixed workshop content.
6. Chapter versioning is a catalog/data problem; a pretty second honor-board tab must not silently reuse the first board.
7. Keep prototype on PR #43 until real desktop/mobile browser and functional regression tests succeed. No changes to production DB.

## Updated read-only verification (2026-10-30)

- The deployed `student-practice` `history` action returns attempt `slug` **and** `course_slug` but limits the response to **100 most recent attempts**. Thus the new browser-side chapter filter classifies only the loaded rows; it cannot promise a complete all-time archive until a paginated endpoint is added.
- Deployed `student-honor-board` returns `available_cycles` for grade3, grade2 (Baccalaureate), and grade2_azhar, and accepts `cycles` by ID or code. Its snapshot path reads saved `assessment_cycle_snapshots` and is distinct from a live readiness calculation.
- The database already has a frozen foundation cycle for grade 3 and grade 2 Baccalaureate; the existing grade-3 chapter-one cycle is still open and **not** frozen. This is metadata verification only; no learner data was accessed or edited.
- No grade-3 chapter-two board was found. Creating one requires an independent evaluation cycle with correctly scoped source data, plus freeze/publish controls. The UI must never reuse the chapter-one board under a chapter-two label.
- All changes remain on draft PR #43 and have not been published to the live site.
