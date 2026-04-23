import { useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";

const tokenKey = "osa.react.auth.token";

export default function AuthPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [me, setMe] = useState(null);

  const token = useMemo(() => localStorage.getItem(tokenKey) || "", []);

  async function onSubmit(event) {
    event.preventDefault();
    setMessage("Processing...");

    try {
      if (mode === "register") {
        const { data } = await api.post("/auth/register", { email, password, name, role: "STUDENT" });
        setMessage(`Registered: ${data?.user?.email || "ok"}. You can now log in.`);
        return;
      }

      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem(tokenKey, data.token);
      setMessage("Login successful. Token stored locally.");
    } catch (error) {
      const text = error?.response?.data?.message || "Auth request failed.";
      setMessage(text);
    }
  }

  async function fetchProfile() {
    const activeToken = localStorage.getItem(tokenKey) || "";
    if (!activeToken) {
      setMessage("No token yet. Log in first.");
      return;
    }

    try {
      const { data } = await api.get("/auth/me", { headers: authHeaders(activeToken) });
      setMe(data.user);
      setMessage("Fetched profile from JWT token.");
    } catch (error) {
      setMessage(error?.response?.data?.message || "Failed to fetch profile.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-8">
      <h1 className="text-2xl font-extrabold text-red-800">Auth (JWT + bcrypt)</h1>

      <div className="flex gap-2">
        <button
          className={`border px-3 py-2 text-sm font-semibold ${mode === "login" ? "border-red-700 bg-red-700 text-white" : "border-red-300 bg-white text-red-800"}`}
          onClick={() => setMode("login")}
          type="button"
        >
          Login
        </button>
        <button
          className={`border px-3 py-2 text-sm font-semibold ${mode === "register" ? "border-red-700 bg-red-700 text-white" : "border-red-300 bg-white text-red-800"}`}
          onClick={() => setMode("register")}
          type="button"
        >
          Register
        </button>
      </div>

      <form onSubmit={onSubmit} className="grid gap-3 border border-red-200 bg-white p-4">
        {mode === "register" && (
          <label className="grid gap-1 text-sm font-semibold text-red-800">
            Name
            <input className="border border-red-200 px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}

        <label className="grid gap-1 text-sm font-semibold text-red-800">
          Email
          <input className="border border-red-200 px-3 py-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label className="grid gap-1 text-sm font-semibold text-red-800">
          Password
          <input className="border border-red-200 px-3 py-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        <button className="border border-red-700 bg-red-700 px-4 py-2 text-sm font-bold text-white" type="submit">
          {mode === "register" ? "Create account" : "Log in"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        <button className="border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800" type="button" onClick={fetchProfile}>
          Fetch /auth/me
        </button>
        <button
          className="border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800"
          type="button"
          onClick={() => {
            localStorage.removeItem(tokenKey);
            setMe(null);
            setMessage("Token removed.");
          }}
        >
          Clear token
        </button>
      </div>

      <p className="border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-900">{message || "No message yet."}</p>
      <pre className="overflow-auto border border-red-200 bg-white p-3 text-xs text-slate-700">
        {JSON.stringify({ tokenExists: !!token, me }, null, 2)}
      </pre>
    </main>
  );
}
