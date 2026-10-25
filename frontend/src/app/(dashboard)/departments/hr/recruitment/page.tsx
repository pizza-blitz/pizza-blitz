"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API = getApiUrl("/api/v1/restaurant/hr/recruitment");

type Job = {
  id: number;
  title: string;
  department?: string | null;
  location?: string | null;
  employment_type: string;
  description?: string | null;
  openings: number;
  status: string;
  application_count: number;
  hired_count: number;
};
type Application = {
  id: number;
  job_id: number;
  job_title?: string | null;
  candidate_name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  stage: string;
  rating?: number | null;
  notes?: string | null;
  rejection_reason?: string | null;
  expected_salary?: number | null;
  offered_salary?: number | null;
  joining_date?: string | null;
  onboarding_candidate_id?: number | null;
  resume?: {
    file_name?: string | null;
    mime_type?: string | null;
    uploaded_at?: string | null;
    parsed?: {
      email?: string | null;
      phone?: string | null;
      name?: string | null;
      skills?: string[];
      character_count?: number;
    };
    text_excerpt?: string | null;
    download_url?: string | null;
  };
  interviews: {
    id: number;
    scheduled_at: string;
    mode: string;
    interviewer?: string | null;
    status: string;
    score?: number | null;
    recommendation?: string | null;
    scored_at?: string | null;
  }[];
  stage_history: {
    id: number;
    from_stage?: string | null;
    to_stage: string;
    actor?: string | null;
    note?: string | null;
    created_at?: string | null;
  }[];
};
type Summary = {
  open_jobs: number;
  draft_jobs: number;
  applications: number;
  active_applications: number;
  hires: number;
  offer_count: number;
  upcoming_interviews: number;
  stage_counts: Record<string, number>;
};

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"];
const NEXT: Record<string, string[]> = {
  applied: ["screening"],
  screening: ["interview"],
  interview: ["offer"],
  offer: ["hired"],
  hired: [],
  rejected: [],
  withdrawn: [],
};

const stageTone = (stage: string) => {
  if (stage === "hired") return "bg-emerald-100 text-emerald-800";
  if (stage === "rejected") return "bg-red-100 text-red-700";
  if (stage === "offer") return "bg-amber-100 text-amber-800";
  if (stage === "interview") return "bg-sky-100 text-sky-800";
  if (stage === "screening") return "bg-purple-100 text-purple-800";
  return "bg-gray-100 text-gray-600";
};

const money = (value?: number | null) =>
  value == null ? "" : `Rs ${Number(value).toLocaleString("en-IN")}`;

export default function HRRecruitmentPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [showJobForm, setShowJobForm] = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [interviewAt, setInterviewAt] = useState("");
  const [jobDraft, setJobDraft] = useState({
    title: "",
    department: "Kitchen",
    location: "",
    employment_type: "full_time",
    salary_min: "",
    salary_max: "",
    openings: 1,
    status: "open",
    description: "",
  });
  const [candidateDraft, setCandidateDraft] = useState({
    candidate_name: "",
    email: "",
    phone: "",
    source: "careers",
    expected_salary: "",
  });

  const loadAll = async (preferredJobId?: number | null) => {
    const [summaryRes, jobsRes] = await Promise.all([
      fetch(`${API}/summary`, { credentials: "include", cache: "no-store" }),
      fetch(`${API}/jobs`, { credentials: "include", cache: "no-store" }),
    ]);
    const summaryData = await summaryRes.json();
    const jobsData = await jobsRes.json();
    if (!jobsRes.ok) throw new Error(jobsData.detail || "Jobs failed to load.");
    setSummary(summaryData);
    setJobs(jobsData.jobs || []);
    const target =
      preferredJobId ??
      selectedJobId ??
      (jobsData.jobs || []).find((job: Job) => job.status === "open")?.id ??
      jobsData.jobs?.[0]?.id ??
      null;
    if (target) {
      setSelectedJobId(target);
      await loadJob(target);
    } else {
      setApplications([]);
    }
  };

  const loadJob = async (jobId: number) => {
    const response = await fetch(`${API}/jobs/${jobId}`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Pipeline failed to load.");
    setApplications(data.pipeline?.applications || []);
  };

  useEffect(() => {
    setHydrated(true);
    void loadAll().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Recruitment failed to load.")
    );
  }, []);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return applications;
    return applications.filter(
      (row) =>
        row.candidate_name.toLowerCase().includes(needle) ||
        (row.email || "").toLowerCase().includes(needle)
    );
  }, [applications, search]);

  const selectApplication = async (applicationId: number) => {
    try {
      const response = await fetch(`${API}/applications/${applicationId}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Candidate failed to load.");
      setSelected(data.application);
      setRejectReason("");
      setInterviewAt("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Candidate failed to load.");
    }
  };

  const moveStage = async (stage: string) => {
    if (!selected) return;
    setBusy(`stage-${stage}`);
    setMessage("");
    try {
      const response = await fetch(`${API}/applications/${selected.id}/stage`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          note: `Moved to ${stage} from the recruitment board.`,
          rejection_reason: stage === "rejected" ? rejectReason : "",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Stage move failed.");
      setSelected(data.application);
      if (selectedJobId) await loadJob(selectedJobId);
      await loadAll(selectedJobId);
      if (data.application.onboarding_candidate_id) {
        setMessage(
          `Candidate hired and handed off to onboarding candidate #${data.application.onboarding_candidate_id}.`
        );
      } else {
        setMessage(`Candidate moved to ${stage}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stage move failed.");
    } finally {
      setBusy("");
    }
  };

  const scoreInterview = async (
    interviewId: number,
    score: number | null,
    recommendation: string | null
  ) => {
    if (!selected) return;
    setBusy(`score-${interviewId}`);
    try {
      const response = await fetch(`${API}/interviews/${interviewId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          score,
          recommendation,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Scorecard failed.");
      }
      await selectApplication(selected.id);
      setMessage("Interview scorecard saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scorecard failed.");
    } finally {
      setBusy("");
    }
  };

  const scheduleInterview = async () => {
    if (!selected || !interviewAt) return;
    setBusy("interview");
    try {
      const response = await fetch(
        `${API}/applications/${selected.id}/interviews`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduled_at: new Date(interviewAt).toISOString(),
            mode: "in_person",
            interviewer: "HR",
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Interview failed.");
      setMessage("Interview scheduled.");
      setInterviewAt("");
      await selectApplication(selected.id);
      if (selectedJobId) await loadJob(selectedJobId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Interview failed.");
    } finally {
      setBusy("");
    }
  };

  const createJob = async () => {
    if (!jobDraft.title.trim()) return;
    setBusy("job");
    try {
      const response = await fetch(`${API}/jobs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...jobDraft,
          salary_min: jobDraft.salary_min ? Number(jobDraft.salary_min) : null,
          salary_max: jobDraft.salary_max ? Number(jobDraft.salary_max) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Job failed.");
      setShowJobForm(false);
      setJobDraft({ ...jobDraft, title: "", description: "" });
      await loadAll(data.job.id);
      setMessage(`Job ${data.job.title} created.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Job failed.");
    } finally {
      setBusy("");
    }
  };

  const addCandidate = async () => {
    if (!selectedJobId || !candidateDraft.candidate_name.trim()) return;
    setBusy("candidate");
    try {
      const response = await fetch(`${API}/applications`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: selectedJobId,
          ...candidateDraft,
          expected_salary: candidateDraft.expected_salary
            ? Number(candidateDraft.expected_salary)
            : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Candidate failed.");
      setShowCandidateForm(false);
      setCandidateDraft({ ...candidateDraft, candidate_name: "", email: "", phone: "" });
      await loadJob(selectedJobId);
      await loadAll(selectedJobId);
      await selectApplication(data.application.id);
      setMessage(`Candidate ${data.application.candidate_name} added.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Candidate failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div
      data-testid="hr-recruitment-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-5 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">
            HR department · hiring
          </p>
          <h1 className="text-3xl font-black text-gray-950">Recruitment</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Jobs, applicants, interviews and offers. Marking a candidate hired creates their
            HR onboarding record automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowJobForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            <Plus className="h-3.5 w-3.5" /> New job
          </button>
          <button
            type="button"
            data-testid="recruitment-add-candidate"
            onClick={() => setShowCandidateForm(true)}
            disabled={!selectedJobId}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-40"
          >
            <UserPlus className="h-4 w-4" /> Add candidate
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      {summary && (
        <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["Open jobs", summary.open_jobs],
            ["Applications", summary.applications],
            ["Active", summary.active_applications],
            ["Offers", summary.offer_count],
            ["Hires", summary.hires],
            ["Interviews", summary.upcoming_interviews],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-gray-100 bg-white p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                {label}
              </p>
              <p className="mt-1 text-2xl font-black text-gray-950">{value}</p>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-wrap gap-2">
        {jobs.length === 0 ? (
          <p className="text-sm font-semibold text-gray-400">No jobs yet.</p>
        ) : (
          jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              data-testid={`recruitment-job-${job.id}`}
              onClick={() => {
                setSelectedJobId(job.id);
                setSelected(null);
                void loadJob(job.id);
              }}
              className={`rounded-xl border px-4 py-3 text-left ${
                selectedJobId === job.id
                  ? "border-teal-600 bg-teal-50"
                  : "border-gray-100 bg-white hover:border-teal-200"
              }`}
            >
              <p className="text-sm font-black text-gray-900">{job.title}</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                {job.status} · {job.application_count} applicants · {job.openings} openings
              </p>
            </button>
          ))
        )}
      </section>

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <section className="overflow-x-auto rounded-2xl border border-gray-100 bg-white p-3">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search candidates"
              className="w-full border-0 bg-transparent text-sm font-semibold text-gray-700 outline-none"
            />
          </div>
          <div className="mt-3 grid min-w-[900px] grid-cols-6 gap-2">
            {STAGES.map((stage) => {
              const rows = visible.filter((row) => row.stage === stage);
              return (
                <div key={stage} className="rounded-xl bg-gray-50 p-2">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                      {stage}
                    </p>
                    <span className="text-[9px] font-black text-gray-400">{rows.length}</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {rows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        data-testid={`recruitment-candidate-${row.id}`}
                        onClick={() => void selectApplication(row.id)}
                        className="w-full rounded-lg border border-gray-100 bg-white p-2 text-left hover:border-teal-300"
                      >
                        <p className="text-xs font-black text-gray-900">{row.candidate_name}</p>
                        <p className="mt-0.5 truncate text-[9px] font-semibold text-gray-400">
                          {row.email || row.phone || "No contact"}
                        </p>
                        {row.expected_salary != null && (
                          <p className="mt-1 text-[9px] font-bold text-gray-500">
                            {money(row.expected_salary)}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside
          data-testid="recruitment-drawer"
          className="rounded-2xl border border-gray-100 bg-white p-5"
        >
          {!selected ? (
            <div className="grid h-full min-h-[300px] place-items-center text-center">
              <div>
                <Users className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-2 text-sm font-bold text-gray-500">Select a candidate.</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-black text-gray-950">{selected.candidate_name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {selected.job_title}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${stageTone(selected.stage)}`}>
                  {selected.stage}
                </span>
              </div>
              <div className="mt-3 space-y-1 text-xs font-semibold text-gray-500">
                <p>{selected.email || "No email"}</p>
                <p>{selected.phone || "No phone"}</p>
                <p>Source: {selected.source || "—"}</p>
                {selected.expected_salary != null && (
                  <p>Expected: {money(selected.expected_salary)}</p>
                )}
              </div>

              {selected.onboarding_candidate_id && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800">
                  Onboarding candidate #{selected.onboarding_candidate_id} created.
                </div>
              )}

              {selected.resume?.file_name && (
                <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[10px] font-black uppercase tracking-widest text-gray-500">
                      Resume · {selected.resume.file_name}
                    </p>
                    {selected.resume.download_url && (
                      <a
                        href={getApiUrl(selected.resume.download_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-[9px] font-black uppercase tracking-widest text-teal-700 underline"
                      >
                        Download
                      </a>
                    )}
                  </div>
                  {selected.resume.parsed?.skills &&
                    selected.resume.parsed.skills.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selected.resume.parsed.skills.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-gray-600"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  {selected.resume.text_excerpt && (
                    <p className="mt-2 line-clamp-4 text-[10px] font-medium leading-4 text-gray-500">
                      {selected.resume.text_excerpt}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-1.5">
                {NEXT[selected.stage]?.map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    data-testid={`recruitment-stage-${stage}`}
                    onClick={() => void moveStage(stage)}
                    disabled={busy === `stage-${stage}`}
                    className="inline-flex items-center gap-1 rounded-lg bg-gray-950 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    {busy === `stage-${stage}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                    {stage}
                  </button>
                ))}
                {["applied", "screening", "interview", "offer"].includes(selected.stage) && (
                  <button
                    type="button"
                    onClick={() => void moveStage("rejected")}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-red-700"
                  >
                    <XCircle className="h-3 w-3" /> reject
                  </button>
                )}
              </div>
              {["applied", "screening", "interview", "offer"].includes(selected.stage) && (
                <input
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="Rejection reason (required to reject)"
                  className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[10px] font-semibold text-gray-700"
                />
              )}

              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                  Interviews
                </p>
                <div className="mt-2 space-y-1">
                  {selected.interviews.length === 0 ? (
                    <p className="text-xs font-semibold text-gray-400">None scheduled.</p>
                  ) : (
                    selected.interviews.map((interview) => (
                      <div
                        key={interview.id}
                        className="rounded-lg border border-gray-100 p-2"
                      >
                        <p className="text-[10px] font-bold text-gray-600">
                          {new Date(interview.scheduled_at).toLocaleString("en-IN")} ·{" "}
                          {interview.mode} · {interview.status}
                        </p>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <select
                            aria-label={`Score interview ${interview.id}`}
                            value={interview.score ?? ""}
                            onChange={(event) =>
                              void scoreInterview(
                                interview.id,
                                event.target.value ? Number(event.target.value) : null,
                                interview.recommendation || null
                              )
                            }
                            disabled={busy === `score-${interview.id}`}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-bold text-gray-600"
                          >
                            <option value="">Score...</option>
                            {[1, 2, 3, 4, 5].map((score) => (
                              <option key={score} value={score}>
                                {score} / 5
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`Recommendation interview ${interview.id}`}
                            value={interview.recommendation ?? ""}
                            onChange={(event) =>
                              void scoreInterview(
                                interview.id,
                                interview.score ?? null,
                                event.target.value || null
                              )
                            }
                            disabled={busy === `score-${interview.id}`}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-bold text-gray-600"
                          >
                            <option value="">Recommend...</option>
                            <option value="strong_yes">Strong yes</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                            <option value="strong_no">Strong no</option>
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <input
                    type="datetime-local"
                    value={interviewAt}
                    onChange={(event) => setInterviewAt(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[10px] font-semibold text-gray-700"
                  />
                  <button
                    type="button"
                    onClick={() => void scheduleInterview()}
                    disabled={!interviewAt || busy === "interview"}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600 disabled:opacity-40"
                  >
                    <CalendarPlus className="h-3 w-3" /> Add
                  </button>
                </div>
              </div>

              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                  Stage history
                </p>
                <div className="mt-1 space-y-1">
                  {selected.stage_history.map((event) => (
                    <p key={event.id} className="text-[10px] font-semibold text-gray-500">
                      {event.from_stage || "new"} → {event.to_stage}
                      {event.note ? ` · ${event.note}` : ""}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {showJobForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-gray-950">New job</h2>
              <button type="button" aria-label="Close job form" onClick={() => setShowJobForm(false)}>
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                Title
                <input
                  data-testid="recruitment-job-title"
                  value={jobDraft.title}
                  onChange={(event) => setJobDraft({ ...jobDraft, title: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Department
                  <input
                    value={jobDraft.department}
                    onChange={(event) =>
                      setJobDraft({ ...jobDraft, department: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  />
                </label>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Location
                  <input
                    value={jobDraft.location}
                    onChange={(event) =>
                      setJobDraft({ ...jobDraft, location: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  />
                </label>
              </div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                Description
                <textarea
                  rows={3}
                  value={jobDraft.description}
                  onChange={(event) =>
                    setJobDraft({ ...jobDraft, description: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <button
                type="button"
                data-testid="recruitment-job-save"
                onClick={() => void createJob()}
                disabled={busy === "job"}
                className="rounded-lg bg-teal-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                Save job
              </button>
            </div>
          </div>
        </div>
      )}

      {showCandidateForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-gray-950">Add candidate</h2>
              <button
                type="button"
                aria-label="Close candidate form"
                onClick={() => setShowCandidateForm(false)}
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <input
                data-testid="recruitment-candidate-name"
                value={candidateDraft.candidate_name}
                onChange={(event) =>
                  setCandidateDraft({ ...candidateDraft, candidate_name: event.target.value })
                }
                placeholder="Candidate name"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
              <input
                value={candidateDraft.email}
                onChange={(event) =>
                  setCandidateDraft({ ...candidateDraft, email: event.target.value })
                }
                placeholder="Email"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
              <input
                value={candidateDraft.phone}
                onChange={(event) =>
                  setCandidateDraft({ ...candidateDraft, phone: event.target.value })
                }
                placeholder="Phone"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
              <button
                type="button"
                data-testid="recruitment-candidate-save"
                onClick={() => void addCandidate()}
                disabled={busy === "candidate"}
                className="rounded-lg bg-teal-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                Add candidate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
