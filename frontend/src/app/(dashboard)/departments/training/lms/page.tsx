"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  ClipboardList,
  Clock,
  FileText,
  Loader2,
  Plus,
  Target,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import {
  DepartmentToolShell,
  EmptyState,
  ErrorNote,
  LoadingRow,
  Panel,
  StatCard,
  StatusBadge,
  formatDate,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/department-tools";

type ContentSection = { title: string; body: string };

type QuizQuestion = {
  prompt: string;
  options: string[];
  correct_index: number;
  explanation?: string | null;
};

type Course = {
  id: number;
  key: string;
  title: string;
  description?: string | null;
  level: string;
  duration_minutes: number;
  pass_score: number;
  quiz_count: number;
  content_count: number;
  active: boolean;
  quiz?: QuizQuestion[];
  content?: ContentSection[];
};

type TrainingRecord = {
  id: number;
  course_id: number;
  course_title: string;
  employee_id?: number | null;
  staff_name: string;
  status: string;
  score: number | null;
  passed: boolean;
  due_on: string | null;
  overdue: boolean;
  assigned_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
};

type TrainingSummary = {
  courses: number;
  active_records: number;
  completed_records: number;
  overdue_records: number;
  average_score: number | null;
};

type TrainingResponse = {
  courses?: Course[];
  records?: TrainingRecord[];
  summary?: TrainingSummary;
  detail?: string;
};

type CompleteResponse = {
  detail?: string;
  score?: number | null;
  passed?: boolean | null;
  record?: { score?: number | null; passed?: boolean | null };
};

type ContentDraft = { title: string; body: string };
type QuizDraft = { prompt: string; options: string; correctIndex: string };

type CourseDraft = {
  title: string;
  description: string;
  level: string;
  duration_minutes: string;
  pass_score: string;
  content: ContentDraft[];
  quiz: QuizDraft[];
};

type QuizResult = {
  staffName: string;
  courseTitle: string;
  score: number;
  passed: boolean;
};

const LEVEL_OPTIONS = ["core", "compliance", "leadership"];

const LEVEL_STYLES: Record<string, string> = {
  core: "border-blue-100 bg-blue-50 text-blue-700",
  compliance: "border-amber-100 bg-amber-50 text-amber-700",
  leadership: "border-purple-100 bg-purple-50 text-purple-700",
};

function emptyContentDraft(): ContentDraft {
  return { title: "", body: "" };
}

function emptyQuizDraft(): QuizDraft {
  return { prompt: "", options: "", correctIndex: "0" };
}

function createCourseDraft(): CourseDraft {
  return {
    title: "",
    description: "",
    level: "core",
    duration_minutes: "30",
    pass_score: "80",
    content: [emptyContentDraft()],
    quiz: [emptyQuizDraft()],
  };
}

function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return `${Math.round(score * 10) / 10}%`;
}

export default function TrainingLmsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [activeTab, setActiveTab] = useState<"courses" | "records">("courses");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewId, setPreviewId] = useState<number | null>(null);

  const [assignFor, setAssignFor] = useState<number | null>(null);
  const [assignName, setAssignName] = useState("");
  const [assignDue, setAssignDue] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);

  const [showNewCourse, setShowNewCourse] = useState(false);
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(createCourseDraft);
  const [courseBusy, setCourseBusy] = useState(false);

  const [quiz, setQuiz] = useState<{ record: TrainingRecord; course: Course } | null>(
    null
  );
  const [answers, setAnswers] = useState<number[]>([]);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/programs/training"),
        { credentials: "include", cache: "no-store" }
      );
      const data = (await response.json()) as TrainingResponse;
      if (!response.ok) {
        throw new Error(data.detail || "Training program failed to load.");
      }
      setCourses(data.courses ?? []);
      setRecords(data.records ?? []);
      setSummary(data.summary ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Training program failed to load."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAssign = (courseId: number) => {
    setAssignFor(courseId);
    setAssignName("");
    setAssignDue("");
    setError("");
  };

  const assignCourse = async (course: Course) => {
    const staffName = assignName.trim();
    if (!staffName) {
      setError("Staff name is required to assign a course.");
      return;
    }
    setAssignBusy(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/programs/training/records"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course_id: course.id,
            staff_name: staffName,
            due_on: assignDue || null,
          }),
        }
      );
      const data = (await response.json()) as {
        detail?: string;
        staff_name?: string;
      };
      if (!response.ok) {
        throw new Error(data.detail || "Could not assign this course.");
      }
      setAssignFor(null);
      setNotice(`Assigned "${course.title}" to ${data.staff_name || staffName}.`);
      await load();
    } catch (assignError) {
      setError(
        assignError instanceof Error
          ? assignError.message
          : "Could not assign this course."
      );
    } finally {
      setAssignBusy(false);
    }
  };

  const updateContent = (index: number, patch: Partial<ContentDraft>) => {
    setCourseDraft((previous) => ({
      ...previous,
      content: previous.content.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    }));
  };

  const updateQuizDraft = (index: number, patch: Partial<QuizDraft>) => {
    setCourseDraft((previous) => ({
      ...previous,
      quiz: previous.quiz.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      ),
    }));
  };

  const saveCourse = async () => {
    const title = courseDraft.title.trim();
    if (!title) {
      setError("Course title is required.");
      return;
    }
    const duration = Number(courseDraft.duration_minutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      setError("Duration must be a positive number of minutes.");
      return;
    }
    const passScore = Number(courseDraft.pass_score);
    if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100) {
      setError("Pass score must be between 0 and 100.");
      return;
    }

    const content: ContentSection[] = [];
    for (const section of courseDraft.content) {
      const sectionTitle = section.title.trim();
      const body = section.body.trim();
      if (!sectionTitle && !body) continue;
      if (!sectionTitle || !body) {
        setError("Each content section needs both a title and a body.");
        return;
      }
      content.push({ title: sectionTitle, body });
    }

    const quizPayload: QuizQuestion[] = [];
    for (const row of courseDraft.quiz) {
      const prompt = row.prompt.trim();
      const options = row.options
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean);
      if (!prompt && options.length === 0) continue;
      if (!prompt) {
        setError("Each quiz question needs a prompt.");
        return;
      }
      if (options.length < 3 || options.length > 5) {
        setError("Each quiz question needs between 3 and 5 comma-separated options.");
        return;
      }
      const correctIndex = Number(row.correctIndex);
      if (
        !Number.isInteger(correctIndex) ||
        correctIndex < 0 ||
        correctIndex >= options.length
      ) {
        setError("Choose a valid correct option for every quiz question.");
        return;
      }
      quizPayload.push({ prompt, options, correct_index: correctIndex });
    }

    setCourseBusy(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/programs/training/courses"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description: courseDraft.description.trim(),
            level: courseDraft.level,
            duration_minutes: duration,
            pass_score: passScore,
            content,
            quiz: quizPayload,
          }),
        }
      );
      const data = (await response.json()) as { detail?: string; title?: string };
      if (!response.ok) {
        throw new Error(data.detail || "Course could not be created.");
      }
      setShowNewCourse(false);
      setCourseDraft(createCourseDraft());
      setNotice(`"${data.title || title}" added to the course library.`);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Course could not be created."
      );
    } finally {
      setCourseBusy(false);
    }
  };

  const startQuiz = (record: TrainingRecord) => {
    const course = courses.find((item) => item.id === record.course_id);
    if (!course || course.quiz_count <= 0) return;
    const questions = course.quiz ?? [];
    setQuiz({ record, course });
    setAnswers(questions.map(() => -1));
    setQuizResult(null);
    setError("");
  };

  const submitQuiz = async () => {
    if (!quiz) return;
    if (answers.some((answer) => answer < 0)) {
      setError("Answer every question before submitting the quiz.");
      return;
    }
    const activeQuiz = quiz;
    setQuizBusy(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/company/programs/training/records/${activeQuiz.record.id}/complete`
        ),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        }
      );
      const data = (await response.json()) as CompleteResponse;
      if (!response.ok) {
        throw new Error(data.detail || "Quiz could not be submitted.");
      }
      const questions = activeQuiz.course.quiz ?? [];
      const correctCount = questions.reduce(
        (total, question, index) =>
          total + (answers[index] === question.correct_index ? 1 : 0),
        0
      );
      const calculatedScore =
        questions.length > 0
          ? Math.round((correctCount / questions.length) * 1000) / 10
          : 0;
      const finalScore = data.record?.score ?? data.score ?? calculatedScore;
      const finalPassed =
        data.record?.passed ??
        data.passed ??
        finalScore >= activeQuiz.course.pass_score;
      setQuizResult({
        staffName: activeQuiz.record.staff_name,
        courseTitle: activeQuiz.course.title,
        score: finalScore,
        passed: finalPassed,
      });
      setQuiz(null);
      setAnswers([]);
      setNotice(`Quiz submitted for ${activeQuiz.record.staff_name}.`);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Quiz could not be submitted."
      );
    } finally {
      setQuizBusy(false);
    }
  };

  const averageScore = summary?.average_score ?? null;
  const activeCourses = courses.filter((course) => course.active).length;
  const answeredCount = answers.filter((answer) => answer >= 0).length;

  return (
    <DepartmentToolShell
      departmentKey="training"
      departmentLabel="Training"
      title="Training & certification"
      subtitle="Assign department courses, track due dates and certify teams with short quizzes."
    >
      <div className="space-y-4">
        <ErrorNote message={error} />
        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            {notice}
          </div>
        ) : null}
        {quizResult ? (
          <div
            className={`flex items-start gap-2 rounded-xl border px-3 py-3 text-xs font-semibold ${
              quizResult.passed
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-red-100 bg-red-50 text-red-700"
            }`}
          >
            {quizResult.passed ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="flex-1">
              <p className="font-black">
                {quizResult.passed ? "Passed" : "Not passed"} ·{" "}
                {formatScore(quizResult.score)}
              </p>
              <p className="mt-0.5">
                {quizResult.staffName} · {quizResult.courseTitle}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss quiz result"
              onClick={() => setQuizResult(null)}
              className="rounded-lg p-1 hover:bg-white/60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Courses"
          value={summary?.courses ?? 0}
          hint={`${activeCourses} active in the library`}
        />
        <StatCard
          label="Active assignments"
          value={summary?.active_records ?? 0}
          hint="Awaiting completion"
        />
        <StatCard
          label="Completed"
          value={summary?.completed_records ?? 0}
          tone="good"
          hint="Recorded certifications"
        />
        <StatCard
          label="Overdue"
          value={summary?.overdue_records ?? 0}
          tone={(summary?.overdue_records ?? 0) > 0 ? "bad" : "neutral"}
          hint="Past the due date"
        />
        <StatCard
          label="Average score"
          value={averageScore === null ? "—" : formatScore(averageScore)}
          tone="info"
          hint="Across completed quizzes"
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={activeTab === "courses"}
          onClick={() => setActiveTab("courses")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-widest ${
            activeTab === "courses"
              ? "bg-gray-950 text-white"
              : "border border-gray-200 bg-white text-gray-500"
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" /> Courses
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "records"}
          onClick={() => setActiveTab("records")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-widest ${
            activeTab === "records"
              ? "bg-gray-950 text-white"
              : "border border-gray-200 bg-white text-gray-500"
          }`}
        >
          <Users className="h-3.5 w-3.5" /> Records
        </button>
      </div>

      {activeTab === "courses" ? (
        <Panel
          title="Course library"
          description="Short internal courses with reading content and quiz certification."
          actions={
            <button
              type="button"
              onClick={() => setShowNewCourse((previous) => !previous)}
              className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}
            >
              {showNewCourse ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {showNewCourse ? "Close form" : "New course"}
            </button>
          }
        >
          {showNewCourse ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveCourse();
              }}
              className="mb-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={`${labelClass} sm:col-span-2`}>
                  Course title
                  <input
                    data-testid="training-course-title"
                    value={courseDraft.title}
                    onChange={(event) =>
                      setCourseDraft((previous) => ({
                        ...previous,
                        title: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                    placeholder="Food safety essentials"
                  />
                </label>
                <label className={`${labelClass} sm:col-span-2`}>
                  Description
                  <textarea
                    rows={2}
                    value={courseDraft.description}
                    onChange={(event) =>
                      setCourseDraft((previous) => ({
                        ...previous,
                        description: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                    placeholder="What this course covers and who should take it."
                  />
                </label>
                <label className={labelClass}>
                  Level
                  <select
                    value={courseDraft.level}
                    onChange={(event) =>
                      setCourseDraft((previous) => ({
                        ...previous,
                        level: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                  >
                    {LEVEL_OPTIONS.map((level) => (
                      <option key={level} value={level}>
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Duration (minutes)
                  <input
                    type="number"
                    min={1}
                    value={courseDraft.duration_minutes}
                    onChange={(event) =>
                      setCourseDraft((previous) => ({
                        ...previous,
                        duration_minutes: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className={labelClass}>
                  Pass score (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={courseDraft.pass_score}
                    onChange={(event) =>
                      setCourseDraft((previous) => ({
                        ...previous,
                        pass_score: event.target.value,
                      }))
                    }
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className={labelClass}>Content sections</p>
                  <button
                    type="button"
                    onClick={() =>
                      setCourseDraft((previous) => ({
                        ...previous,
                        content: [...previous.content, emptyContentDraft()],
                      }))
                    }
                    className={`${secondaryButtonClass} inline-flex items-center gap-1`}
                  >
                    <Plus className="h-3 w-3" /> Add section
                  </button>
                </div>
                {courseDraft.content.map((section, index) => (
                  <div
                    key={`content-${index}`}
                    className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-[1fr_1.5fr_auto]"
                  >
                    <label className={labelClass}>
                      Section title
                      <input
                        value={section.title}
                        onChange={(event) =>
                          updateContent(index, { title: event.target.value })
                        }
                        className={`${inputClass} mt-1`}
                      />
                    </label>
                    <label className={labelClass}>
                      Body
                      <textarea
                        rows={1}
                        value={section.body}
                        onChange={(event) =>
                          updateContent(index, { body: event.target.value })
                        }
                        className={`${inputClass} mt-1`}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label={`Remove content section ${index + 1}`}
                      onClick={() =>
                        setCourseDraft((previous) => ({
                          ...previous,
                          content: previous.content.filter(
                            (_, rowIndex) => rowIndex !== index
                          ),
                        }))
                      }
                      className="self-end rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className={labelClass}>Quiz questions</p>
                  <button
                    type="button"
                    onClick={() =>
                      setCourseDraft((previous) => ({
                        ...previous,
                        quiz: [...previous.quiz, emptyQuizDraft()],
                      }))
                    }
                    className={`${secondaryButtonClass} inline-flex items-center gap-1`}
                  >
                    <Plus className="h-3 w-3" /> Add question
                  </button>
                </div>
                {courseDraft.quiz.map((question, index) => (
                  <div
                    key={`quiz-${index}`}
                    className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-2"
                  >
                    <label className={`${labelClass} sm:col-span-2`}>
                      Question {index + 1}
                      <input
                        value={question.prompt}
                        onChange={(event) =>
                          updateQuizDraft(index, { prompt: event.target.value })
                        }
                        className={`${inputClass} mt-1`}
                        placeholder="What temperature should chicken be cooked to?"
                      />
                    </label>
                    <label className={labelClass}>
                      Options (comma separated)
                      <input
                        value={question.options}
                        onChange={(event) =>
                          updateQuizDraft(index, { options: event.target.value })
                        }
                        className={`${inputClass} mt-1`}
                        placeholder="60°C, 65°C, 75°C"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className={`${labelClass} flex-1`}>
                        Correct index
                        <select
                          value={question.correctIndex}
                          onChange={(event) =>
                            updateQuizDraft(index, {
                              correctIndex: event.target.value,
                            })
                          }
                          className={`${inputClass} mt-1`}
                        >
                          {[0, 1, 2, 3, 4].map((optionIndex) => (
                            <option key={optionIndex} value={optionIndex}>
                              Option {optionIndex + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove quiz question ${index + 1}`}
                        onClick={() =>
                          setCourseDraft((previous) => ({
                            ...previous,
                            quiz: previous.quiz.filter(
                              (_, rowIndex) => rowIndex !== index
                            ),
                          }))
                        }
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewCourse(false);
                    setCourseDraft(createCourseDraft());
                  }}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={courseBusy}
                  className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                >
                  {courseBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Create course
                </button>
              </div>
            </form>
          ) : null}

          {isLoading ? (
            <LoadingRow label="Loading courses..." />
          ) : courses.length === 0 ? (
            <EmptyState
              title="No courses yet"
              body="Create the first training course for the department."
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {courses.map((course) => {
                const isPreviewing = previewId === course.id;
                const questions = course.quiz ?? [];
                const sections = course.content ?? [];
                return (
                  <article
                    key={course.id}
                    data-testid={`training-course-${course.key}`}
                    className="rounded-xl border border-gray-100 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                              LEVEL_STYLES[course.level] ||
                              "border-gray-200 bg-gray-50 text-gray-600"
                            }`}
                          >
                            {course.level}
                          </span>
                          {!course.active ? (
                            <StatusBadge label="inactive" />
                          ) : null}
                        </div>
                        <h3 className="mt-2 text-sm font-black text-gray-950">
                          {course.title}
                        </h3>
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                          {course.description || "No description provided."}
                        </p>
                      </div>
                      <BookOpen className="h-5 w-5 shrink-0 text-gray-300" />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-bold text-gray-500 sm:grid-cols-4">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-gray-400" />
                        {course.duration_minutes} min
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Target className="h-3.5 w-3.5 text-gray-400" />
                        Pass {course.pass_score}%
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5 text-gray-400" />
                        {course.content_count} sections
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CircleHelp className="h-3.5 w-3.5 text-gray-400" />
                        {course.quiz_count} questions
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          assignFor === course.id
                            ? setAssignFor(null)
                            : openAssign(course.id)
                        }
                        className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                      >
                        <Users className="h-3.5 w-3.5" /> Assign
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewId(isPreviewing ? null : course.id)
                        }
                        className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}
                      >
                        {isPreviewing ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {isPreviewing ? "Hide preview" : "Preview"}
                      </button>
                    </div>

                    {assignFor === course.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void assignCourse(course);
                        }}
                        className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className={labelClass}>
                            Staff name
                            <input
                              data-testid={`training-assign-name-${course.key}`}
                              value={assignName}
                              onChange={(event) => setAssignName(event.target.value)}
                              placeholder="Who should take this?"
                              className={`${inputClass} mt-1`}
                            />
                          </label>
                          <label className={labelClass}>
                            Due date
                            <input
                              type="date"
                              value={assignDue}
                              onChange={(event) => setAssignDue(event.target.value)}
                              className={`${inputClass} mt-1`}
                            />
                          </label>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setAssignFor(null)}
                            className={secondaryButtonClass}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={assignBusy}
                            className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                          >
                            {assignBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Assign course
                          </button>
                        </div>
                      </form>
                    ) : null}

                    {isPreviewing ? (
                      <div className="mt-3 space-y-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                        <div>
                          <p className={labelClass}>Course content</p>
                          {sections.length === 0 ? (
                            <p className="mt-1 text-xs font-semibold text-gray-400">
                              No content sections yet.
                            </p>
                          ) : (
                            <div className="mt-1.5 space-y-2">
                              {sections.map((section, index) => (
                                <div
                                  key={`${course.id}-section-${index}`}
                                  className="rounded-lg bg-white p-2.5"
                                >
                                  <p className="text-xs font-black text-gray-800">
                                    {section.title}
                                  </p>
                                  <p className="mt-0.5 whitespace-pre-line text-xs font-semibold text-gray-500">
                                    {section.body}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className={labelClass}>Quiz preview</p>
                          {questions.length === 0 ? (
                            <p className="mt-1 text-xs font-semibold text-gray-400">
                              No quiz questions attached to this course.
                            </p>
                          ) : (
                            <div className="mt-1.5 space-y-2">
                              {questions.map((question, questionIndex) => (
                                <div
                                  key={`${course.id}-question-${questionIndex}`}
                                  className="rounded-lg bg-white p-2.5"
                                >
                                  <p className="text-xs font-black text-gray-800">
                                    {questionIndex + 1}. {question.prompt}
                                  </p>
                                  <ul className="mt-1 space-y-1">
                                    {question.options.map((option, optionIndex) => {
                                      const isCorrect =
                                        optionIndex === question.correct_index;
                                      return (
                                        <li
                                          key={`${course.id}-${questionIndex}-option-${optionIndex}`}
                                          className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[11px] font-semibold ${
                                            isCorrect
                                              ? "bg-emerald-50 text-emerald-700"
                                              : "text-gray-500"
                                          }`}
                                        >
                                          <span>
                                            {String.fromCharCode(65 + optionIndex)}.{" "}
                                            {option}
                                          </span>
                                          {isCorrect ? (
                                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest">
                                              <CheckCircle2 className="h-3 w-3" />
                                              Correct
                                            </span>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  {question.explanation ? (
                                    <p className="mt-1 text-[10px] font-semibold text-gray-400">
                                      {question.explanation}
                                    </p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </Panel>
      ) : (
        <Panel
          title="Assignments & results"
          description="Assigned courses, due dates and completed quiz scores."
        >
          {quiz ? (
            <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={labelClass}>Quiz in progress</p>
                  <h3 className="mt-1 text-sm font-black text-gray-950">
                    {quiz.course.title}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold text-gray-500">
                    {quiz.record.staff_name} · Pass mark {quiz.course.pass_score}%
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close quiz"
                  onClick={() => setQuiz(null)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-gray-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 space-y-3">
                {(quiz.course.quiz ?? []).map((question, questionIndex) => (
                  <fieldset
                    key={`${quiz.record.id}-q-${questionIndex}`}
                    className="rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <legend className="px-1 text-xs font-black text-gray-800">
                      {questionIndex + 1}. {question.prompt}
                    </legend>
                    <div className="mt-2 grid gap-1.5">
                      {question.options.map((option, optionIndex) => (
                        <label
                          key={`${quiz.record.id}-q-${questionIndex}-o-${optionIndex}`}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold ${
                            answers[questionIndex] === optionIndex
                              ? "border-gray-900 bg-gray-50 text-gray-900"
                              : "border-gray-100 text-gray-600"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`quiz-${quiz.record.id}-${questionIndex}`}
                            checked={answers[questionIndex] === optionIndex}
                            onChange={() =>
                              setAnswers((previous) =>
                                previous.map((answer, index) =>
                                  index === questionIndex
                                    ? optionIndex
                                    : answer
                                )
                              )
                            }
                            className="h-3.5 w-3.5"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {answeredCount} of {answers.length} answered
                </p>
                <button
                  type="button"
                  onClick={() => void submitQuiz()}
                  disabled={
                    quizBusy ||
                    answers.length === 0 ||
                    answers.some((answer) => answer < 0)
                  }
                  className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                >
                  {quizBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Submit answers
                </button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <LoadingRow label="Loading assignments..." />
          ) : records.length === 0 ? (
            <EmptyState
              title="No assignments yet"
              body="Assign a course from the Courses tab to start certification."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                    <th className="px-2 py-2">Course</th>
                    <th className="px-2 py-2">Staff</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Due</th>
                    <th className="px-2 py-2">Score</th>
                    <th className="px-2 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => {
                    const course = courses.find(
                      (item) => item.id === record.course_id
                    );
                    const canQuiz =
                      (record.status === "assigned" ||
                        record.status === "in_progress") &&
                      Boolean(course && course.quiz_count > 0);
                    return (
                      <tr
                        key={record.id}
                        data-testid={`training-record-${record.id}`}
                        className="border-b border-gray-50 align-top text-sm"
                      >
                        <td className="px-2 py-3">
                          <p className="font-black text-gray-900">
                            {record.course_title}
                          </p>
                          {record.notes ? (
                            <p className="mt-0.5 text-[10px] font-semibold text-gray-400">
                              {record.notes}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-2 py-3 font-semibold text-gray-600">
                          {record.staff_name}
                        </td>
                        <td className="px-2 py-3">
                          <StatusBadge label={record.status} />
                        </td>
                        <td className="px-2 py-3">
                          <p
                            className={`text-xs font-bold ${
                              record.overdue ? "text-red-600" : "text-gray-600"
                            }`}
                          >
                            {formatDate(record.due_on)}
                          </p>
                          {record.overdue ? (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-600">
                              <AlertTriangle className="h-3 w-3" /> Overdue
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-3">
                          <p className="text-xs font-black text-gray-800">
                            {formatScore(record.score)}
                          </p>
                          {record.score !== null ? (
                            <p
                              className={`text-[9px] font-black uppercase tracking-widest ${
                                record.passed
                                  ? "text-emerald-600"
                                  : "text-red-500"
                              }`}
                            >
                              {record.passed ? "Passed" : "Not passed"}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-2 py-3 text-right">
                          {canQuiz ? (
                            <button
                              type="button"
                              onClick={() => startQuiz(record)}
                              className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}
                            >
                              <ClipboardList className="h-3.5 w-3.5" /> Take quiz
                            </button>
                          ) : (
                            <span className="text-xs font-semibold text-gray-300">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </DepartmentToolShell>
  );
}
