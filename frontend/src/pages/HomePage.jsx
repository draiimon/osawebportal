import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="border border-red-700 bg-red-700 px-5 py-4 text-white">
        <p className="text-xs uppercase tracking-[0.24em] text-red-100">OSA Transaction Guide Portal</p>
        <h1 className="text-2xl font-extrabold">React Route Layer (Same UI)</h1>
        <p className="text-sm text-red-100">
          These links now show your existing exact UI, while the backend migration stack stays active.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Link to="/portal">
          <Button variant="outline" className="w-full py-3">Student Portal (Exact Legacy UI)</Button>
        </Link>
        <Link to="/admin-react">
          <Button variant="outline" className="w-full py-3">Admin Dashboard (Exact Legacy UI)</Button>
        </Link>
        <Link to="/auth">
          <Button variant="outline" className="w-full py-3">Auth Test</Button>
        </Link>
        <Link to="/chat">
          <Button variant="outline" className="w-full py-3">Realtime Chat Test</Button>
        </Link>
        <a href="http://localhost:8787/preview" className="border border-red-300 bg-white px-4 py-3 text-center font-semibold text-red-800 hover:bg-red-50">
          Open Legacy Portal
        </a>
      </section>
    </main>
  );
}
