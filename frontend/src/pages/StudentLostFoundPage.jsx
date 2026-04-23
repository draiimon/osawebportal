import { useEffect, useState } from "react";
import { api } from "@/lib/api";

function ItemCard({ item }) {
  return (
    <article className="border border-red-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap gap-2">
        <span className="border border-red-300 px-2 py-1 text-[11px] font-bold uppercase text-red-700">{item.status || "Unclaimed"}</span>
        {item.tag ? <span className="border border-slate-200 px-2 py-1 text-[11px] font-bold uppercase text-slate-600">{item.tag}</span> : null}
      </div>
      <h2 className="text-lg font-extrabold text-red-900">{item.title || "Recovered Item"}</h2>
      <p className="mt-2 text-sm text-slate-700">{item.caption || "No extra description."}</p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {item.itemNumber || "No item number"} • {item.date || "Date TBD"} {item.time ? `• ${item.time}` : ""}
      </p>
    </article>
  );
}

export default function StudentLostFoundPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/lost-found/items")
      .then((response) => {
        if (cancelled) return;
        setItems(Array.isArray(response.data?.data) ? response.data.data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load lost-and-found items right now.");
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
      <header className="border-2 border-red-700 bg-red-700 px-5 py-4 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-100">Student Module</p>
        <h1 className="text-2xl font-extrabold">Lost and Found</h1>
      </header>

      {loading ? <p className="text-sm text-slate-600">Loading items...</p> : null}
      {error ? <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {!loading && !error && items.length === 0 ? (
        <p className="border border-red-200 bg-white px-4 py-3 text-sm text-slate-700">No items listed.</p>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </section>
    </main>
  );
}
