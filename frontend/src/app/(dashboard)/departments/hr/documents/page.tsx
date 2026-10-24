"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Employee = {
  id: number;
  employee_code: string;
  full_name: string;
  status: string;
};

type DocumentRow = {
  id: number;
  employee_id: number;
  employee_name?: string | null;
  employee_code?: string | null;
  category: string;
  title: string;
  file_name: string;
  size_bytes: number;
  visibility: string;
  expires_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

type Letter = {
  id: number;
  employee_id: number;
  employee_name?: string | null;
  employee_code?: string | null;
  letter_type: string;
  letter_label: string;
  title: string;
  verification_code: string;
  status: string;
  issued_at?: string | null;
  content_html?: string;
};

type Tab = "documents" | "letters";

const CATEGORY_LABELS: Record<string, string> = {
  identity: "Identity",
  address: "Address",
  bank: "Bank",
  contract: "Contract",
  certificate: "Certificate",
  other: "Other",
};

const LETTER_TYPES = [
  ["offer", "Offer letter"],
  ["confirmation", "Confirmation letter"],
  ["experience", "Experience letter"],
  ["relieving", "Relieving letter"],
];

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function HRDocumentsPage() {
  const [tab, setTab] = useState<Tab>("documents");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showLetter, setShowLetter] = useState(false);
  const [viewLetter, setViewLetter] = useState<Letter | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadForm, setUploadForm] = useState({
    employee_id: "",
    category: "identity",
    title: "",
    visibility: "hr",
    expires_at: "",
    notes: "",
  });
  const [letterForm, setLetterForm] = useState({
    employee_id: "",
    letter_type: "offer",
  });

  const load = async () => {
    try {
      const [employeeRes, documentRes, letterRes] = await Promise.all([
        fetch(getApiUrl("/api/v1/restaurant/hr/employees"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/hr/documents"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/hr/letters"), {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const employeeData = await employeeRes.json();
      if (!employeeRes.ok) throw new Error(employeeData.detail || "HR documents failed.");
      setEmployees(employeeData.employees || []);
      if (documentRes.ok) setDocuments((await documentRes.json()).documents || []);
      if (letterRes.ok) setLetters((await letterRes.json()).letters || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HR documents failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!uploadForm.employee_id || !uploadForm.title.trim() || !file) {
      setMessage("Choose an employee, a title and a file.");
      return;
    }
    setBusy("upload");
    setMessage("");
    try {
      const data = new FormData();
      data.append("employee_id", uploadForm.employee_id);
      data.append("category", uploadForm.category);
      data.append("title", uploadForm.title.trim());
      data.append("visibility", uploadForm.visibility);
      data.append("expires_at", uploadForm.expires_at);
      data.append("notes", uploadForm.notes);
      data.append("file", file);
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/documents"),
        { method: "POST", credentials: "include", body: data }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Upload failed.");
      setShowUpload(false);
      setUploadForm({
        employee_id: uploadForm.employee_id,
        category: "identity",
        title: "",
        visibility: "hr",
        expires_at: "",
        notes: "",
      });
      if (fileRef.current) fileRef.current.value = "";
      await load();
      setMessage("Document uploaded to the private HR vault.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  };

  const download = async (row: DocumentRow) => {
    setBusy(`download-${row.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/documents/${row.id}/download`),
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Download failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = row.file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setBusy("");
    }
  };

  const removeDocument = async (row: DocumentRow) => {
    setBusy(`delete-${row.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/documents/${row.id}`),
        { method: "DELETE", credentials: "include" }
      );
      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Delete failed.");
      }
      await load();
      setMessage("Document removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy("");
    }
  };

  const issueLetter = async () => {
    if (!letterForm.employee_id) {
      setMessage("Choose an employee.");
      return;
    }
    setBusy("letter");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/letters"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(letterForm),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Letter failed.");
      setShowLetter(false);
      await load();
      setViewLetter(data);
      setMessage("Letter issued with a verification code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Letter failed.");
    } finally {
      setBusy("");
    }
  };

  const verify = async () => {
    if (!verifyCode.trim()) return;
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/hr/verify-letter/${encodeURIComponent(
            verifyCode.trim().toUpperCase()
          )}`
        ),
        { cache: "no-store" }
      );
      const data = await response.json();
      setVerifyResult(
        data.valid
          ? `Valid: ${data.letter_label} for ${data.employee_name} (${data.employee_code}).`
          : "No issued letter matches that code."
      );
    } catch {
      setVerifyResult("Verification service unavailable.");
    }
  };

  return (
    <div
      data-testid="hr-documents-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div>
        <Link
          href="/departments/hr"
          className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> People & HR
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">
              HR department · Records
            </p>
            <h1 className="text-3xl font-black text-gray-950">Documents & letters</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Private employee document vault and issued offer, confirmation, experience
              and relieving letters with public verification codes.
            </p>
          </div>
          <div className="flex gap-2">
            {tab === "documents" ? (
              <button
                type="button"
                data-testid="document-upload-open"
                onClick={() => setShowUpload(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700"
              >
                <Upload className="h-4 w-4" /> Upload document
              </button>
            ) : (
              <button
                type="button"
                data-testid="letter-issue-open"
                onClick={() => setShowLetter(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700"
              >
                <Plus className="h-4 w-4" /> Issue letter
              </button>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Documents
          </p>
          <p className="mt-1 text-2xl font-black text-gray-950">{documents.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Letters issued
          </p>
          <p className="mt-1 text-2xl font-black text-gray-950">{letters.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Expiring documents
          </p>
          <p className="mt-1 text-2xl font-black text-amber-700">
            {
              documents.filter(
                (row) =>
                  row.expires_at &&
                  new Date(row.expires_at).getTime() <
                    Date.now() + 90 * 24 * 60 * 60 * 1000
              ).length
            }
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Verified letters
          </p>
          <p className="mt-1 text-2xl font-black text-teal-700">
            {letters.filter((row) => row.status === "issued").length}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["documents", "Documents"],
            ["letters", "Letters"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`documents-tab-${key}`}
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === key
                ? "bg-gray-950 text-white"
                : "border border-gray-200 bg-white text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading records...
        </div>
      ) : tab === "documents" ? (
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
          {documents.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm font-semibold text-gray-400">
              No documents uploaded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Document</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Expiry</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((row) => (
                    <tr
                      key={row.id}
                      data-testid={`document-row-${row.id}`}
                      className="border-b border-gray-50 text-sm"
                    >
                      <td className="px-3 py-3">
                        <p className="font-black text-gray-900">{row.employee_name}</p>
                        <p className="text-[10px] font-semibold text-gray-400">
                          {row.employee_code}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-gray-800">{row.title}</p>
                        <p className="text-[10px] text-gray-400">{row.file_name}</p>
                      </td>
                      <td className="px-3 py-3 text-xs font-bold uppercase tracking-widest text-gray-500">
                        {CATEGORY_LABELS[row.category] || row.category}
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold text-gray-500">
                        {formatSize(row.size_bytes)}
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold text-gray-500">
                        {row.expires_at || "—"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label={`Download ${row.title}`}
                            onClick={() => void download(row)}
                            disabled={busy === `download-${row.id}`}
                            className="rounded-md border border-gray-200 p-1.5 text-gray-500"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${row.title}`}
                            onClick={() => void removeDocument(row)}
                            disabled={busy === `delete-${row.id}`}
                            className="rounded-md border border-gray-200 p-1.5 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
            {letters.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm font-semibold text-gray-400">
                No letters issued.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2">Letter</th>
                      <th className="px-3 py-2">Issued</th>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {letters.map((row) => (
                      <tr
                        key={row.id}
                        data-testid={`letter-row-${row.id}`}
                        className="border-b border-gray-50 text-sm"
                      >
                        <td className="px-3 py-3">
                          <p className="font-black text-gray-900">{row.employee_name}</p>
                          <p className="text-[10px] font-semibold text-gray-400">
                            {row.employee_code}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-xs font-bold text-gray-600">
                          {row.letter_label}
                        </td>
                        <td className="px-3 py-3 text-xs font-semibold text-gray-500">
                          {row.issued_at
                            ? new Date(row.issued_at).toLocaleDateString("en-IN")
                            : "—"}
                        </td>
                        <td className="px-3 py-3 font-mono text-[10px] font-bold text-teal-700">
                          {row.verification_code}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={async () => {
                              const response = await fetch(
                                getApiUrl(`/api/v1/restaurant/hr/letters/${row.id}`),
                                { credentials: "include", cache: "no-store" }
                              );
                              if (response.ok) setViewLetter(await response.json());
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-600"
                          >
                            <FileText className="h-3 w-3" /> View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <ShieldCheck className="h-4 w-4 text-teal-700" /> Verify a letter
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={verifyCode}
                onChange={(event) => setVerifyCode(event.target.value)}
                placeholder="PBL-XXXXXXXXXXXX"
                className="min-w-[220px] flex-1 rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs font-bold text-gray-700"
              />
              <button
                type="button"
                onClick={() => void verify()}
                className="rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white"
              >
                Verify
              </button>
            </div>
            {verifyResult && (
              <p className="mt-2 text-xs font-semibold text-gray-600">{verifyResult}</p>
            )}
          </section>
        </>
      )}

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div data-testid="document-upload-form" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <h2 className="text-2xl font-black text-gray-950">Upload document</h2>
              <button type="button" onClick={() => setShowUpload(false)} aria-label="Close">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Employee
                <select
                  data-testid="document-employee"
                  value={uploadForm.employee_id}
                  onChange={(event) =>
                    setUploadForm({ ...uploadForm, employee_id: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name} ({employee.employee_code})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Category
                  <select
                    value={uploadForm.category}
                    onChange={(event) =>
                      setUploadForm({ ...uploadForm, category: event.target.value })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Visibility
                  <select
                    value={uploadForm.visibility}
                    onChange={(event) =>
                      setUploadForm({ ...uploadForm, visibility: event.target.value })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  >
                    <option value="hr">HR only</option>
                    <option value="employee">Employee visible</option>
                  </select>
                </label>
              </div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Title
                <input
                  data-testid="document-title"
                  value={uploadForm.title}
                  onChange={(event) =>
                    setUploadForm({ ...uploadForm, title: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Expiry (optional)
                <input
                  type="date"
                  value={uploadForm.expires_at}
                  onChange={(event) =>
                    setUploadForm({ ...uploadForm, expires_at: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                File (PDF, JPEG, PNG, DOCX · max 10 MB)
                <input
                  ref={fileRef}
                  data-testid="document-file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.docx"
                  className="mt-1 block w-full rounded-lg border border-dashed border-gray-300 px-3 py-3 text-xs font-semibold text-gray-600"
                />
              </label>
            </div>
            <button
              type="button"
              data-testid="document-upload-submit"
              onClick={() => void upload()}
              disabled={busy === "upload"}
              className="mt-4 w-full rounded-lg bg-gray-950 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Upload
            </button>
          </div>
        </div>
      )}

      {showLetter && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <h2 className="text-2xl font-black text-gray-950">Issue letter</h2>
              <button type="button" onClick={() => setShowLetter(false)} aria-label="Close">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <label className="mt-4 block text-[10px] font-black uppercase tracking-widest text-gray-400">
              Employee
              <select
                data-testid="letter-employee"
                value={letterForm.employee_id}
                onChange={(event) =>
                  setLetterForm({ ...letterForm, employee_id: event.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
              >
                <option value="">Select employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name} ({employee.employee_code})
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-gray-400">
              Letter type
              <select
                data-testid="letter-type"
                value={letterForm.letter_type}
                onChange={(event) =>
                  setLetterForm({ ...letterForm, letter_type: event.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
              >
                {LETTER_TYPES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              data-testid="letter-issue-submit"
              onClick={() => void issueLetter()}
              disabled={busy === "letter"}
              className="mt-4 w-full rounded-lg bg-teal-700 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Issue letter
            </button>
          </div>
        </div>
      )}

      {viewLetter && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-3 sm:items-center">
          <div
            data-testid="letter-modal"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                  Issued letter
                </p>
                <h2 className="text-xl font-black text-gray-950">{viewLetter.title}</h2>
                <p className="mt-1 font-mono text-[10px] font-bold text-teal-700">
                  {viewLetter.verification_code}
                </p>
              </div>
              <button type="button" onClick={() => setViewLetter(null)} aria-label="Close letter">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div
              className="mt-4"
              dangerouslySetInnerHTML={{ __html: viewLetter.content_html || "" }}
            />
            <button
              type="button"
              onClick={() => window.print()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700"
            >
              <Printer className="h-4 w-4" /> Print letter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
