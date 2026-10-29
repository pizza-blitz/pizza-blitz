"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  PRIORITY_STYLES,
  WORK_STATUSES,
  companyApi,
  formatWorkDate,
  titleCase,
  type Approval,
  type StaffNotification,
  type WorkHome,
  type WorkItem,
  type WorkItemComment,
} from "@/lib/company";

type CreateMode = "task" | "approval";

export default function WorkPage() {
  const [home, setHome] = useState<WorkHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("task");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, WorkItemComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [approvalNotes, setApprovalNotes] = useState<Record<number, string>>({});
  const [form, setForm] = useState({
    department_key: "",
    title: "",
    description: "",
    kind: "task",
    priority: "normal",
    due_at: "",
    amount: "",
    note: "",
  });

  const load = useCallback(async () => {
    try {
      const data = await companyApi<WorkHome>("/api/v1/restaurant/work");
      setHome(data);
      setError("");
      setForm((current) => ({
        ...current,
        department_key:
          current.department_key || data.departments[0]?.key || "",
      }));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Work queue failed to load."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setHydrated(true);
    const params = new URLSearchParams(window.location.search);
    const department = params.get("department");
    const mode = params.get("new");
    if (department) {
      setDepartmentFilter(department);
      setForm((current) => ({ ...current, department_key: department }));
    }
    if (mode === "task" || mode === "approval") {
      setCreateMode(mode);
      setShowCreate(true);
    }
    void load();
  }, [load]);

  const departments = home?.departments ?? [];
  const filteredItems = useMemo(
    () =>
      (home?.work_items ?? []).filter(
        (item) =>
          departmentFilter === "all" ||
          item.department_key === departmentFilter
      ),
    [home, departmentFilter]
  );
  const filteredApprovals = useMemo(
    () =>
      (home?.approvals ?? []).filter(
        (approval) =>
          departmentFilter === "all" ||
          approval.department_key === departmentFilter
      ),
    [home, departmentFilter]
  );

  const canApprove = (approval: Approval) => {
    if (!home) return false;
    if (home.is_admin) return true;
    const department = home.departments.find(
      (row) => row.key === approval.department_key
    );
    if (!department) return false;
    return (
      department.permissions.includes(`${department.key}.approve`) ||
      department.permissions.includes(`${department.key}.manage_team`)
    );
  };

  const openCreate = (mode: CreateMode) => {
    setCreateMode(mode);
    setFlash("");
    setShowCreate(true);
    setForm((current) => ({
      ...current,
      // Task and approval kinds live in separate vocabularies; reset the
      // selection when the modal switches modes so the first option is valid.
      kind: mode === "task" ? "task" : "manual",
      department_key:
        departmentFilter !== "all" ? departmentFilter : current.department_key,
    }));
  };

  const submitCreate = async () => {
    if (!form.department_key) {
      setError("Choose a department first.");
      return;
    }
    if (form.title.trim().length < 2) {
      setError("Give the item a title.");
      return;
    }
    setBusy("create");
    setError("");
    try {
      if (createMode === "task") {
        await companyApi("/api/v1/restaurant/work/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            department_key: form.department_key,
            title: form.title.trim(),
            description: form.description.trim() || null,
            kind: form.kind || "task",
            priority: form.priority,
            due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
          }),
        });
        setFlash("Task added to the department queue.");
      } else {
        await companyApi("/api/v1/restaurant/work/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            department_key: form.department_key,
            title: form.title.trim(),
            kind: form.kind || "manual",
            amount: form.amount ? Number(form.amount) : null,
            note: form.note.trim() || null,
          }),
        });
        setFlash("Approval request raised.");
      }
      setShowCreate(false);
      setForm((current) => ({
        ...current,
        title: "",
        description: "",
        due_at: "",
        amount: "",
        note: "",
      }));
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Item could not be saved."
      );
    } finally {
      setBusy("");
    }
  };

  const changeStatus = async (item: WorkItem, status: string) => {
    setBusy(`status-${item.id}`);
    setFlash("");
    try {
      await companyApi(`/api/v1/restaurant/work/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setFlash(`"${item.title}" marked ${titleCase(status)}.`);
      await load();
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Status could not be updated."
      );
    } finally {
      setBusy("");
    }
  };

  const toggleComments = async (item: WorkItem) => {
    if (expanded === item.id) {
      setExpanded(null);
      return;
    }
    setExpanded(item.id);
    if (comments[item.id]) return;
    try {
      const data = await companyApi<{
        work_item: WorkItem;
        comments: WorkItemComment[];
      }>(`/api/v1/restaurant/work/items/${item.id}`);
      setComments((current) => ({ ...current, [item.id]: data.comments }));
    } catch (commentError) {
      setError(
        commentError instanceof Error
          ? commentError.message
          : "Comments could not be loaded."
      );
    }
  };

  const addComment = async (item: WorkItem) => {
    if (!commentDraft.trim()) return;
    setBusy(`comment-${item.id}`);
    try {
      const data = await companyApi<{ comment: WorkItemComment }>(
        `/api/v1/restaurant/work/items/${item.id}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: commentDraft.trim() }),
        }
      );
      setComments((current) => ({
        ...current,
        [item.id]: [...(current[item.id] || []), data.comment],
      }));
      setCommentDraft("");
      await load();
    } catch (commentError) {
      setError(
        commentError instanceof Error
          ? commentError.message
          : "Comment could not be saved."
      );
    } finally {
      setBusy("");
    }
  };

  const decide = async (approval: Approval, decision: "approved" | "rejected") => {
    setBusy(`approval-${approval.id}`);
    setFlash("");
    try {
      await companyApi(
        `/api/v1/restaurant/work/approvals/${approval.id}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            note: (approvalNotes[approval.id] || "").trim() || null,
          }),
        }
      );
      setFlash(`"${approval.title}" ${decision}.`);
      await load();
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "Approval could not be decided."
      );
    } finally {
      setBusy("");
    }
  };

  const markRead = async (notification: StaffNotification) => {
    setBusy(`notification-${notification.id}`);
    try {
      await companyApi(
        `/api/v1/restaurant/work/notifications/${notification.id}/read`,
        { method: "POST" }
      );
      await load();
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : "Notification could not be marked read."
      );
    } finally {
      setBusy("");
    }
  };

  const counts = home?.counts;

  return (
    <div
      data-testid="work-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            <ClipboardCheck className="h-4 w-4" /> Company OS
          </p>
          <h1 className="mt-1 text-3xl font-black text-gray-950">My work</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Every task, approval and request across your departments in one queue.
            Department screens stay authoritative; this inbox stays in sync.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh work queue"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-black uppercase tracking-widest text-gray-600 hover:border-orange-300"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            type="button"
            data-testid="work-create-approval-open"
            onClick={() => openCreate("approval")}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300"
          >
            <ShieldCheck className="h-4 w-4" /> Request approval
          </button>
          <button
            type="button"
            data-testid="work-create-open"
            onClick={() => openCreate("task")}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
          >
            <Plus className="h-4 w-4" /> New task
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </div>
      )}
      {flash && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {flash}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Open tasks",
            value: counts?.work_items ?? 0,
            hint: "Assigned to you or your teams",
            icon: ClipboardCheck,
          },
          {
            label: "Pending approvals",
            value: counts?.approvals ?? 0,
            hint: "Waiting on a decision",
            icon: ShieldCheck,
          },
          {
            label: "Need attention",
            value: counts?.attention ?? 0,
            hint: "High priority or overdue",
            icon: Clock3,
          },
          {
            label: "Unread notices",
            value: counts?.unread_notifications ?? 0,
            hint: "Approvals and assignments",
            icon: Bell,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl border border-gray-100 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {card.label}
                </p>
                <Icon className="h-4 w-4 text-orange-600" />
              </div>
              <p className="mt-2 text-3xl font-black text-gray-950">
                {card.value}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-gray-400">
                {card.hint}
              </p>
            </div>
          );
        })}
      </section>

      {home?.notifications?.length ? (
        <section
          data-testid="work-notifications"
          className="rounded-2xl border border-orange-100 bg-orange-50/60 p-4"
        >
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-800">
            <Bell className="h-4 w-4" /> Unread notices
          </p>
          <div className="mt-2 space-y-2">
            {home.notifications.map((notification) => (
              <div
                key={notification.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-gray-900">
                    {notification.title}
                  </p>
                  <p className="text-[11px] font-semibold text-gray-500">
                    {notification.body || "No extra detail."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void markRead(notification)}
                  disabled={busy === `notification-${notification.id}`}
                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:border-orange-300"
                >
                  Mark read
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDepartmentFilter("all")}
          className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
            departmentFilter === "all"
              ? "bg-gray-950 text-white"
              : "border border-gray-200 bg-white text-gray-500"
          }`}
        >
          All departments
        </button>
        {departments.map((department) => (
          <button
            key={department.key}
            type="button"
            onClick={() => setDepartmentFilter(department.key)}
            className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
              departmentFilter === department.key
                ? "bg-gray-950 text-white"
                : "border border-gray-200 bg-white text-gray-500"
            }`}
          >
            {department.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading work queue...
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[1.35fr_0.85fr]">
          <section className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <ClipboardCheck className="h-4 w-4 text-orange-600" /> Work queue
              </p>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {filteredItems.length} open
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {filteredItems.length ? (
                filteredItems.map((item) => (
                  <article
                    key={item.id}
                    data-testid={`work-item-${item.id}`}
                    className="rounded-xl border border-gray-100 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                              PRIORITY_STYLES[item.priority] ||
                              PRIORITY_STYLES.normal
                            }`}
                          >
                            {item.priority}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500">
                            {titleCase(item.kind)}
                          </span>
                          {item.department_name && (
                            <span className="text-[10px] font-bold text-gray-400">
                              {item.department_name}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-black text-gray-900">
                          {item.title}
                        </p>
                        {item.description && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold text-gray-500">
                            {item.description}
                          </p>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold text-gray-400">
                          <span>
                            Owner: {item.owner_display_name || "Unassigned"}
                          </span>
                          <span>·</span>
                          <span
                            className={
                              item.needs_attention ? "text-red-600" : ""
                            }
                          >
                            Due {formatWorkDate(item.due_at)}
                          </span>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() => void toggleComments(item)}
                            className="inline-flex items-center gap-1 hover:text-orange-700"
                          >
                            <MessageSquare className="h-3 w-3" />
                            {item.comment_count} comments
                          </button>
                        </p>
                      </div>
                      <select
                        aria-label={`Status for ${item.title}`}
                        value={item.status}
                        disabled={busy === `status-${item.id}`}
                        onChange={(event) =>
                          void changeStatus(item, event.target.value)
                        }
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
                      >
                        {WORK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {titleCase(status)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {expanded === item.id && (
                      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                        {(comments[item.id] || []).length ? (
                          (comments[item.id] || []).map((comment) => (
                            <div
                              key={comment.id}
                              className="rounded-lg bg-gray-50 px-3 py-2"
                            >
                              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                {comment.author_name || "Team"} ·{" "}
                                {formatWorkDate(comment.created_at)}
                              </p>
                              <p className="mt-0.5 text-xs font-semibold text-gray-700">
                                {comment.body}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="text-[11px] font-semibold text-gray-400">
                            No comments yet.
                          </p>
                        )}
                        <div className="flex gap-2">
                          <input
                            value={commentDraft}
                            onChange={(event) =>
                              setCommentDraft(event.target.value)
                            }
                            data-testid={`work-comment-input-${item.id}`}
                            placeholder="Add a comment..."
                            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold"
                          />
                          <button
                            type="button"
                            data-testid={`work-comment-submit-${item.id}`}
                            onClick={() => void addComment(item)}
                            disabled={
                              !commentDraft.trim() ||
                              busy === `comment-${item.id}`
                            }
                            className="rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                          >
                            Post
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" />
                  <p className="mt-2 text-sm font-black text-gray-700">
                    Nothing open here
                  </p>
                  <p className="mt-1 text-xs font-semibold text-gray-400">
                    Create a task or pick another department.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <ShieldCheck className="h-4 w-4 text-orange-600" /> Approvals
              </p>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {filteredApprovals.length} pending
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {filteredApprovals.length ? (
                filteredApprovals.map((approval) => (
                  <article
                    key={approval.id}
                    data-testid={`approval-${approval.id}`}
                    className="rounded-xl border border-gray-100 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-800">
                            {titleCase(approval.kind)}
                          </span>
                          {approval.department_name && (
                            <span className="text-[10px] font-bold text-gray-400">
                              {approval.department_name}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-black text-gray-900">
                          {approval.title}
                        </p>
                        <p className="mt-0.5 text-[11px] font-semibold text-gray-500">
                          {approval.amount
                            ? `Rs ${Number(approval.amount).toLocaleString()} · `
                            : ""}
                          Requested by {approval.requested_by || "system"}
                        </p>
                        {approval.note && (
                          <p className="mt-1 rounded-lg bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-500">
                            {approval.note}
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500">
                        {approval.status}
                      </span>
                    </div>

                    {approval.status === "pending" && canApprove(approval) ? (
                      <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                        <input
                          value={approvalNotes[approval.id] || ""}
                          onChange={(event) =>
                            setApprovalNotes((current) => ({
                              ...current,
                              [approval.id]: event.target.value,
                            }))
                          }
                          placeholder="Decision note (optional)"
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            data-testid={`approval-approve-${approval.id}`}
                            onClick={() => void decide(approval, "approved")}
                            disabled={busy === `approval-${approval.id}`}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            data-testid={`approval-reject-${approval.id}`}
                            onClick={() => void decide(approval, "rejected")}
                            disabled={busy === `approval-${approval.id}`}
                            className="rounded-lg border border-red-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 disabled:opacity-40"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : approval.status === "pending" ? (
                      <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] font-bold uppercase tracking-widest text-amber-700">
                        Waiting on a department head
                      </p>
                    ) : (
                      <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        {approval.decided_by
                          ? `Decided by ${approval.decided_by}`
                          : "Decided"}
                        {approval.decided_at
                          ? ` · ${formatWorkDate(approval.decided_at)}`
                          : ""}
                      </p>
                    )}
                  </article>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center">
                  <Sparkles className="mx-auto h-6 w-6 text-orange-400" />
                  <p className="mt-2 text-sm font-black text-gray-700">
                    No pending approvals
                  </p>
                  <p className="mt-1 text-xs font-semibold text-gray-400">
                    Leave, spend and publishing requests appear here.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-gray-200 bg-white/70 p-4 text-[11px] font-semibold text-gray-500">
        <Link
          href="/departments"
          className="inline-flex items-center gap-1 font-black text-orange-700"
        >
          Browse departments <ArrowUpRight className="h-3 w-3" />
        </Link>
        <span>
          Approvals raised on HR, marketing, expense and purchase screens are
          mirrored here automatically.
        </span>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div
            data-testid="work-create-modal"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                  {createMode === "task" ? "Work item" : "Approval request"}
                </p>
                <h2 className="mt-1 text-2xl font-black text-gray-950">
                  {createMode === "task" ? "Create a task" : "Request approval"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                aria-label="Close work form"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                Department
                <select
                  value={form.department_key}
                  onChange={(event) =>
                    setForm({ ...form, department_key: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                >
                  <option value="">Select department...</option>
                  {departments.map((department) => (
                    <option key={department.key} value={department.key}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                Title
                <input
                  data-testid="work-title"
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  placeholder={
                    createMode === "task"
                      ? "Close the evening stock count"
                      : "Approve weekend spend"
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                />
              </label>
              {createMode === "task" ? (
                <>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                    Description
                    <textarea
                      value={form.description}
                      onChange={(event) =>
                        setForm({ ...form, description: event.target.value })
                      }
                      rows={3}
                      placeholder="What needs to happen?"
                      className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900"
                    />
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Kind
                    <select
                      value={form.kind}
                      onChange={(event) =>
                        setForm({ ...form, kind: event.target.value })
                      }
                      className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                    >
                      {["task", "request", "checklist", "incident", "handoff"].map(
                        (kind) => (
                          <option key={kind} value={kind}>
                            {titleCase(kind)}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Priority
                    <select
                      value={form.priority}
                      onChange={(event) =>
                        setForm({ ...form, priority: event.target.value })
                      }
                      className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                    >
                      {["low", "normal", "high", "urgent"].map((priority) => (
                        <option key={priority} value={priority}>
                          {titleCase(priority)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                    Due
                    <input
                      type="datetime-local"
                      value={form.due_at}
                      onChange={(event) =>
                        setForm({ ...form, due_at: event.target.value })
                      }
                      className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Approval kind
                    <select
                      value={form.kind}
                      onChange={(event) =>
                        setForm({ ...form, kind: event.target.value })
                      }
                      className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                    >
                      {[
                        "manual",
                        "expense",
                        "purchase_order",
                        "discount",
                        "refund",
                        "capex",
                      ].map((kind) => (
                        <option key={kind} value={kind}>
                          {titleCase(kind)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Amount (optional)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      onChange={(event) =>
                        setForm({ ...form, amount: event.target.value })
                      }
                      placeholder="0"
                      className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                    />
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                    Note
                    <textarea
                      value={form.note}
                      onChange={(event) =>
                        setForm({ ...form, note: event.target.value })
                      }
                      rows={3}
                      placeholder="Why is this needed?"
                      className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-500"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="work-submit"
                onClick={() => void submitCreate()}
                disabled={busy === "create"}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy === "create" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {createMode === "task" ? "Create task" : "Raise request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
