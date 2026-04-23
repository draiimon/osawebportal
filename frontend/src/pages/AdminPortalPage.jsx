import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

function Block({ label, value, detail }) {
  return (
    <article className="border-2 border-red-300 bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-red-700">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-red-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
    </article>
  );
}

export default function AdminPortalPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [lostFound, setLostFound] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get("/announcements"), api.get("/lost-found/items")])
      .then(([a, l]) => {
        if (cancelled) return;
        setAnnouncements(Array.isArray(a.data?.data) ? a.data.data : []);
        setLostFound(Array.isArray(l.data?.data) ? l.data.data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const unclaimed = lostFound.filter((item) => String(item.status || "").toLowerCase().includes("unclaimed")).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6">
      <header className="border-2 border-red-900 bg-red-700 px-5 py-5 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-100">Admin React Port</p>
        <h1 className="text-2xl font-extrabold">OSA Administrator Dashboard</h1>
        <p className="text-sm text-red-100">Live monitoring from the same backend APIs.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Block label="Announcements" value={announcements.length} detail="Total active records" />
        <Block label="Lost and Found" value={lostFound.length} detail="Current listed items" />
        <Block label="Unclaimed Items" value={unclaimed} detail="Needs claim verification" />
        <Block label="Portal Layer" value="React" detail="Progressive migration enabled" />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Link to="/admin-react/announcements" className="border border-red-300 bg-white px-4 py-4 font-bold text-red-800 hover:bg-red-50">
          Open Admin Announcements (React)
        </Link>
        <a href="http://localhost:8787/admin/modules/announcements" className="border border-red-300 bg-white px-4 py-4 font-bold text-red-800 hover:bg-red-50">
          Open Legacy Admin Announcements
        </a>
      </section>
    </main>
  );
}
