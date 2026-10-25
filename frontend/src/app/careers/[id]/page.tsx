import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness, MapPin, Wallet } from "lucide-react";
import { getServerApiUrl } from "@/lib/server-api";
import CareerApplicationForm from "./application-form";

export const dynamic = "force-dynamic";

type PublicJob = {
  id: number;
  title: string;
  department?: string | null;
  location?: string | null;
  employment_type: string;
  description?: string | null;
  requirements?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  openings: number;
};

const typeLabel: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  internship: "Internship",
};

const money = (value?: number | null) =>
  value == null ? "" : `Rs ${Number(value).toLocaleString("en-IN")}`;

async function loadJob(id: string): Promise<PublicJob | null> {
  try {
    const response = await fetch(
      getServerApiUrl(`/api/v1/restaurant/careers/jobs/${id}`),
      { cache: "no-store" }
    );
    if (!response.ok) return null;
    return (await response.json()).job;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const job = await loadJob(params.id);
  return {
    title: job ? `${job.title} — Pizza Blitz Careers` : "Careers — Pizza Blitz",
    description: job?.description || "Apply for a role at Pizza Blitz.",
  };
}

export default async function CareerDetailPage({ params }: { params: { id: string } }) {
  const job = await loadJob(params.id);
  if (!job) notFound();

  return (
    <main className="min-h-screen bg-[#faf6ef] text-[#17130f]">
      <header className="border-b border-[#17130f]/10 bg-[#17130f] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-600 text-lg font-black">
              PB
            </span>
            <span className="text-lg font-black tracking-tight">Pizza Blitz</span>
          </Link>
          <Link href="/careers" className="text-sm font-bold text-white/70 hover:text-white">
            All roles
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 md:grid-cols-[1fr_0.9fr] md:px-8 md:py-16">
        <div>
          <Link
            href="/careers"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-[#8a7a6a] hover:text-red-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All roles
          </Link>
          <p className="mt-5 inline-flex rounded-full bg-[#17130f] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
            {typeLabel[job.employment_type] || job.employment_type}
          </p>
          <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            {job.title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-[#5a4f45]">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {job.location || "Kolkata"}
            </span>
            <span className="inline-flex items-center gap-1">
              <BriefcaseBusiness className="h-3.5 w-3.5" /> {job.department || "Restaurant"}
            </span>
            {job.salary_min != null && (
              <span className="inline-flex items-center gap-1">
                <Wallet className="h-3.5 w-3.5" /> {money(job.salary_min)}
                {job.salary_max != null ? ` – ${money(job.salary_max)}` : "+"} / month
              </span>
            )}
          </div>

          <div className="mt-8 space-y-6 text-sm font-medium leading-7 text-[#5a4f45]">
            <div>
              <h2 className="text-lg font-black text-[#17130f]">The role</h2>
              <p className="mt-2 whitespace-pre-wrap">
                {job.description || "Come build great pizza service with our team."}
              </p>
            </div>
            {job.requirements && (
              <div>
                <h2 className="text-lg font-black text-[#17130f]">What we look for</h2>
                <p className="mt-2 whitespace-pre-wrap">{job.requirements}</p>
              </div>
            )}
            <div>
              <h2 className="text-lg font-black text-[#17130f]">Hiring process</h2>
              <ol className="mt-2 space-y-1">
                <li>1. Apply online with your contact details.</li>
                <li>2. A short screening call from the HR team.</li>
                <li>3. Kitchen or floor interview with the hiring manager.</li>
                <li>4. Offer, documents and a structured onboarding plan.</li>
              </ol>
            </div>
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-[#17130f]/10 bg-white p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-700">
            Apply online
          </p>
          <h2 className="mt-1 text-2xl font-black">Join the team</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#8a7a6a]">
            No account needed. Your application goes straight to the HR hiring board.
          </p>
          <div className="mt-5">
            <CareerApplicationForm jobId={job.id} jobTitle={job.title} />
          </div>
        </aside>
      </div>
    </main>
  );
}
