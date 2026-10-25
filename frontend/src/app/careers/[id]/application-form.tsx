"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Paperclip, Send } from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Props = { jobId: number; jobTitle: string };

export default function CareerApplicationForm({ jobId, jobTitle }: Props) {
  const [form, setForm] = useState({
    candidate_name: "",
    email: "",
    phone: "",
    expected_salary: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const endpoint = resumeFile ? "apply-resume" : "apply";
      let body: FormData | string;
      let headers: Record<string, string> = {};
      if (resumeFile) {
        const formData = new FormData();
        formData.append("candidate_name", form.candidate_name);
        formData.append("email", form.email);
        formData.append("phone", form.phone);
        formData.append("expected_salary", form.expected_salary);
        formData.append("notes", form.notes);
        formData.append("file", resumeFile);
        body = formData;
      } else {
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          ...form,
          expected_salary: form.expected_salary ? Number(form.expected_salary) : null,
        });
      }
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/careers/jobs/${jobId}/${endpoint}`),
        {
          method: "POST",
          headers,
          body,
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Application could not be submitted.");
      setDone(true);
      setMessage(data.message || "Application received.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Application could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div
        data-testid="career-application-success"
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center"
      >
        <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-700" />
        <h3 className="mt-3 text-xl font-black text-emerald-950">Application received</h3>
        <p className="mt-2 text-sm font-semibold leading-6 text-emerald-900">
          Thanks for applying for {jobTitle}. Our team will contact you using the details you
          provided.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
          Full name *
          <input
            data-testid="career-name"
            required
            minLength={2}
            value={form.candidate_name}
            onChange={(event) => setForm({ ...form, candidate_name: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[#17130f]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#17130f] outline-none focus:border-red-600"
          />
        </label>
        <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
          Email
          <input
            data-testid="career-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[#17130f]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#17130f] outline-none focus:border-red-600"
          />
        </label>
        <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
          Phone
          <input
            data-testid="career-phone"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[#17130f]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#17130f] outline-none focus:border-red-600"
          />
        </label>
        <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
          Expected salary (monthly)
          <input
            type="number"
            min={0}
            value={form.expected_salary}
            onChange={(event) => setForm({ ...form, expected_salary: event.target.value })}
            className="mt-1 w-full rounded-xl border border-[#17130f]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#17130f] outline-none focus:border-red-600"
          />
        </label>
      </div>
      <label className="block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
        Why this role?
        <textarea
          rows={4}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          className="mt-1 w-full rounded-xl border border-[#17130f]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#17130f] outline-none focus:border-red-600"
        />
      </label>
      <label className="block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
        Resume (PDF, DOCX or TXT — optional)
        <span className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#17130f]/20 bg-[#faf6ef] px-3 py-2.5 text-xs font-bold text-[#5a4f45]">
          <Paperclip className="h-4 w-4" />
          {resumeFile ? resumeFile.name : "Attach a resume to auto-fill contact details"}
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={(event) => setResumeFile(event.target.files?.[0] || null)}
          />
        </span>
      </label>
      <p className="text-[10px] font-semibold text-[#8a7a6a]">
        Add an email or phone so the team can contact you. If omitted, we use the details
        found in your resume.
      </p>
      {message && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          {message}
        </p>
      )}
      <button
        type="submit"
        data-testid="career-submit"
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Apply for this role
      </button>
    </form>
  );
}
