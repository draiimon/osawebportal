import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

function StatCard({ label, value, hint }) {
  return (
    <article className="border-2 border-red-200 bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-red-700">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-red-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{hint}</p>
    </article>
  );
}

export default function StudentPortalPage() {
  const [announcementCount, setAnnouncementCount] = useState(0);
  const [lostFoundCount, setLostFoundCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get("/announcements"), api.get("/lost-found/items")])
      .then(([a, l]) => {
        if (cancelled) return;
        setAnnouncementCount(Array.isArray(a.data?.data) ? a.data.data.length : 0);
        setLostFoundCount(Array.isArray(l.data?.data) ? l.data.data.length : 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <section className="border-2 border-red-800 bg-red-700 px-5 py-5 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-red-100">Student View (React Port)</p>
        <h1 className="text-2xl font-extrabold">OSA Transaction Guide Portal</h1>
        <p className="text-sm text-red-100">
          This is the React version of the student flow, connected to the same backend and chat pipeline.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Announcements" value={announcementCount} hint="Live count from API" />
        <StatCard label="Lost and Found" value={lostFoundCount} hint="Items currently listed" />
        <StatCard label="Auth Layer" value="JWT" hint="Login token support enabled" />
        <StatCard label="Realtime" value="Socket" hint="Chat namespace is online" />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link to="/portal/announcements" className="border border-red-300 bg-white px-4 py-4 font-bold text-red-800 hover:bg-red-50">
          View Announcements
        </Link>
        <Link to="/portal/lost-found" className="border border-red-300 bg-white px-4 py-4 font-bold text-red-800 hover:bg-red-50">
          View Lost and Found
        </Link>
        <Link to="/chat" className="border border-red-300 bg-white px-4 py-4 font-bold text-red-800 hover:bg-red-50">
          Open Live Chat
        </Link>
      </section>
    </main>
  );
}
