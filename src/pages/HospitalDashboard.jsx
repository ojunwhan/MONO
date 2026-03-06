// src/pages/HospitalDashboard.jsx — 병원 전용 관리 대시보드
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MonoLogo from "../components/MonoLogo";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";
import {
  BarChart3,
  Users,
  Building2,
  FileText,
  ChevronLeft,
  Calendar,
  Search,
  Filter,
  X,
  Eye,
  Printer,
  ChevronDown,
  ChevronUp,
  Globe,
  Clock,
  MessageSquare,
  Activity,
  RefreshCw,
  Download,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ── Constants ──
const MENU_ITEMS = [
  { id: "overview", label: "통계 개요", icon: BarChart3 },
  { id: "history", label: "환자 통역 이력", icon: Users },
  { id: "departments", label: "진료과별 현황", icon: Building2 },
  { id: "reports", label: "보고서 출력", icon: FileText },
];

const LANG_LABELS = {
  ko: "한국어", en: "English", zh: "中文", ja: "日本語", vi: "Tiếng Việt",
  th: "ไทย", ne: "नेपाली", km: "ខ្មែរ", my: "မြန်မာ", id: "Indonesia",
  mn: "Монгол", ru: "Русский", uz: "O'zbek", tl: "Filipino", bn: "বাংলা",
  si: "සිංහල", ar: "العربية", es: "Español", fr: "Français", de: "Deutsch",
  pt: "Português", hi: "हिन्दी",
};

const CHART_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
];

const DEPT_MAP = {};
HOSPITAL_DEPARTMENTS.forEach((d) => { DEPT_MAP[d.id] = d; });

function getLangLabel(code) {
  return LANG_LABELS[code?.toLowerCase()] || code?.toUpperCase() || "-";
}

function getDeptLabel(id) {
  return DEPT_MAP[id]?.labelKo || id || "-";
}

function getDeptIcon(id) {
  return DEPT_MAP[id]?.icon || "🏥";
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return dateStr; }
}

function formatDateShort(dateStr) {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString("ko-KR", {
      month: "2-digit", day: "2-digit",
    });
  } catch { return dateStr; }
}

function formatTime(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleTimeString("ko-KR", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return ""; }
}

function todayStr() { return new Date().toISOString().split("T")[0]; }
function weekAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
}
function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function HospitalDashboard() {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-[100dvh] flex bg-[var(--color-bg-secondary)]">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-[240px]" : "w-0 overflow-hidden"
        } transition-all duration-300 bg-[var(--color-bg)] border-r border-[var(--color-border)] flex-shrink-0 flex flex-col`}
      >
        {/* Logo */}
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <MonoLogo />
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold tracking-[2px] text-[#7C6FEB] uppercase">
                Hospital
              </span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">
                Dashboard
              </span>
            </div>
          </div>
        </div>

        {/* Menu */}
        <nav className="flex-1 py-3">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeMenu === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveMenu(item.id)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#3B82F6] border-r-2 border-[#3B82F6]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Back button */}
        <div className="p-4 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => navigate("/hospital")}
            className="w-full flex items-center justify-center gap-2 h-[40px] rounded-[10px] border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            <ChevronLeft size={14} />
            병원 모드로 돌아가기
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-[var(--color-bg)] border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden w-9 h-9 rounded-[8px] flex items-center justify-center border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]"
          >
            {sidebarOpen ? <X size={16} /> : <BarChart3 size={16} />}
          </button>
          <h1 className="text-[16px] font-semibold text-[var(--color-text)]">
            {MENU_ITEMS.find((m) => m.id === activeMenu)?.label || "대시보드"}
          </h1>
        </header>

        {/* Content */}
        <div className="p-6">
          {activeMenu === "overview" && <OverviewPanel />}
          {activeMenu === "history" && <HistoryPanel />}
          {activeMenu === "departments" && <DepartmentsPanel />}
          {activeMenu === "reports" && <ReportsPanel />}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════
// 1. OVERVIEW PANEL — 통계 개요
// ═══════════════════════════════════════════
function OverviewPanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/hospital/dashboard/stats");
      const data = await r.json();
      if (data.success) setStats(data);
    } catch (e) {
      console.error("stats fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // All hooks MUST be called before any conditional returns
  const dailyChart = useMemo(() => {
    if (!stats?.dailyStats) return [];
    const map = {};
    stats.dailyStats.forEach((d) => { map[d.date] = d.count; });
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const key = dt.toISOString().split("T")[0];
      result.push({ date: formatDateShort(key), count: map[key] || 0 });
    }
    return result;
  }, [stats?.dailyStats]);

  const langChart = useMemo(() => {
    if (!stats?.languageStats) return [];
    return stats.languageStats.map((l) => ({
      name: getLangLabel(l.language),
      value: l.count,
    }));
  }, [stats?.languageStats]);

  if (loading) return <LoadingSpinner />;
  if (!stats) return <EmptyState text="통계 데이터를 불러올 수 없습니다." />;

  const cards = [
    { label: "오늘 통역 건수", value: stats.todayCount, icon: Activity, color: "#3B82F6" },
    { label: "이번 달 누적", value: stats.monthCount, icon: Calendar, color: "#10B981" },
    { label: "사용 언어 종류", value: stats.languageCount, icon: Globe, color: "#F59E0B" },
    { label: "평균 통역 시간(분)", value: stats.avgDuration || 0, icon: Clock, color: "#8B5CF6" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)] hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] text-[var(--color-text-secondary)] font-medium">
                  {card.label}
                </span>
                <div
                  className="w-9 h-9 rounded-[10px] flex items-center justify-center"
                  style={{ backgroundColor: card.color + "15" }}
                >
                  <Icon size={18} style={{ color: card.color }} />
                </div>
              </div>
              <p className="text-[28px] font-bold text-[var(--color-text)]">
                {card.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar chart — 7-day */}
        <div className="lg:col-span-2 p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text)]">
            최근 7일 일별 통역 건수
          </h3>
          {dailyChart.every((d) => d.count === 0) ? (
            <EmptyState text="최근 7일간 통역 기록이 없습니다." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "10px",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" name="건수" fill="#3B82F6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pie chart — language */}
        <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text)]">
            언어별 비율
          </h3>
          {langChart.length === 0 ? (
            <EmptyState text="언어 데이터가 없습니다." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={langChart}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {langChart.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "10px",
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Refresh */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={fetchStats}
          className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)] hover:text-[#3B82F6] transition-colors"
        >
          <RefreshCw size={14} />
          새로고침
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// 2. HISTORY PANEL — 환자 통역 이력
// ═══════════════════════════════════════════
function HistoryPanel() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [startDate, setStartDate] = useState(monthStartStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [department, setDepartment] = useState("");
  const [language, setLanguage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Modal
  const [selectedSession, setSelectedSession] = useState(null);
  const [modalMessages, setModalMessages] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);

  const fetchSessions = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pg,
        limit: 20,
        startDate,
        endDate,
      });
      if (department) params.set("department", department);
      if (language) params.set("language", language);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const r = await fetch(`/api/hospital/dashboard/sessions?${params}`);
      const data = await r.json();
      if (data.success) {
        setSessions(data.sessions || []);
        setTotal(data.total || 0);
        setPage(data.page || 1);
        setTotalPages(data.totalPages || 1);
      }
    } catch (e) {
      console.error("sessions fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, department, language, searchQuery]);

  useEffect(() => { fetchSessions(1); }, [fetchSessions]);

  const openDetail = async (session) => {
    setSelectedSession(session);
    setModalLoading(true);
    setModalMessages([]);
    try {
      const r = await fetch(`/api/hospital/sessions/${session.id}/messages`);
      const data = await r.json();
      if (data.success) setModalMessages(data.messages || []);
    } catch (e) {
      console.error("messages fetch failed:", e);
    } finally {
      setModalLoading(false);
    }
  };

  const handlePrint = (session, messages) => {
    printConversation(session, messages);
  };

  return (
    <div className="space-y-4">
      {/* Filter Toggle */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] transition-colors"
        >
          <Filter size={14} />
          필터 {showFilters ? "접기" : "펼치기"}
          {showFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          총 {total}건
        </span>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="p-4 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Date range */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                시작일
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-[36px] px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[12px] focus:outline-none focus:border-[#3B82F6]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                종료일
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full h-[36px] px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[12px] focus:outline-none focus:border-[#3B82F6]"
              />
            </div>

            {/* Department */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                진료과
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full h-[36px] px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[12px] focus:outline-none focus:border-[#3B82F6]"
              >
                <option value="">전체</option>
                {HOSPITAL_DEPARTMENTS.map((d) => (
                  <option key={d.id} value={d.id}>{d.icon} {d.labelKo}</option>
                ))}
              </select>
            </div>

            {/* Language */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
                사용 언어
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full h-[36px] px-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[12px] focus:outline-none focus:border-[#3B82F6]"
              >
                <option value="">전체</option>
                {Object.entries(LANG_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="차트번호 또는 방 ID로 검색"
              className="w-full h-[36px] pl-9 pr-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[12px] focus:outline-none focus:border-[#3B82F6]"
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)] overflow-hidden">
        {loading ? (
          <LoadingSpinner />
        ) : sessions.length === 0 ? (
          <EmptyState text="통역 기록이 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["날짜/시간", "차트번호", "진료과", "사용 언어", "통역 시간", "메시지 수", "액션"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      {formatDate(s.created_at)}
                    </td>
                    <td className="px-4 py-3 text-[12px] font-mono text-[var(--color-text)]">
                      {s.chart_number || "-"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      <span className="flex items-center gap-1.5">
                        <span>{getDeptIcon(s.department)}</span>
                        {getDeptLabel(s.department)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      <span className="flex items-center gap-1">
                        <Globe size={12} className="text-[var(--color-text-secondary)]" />
                        {getLangLabel(s.host_lang)} → {getLangLabel(s.guest_lang)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      {s.duration_min != null ? `${s.duration_min}분` : "-"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      <span className="flex items-center gap-1">
                        <MessageSquare size={12} className="text-[var(--color-text-secondary)]" />
                        {s.message_count || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openDetail(s)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-medium text-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] transition-colors"
                        >
                          <Eye size={12} />
                          상세
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => fetchSessions(page - 1)}
            className="px-3 py-1.5 rounded-[8px] border border-[var(--color-border)] text-[12px] disabled:opacity-40 hover:bg-[var(--color-bg)] transition-colors"
          >
            이전
          </button>
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => fetchSessions(page + 1)}
            className="px-3 py-1.5 rounded-[8px] border border-[var(--color-border)] text-[12px] disabled:opacity-40 hover:bg-[var(--color-bg)] transition-colors"
          >
            다음
          </button>
        </div>
      )}

      {/* Session Detail Modal */}
      {selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          messages={modalMessages}
          loading={modalLoading}
          onClose={() => setSelectedSession(null)}
          onPrint={() => handlePrint(selectedSession, modalMessages)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// 3. DEPARTMENTS PANEL — 진료과별 현황
// ═══════════════════════════════════════════
function DepartmentsPanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/hospital/dashboard/stats");
        const data = await r.json();
        if (data.success) setStats(data);
      } catch (e) {
        console.error("dept stats failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!stats?.deptStats?.length) return <EmptyState text="진료과별 데이터가 없습니다." />;

  const totalSessions = stats.deptStats.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="p-4 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
        <h3 className="text-[14px] font-semibold text-[var(--color-text)] mb-3">
          진료과별 이용 비율
        </h3>
        <div className="flex h-[24px] rounded-full overflow-hidden bg-[var(--color-bg-secondary)]">
          {stats.deptStats.map((d, i) => {
            const pct = totalSessions > 0 ? (d.count / totalSessions) * 100 : 0;
            if (pct < 1) return null;
            return (
              <div
                key={d.department}
                title={`${getDeptLabel(d.department)}: ${d.count}건 (${pct.toFixed(1)}%)`}
                className="transition-all"
                style={{
                  width: `${pct}%`,
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                  minWidth: pct > 0 ? "4px" : "0",
                }}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          {stats.deptStats.map((d, i) => (
            <span key={d.department} className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              {getDeptIcon(d.department)} {getDeptLabel(d.department)} ({d.count})
            </span>
          ))}
        </div>
      </div>

      {/* Department cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.deptStats.map((d, i) => (
          <div
            key={d.department}
            className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)] hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[28px]">{getDeptIcon(d.department)}</span>
              <div>
                <h4 className="text-[14px] font-semibold text-[var(--color-text)]">
                  {getDeptLabel(d.department)}
                </h4>
                <span className="text-[10px] text-[var(--color-text-secondary)]">
                  {DEPT_MAP[d.department]?.label || d.department}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className="text-[18px] font-bold text-[var(--color-text)]">{d.count}</p>
                <p className="text-[10px] text-[var(--color-text-secondary)]">총 건수</p>
              </div>
              <div className="text-center">
                <p className="text-[18px] font-bold text-green-500">{d.active_count || 0}</p>
                <p className="text-[10px] text-[var(--color-text-secondary)]">진행 중</p>
              </div>
              <div className="text-center">
                <p className="text-[18px] font-bold text-[#F59E0B]">{d.lang_count || 0}</p>
                <p className="text-[10px] text-[var(--color-text-secondary)]">언어 수</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// 4. REPORTS PANEL — 보고서 출력
// ═══════════════════════════════════════════
function ReportsPanel() {
  const [startDate, setStartDate] = useState(monthStartStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [generating, setGenerating] = useState(false);

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      // Fetch stats for the period
      const statsR = await fetch(`/api/hospital/dashboard/stats?startDate=${startDate}&endDate=${endDate}`);
      const statsData = await statsR.json();

      // Fetch sessions for the period
      const sessR = await fetch(`/api/hospital/dashboard/sessions?startDate=${startDate}&endDate=${endDate}&limit=100`);
      const sessData = await sessR.json();

      // Generate a printable report
      printReport(statsData, sessData?.sessions || [], startDate, endDate);
    } catch (e) {
      console.error("report generation failed:", e);
      alert("보고서 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadCSV = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`/api/hospital/dashboard/sessions?startDate=${startDate}&endDate=${endDate}&limit=1000`);
      const data = await r.json();
      if (!data.success || !data.sessions?.length) {
        alert("내보낼 데이터가 없습니다.");
        return;
      }

      const BOM = "\uFEFF";
      const header = "날짜,차트번호,진료과,호스트언어,환자언어,통역시간(분),메시지수,상태\n";
      const rows = data.sessions.map((s) => {
        return [
          s.created_at || "",
          s.chart_number || "",
          getDeptLabel(s.department),
          getLangLabel(s.host_lang),
          getLangLabel(s.guest_lang),
          s.duration_min ?? "",
          s.message_count || 0,
          s.status === "active" ? "진행중" : "종료",
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
      }).join("\n");

      const blob = new Blob([BOM + header + rows], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `MONO_hospital_report_${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error("CSV export failed:", e);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Date selection */}
      <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
        <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text)]">
          📄 보고서 기간 설정
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
              시작일
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[13px] focus:outline-none focus:border-[#3B82F6]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">
              종료일
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-[40px] px-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[13px] focus:outline-none focus:border-[#3B82F6]"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-[#3B82F6] text-white text-[13px] font-medium hover:bg-[#2563EB] disabled:opacity-50 transition-colors"
          >
            <Printer size={14} />
            {generating ? "생성 중..." : "보고서 인쇄"}
          </button>
          <button
            type="button"
            onClick={handleDownloadCSV}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-50 transition-colors"
          >
            <Download size={14} />
            CSV 다운로드
          </button>
        </div>
      </div>

      {/* Quick presets */}
      <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
        <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text)]">
          빠른 기간 선택
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "오늘", start: todayStr(), end: todayStr() },
            { label: "최근 7일", start: weekAgoStr(), end: todayStr() },
            { label: "이번 달", start: monthStartStr(), end: todayStr() },
            {
              label: "지난 달",
              start: (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })(),
              end: (() => { const d = new Date(); d.setDate(0); return d.toISOString().split("T")[0]; })(),
            },
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => { setStartDate(p.start); setEndDate(p.end); }}
              className="px-4 py-2 rounded-full border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[#EFF6FF] hover:text-[#3B82F6] hover:border-[#3B82F6] dark:hover:bg-[#1E3A5F] transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// SESSION DETAIL MODAL
// ═══════════════════════════════════════════
function SessionDetailModal({ session, messages, loading, onClose, onPrint }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[640px] max-h-[85vh] bg-[var(--color-bg)] rounded-[20px] border border-[var(--color-border)] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--color-text)]">
              통역 상세 기록
            </h2>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--color-text-secondary)]">
              <span>{getDeptIcon(session.department)} {getDeptLabel(session.department)}</span>
              <span>차트: {session.chart_number || "-"}</span>
              <span>{formatDate(session.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrint}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              title="PDF 출력"
            >
              <Printer size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Session info */}
        <div className="px-5 py-3 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] flex items-center gap-4 text-[11px] text-[var(--color-text-secondary)]">
          <span className="flex items-center gap-1">
            <Globe size={12} />
            {getLangLabel(session.host_lang)} ↔ {getLangLabel(session.guest_lang)}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {session.duration_min != null ? `${session.duration_min}분` : "-"}
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare size={12} />
            {messages.length}건
          </span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
            session.status === "active"
              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          }`}>
            {session.status === "active" ? "진행 중" : "종료"}
          </span>
        </div>

        {/* Messages scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <LoadingSpinner />
          ) : messages.length === 0 ? (
            <EmptyState text="대화 내용이 없습니다." />
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender_role === "host" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-[14px] ${
                    msg.sender_role === "host"
                      ? "bg-[#EFF6FF] dark:bg-[#1E3A5F] border border-blue-200 dark:border-blue-800"
                      : "bg-[#F0FDF4] dark:bg-[#14532D] border border-green-200 dark:border-green-800"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold">
                      {msg.sender_role === "host" ? "🩺 의료진" : "🧑 환자"}
                    </span>
                    <span className="text-[9px] text-[var(--color-text-secondary)]">
                      {msg.sender_lang?.toUpperCase()} · {formatTime(msg.created_at)}
                    </span>
                  </div>
                  <p className="text-[13px] text-[var(--color-text)]">{msg.original_text}</p>
                  {msg.translated_text && (
                    <p className="text-[12px] text-[#3B82F6] mt-1">→ {msg.translated_text}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// PRINT / PDF helpers
// ═══════════════════════════════════════════
function printConversation(session, messages) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>MONO 통역 기록 - ${session.chart_number || "N/A"}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
      .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #3B82F6; padding-bottom: 20px; }
      .header h1 { font-size: 20px; color: #3B82F6; }
      .header p { font-size: 12px; color: #666; margin-top: 4px; }
      .info { display: flex; gap: 20px; margin-bottom: 24px; padding: 12px; background: #f8f9fa; border-radius: 8px; font-size: 12px; }
      .info span { display: inline-flex; align-items: center; gap: 4px; }
      .messages { border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; }
      .msg { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; }
      .msg:last-child { border-bottom: none; }
      .msg.host { background: #f0f7ff; }
      .msg.guest { background: #f0fdf4; }
      .msg-header { font-size: 10px; color: #666; margin-bottom: 4px; }
      .msg-text { font-size: 13px; }
      .msg-translated { font-size: 12px; color: #3B82F6; margin-top: 4px; }
      .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #999; }
      @media print { body { padding: 20px; } }
    </style></head><body>
    <div class="header">
      <h1>MONO Hospital - 통역 기록</h1>
      <p>Medical Interpretation Record</p>
    </div>
    <div class="info">
      <span>📅 ${session.created_at || "-"}</span>
      <span>🏥 ${getDeptLabel(session.department)}</span>
      <span>📋 차트: ${session.chart_number || "-"}</span>
      <span>🌐 ${getLangLabel(session.host_lang)} ↔ ${getLangLabel(session.guest_lang)}</span>
      <span>💬 ${messages.length}건</span>
    </div>
    <div class="messages">
      ${messages.map((m) => `
        <div class="msg ${m.sender_role === "host" ? "host" : "guest"}">
          <div class="msg-header">${m.sender_role === "host" ? "🩺 의료진" : "🧑 환자"} · ${m.sender_lang?.toUpperCase() || ""} · ${formatTime(m.created_at)}</div>
          <div class="msg-text">${escapeHtml(m.original_text || "")}</div>
          ${m.translated_text ? `<div class="msg-translated">→ ${escapeHtml(m.translated_text)}</div>` : ""}
        </div>
      `).join("")}
    </div>
    <div class="footer">
      <p>Powered by MONO Medical Interpreter (lingora.chat)</p>
      <p>출력일: ${new Date().toLocaleString("ko-KR")}</p>
    </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function printReport(stats, sessions, startDate, endDate) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>MONO 병원 통역 보고서</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
      .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #3B82F6; padding-bottom: 20px; }
      .header h1 { font-size: 22px; color: #3B82F6; }
      .header p { font-size: 12px; color: #666; margin-top: 6px; }
      .section { margin-bottom: 24px; }
      .section h2 { font-size: 16px; margin-bottom: 10px; color: #333; }
      .cards { display: flex; gap: 16px; margin-bottom: 24px; }
      .card { flex: 1; padding: 16px; border: 1px solid #e5e5e5; border-radius: 10px; text-align: center; }
      .card .value { font-size: 28px; font-weight: bold; color: #3B82F6; }
      .card .label { font-size: 11px; color: #666; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #f8f9fa; padding: 8px 10px; text-align: left; border-bottom: 2px solid #e5e5e5; font-weight: 600; }
      td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
      .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #999; }
      @media print { body { padding: 20px; } .no-print { display: none; } }
    </style></head><body>
    <div class="header">
      <h1>MONO Hospital - 통역 보고서</h1>
      <p>${startDate} ~ ${endDate}</p>
    </div>
    <div class="cards">
      <div class="card"><div class="value">${stats?.todayCount ?? 0}</div><div class="label">오늘 건수</div></div>
      <div class="card"><div class="value">${stats?.monthCount ?? 0}</div><div class="label">월 누적</div></div>
      <div class="card"><div class="value">${stats?.languageCount ?? 0}</div><div class="label">언어 수</div></div>
      <div class="card"><div class="value">${stats?.avgDuration ?? 0}</div><div class="label">평균 시간(분)</div></div>
    </div>
    <div class="section">
      <h2>통역 세션 목록</h2>
      <table>
        <thead><tr><th>날짜</th><th>차트번호</th><th>진료과</th><th>언어</th><th>시간</th><th>메시지</th><th>상태</th></tr></thead>
        <tbody>
          ${sessions.map((s) => `<tr>
            <td>${s.created_at || "-"}</td>
            <td>${s.chart_number || "-"}</td>
            <td>${getDeptLabel(s.department)}</td>
            <td>${getLangLabel(s.host_lang)} → ${getLangLabel(s.guest_lang)}</td>
            <td>${s.duration_min != null ? s.duration_min + "분" : "-"}</td>
            <td>${s.message_count || 0}</td>
            <td>${s.status === "active" ? "진행 중" : "종료"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${stats?.languageStats?.length ? `
    <div class="section">
      <h2>언어별 통계</h2>
      <table>
        <thead><tr><th>언어</th><th>건수</th></tr></thead>
        <tbody>${stats.languageStats.map((l) => `<tr><td>${getLangLabel(l.language)}</td><td>${l.count}</td></tr>`).join("")}</tbody>
      </table>
    </div>` : ""}
    <div class="footer">
      <p>Powered by MONO Medical Interpreter (lingora.chat)</p>
      <p>출력일: ${new Date().toLocaleString("ko-KR")}</p>
    </div>
  </body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ═══════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="text-center py-12">
      <p className="text-[13px] text-[var(--color-text-secondary)]">{text}</p>
    </div>
  );
}
