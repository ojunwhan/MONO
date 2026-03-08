import { useEffect, useState } from "react";
import { Outlet, useNavigate, NavLink } from "react-router-dom";
import { Building2, LogOut } from "lucide-react";

const NAV_ITEMS = [
  { to: "/admin/orgs", icon: Building2, label: "기관 관리" },
  // 추후 확장:
  // { to: "/admin/dashboard", icon: LayoutDashboard, label: "대시보드" },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  // 인증 확인
  useEffect(() => {
    fetch("/api/admin/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setAuthed(true);
        } else {
          navigate("/admin", { replace: true });
        }
      })
      .catch(() => navigate("/admin", { replace: true }))
      .finally(() => setChecking(false));
  }, [navigate]);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "include",
    });
    navigate("/admin", { replace: true });
  };

  if (checking) {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">인증 확인 중...</div>
      </div>
    );
  }

  if (!authed) return null;

  return (
    <div className="min-h-[100dvh] bg-gray-950 flex">
      {/* ── Sidebar ── */}
      <aside className="w-[220px] bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="px-5 py-6 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white tracking-wide">
            <span className="text-indigo-400">MONO</span>{" "}
            <span className="text-gray-300 font-normal text-sm">Admin</span>
          </h1>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors w-full"
          >
            <LogOut size={18} />
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
