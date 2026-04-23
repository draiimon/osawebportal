import { Link, NavLink } from "react-router-dom";

function menuClass({ isActive }) {
  return `border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${
    isActive ? "border-white bg-white text-red-700" : "border-red-200 text-white hover:bg-red-800"
  }`;
}

export default function PortalLayout({ children }) {
  return (
    <div className="min-h-screen bg-[#fff7f8]">
      <header className="border-b-2 border-red-900 bg-red-700 text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="text-lg font-extrabold tracking-wide">
              OSA Portal React
            </Link>
            <a href="http://localhost:8787/preview" className="text-xs font-semibold text-red-100 underline">
              Open legacy UI
            </a>
          </div>
          <nav className="flex flex-wrap gap-2">
            <NavLink to="/portal" end className={menuClass}>
              Student Home
            </NavLink>
            <NavLink to="/portal/announcements" className={menuClass}>
              Announcements
            </NavLink>
            <NavLink to="/portal/lost-found" className={menuClass}>
              Lost and Found
            </NavLink>
            <NavLink to="/chat" className={menuClass}>
              Live Chat
            </NavLink>
            <NavLink to="/admin-react" end className={menuClass}>
              Admin Home
            </NavLink>
            <NavLink to="/admin-react/announcements" className={menuClass}>
              Admin Announcements
            </NavLink>
            <NavLink to="/auth" className={menuClass}>
              Auth
            </NavLink>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
