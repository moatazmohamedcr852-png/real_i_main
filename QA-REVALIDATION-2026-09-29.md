# REAL_i Platform — QA Revalidation (29 September 2026)

## Run status

**Partial revalidation; the requested 49-scenario browser rerun could not be completed.** The original report defines live browser execution as the test method. The computer-use service returned `Transport closed`, and launching a separate browser session was rejected by the desktop execution policy. I therefore did not claim UI behavior I could not observe.

The local Express/PostgreSQL app is reachable at `http://localhost:3001` and `/v1/health` returned HTTP 200 with the database connected. I rechecked available scenarios with read-only authenticated API requests and inspected the deployed frontend bundles and current backend handlers. I did not create assessments, submissions, meetings, accounts, uploads, or other QA data during this rerun.

## Current findings

| Area | Result | Evidence |
|---|---|---|
| Empty quiz submission | **Pass (handler inspection)** | `POST /assessments/:id/submit` computes a score only when there is answer content. An empty answer set is stored as pending with a null score; it cannot receive 100 from this path. No new submission was created for this check. |
| Required assignment upload | **Pass (handler inspection)** | Assignment/task submissions without an uploaded file are rejected with HTTP 400 `FILE_REQUIRED`. Upload bytes are inserted into `assessment_submission_files.file_data`; the admin file routes read and return those bytes. |
| Assessment type and student scoping | **Pass (live API)** | Student `GET /v1/assessments` returned 41 records with types (`assignment`, `quiz`, `task`) present on every record. The route filters to published global assessments plus assessments for enrolled courses. |
| Assessment file/submission listing | **Partial (live API)** | `GET /v1/assessments/student/me` returned 25 records. Four legacy records have no assessment reference; none of this student’s current records had file metadata, so this run could not verify opening a real submitted attachment in the grading UI. |
| Dashboard and performance data source | **Partial (bundle inspection + live API)** | Both current bundles call `getStudentLearningSummary`; the dashboard bundle no longer contains “My Assessment Submissions”. The endpoint returned 82 courses, 41 assessments, 1 attended session, and `assessmentAverage: 1000` for the seeded student. That account has 82 enrollments, so it is not a valid one-course fixture. The 1000 average is also a real calculation defect: the endpoint divides a percentage score by total marks and multiplies by 100 again. |
| Dashboard course catalogue isolation | **Fail (live API)** | For that same student, `GET /v1/data/projects` returned 74 projects while the learning summary reported 82 enrolled courses. This route is not a suitable student-enrollment source. The dashboard bundle uses the learning summary, but the catalogue route remains unscoped for student requests. |
| AI quiz answer confidentiality | **Fail (handler inspection)** | The AI quiz handler includes `correct_answer` (the correct option index) and the explanation in `publicQuestions`, then returns those questions to the student. A server-side grading store exists, but the response still exposes the answer key. |
| Role controls | **Fail (bundle inspection)** | `AdminStudentProfile-C8avtq8J.js` still contains the hardcoded `goharhany@gmail.com` check. This can hide role controls from other admins. |
| Admin/student assessment average agreement | **Fail (live API)** | `/v1/analytics/kpis` returned `assessmentAvg: 53`; the student learning summary returned `assessmentAverage: 1000`. These metrics do not agree and the student-side value is outside the 0–100 range. |
| Calendar, meetings, profile edits, uploads/RAG, chat, settings, grading workflow, and remaining interactive cases | **Not revalidated in browser** | These require browser interaction and/or writes to platform data. Source/API evidence from the earlier report was not reused as if it were a fresh UI run. |

## Data quality and test-fixture caveats

- The database already contains prior QA activity. The default student account has 82 enrollments, 25 submissions, and 41 visible assessments; it cannot reproduce the original “fresh student with one course” scenario.
- The prior `qa-results-2026-09-29.json` in the workspace predates this run and includes inconsistent values (including a non-boolean scenario result), so it was not treated as current evidence.
- No destructive actions or new QA records were created in this pass. Login requests refreshed `lastLoginAt` for the two existing local QA accounts.

## Conclusion

This is **not a completed 49-scenario rerun**. Current evidence confirms the empty-submit and mandatory-file protections, and confirms assessment typing plus the new student learning-summary data source. It also finds remaining answer-key exposure, a hardcoded admin-email gate, inconsistent student/admin averages, and an unscoped projects endpoint. A browser-enabled pass is still needed to validate the 49 UI scenarios, especially the grading page’s attachment preview and the requested dashboard experience.
