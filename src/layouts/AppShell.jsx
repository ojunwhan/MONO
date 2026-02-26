import React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { MessageCircle, Users, Mic, Settings } from "lucide-react";
import { getAllRooms } from "../db";
import useNetworkStatus from "../hooks/useNetworkStatus";

const TABS = [
  { to: "/interpret", label: "통역", icon: Mic, activeColor: "#7C6FEB", matchPrefixes: ["/interpret"] },
  { to: "/home", label: "채팅", icon: MessageCircle, activeColor: "#F472B6", matchPrefixes: ["/home", "/room"] },
  { to: "/contacts", label: "연락처", icon: Users, activeColor: "#34D399", matchPrefixes: ["/contacts"] },
  { to: "/settings", label: "설정", icon: Settings, activeColor: "#FBBF24", matchPrefixes: ["/settings"] },
];

function tabClass() {
  return [
    "flex-1 h-full flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors duration-200",
    "text-[var(--color-tab-inactive)]",
  ].join(" ");
}

export default function AppShell() {
  const location = useLocation();
  const [unreadTotal, setUnreadTotal] = React.useState(0);
  const { isOnline } = useNetworkStatus();
  const [netBanner, setNetBanner] = React.useState("");
  const pathname = location?.pathname || "/";

  React.useEffect(() => {
    let mounted = true;
    async function loadUnread() {
      const rooms = await getAllRooms();
      if (!mounted) return;
      const total = rooms.reduce((acc, room) => acc + Number(room?.unreadCount || 0), 0);
      setUnreadTotal(total);
    }
    loadUnread().catch(() => {});
    const timer = window.setInterval(() => loadUnread().catch(() => {}), 1500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!isOnline) {
      setNetBanner("인터넷 연결이 끊어졌습니다");
      return;
    }
    setNetBanner("연결되었습니다");
    const timer = window.setTimeout(() => setNetBanner(""), 2000);
    return () => window.clearTimeout(timer);
  }, [isOnline]);

  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg-secondary)] text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-[480px] min-h-[100dvh] pb-[calc(56px+env(safe-area-inset-bottom))] bg-[var(--color-bg)]">
        {netBanner ? (
          <div className={`px-4 py-2 text-[12px] text-white ${isOnline ? "bg-[#34C759]" : "bg-[#FF3B30]"}`}>
            {netBanner}
          </div>
        ) : null}
        <Outlet />
      </div>
      <nav className="fixed bottom-0 left-0 right-0 h-[calc(56px+env(safe-area-inset-bottom))] border-t border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="mx-auto flex h-[56px] w-full max-w-[480px]">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={tabClass}
              style={() => {
                const isActive = (tab.matchPrefixes || []).some(
                  (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
                );
                return { color: isActive ? tab.activeColor : "var(--color-tab-inactive)" };
              }}
            >
              <div className="relative">
                <tab.icon size={24} strokeWidth={1.8} />
                {tab.to === "/home" && unreadTotal > 0 ? (
                  <span className="absolute -top-2 -right-3 min-w-[18px] h-[18px] px-[4px] rounded-full bg-[var(--color-unread)] text-white text-[11px] font-bold leading-[18px] text-center">
                    {unreadTotal > 99 ? "99+" : unreadTotal}
                  </span>
                ) : null}
              </div>
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

