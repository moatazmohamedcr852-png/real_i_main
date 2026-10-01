import { r as interop } from "./rolldown-runtime-QTnfLwEv.js";
import { an as getJsxRuntime, cn as getReact } from "./vendor-react-CeZ512P1.js";
import { getSubmissionReview, gradeSubmission, loadSubmissionFile, openSubmissionFile } from "./api-DvVeKkjb.js";

const React = interop(getReact(), 1);
const { jsx, jsxs } = getJsxRuntime();
const h = (type, props, ...children) => { const child = children.length ? (children.length === 1 ? children[0] : children) : props?.children; const factory = Array.isArray(child) ? jsxs : jsx; return factory(type, { ...props, children: child }); };
const formatBytes = (size) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;

export default function AdminGradingPage() {
  const submissionId = window.location.pathname.split("/").filter(Boolean).at(-1);
  const [review, setReview] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [comments, setComments] = React.useState("");
  const [suggestions, setSuggestions] = React.useState("");
  const [score, setScore] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    getSubmissionReview(submissionId).then((data) => {
      if (!active) return;
      setReview(data);
      setComments(data.comments || "");
      setSuggestions(data.suggestions || "");
      setScore(data.score == null ? "" : String(data.score));
    }).catch((err) => active && setError(err.message || "Could not load this submission."));
    return () => { active = false; };
  }, [submissionId]);

  React.useEffect(() => {
    if (!review?.files?.length) return;
    const first = review.files[0];
    const extension = first.originalName.split(".").pop()?.toLowerCase();
    const previewable = ["pdf", "png", "jpg", "jpeg", "gif", "txt", "py", "js", "ts", "java", "c", "cpp", "ipynb"].includes(extension);
    if (!previewable) return;
    let active = true;
    loadSubmissionFile(review.id, first.id).then((file) => {
      if (active) setPreview({ ...file, name: first.originalName });
      else URL.revokeObjectURL(file.url);
    }).catch((err) => active && setError(err.message || "Could not load the file preview."));
    return () => { active = false; };
  }, [review]);

  const questions = review?.questionSnapshot?.length ? review.questionSnapshot : (review?.assessmentQuestions || []);
  const maxGrade = questions.reduce((total, question) => total + Number(question.points || question.marks || 1), 0) || 100;
  const answers = Array.isArray(review?.responses) ? review.responses : [];
  const submitGrade = async (event) => {
    event.preventDefault();
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0 || value > maxGrade) {
      setError(`Enter a grade from 0 to ${maxGrade}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await gradeSubmission(review.id, value, "", comments, suggestions);
      setReview((current) => ({ ...current, score: value, gradingStatus: "graded", comments, suggestions }));
      setSaved(true);
    } catch (err) {
      setError(err.message || "Could not save the grade.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !review) return jsxs("main", { className: "max-w-4xl mx-auto p-8 text-surface-100", children: [
    h("a", { href: "/admin/assessments", className: "text-primary-400 font-bold" }, "← Back to Assessments"),
    h("p", { className: "mt-8 text-rose-400" }, error)
  ] });
  if (!review) return h("main", { className: "max-w-4xl mx-auto p-8 text-surface-400" }, "Loading submission…");

  const lateLabel = review.late ? "Late" : "On time";
  return jsxs("main", { className: "max-w-7xl mx-auto space-y-6 animate-fade-in-up pb-12", children: [
    h("a", { href: `/admin/assessments/${review.assessmentId}`, className: "inline-flex items-center gap-2 text-sm font-bold text-primary-400 hover:text-primary-300" }, "← Back to assessment"),
    jsxs("header", { className: "glass-card rounded-3xl border border-surface-700/50 bg-surface-900/70 p-6 sm:p-8", children: [
      h("p", { className: "text-xs font-bold uppercase tracking-widest text-primary-400 mb-2" }, "Grading Page"),
      h("h1", { className: "text-2xl sm:text-3xl font-extrabold text-surface-50" }, review.assessmentTitle),
      jsxs("div", { className: "flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-surface-300", children: [
        jsxs("span", { children: ["Student: ", h("strong", { className: "text-surface-50" }, review.studentName)] }),
        jsxs("span", { children: ["Email: ", h("strong", { className: "text-surface-50" }, review.studentEmail)] }),
        jsxs("span", { children: ["Status: ", h("strong", { className: review.late ? "text-amber-400" : "text-emerald-400" }, lateLabel)] }),
        review.submittedAt && jsxs("span", { children: ["Submitted: ", h("strong", { className: "text-surface-50" }, new Date(review.submittedAt).toLocaleString())] })
      ] })
    ] }),
    jsxs("div", { className: "grid xl:grid-cols-[1.4fr_0.9fr] gap-6 items-start", children: [
      jsxs("section", { className: "glass-card rounded-3xl border border-surface-700/50 bg-surface-900/60 overflow-hidden", children: [
        jsxs("div", { className: "p-5 border-b border-surface-700/60 flex items-center justify-between", children: [
          jsxs("div", { children: [h("h2", { className: "text-lg font-bold text-surface-50" }, "Student’s submitted work"), h("p", { className: "text-xs text-surface-400 mt-1" }, `${review.files.length} uploaded file${review.files.length === 1 ? "" : "s"}`)] }),
          review.files.length > 0 && h("button", { type: "button", onClick: () => Promise.all(review.files.map((file) => openSubmissionFile(review.id, file.id))), className: "px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-xs font-bold text-primary-300" }, "Open all files")
        ] }),
        review.files.length === 0 ? h("div", { className: "p-8 text-sm text-surface-400" }, "No uploaded files are attached to this submission.") : jsxs("div", { className: "p-5 space-y-4", children: [
          h("div", { className: "flex flex-wrap gap-2", children: review.files.map((file) => h("button", { key: file.id, type: "button", onClick: () => openSubmissionFile(review.id, file.id), className: "px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-left hover:border-primary-500/50", children: jsxs("span", { className: "text-xs text-surface-200", children: [file.originalName, h("span", { className: "ml-2 text-surface-500" }, formatBytes(Number(file.fileSize || 0)))] }) })) }),
          preview ? h("iframe", { title: preview.name, src: preview.url, className: "w-full h-[65vh] rounded-2xl border border-surface-700 bg-white" }) : h("div", { className: "rounded-2xl border border-dashed border-surface-700 p-8 text-sm text-surface-400" }, "This archive or document format cannot be previewed in the browser. Open the file above to inspect it, then return here to grade it.")
        ] })
      ] }),
      jsxs("div", { className: "space-y-6", children: [
        answers.length > 0 && jsxs("section", { className: "glass-card rounded-3xl border border-surface-700/50 bg-surface-900/60 p-5", children: [
          h("h2", { className: "text-lg font-bold text-surface-50 mb-4" }, "Submitted answers"),
          h("div", { className: "space-y-3", children: answers.map((answer, index) => {
            const question = questions.find((item) => item.id === (answer.questionId || answer.id)) || questions[index];
            return jsxs("div", { className: "rounded-xl bg-surface-800/70 p-4", children: [
              h("p", { className: "text-xs font-bold text-surface-400 mb-2" }, question?.prompt || question?.text || `Question ${index + 1}`),
              h("p", { className: "text-sm text-surface-100 whitespace-pre-wrap" }, String(answer.value ?? answer.answer ?? "—"))
            ] }, index);
          }) })
        ] }),
        h("form", { onSubmit: submitGrade, className: "glass-card rounded-3xl border border-surface-700/50 bg-surface-900/60 p-5 sm:p-6 space-y-5", children: [
          jsxs("div", { children: [h("h2", { className: "text-lg font-bold text-surface-50" }, "Feedback and grade"), h("p", { className: "text-xs text-surface-400 mt-1" }, `Maximum grade: ${maxGrade}`)] }),
          jsxs("label", { className: "block space-y-2", children: [h("span", { className: "text-xs font-bold uppercase tracking-wider text-surface-300" }, "Comments on the student’s solution"), h("textarea", { value: comments, onChange: (event) => setComments(event.target.value), rows: 4, placeholder: "What did the student do well? What needs work?", className: "w-full rounded-xl border border-surface-700 bg-surface-950 p-3 text-sm text-surface-100 outline-none focus:border-primary-500" })] }),
          jsxs("label", { className: "block space-y-2", children: [h("span", { className: "text-xs font-bold uppercase tracking-wider text-surface-300" }, "Suggestions for improvement"), h("textarea", { value: suggestions, onChange: (event) => setSuggestions(event.target.value), rows: 4, placeholder: "Give the student clear next steps and suggestions.", className: "w-full rounded-xl border border-surface-700 bg-surface-950 p-3 text-sm text-surface-100 outline-none focus:border-primary-500" })] }),
          jsxs("label", { className: "block space-y-2", children: [h("span", { className: "text-xs font-bold uppercase tracking-wider text-surface-300" }, "Admin grade"), jsxs("span", { className: "flex items-center gap-3", children: [h("input", { type: "number", min: 0, max: maxGrade, step: "0.01", required: true, value: score, onChange: (event) => setScore(event.target.value), className: "w-36 rounded-xl border border-surface-700 bg-surface-950 p-3 text-lg font-bold text-surface-100 outline-none focus:border-primary-500" }), h("span", { className: "text-sm text-surface-400" }, `/ ${maxGrade}`)] })] }),
          error && h("p", { className: "text-sm text-rose-400", role: "alert" }, error),
          saved && h("p", { className: "text-sm text-emerald-400", role: "status" }, "Grade and feedback saved."),
          h("button", { type: "submit", disabled: busy, className: "w-full py-3 rounded-xl gradient-primary text-surface-950 font-extrabold disabled:opacity-50", children: busy ? "Saving…" : "Save grade and feedback" })
        ] })
      ] })
    ] })
  ] });
}
