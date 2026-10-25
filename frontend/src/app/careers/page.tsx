import Link from "next/link";
import { ArrowRight, Clock3, MapPin, Sparkles, Utensils } from "lucide-react";
import { getServerApiUrl } from "@/lib/server-api";

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

async function loadJobs(): Promise<PublicJob[]> {
  try {
    const response = await fetch(getServerApiUrl("/api/v1/restaurant/careers/jobs"), {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

export const metadata = {
  title: "Careers — Pizza Blitz",
  description:
    "Join the Pizza Blitz kitchen, service floor or delivery team. See open roles and apply online.",
};

export default async function CareersPage() {
  const jobs = await loadJobs();
  return (
    <main className="min-h-screen bg-[#faf6ef] text-[#17130f]">
      <header className="border-b border-[#17130f]/10 bg-[#17130f] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-600 text-lg font-black">
              PB
            </span>
            <span className="text-lg font-black tracking-tight">Pizza Blitz</span>
          </Link>
          <div className="flex items-center gap-4 text-sm font-bold">
            <Link href="/menu" className="text-white/70 hover:text-white">
              Menu
            </Link>
            <Link
              href="/order"
              className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-500"
            >
              Order now
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-[#17130f] px-5 pb-16 pt-14 text-white md:px-8 md:pb-24 md:pt-20">
        <div className="mx-auto max-w-6xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em]">
            <Sparkles className="h-4 w-4 text-amber-300" /> Careers at Pizza Blitz
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            Make pizza people <span className="text-amber-300">talk about.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base font-medium leading-7 text-white/75 sm:text-lg">
            Kitchen, counter, delivery and management roles in a restaurant that runs on real
            systems. Apply online, meet the team, and start with a proper onboarding plan.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm font-bold">
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3">
              <Utensils className="h-4 w-4 text-amber-300" /> Real food craft
            </span>
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3">
              <Clock3 className="h-4 w-4 text-amber-300" /> Predictable shifts
            </span>
            <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3">
              <MapPin className="h-4 w-4 text-amber-300" /> Kolkata kitchen
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">
              Open roles
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              {jobs.length ? `${jobs.length} role${jobs.length === 1 ? "" : "s"} open now` : "No roles open right now"}
            </h2>
          </div>
          <p className="max-w-md text-sm font-semibold leading-6 text-[#5a4f45]">
            Applications go straight into the hiring pipeline. No account needed.
          </p>
        </div>

        {jobs.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-[#17130f]/20 bg-white p-10 text-center">
            <p className="text-lg font-black">Nothing open this minute.</p>
            <p className="mt-2 text-sm font-semibold text-[#5a4f45]">
              Send a speculative application to careers@pizza-blitz.test or check back soon.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {jobs.map((job) => (
              <article
                key={job.id}
                data-testid={`career-job-${job.id}`}
                className="flex flex-col rounded-2xl border border-[#17130f]/10 bg-white p-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#17130f] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                    {typeLabel[job.employment_type] || job.employment_type}
                  </span>
                  {job.department && (
                    <span className="rounded-full bg-[#f1e9dc] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#5a4f45]">
                      {job.department}
                    </span>
                  )}
                </div>
                <h3 className="mt-4 text-2xl font-black tracking-tight">{job.title}</h3>
                <p className="mt-1 flex items-center gap-1 text-xs font-bold text-[#8a7a6a]">
                  <MapPin className="h-3.5 w-3.5" /> {job.location || "Kolkata"} ·{" "}
                  {job.openings} opening{job.openings === 1 ? "" : "s"}
                </p>
                {job.description && (
                  <p className="mt-3 line-clamp-3 text-sm font-medium leading-6 text-[#5a4f45]">
                    {job.description}
                  </p>
                )}
                {job.salary_min != null && (
                  <p className="mt-3 text-sm font-black text-[#17130f]">
                    {money(job.salary_min)}
                    {job.salary_max != null ? ` – ${money(job.salary_max)}` : "+"} / month
                  </p>
                )}
                <Link
                  href={`/careers/${job.id}`}
                  className="mt-5 inline-flex w-fit items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-500"
                >
                  View role <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-[#17130f]/10 px-5 py-8 text-center text-xs font-semibold text-[#8a7a6a]">
        Pizza Blitz · Built in Kolkata ·{" "}
        <Link href="/" className="underline">
          Back to the restaurant
        </Link>
      </footer>
    </main>
  );
}
