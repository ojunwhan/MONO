import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { MessageCircle, Users, Mic, Globe2, Settings } from "lucide-react";

const TABS = [
  { to: "/home", label: "홈", icon: MessageCircle },
  { to: "/contacts", label: "연락처", icon: Users },
  { to: "/interpret", label: "통역", icon: Mic },
  { to: "/global", label: "글로벌", icon: Globe2 },
  { to: "/settings", label: "설정", icon: Settings },
];

function tabClass({ isActive }) {
  return [
    "flex-1 h-full flex flex-col items-center justify-center gap-[2px] text-[11px] font-medium transition-colors",
    isActive ? "text-[#111]" : "text-[#777]",
  ].join(" ");
}

export default function AppShell() {
  return (
    <div className="min-h-[100dvh] bg-[#FAFAFF] text-[#111]">
      <div className="mx-auto w-full max-w-[420px] min-h-[100dvh] pb-[64px]">
        <Outlet />
      </div>
      <nav className="fixed bottom-0 left-0 right-0 h-[60px] border-t border-[#E5E7EB] bg-white">
        <div className="mx-auto flex h-full w-full max-w-[420px]">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} className={tabClass}>
              <tab.icon size={18} strokeWidth={2.2} />
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

