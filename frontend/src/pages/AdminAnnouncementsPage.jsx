import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/announcements")
      .then((response) => {
        if (cancelled) return;
        setItems(Array.isArray(response.data?.data) ? response.data.data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load announcements.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6">
      <header className="border-2 border-red-900 bg-red-700 px-5 py-5 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-100">Admin React Module</p>
        <h1 className="text-2xl font-extrabold">Announcements Management</h1>
        <p className="text-sm text-red-100">
          Read view is fully in React. For posting/editing, use existing admin module while CRUD API expansion is in progress.
        </p>
      </header>

      <a
        href="http://localhost:8787/admin/modules/announcements"
        className="w-fit border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-800 hover:bg-red-50"
      >
        Open Legacy Editor
      </a>

      {loading ? <p className="text-sm text-slate-600">Loading announcements...</p> : null}
      {error ? <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <section className="grid gap-3">
        {items.map((item) => (
          <article key={item.id} className="border border-red-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap gap-2">
              <span className="border border-red-300 px-2 py-1 text-[11px] font-bold uppercase text-red-700">{item.category || "Advisory"}</span>
              {item.urgency ? (
                <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold uppercase text-amber-800">
                  {item.urgency}
                </span>
              ) : null}
            </div>
            <h2 className="text-lg font-extrabold text-red-900">{item.title || "Announcement"}</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{item.details || "No details."}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
