import { Link, Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import AuthPage from "./pages/AuthPage";
import ChatPage from "./pages/ChatPage";

function LegacyView({ path }) {
  const legacyBase = (import.meta.env.VITE_LEGACY_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");
  const src = `${legacyBase}${path.startsWith("/") ? path : `/${path}`}`;
  return (
    <div className="min-h-screen bg-[#fff7f8]">
      <iframe
        title={`legacy-${path}`}
        src={src}
        className="h-screen w-full border-0"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/chat" element={<ChatPage />} />

      {/* React route layer, exact legacy visuals */}
      <Route path="/portal" element={<LegacyView path="/preview" />} />
      <Route path="/portal/announcements" element={<LegacyView path="/announcements" />} />
      <Route path="/portal/lost-found" element={<LegacyView path="/lost-and-found" />} />

      <Route path="/admin-react" element={<LegacyView path="/admin/dashboard" />} />
      <Route path="/admin-react/announcements" element={<LegacyView path="/admin/modules/announcements" />} />

      <Route
        path="*"
        element={
          <div className="min-h-screen bg-[#fff7f8] px-4 py-8">
            <div className="mx-auto flex max-w-4xl flex-col gap-3 border border-red-200 bg-white p-5">
              <h1 className="text-xl font-extrabold text-red-800">Route not found</h1>
              <Link className="text-sm font-semibold text-red-700 underline" to="/">
                Back to home
              </Link>
            </div>
          </div>
        }
      />
    </Routes>
  );
}

export default App;
