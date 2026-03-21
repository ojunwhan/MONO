// src/pages/HospitalDashboard.jsx — 병원 전용 관리 대시보드
import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import MonoLogo from "../components/MonoLogo";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";
import { getLanguageByCode } from "../constants/languages";
import {
  BarChart3,
  Users,
  Building2,
  FileText,
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
  Copy,
  LayoutGrid,
  Plus,
  Check,
  Trash2,
  Monitor,
  Tablet,
  Mic,
  MicOff,
  Sparkles,
} from "lucide-react";
const QRCode = lazy(() => import("react-qr-code").then((m) => ({ default: m.default })));
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
  { id: "rooms", label: "\uBC29 \uB9CC\uB4E4\uAE30", icon: LayoutGrid },
  { id: "reports", label: "보고서 출력", icon: FileText },
  { id: "usage-billing", label: "사용량 & 요금", icon: FileText },
  { id: "ai-summary", label: "AI 요약", icon: Sparkles },
];

const LANG_LABELS = {
  ko: "한국어", en: "English", zh: "中文", ja: "日本語", vi: "Tiếng Việt",
  th: "ไทย", ne: "नेपाली", km: "ខ្មែរ", my: "မြန်မာ", id: "Indonesia",
  mn: "Монгол", ru: "Русский", uz: "O'zbek", tl: "Filipino", bn: "বাংলা",
  si: "සිංහල", ar: "العربية", es: "Español", fr: "Français", de: "Deutsch",
  pt: "Português", hi: "हिन्दी",
};

const LANG_NAMES_KO = {
  ko: "한국어", en: "영어", zh: "중국어", ja: "일본어", vi: "베트남어",
  th: "태국어", ne: "네팔어", km: "크메르어", my: "미얀마어", id: "인도네시아어",
  mn: "몽골어", ru: "러시아어", uz: "우즈베크어", tl: "필리핀어", bn: "벵골어",
  si: "싱할라어", ar: "아랍어", es: "스페인어", fr: "프랑스어", de: "독일어",
  pt: "포르투갈어", hi: "힌디어",
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

function getLangDisplay(code) {
  const L = getLanguageByCode(code);
  return L ? `${L.flag} ${L.name}` : (code ? String(code).toUpperCase() : "-");
}

function formatChartNumber(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^PT-[A-Z0-9]{6}$/i.test(s)) return s.toUpperCase();
  const alnum = s.replace(/[^A-Za-z0-9]/g, "");
  const last6 = alnum.slice(-6).toUpperCase().padStart(6, "0").slice(-6);
  return last6 ? "PT-" + last6 : "";
}

function getLanguageNameKo(code) {
  return LANG_NAMES_KO[code?.toLowerCase()] || code?.toUpperCase() || "-";
}

function getDeptLabel(id) {
  if (id == null || id === "") return "미지정";
  return DEPT_MAP[id]?.labelKo || id || "미지정";
}

function getDeptIcon(id) {
  return DEPT_MAP[id]?.icon || "🏥";
}

function parseAsUTC(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (/Z|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s + "Z");
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = parseAsUTC(dateStr);
    if (!d || isNaN(d.getTime())) return "-";
    return d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return dateStr; }
}

function formatDateShort(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = parseAsUTC(dateStr);
    if (!d || isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit", day: "2-digit",
    });
  } catch { return dateStr; }
}

function formatTime(dateStr) {
  if (!dateStr) return "";
  try {
    const d = parseAsUTC(dateStr);
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ko-KR", {
      timeZone: "Asia/Seoul",
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

/** Append org_code to URL for org-scoped dashboard API requests. */
function urlWithOrg(url, orgCode) {
  if (!orgCode) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}org_code=${encodeURIComponent(orgCode)}`;
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function HospitalDashboard() {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("pending");
  const [aiSummaries, setAiSummaries] = useState([]);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummarySearch, setAiSummarySearch] = useState("");
  const [aiSummarySearchInput, setAiSummarySearchInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/hospital/auth/me", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.authenticated) {
          navigate("/hospital-login?redirect=" + encodeURIComponent("/hospital-dashboard"), { replace: true });
          return;
        }
        setAuthUser({ org_code: data.org_code, email: data.email, role: data.role });
        setAuthStatus("allowed");
      } catch {
        if (!cancelled) {
          navigate("/hospital-login?redirect=" + encodeURIComponent("/hospital-dashboard"), { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const fetchAiSummaries = useCallback(async (ptNumber = "") => {
    setAiSummaryLoading(true);
    try {
      let url = urlWithOrg("/api/hospital/ai-summaries", authUser?.org_code);
      if (ptNumber.trim()) url += `&pt_number=${encodeURIComponent(ptNumber.trim())}`;
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json();
      if (data.success) setAiSummaries(data.summaries || []);
    } catch (e) {
      console.error("ai-summaries fetch error", e);
    } finally {
      setAiSummaryLoading(false);
    }
  }, [authUser?.org_code]);

  useEffect(() => {
    if (activeMenu === "ai-summary") fetchAiSummaries();
  }, [activeMenu, fetchAiSummaries]);

  if (authStatus === "pending") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg-secondary)]">
        <LoadingSpinner />
      </div>
    );
  }

  if (authStatus !== "allowed") return null;

  return (
    <div className="min-h-[100dvh] flex bg-[var(--color-bg-secondary)]">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-[240px]" : "w-0 overflow-hidden"
        } transition-all duration-300 bg-[var(--color-bg)] border-r border-[var(--color-border)] flex-shrink-0 flex flex-col h-[100dvh]`}
      >
        {/* Logo */}
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3 min-w-0">
            <MonoLogo />
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] font-bold text-[#7C6FEB] whitespace-nowrap">
                병원 관리
              </span>
              <span className="text-[10px] text-[var(--color-text-secondary)] whitespace-nowrap">
                대시보드
              </span>
            </div>
          </div>
        </div>

        {/* Menu — render all MENU_ITEMS with index-stable keys so every item mounts */}
        <nav className="flex-1 py-3 overflow-y-auto" aria-label="대시보드 메뉴">
          {MENU_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeMenu === item.id;
            return (
              <button
                key={`sidebar-${index}-${item.id}`}
                type="button"
                onClick={() => setActiveMenu(item.id)}
                className={`w-full flex items-center gap-3 px-5 py-2 text-left text-[13px] font-semibold transition-colors ${
                  isActive
                    ? "bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#2563EB] border-r-2 border-[#2563EB]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                {Icon ? <Icon size={18} /> : null}
                {item.label}
              </button>
            );
          })}
        </nav>
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
          <button
            type="button"
            onClick={() => { window.location.href = "/hospital?template=reception"; }}
            className="ml-auto text-[13px] text-[var(--color-text-secondary)] hover:text-[#2563EB] transition-colors"
          >
            ← 통역 대기창
          </button>
        </header>

        {/* Content */}
        <div className="p-6">
          {activeMenu === "overview" && <OverviewPanel authUser={authUser} />}
          {activeMenu === "history" && <HistoryPanel authUser={authUser} />}
          {activeMenu === "departments" && <DepartmentsPanel authUser={authUser} />}
          {activeMenu === "rooms" && <RoomsPanel authUser={authUser} />}
          {activeMenu === "reports" && <ReportsPanel authUser={authUser} />}
          {activeMenu === "usage-billing" && <UsageBillingTab authUser={authUser} />}
          {activeMenu === "ai-summary" && (
            <div style={{ padding: "24px" }}>
              <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
                <input
                  type="text"
                  placeholder="PT 번호 검색 (예: PT-XXXXXX)"
                  value={aiSummarySearchInput}
                  onChange={(e) => setAiSummarySearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setAiSummarySearch(aiSummarySearchInput);
                      fetchAiSummaries(aiSummarySearchInput);
                    }
                  }}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "14px" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setAiSummarySearch(aiSummarySearchInput);
                    fetchAiSummaries(aiSummarySearchInput);
                  }}
                  style={{ padding: "8px 20px", borderRadius: "8px", background: "#6366f1", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}
                >
                  검색
                </button>
                {aiSummarySearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setAiSummarySearchInput("");
                      setAiSummarySearch("");
                      fetchAiSummaries("");
                    }}
                    style={{ padding: "8px 16px", borderRadius: "8px", background: "#f3f4f6", color: "#374151", border: "none", cursor: "pointer" }}
                  >
                    초기화
                  </button>
                )}
              </div>
              {aiSummaryLoading ? (
                <div style={{ textAlign: "center", color: "#9ca3af", padding: "48px" }}>불러오는 중...</div>
              ) : aiSummaries.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9ca3af", padding: "48px" }}>아직 생성된 AI 요약이 없습니다</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {aiSummaries.map((item) => (
                    <div key={item.session_id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <span style={{ fontWeight: 700, fontSize: "16px", color: "#111827" }}>{item.pt_number}</span>
                        <span style={{ fontSize: "12px", color: "#6b7280" }}>
                          {item.created_at ? new Date(item.created_at).toLocaleString("ko-KR") : ""}
                        </span>
                      </div>
                      {(item.patient_name || item.patient_lang) && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                          {item.patient_lang && (
                            <img
                              src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${(() => { const flag = { en: '1f1fa-1f1f8', zh: '1f1e8-1f1f3', ja: '1f1ef-1f1f5', vi: '1f1fb-1f1f3', th: '1f1f9-1f1ed', ko: '1f1f0-1f1f7', ru: '1f1f7-1f1fa', es: '1f1ea-1f1f8', fr: '1f1eb-1f1f7', de: '1f1e9-1f1ea', pt: '1f1e7-1f1f7', ar: '1f1f8-1f1e6', hi: '1f1ee-1f1f3', id: '1f1ee-1f1e9', ms: '1f1f2-1f1fe', tl: '1f1f5-1f1ed', mn: '1f1f2-1f1f3', my: '1f1f2-1f1f2', km: '1f1f0-1f1ed', lo: '1f1f1-1f1e6', ne: '1f1f3-1f1f5', bn: '1f1e7-1f1e9', ur: '1f1f5-1f1f0', tr: '1f1f9-1f1f7', uk: '1f1fa-1f1e6', pl: '1f1f5-1f1f1', it: '1f1ee-1f1f9', nl: '1f1f3-1f1f1', sv: '1f1f8-1f1ea', ka: '1f1ec-1f1ea' }; return flag[item.patient_lang] || '1f310'; })()}.svg`}
                              alt={item.patient_lang}
                              width={20}
                              height={18}
                              style={{ borderRadius: "2px", objectFit: "cover" }}
                              onError={(e) => { e.target.style.display = "none"; }}
                            />
                          )}
                          <span style={{ fontSize: "13px", color: "#374151", fontWeight: 500 }}>
                            {item.patient_name || "-"}
                          </span>
                          {item.patient_lang && (
                            <span style={{ fontSize: "12px", color: "#9ca3af" }}>{item.patient_lang}</span>
                          )}
                        </div>
                      )}
                      {item.ai_summary && typeof item.ai_summary === "object" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                            <button
                              type="button"
                              onClick={() => {
                                const s = item.ai_summary || {};
                                const labelMap = { cc: "C.C", consulted_procedures: "\uC0C1\uB2F4 \uC2DC\uC220", patient_requests: "\uD658\uC790 \uC694\uCCAD", budget: "\uC608\uC0B0", follow_up: "F/U", special_notes: "\uD2B9\uC774\uC0AC\uD56D", summary: "\uC0C1\uB2F4 \uC694\uC57D", chief_complaint: "C.C", procedures_mentioned: "\uC0C1\uB2F4 \uC2DC\uC220", budget_mentioned: "\uC608\uC0B0", follow_up_required: "F/U", consultation_summary: "\uC0C1\uB2F4 \uC694\uC57D" };
                                const lines = Object.entries(s).map(([k, v]) => {
                                  if (!v || (typeof v === "string" && !v.trim())) return null;
                                  const label = labelMap[k] || k;
                                  const val = Array.isArray(v) ? v.join(", ") : (v === true || v === "true") ? "\uD544\uC694" : (v === false || v === "false") ? "\uBD88\uD544\uC694" : String(v);
                                  return `[${label}] ${val}`;
                                }).filter(Boolean);
                                const text = `${item.room_id ?? item.pt_number} | ${item.patient_name || "-"}\n${"=".repeat(30)}\n${lines.join("\n")}`;
                                navigator.clipboard.writeText(text).then(() => alert("\uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4")).catch(() => alert("Copy failed"));
                              }}
                              style={{ padding: "4px 12px", fontSize: "12px", background: "#6366f1", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                            >
                              {"\uD074\uB9BD\uBCF4\uB4DC \uBCF5\uC0AC"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const a = document.createElement("a");
                                a.href = `/api/hospital/ai-summary-pdf/${item.session_id}?orgCode=${encodeURIComponent(item.org_code || "")}`;
                                a.download = `MONO_Summary_${item.room_id}.pdf`;
                                a.click();
                              }}
                              style={{ padding: "4px 12px", fontSize: "12px", background: "#059669", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
                            >
                              PDF
                            </button>
                          </div>
                          {Object.entries(item.ai_summary).map(([key, value]) =>
                            value !== null && value !== undefined && (typeof value === "boolean" || (Array.isArray(value) ? value.length > 0 : String(value).trim())) ? (
                              <div key={key} style={{ background: "#f9fafb", borderRadius: "8px", padding: "10px 14px" }}>
                                <div style={{ fontSize: "11px", fontWeight: 600, color: "#6366f1", textTransform: "uppercase", marginBottom: "4px" }}>{({ cc: "\u0043\u002E\u0043 (\uB0B4\uC6D0 \uC0AC\uC720)", consulted_procedures: "\uC0C1\uB2F4 \uC2DC\uC220", patient_requests: "\uD658\uC790 \uC694\uCCAD\uC0AC\uD56D", budget: "\uC608\uC0B0", follow_up: "\u0046\u002F\u0055", special_notes: "\uD2B9\uC774\uC0AC\uD56D", summary: "\uC0C1\uB2F4 \uC694\uC57D", chief_complaint: "\u0043\u002E\u0043 (\uB0B4\uC6D0 \uC0AC\uC720)", procedures_mentioned: "\uC0C1\uB2F4 \uC2DC\uC220", budget_mentioned: "\uC608\uC0B0", follow_up_required: "\u0046\u002F\u0055", consultation_summary: "\uC0C1\uB2F4 \uC694\uC57D" }[key] || key.replace(/_/g, " "))}</div>
                                <div style={{ fontSize: "14px", color: "#374151" }}>{Array.isArray(value) ? value.join(", ") : (value === true || value === "true") ? "\uD544\uC694" : (value === false || value === "false") ? "\uBD88\uD544\uC694" : String(value)}</div>
                              </div>
                            ) : null
                          )}
                        </div>
                      ) : (
                        <div style={{ color: "#9ca3af", fontSize: "14px" }}>요약 없음</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════
// ROOMS PANEL — \uBC29 \uB9CC\uB4E4\uAE30 (추가, QR, 인쇄, 링크 복사)
// ═══════════════════════════════════════════
/** UI template keys (cards). API/DB still use reception | consultation | consultation_dual (server VALID_TEMPLATES). */
const TEMPLATE_UI = {
  RECEPTION: "reception",
  CONSULTATION_SINGLE: "consultation-single",
  CONSULTATION_DUAL: "consultation-dual",
  CONSULTATION_DISPLAY: "consultation-display",
  CONSULTATION_TABLET: "consultation-tablet",
};

function templateUiToApi(ui) {
  if (ui === TEMPLATE_UI.CONSULTATION_DUAL) return "consultation_dual";
  if (ui === TEMPLATE_UI.CONSULTATION_TABLET) return "consultation";
  if (ui === TEMPLATE_UI.RECEPTION) return "reception";
  return ui;
}

function SvgReceptionIllust() {
  return (
    <svg viewBox="0 0 200 88" className="w-full h-[88px]" aria-hidden>
      <rect x="8" y="12" width="56" height="40" rx="4" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1.5" />
      <rect x="18" y="54" width="36" height="6" rx="1" fill="#CBD5E1" />
      <rect x="100" y="18" width="36" height="48" rx="3" fill="#F1F5F9" stroke="#3B82F6" strokeWidth="1.5" />
      <path d="M112 28h12M112 34h12M112 40h8" stroke="#3B82F6" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="156" cy="28" r="5" fill="#CBD5E1" />
      <path d="M156 34v14M148 42h16" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="168" y="44" width="10" height="16" rx="1" fill="#3B82F6" opacity="0.35" />
    </svg>
  );
}

function SvgSingleMicIllust() {
  return (
    <svg viewBox="0 0 200 88" className="w-full h-[88px]" aria-hidden>
      <rect x="72" y="10" width="56" height="38" rx="4" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1.5" />
      <rect x="82" y="50" width="36" height="5" rx="1" fill="#CBD5E1" />
      <circle cx="100" cy="68" r="6" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="1.5" />
      <path d="M97 74v6M94 80h12" stroke="#3B82F6" strokeWidth="1.2" />
      <circle cx="40" cy="52" r="5" fill="#CBD5E1" />
      <path d="M40 58v12M34 66h12" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="160" cy="52" r="5" fill="#CBD5E1" />
      <path d="M160 58v12M154 66h12" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SvgDualMicIllust() {
  return (
    <svg viewBox="0 0 200 88" className="w-full h-[88px]" aria-hidden>
      <rect x="72" y="8" width="56" height="36" rx="4" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1.5" />
      <rect x="82" y="46" width="36" height="5" rx="1" fill="#CBD5E1" />
      <circle cx="38" cy="40" r="5" fill="#CBD5E1" />
      <path d="M38 46v14M32 54h12" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="28" cy="62" r="5" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="1.5" />
      <path d="M28 68v5" stroke="#3B82F6" strokeWidth="1.2" />
      <circle cx="162" cy="40" r="5" fill="#CBD5E1" />
      <path d="M162 46v14M156 54h12" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="172" cy="62" r="5" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="1.5" />
      <path d="M172 68v5" stroke="#3B82F6" strokeWidth="1.2" />
    </svg>
  );
}

function SvgDisplayIllust() {
  return (
    <svg viewBox="0 0 200 88" className="w-full h-[88px]" aria-hidden>
      <rect x="6" y="14" width="52" height="36" rx="3" fill="#E2E8F0" stroke="#3B82F6" strokeWidth="1.5" />
      <rect x="16" y="52" width="32" height="4" rx="1" fill="#CBD5E1" />
      <circle cx="32" cy="68" r="5" fill="#CBD5E1" />
      <path d="M32 74v8" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="92" y="16" width="48" height="34" rx="3" fill="#F8FAFC" stroke="#94A3B8" strokeWidth="1.5" />
      <rect x="98" y="24" width="18" height="8" rx="2" fill="#DBEAFE" stroke="#3B82F6" strokeWidth="1" />
      <rect x="120" y="34" width="14" height="6" rx="1" fill="#E2E8F0" />
      <rect x="98" y="38" width="22" height="6" rx="1" fill="#E2E8F0" />
      <rect x="148" y="52" width="40" height="5" rx="1" fill="#CBD5E1" />
    </svg>
  );
}

function SvgTabletPairIllust() {
  return (
    <svg viewBox="0 0 200 88" className="w-full h-[88px]" aria-hidden>
      <rect x="10" y="12" width="50" height="36" rx="3" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1.5" />
      <rect x="20" y="50" width="30" height="4" rx="1" fill="#CBD5E1" />
      <path d="M62 32h28" stroke="#3B82F6" strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="96" y="18" width="38" height="48" rx="3" fill="#F1F5F9" stroke="#3B82F6" strokeWidth="1.5" />
      <circle cx="32" cy="72" r="5" fill="#CBD5E1" />
      <path d="M32 78v6" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="115" cy="72" r="5" fill="#CBD5E1" />
      <path d="M115 78v6" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const ROOM_TEMPLATE_CARDS = [
  {
    value: TEMPLATE_UI.RECEPTION,
    title: "접수처 · PC + QR",
    subtitle: "직원 PC 1대 + 태블릿 QR 키오스크",
    comingSoon: false,
    Illustration: SvgReceptionIllust,
  },
  {
    value: TEMPLATE_UI.CONSULTATION_SINGLE,
    title: "상담실 · 싱글마이크 · PC 1대",
    subtitle: "PC 1대 + 마이크 1개 (VAD 자동인식)",
    comingSoon: true,
    Illustration: SvgSingleMicIllust,
  },
  {
    value: TEMPLATE_UI.CONSULTATION_DUAL,
    title: "상담실 · 듀얼마이크 · PC 1대",
    subtitle: "PC 1대 + 블루투스 마이크 2개",
    comingSoon: false,
    Illustration: SvgDualMicIllust,
  },
  {
    value: TEMPLATE_UI.CONSULTATION_DISPLAY,
    title: "상담실 · PC + 외부모니터",
    subtitle: "직원 PC + 환자용 읽기전용 모니터",
    comingSoon: true,
    Illustration: SvgDisplayIllust,
  },
  {
    value: TEMPLATE_UI.CONSULTATION_TABLET,
    title: "상담실 · PC + 태블릿",
    subtitle: "직원 PC + 환자 전용 태블릿 (완전 분리)",
    comingSoon: false,
    Illustration: SvgTabletPairIllust,
  },
];

function RoomsPanel({ authUser }) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [addTemplate, setAddTemplate] = useState(TEMPLATE_UI.RECEPTION);
  const [submitting, setSubmitting] = useState(false);
  const [templateToast, setTemplateToast] = useState(null);

  useEffect(() => {
    if (!templateToast) return undefined;
    const t = setTimeout(() => setTemplateToast(null), 2800);
    return () => clearTimeout(t);
  }, [templateToast]);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    try {
      const url = urlWithOrg("/api/hospital/rooms", authUser?.org_code);
      const r = await fetch(url, { credentials: "include" });
      const data = await r.json();
      if (data.success) setRooms(data.rooms || []);
    } catch (e) {
      console.error("rooms fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [authUser?.org_code]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const buildRoomUrl = useCallback(
    (room, kiosk = false) => {
      if (!origin) return "";
      const tpl = room.template;
      if (tpl === "consultation_dual" || tpl === "consultation-dual") {
        const orgSuffix = authUser?.org_code ? `&org=${encodeURIComponent(authUser.org_code)}` : "";
        return `${origin}/dual-consultation?room=${encodeURIComponent(room.id)}${orgSuffix}`;
      }
      const urlTemplate =
        tpl === "consultation" || tpl === "consultation-tablet" ? "consultation" : tpl === "reception" || !tpl ? "reception" : tpl;
      const base = `/hospital?template=${urlTemplate}&room=${room.id}`;
      const orgSuffix = authUser?.org_code ? `&org=${encodeURIComponent(authUser.org_code)}` : "";
      return `${origin}${base}${orgSuffix}${kiosk ? "&kiosk=true" : ""}`;
    },
    [authUser, origin]
  );

  // 환자가 스캔할 QR용 URL: 병원당 하나 (orgCode만 포함)
  const buildPatientJoinUrl = useCallback(
    (room) => {
      if (!origin) return "";
      const org = authUser?.org_code || "reception";
      return `${origin}/hospital/join/${encodeURIComponent(org)}`;
    },
    [authUser, origin]
  );

  const handleAddRoom = async (e) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    const apiTemplate = templateUiToApi(addTemplate);
    setSubmitting(true);
    try {
      const url = urlWithOrg("/api/hospital/rooms", authUser?.org_code);
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, template: apiTemplate }),
      });
      const data = await r.json();
      if (data.success) {
        if (apiTemplate === "consultation_dual" && data.room) {
          setRooms((prev) => [data.room, ...prev]);
          setAddName("");
          setAddTemplate(TEMPLATE_UI.RECEPTION);
          navigate(
            `/dual-consultation?room=${encodeURIComponent(data.room.id)}&org=${encodeURIComponent(authUser?.org_code || "")}&roomName=${encodeURIComponent(data.room.name)}`
          );
          setSubmitting(false);
          return;
        }
        setRooms((prev) => [data.room, ...prev]);
        setAddName("");
        setAddTemplate(TEMPLATE_UI.RECEPTION);
      }
    } catch (e) {
      console.error("add room failed:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const roomNamePlaceholder =
    addTemplate === TEMPLATE_UI.RECEPTION
      ? "예: 접수 데스크 1, 접수 데스크 2"
      : "예: 상담실 1, 진료실 2";

  const handleTemplateCardClick = (card) => {
    if (card.comingSoon) {
      setTemplateToast("이 모드는 현재 준비 중입니다.");
      return;
    }
    setAddTemplate(card.value);
  };

  const handlePrintQR = (room) => {
    const qrUrl = buildPatientJoinUrl(room);
    const qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrUrl)}`;
    const win = window.open("", "_blank", "width=400,height=500");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>QR 인쇄 - ${room.name}</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
            .room-name { font-size: 24px; font-weight: bold; margin-bottom: 24px; text-align: center; }
            img { display: block; }
          </style>
        </head>
        <body>
          <div class="room-name">${room.name}</div>
          <img src="${qrImgSrc}" alt="QR" />
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 300);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="relative p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
        {templateToast ? (
          <div
            className="absolute left-1/2 top-3 z-10 -translate-x-1/2 px-4 py-2 rounded-[8px] bg-slate-800 text-white text-[12px] shadow-lg max-w-[90vw] text-center"
            role="status"
          >
            {templateToast}
          </div>
        ) : null}
        <h2 className="text-[14px] font-semibold text-[var(--color-text)] mb-2">방 추가</h2>
        <p className="text-[12px] text-[var(--color-text-secondary)] mb-4">템플릿을 선택한 뒤 방 이름을 입력하세요.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6 justify-items-stretch">
          {ROOM_TEMPLATE_CARDS.map((card) => {
            const selected = addTemplate === card.value && !card.comingSoon;
            const Ill = card.Illustration;
            return (
              <button
                key={card.value}
                type="button"
                aria-disabled={card.comingSoon}
                onClick={() => handleTemplateCardClick(card)}
                className={[
                  "relative flex flex-col w-full max-w-[240px] mx-auto sm:mx-0 rounded-[12px] border-2 p-3 text-left transition-shadow duration-150",
                  card.comingSoon
                    ? "opacity-60 cursor-not-allowed border-[var(--color-border)] bg-[var(--color-bg)]"
                    : selected
                      ? "border-[#3B82F6] bg-[#EFF6FF] shadow-sm hover:shadow-md"
                      : "border-[var(--color-border)] bg-[var(--color-bg)] hover:shadow-md",
                ].join(" ")}
              >
                {card.comingSoon ? (
                  <span className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-100">
                    준비중
                  </span>
                ) : null}
                {selected ? (
                  <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#3B82F6] text-white">
                    <Check size={14} strokeWidth={3} />
                  </span>
                ) : null}
                <div className="mb-2 pointer-events-none">
                  <Ill />
                </div>
                <div className="text-[14px] font-bold text-[var(--color-text)] leading-tight pr-6">{card.title}</div>
                <div className="text-[12px] text-[var(--color-text-secondary)] mt-1 leading-snug">{card.subtitle}</div>
              </button>
            );
          })}
        </div>
        <form onSubmit={handleAddRoom} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[12px] text-[var(--color-text-secondary)]">방 이름</label>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={roomNamePlaceholder}
              className="w-full max-w-[320px] px-3 py-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[13px]"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="h-[40px] px-4 rounded-[8px] bg-[#3B82F6] text-white text-[13px] font-medium hover:bg-[#2563EB] disabled:opacity-50 flex items-center gap-2"
          >
            <Plus size={16} />
            방 추가
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            orgCode={authUser?.org_code}
            staffUrl={buildRoomUrl(room, false)}
            kioskUrl={buildRoomUrl(room, true)}
            qrUrl={buildPatientJoinUrl(room)}
            onPrintQR={handlePrintQR}
            onDelete={fetchRooms}
          />
        ))}
      </div>
      {rooms.length === 0 && (
        <p className="text-[13px] text-[var(--color-text-secondary)] py-8 text-center">
          등록된 방이 없습니다. 위에서 방을 추가해 주세요.
        </p>
      )}
    </div>
  );
}

function RoomCard({ room, orgCode, staffUrl, kioskUrl, qrUrl, onPrintQR, onDelete }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [copiedTablet, setCopiedTablet] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleCopyStaff = () => {
    navigator.clipboard?.writeText(staffUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleCopyTablet = () => {
    navigator.clipboard?.writeText(kioskUrl).then(() => {
      setCopiedTablet(true);
      setTimeout(() => setCopiedTablet(false), 2000);
    }).catch(() => {});
  };

  const handleDelete = async () => {
    if (!window.confirm(`"${room.name}" 방을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      const url = urlWithOrg(`/api/hospital/rooms/${encodeURIComponent(room.id)}`, orgCode);
      const r = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok && onDelete) await onDelete();
    } catch (e) {
      console.error("delete room failed:", e);
    } finally {
      setDeleting(false);
    }
  };

  const templateLabel =
    room.template === "consultation_dual"
      ? "듀얼마이크 PTT"
      : room.template === "consultation"
        ? "상담 모드 (VAD)"
        : "접수 모드 (탭하여 말하기)";
  const isConsultationDual = room.template === "consultation_dual";

  const openDualConsultation = () => {
    navigate(
      `/dual-consultation?room=${encodeURIComponent(room.id)}${orgCode ? `&org=${encodeURIComponent(orgCode)}` : ""}&roomName=${encodeURIComponent(room.name)}`
    );
  };

  return (
    <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col items-center">
      <div className="w-full flex items-start justify-between gap-2 mb-2">
        <h3 className="text-[15px] font-semibold text-[var(--color-text)] text-center flex-1 min-w-0">
          {room.name}
        </h3>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="flex-shrink-0 p-1.5 rounded-[8px] text-[var(--color-text-secondary)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-50"
          title="방 삭제"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <span className="text-[11px] font-medium text-[var(--color-text-secondary)] mb-3 px-2 py-1 rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
        {templateLabel}
      </span>
      {isConsultationDual ? (
        <div className="flex flex-wrap gap-2 w-full justify-center mb-2">
          <button
            type="button"
            onClick={openDualConsultation}
            className="flex items-center justify-center gap-2 w-full max-w-[280px] px-3 py-2.5 rounded-[8px] bg-[#2563EB] text-white text-[13px] font-semibold hover:bg-[#1D4ED8]"
          >
            상담실 열기
          </button>
        </div>
      ) : null}
      {!isConsultationDual ? (
        <>
          <div className="bg-white p-3 rounded-[10px] mb-4 inline-block">
            <Suspense fallback={<span className="inline-block w-[160px] h-[160px] bg-[var(--color-bg-secondary)] animate-pulse rounded" />}>
              <QRCode value={qrUrl} size={160} bgColor="#FFFFFF" fgColor="#3B82F6" level="M" />
            </Suspense>
          </div>
          <div className="flex flex-wrap gap-2 w-full justify-center">
            <button
              type="button"
              onClick={() => onPrintQR(room)}
              className="flex items-center gap-2 px-3 py-2 rounded-[8px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
            >
              <Printer size={14} />
              QR 인쇄
            </button>
            <button
              type="button"
              onClick={handleCopyStaff}
              className="flex items-center gap-2 px-3 py-2 rounded-[8px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
            >
              <Copy size={14} />
              {copied ? "복사됨" : "직원 PC용 링크 복사"}
            </button>
            <button
              type="button"
              onClick={handleCopyTablet}
              className="flex items-center gap-2 px-3 py-2 rounded-[8px] border border-[var(--color-border)] text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
            >
              <Copy size={14} />
              {copiedTablet ? "복사됨" : "태블릿용 링크 복사"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════
// 1. OVERVIEW PANEL — 통계 개요 + 원클릭 통역 시작
// ═══════════════════════════════════════════
const HOSPITAL_PRIMARY = "#2563EB";
const HOSPITAL_BG = "#ffffff";
const HOSPITAL_BG_DARK = "#0f172a";
const HOSPITAL_BORDER = "#e2e8f0";
const HOSPITAL_BORDER_DARK = "#334155";
const HOSPITAL_TEXT = "#1e293b";
const HOSPITAL_TEXT_DARK = "#f1f5f9";
const HOSPITAL_TEXT_MUTED = "#64748b";
const HOSPITAL_TEXT_MUTED_DARK = "#94a3b8";

function OverviewPanel({ authUser }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startModal, setStartModal] = useState(null); // null | 'choose' | 'reception' | 'consultation-mode' | 'consultation-qr'
  const [receptionRoom, setReceptionRoom] = useState(null);
  const [consultationRoom, setConsultationRoom] = useState(null);
  const [consultationInputMode, setConsultationInputMode] = useState(null); // 'vad' | 'ptt'
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [tabletUrlCopied, setTabletUrlCopied] = useState(false);
  const [doctorPcUrlCopied, setDoctorPcUrlCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const url = urlWithOrg("/api/hospital/dashboard/stats", authUser?.org_code);
      const r = await fetch(url, { credentials: "include" });
      const data = await r.json();
      if (data.success) setStats(data);
    } catch (e) {
      console.error("stats fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [authUser?.org_code]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const getOrCreateReceptionRoom = useCallback(async () => {
    if (!authUser?.org_code) return null;
    setRoomsLoading(true);
    try {
      const roomsUrl = urlWithOrg("/api/hospital/rooms", authUser?.org_code);
      const r = await fetch(roomsUrl, { credentials: "include" });
      const data = await r.json();
      if (!data.success || !data.rooms) return null;
      const existing = (data.rooms || []).find((x) => x.template === "reception");
      if (existing) {
        setReceptionRoom(existing);
        setStartModal("reception");
        return existing;
      }
      const createRes = await fetch(roomsUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "접수처", template: "reception" }),
      });
      const createData = await createRes.json();
      if (createData.success && createData.room) {
        setReceptionRoom(createData.room);
        setStartModal("reception");
        return createData.room;
      }
    } catch (e) {
      console.error("getOrCreateReceptionRoom", e);
    } finally {
      setRoomsLoading(false);
    }
    return null;
  }, [authUser?.org_code]);

  const getOrCreateConsultationRoom = useCallback(async () => {
    if (!authUser?.org_code) return null;
    setRoomsLoading(true);
    try {
      const roomsUrl = urlWithOrg("/api/hospital/rooms", authUser?.org_code);
      const r = await fetch(roomsUrl, { credentials: "include" });
      const data = await r.json();
      if (!data.success || !data.rooms) return null;
      const existing = (data.rooms || []).find((x) => x.template === "consultation");
      if (existing) {
        setConsultationRoom(existing);
        setStartModal("consultation-qr");
        return existing;
      }
      const createRes = await fetch(roomsUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "상담실", template: "consultation" }),
      });
      const createData = await createRes.json();
      if (createData.success && createData.room) {
        setConsultationRoom(createData.room);
        setStartModal("consultation-qr");
        return createData.room;
      }
    } catch (e) {
      console.error("getOrCreateConsultationRoom", e);
    } finally {
      setRoomsLoading(false);
    }
    return null;
  }, [authUser?.org_code]);

  const buildStaffUrl = useCallback((room, kiosk = false) => {
    if (!origin || !room) return "";
    if (room.template === "consultation_dual") {
      const orgSuffix = authUser?.org_code ? `&org=${encodeURIComponent(authUser.org_code)}` : "";
      return `${origin}/dual-consultation?room=${encodeURIComponent(room.id)}${orgSuffix}`;
    }
    const base = `/hospital?template=${room.template || "reception"}&room=${room.id}`;
    const orgSuffix = authUser?.org_code ? `&org=${encodeURIComponent(authUser.org_code)}` : "";
    return `${origin}${base}${orgSuffix}${kiosk ? "&kiosk=true" : ""}`;
  }, [authUser?.org_code, origin]);

  const buildPatientJoinUrl = useCallback((room, extraParams = {}) => {
    if (!origin) return "";
    const org = authUser?.org_code || "reception";
    return `${origin}/hospital/join/${encodeURIComponent(org)}`;
  }, [authUser?.org_code, origin]);

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
      name: getLanguageNameKo(l.language),
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
      {/* 모달: 상담실 — VAD / PTT 선택 */}
      {startModal === "consultation-mode" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setStartModal(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[18px] font-bold text-slate-800 dark:text-slate-100">상담실 통역 방식</h3>
              <button type="button" onClick={() => setStartModal(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => { setConsultationInputMode("vad"); getOrCreateConsultationRoom(); }}
                disabled={roomsLoading}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-left hover:border-[#2563EB] hover:bg-blue-50/50 dark:hover:bg-slate-800"
              >
                <Mic size={24} style={{ color: HOSPITAL_PRIMARY }} />
                <div className="flex-1">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 block">VAD (자동 음성감지)</span>
                  <span className="text-[12px] text-slate-500">말하면 자동 감지</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setConsultationInputMode("ptt"); getOrCreateConsultationRoom(); }}
                disabled={roomsLoading}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-left hover:border-[#2563EB] hover:bg-blue-50/50 dark:hover:bg-slate-800"
              >
                <MicOff size={24} style={{ color: HOSPITAL_PRIMARY }} />
                <div className="flex-1">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 block">탭하여 말하기</span>
                  <span className="text-[12px] text-slate-500">탭하면 말하기</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 모달: 접수처 — 직원 PC / 태블릿 QR */}
      {startModal === "reception" && receptionRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setStartModal(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[18px] font-bold text-slate-800 dark:text-slate-100">접수처 통역</h3>
              <button type="button" onClick={() => setStartModal(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => window.open(buildStaffUrl(receptionRoom, false), "_blank")}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold"
                style={{ backgroundColor: HOSPITAL_PRIMARY }}
              >
                <Monitor size={20} />
                직원 PC에서 열기
              </button>
              <div className="flex flex-col items-center">
                <p className="text-[13px] text-slate-600 dark:text-slate-400 mb-2">태블릿용 QR</p>
                <div className="p-3 bg-white rounded-xl inline-block">
                  <Suspense fallback={<span className="inline-block w-[200px] h-[200px] bg-[var(--color-bg-secondary)] animate-pulse rounded" />}>
                    <QRCode value={buildStaffUrl(receptionRoom, true)} size={200} bgColor="#FFFFFF" fgColor={HOSPITAL_PRIMARY} level="M" />
                  </Suspense>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(buildStaffUrl(receptionRoom, true));
                    setTabletUrlCopied(true);
                    setTimeout(() => setTabletUrlCopied(false), 2000);
                  }}
                  className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-[13px] font-medium"
                >
                  <Copy size={14} />
                  {tabletUrlCopied ? "복사됨!" : "태블릿 QR 복사"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 모달: 상담실 — 태블릿 QR + 링크 복사 (환자 스캔용 QR에는 inputMode 포함) */}
      {startModal === "consultation-qr" && consultationRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setStartModal(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[18px] font-bold text-slate-800 dark:text-slate-100">상담실 통역 — 태블릿</h3>
              <button type="button" onClick={() => setStartModal(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-[12px] text-slate-500">
                {consultationInputMode === "vad" ? "VAD (자동 음성감지)" : "탭하여 말하기"} · 환자 QR 스캔 시 태블릿이 통역 화면으로 전환됩니다.
              </p>
              <button
                type="button"
                onClick={() => window.open(buildStaffUrl(consultationRoom, false), "_blank")}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold"
                style={{ backgroundColor: HOSPITAL_PRIMARY }}
              >
                <Monitor size={20} />
                의사용 PC에서 열기
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(buildStaffUrl(consultationRoom, false));
                  setDoctorPcUrlCopied(true);
                  setTimeout(() => setDoctorPcUrlCopied(false), 2000);
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-300 text-[13px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Copy size={14} />
                {doctorPcUrlCopied ? "복사됨!" : "의사용 PC 링크 복사"}
              </button>
              <div className="flex flex-col items-center">
                <p className="text-[11px] text-slate-500 mb-1">환자 스캔용 QR (태블릿에 띄우세요)</p>
                <div className="p-3 bg-white rounded-xl inline-block">
                  <Suspense fallback={<span className="inline-block w-[200px] h-[200px] bg-[var(--color-bg-secondary)] animate-pulse rounded" />}>
                    <QRCode value={buildPatientJoinUrl(consultationRoom, { inputMode: consultationInputMode })} size={200} bgColor="#FFFFFF" fgColor={HOSPITAL_PRIMARY} level="M" />
                  </Suspense>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(buildStaffUrl(consultationRoom, true));
                    setTabletUrlCopied(true);
                    setTimeout(() => setTabletUrlCopied(false), 2000);
                  }}
                  className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-white font-semibold"
                  style={{ backgroundColor: HOSPITAL_PRIMARY }}
                >
                  <Tablet size={14} />
                  {tabletUrlCopied ? "복사됨!" : "태블릿 링크 복사"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
function HistoryPanel({ authUser }) {
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

      const url = urlWithOrg(`/api/hospital/dashboard/sessions?${params}`, authUser?.org_code);
      const r = await fetch(url, { credentials: "include" });
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
  }, [startDate, endDate, department, language, searchQuery, authUser?.org_code]);

  useEffect(() => { fetchSessions(1); }, [fetchSessions]);

  const handleDeleteSession = useCallback(async (session) => {
    if (!window.confirm("이 기록을 삭제하시겠습니까?")) return;
    try {
      const url = urlWithOrg(`/api/hospital/sessions/${session.id}`, authUser?.org_code);
      const r = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await r.json();
      if (data.success) fetchSessions(page);
    } catch (e) {
      console.error("session delete failed:", e);
    }
  }, [page, fetchSessions, authUser?.org_code]);

  const openDetail = async (session) => {
    setSelectedSession(session);
    setModalLoading(true);
    setModalMessages([]);
    try {
      const url = urlWithOrg(`/api/hospital/sessions/${session.id}/messages`, authUser?.org_code);
      const r = await fetch(url, { credentials: "include" });
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
                  {["최근 활동", "차트번호", "환자", "진료과", "사용 언어", "메시지 수", "액션"].map((h) => (
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
                    className="group border-b border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                  >
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      {formatDate(s.last_started_at)}
                    </td>
                    <td className="px-4 py-3 text-[12px] font-mono text-[var(--color-text)]">
                      {s.chart_number || "-"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      <div className="flex items-center gap-1.5">
                        {s.language && (
                          <img
                            src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${(() => { const flag = { en: '1f1fa-1f1f8', zh: '1f1e8-1f1f3', ja: '1f1ef-1f1f5', vi: '1f1fb-1f1f3', th: '1f1f9-1f1ed', ko: '1f1f0-1f1f7', ru: '1f1f7-1f1fa', es: '1f1ea-1f1f8', fr: '1f1eb-1f1f7', de: '1f1e9-1f1ea', pt: '1f1e7-1f1f7', ar: '1f1f8-1f1e6', hi: '1f1ee-1f1f3', id: '1f1ee-1f1e9', ms: '1f1f2-1f1fe', tl: '1f1f5-1f1ed', mn: '1f1f2-1f1f3', my: '1f1f2-1f1f2', km: '1f1f0-1f1ed', lo: '1f1f1-1f1e6', ne: '1f1f3-1f1f5', bn: '1f1e7-1f1e9', ur: '1f1f5-1f1f0', tr: '1f1f9-1f1f7', uk: '1f1fa-1f1e6', pl: '1f1f5-1f1f1', it: '1f1ee-1f1f9', nl: '1f1f3-1f1f1', sv: '1f1f8-1f1ea', ka: '1f1ec-1f1ea' }; return flag[s.language] || '1f310'; })()}.svg`}
                            alt={s.language}
                            width={18}
                            height={18}
                            className="rounded-sm"
                            style={{ objectFit: 'cover' }}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        )}
                        <span className="font-medium">{s.name || "-"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      <span className="flex items-center gap-1.5">
                        <span>{getDeptIcon(s.dept)}</span>
                        {getDeptLabel(s.dept)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      {getLangDisplay(s.language) || "-"}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-text)]">
                      <span className="flex items-center gap-1">
                        <MessageSquare size={12} className="text-[var(--color-text-secondary)]" />
                        {s.message_count || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => openDetail(s)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[11px] font-medium text-[#3B82F6] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] transition-colors"
                        >
                          <Eye size={12} />
                          상세
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteSession(s); }}
                          className="session-row-delete flex items-center justify-center w-8 h-8 rounded-[8px] text-[var(--color-text-secondary)] hover:bg-red-500/10 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 max-md:opacity-100"
                          title="삭제"
                          aria-label="삭제"
                        >
                          <Trash2 size={14} />
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
function DepartmentsPanel({ authUser }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const url = urlWithOrg("/api/hospital/dashboard/stats", authUser?.org_code);
        const r = await fetch(url, { credentials: "include" });
        const data = await r.json();
        if (!cancelled && data.success) setStats(data);
      } catch (e) {
        if (!cancelled) console.error("dept stats failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authUser?.org_code]);

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
function ReportsPanel({ authUser }) {
  const [startDate, setStartDate] = useState(monthStartStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [generating, setGenerating] = useState(false);

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const statsUrl = urlWithOrg(`/api/hospital/dashboard/stats?startDate=${startDate}&endDate=${endDate}`, authUser?.org_code);
      const statsR = await fetch(statsUrl, { credentials: "include" });
      const statsData = await statsR.json();

      const sessUrl = urlWithOrg(`/api/hospital/dashboard/sessions?startDate=${startDate}&endDate=${endDate}&limit=100`, authUser?.org_code);
      const sessR = await fetch(sessUrl, { credentials: "include" });
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
      const url = urlWithOrg(`/api/hospital/dashboard/sessions?startDate=${startDate}&endDate=${endDate}&limit=1000`, authUser?.org_code);
      const r = await fetch(url, { credentials: "include" });
      const data = await r.json();
      if (!data.success || !data.sessions?.length) {
        alert("내보낼 데이터가 없습니다.");
        return;
      }

      const BOM = "\uFEFF";
      const header = "날짜,차트번호,진료과,호스트언어,환자언어,통역시간(분),메시지수,상태\n";
      const rows = data.sessions.map((s) => {
        return [
          formatDate(s.created_at),
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
// USAGE & BILLING TAB
// ═══════════════════════════════════════════
const USAGE_BILLING_TIERS = [
  { limit: 600, rate: 167 },
  { limit: 1800, rate: 133 },
  { limit: 3600, rate: 100 },
  { limit: Infinity, rate: 83 },
];

function calcBill(totalMins) {
  let remaining = totalMins;
  let cost = 0;
  let prev = 0;
  for (const tier of USAGE_BILLING_TIERS) {
    const available = tier.limit === Infinity ? remaining : tier.limit - prev;
    const used = Math.min(remaining, available);
    if (used <= 0) break;
    cost += used * tier.rate;
    remaining -= used;
    prev = tier.limit === Infinity ? prev : tier.limit;
    if (remaining <= 0) break;
  }
  return cost;
}

function getTierLabel(totalMins) {
  if (totalMins <= 600) return { label: "1구간", rate: 167 };
  if (totalMins <= 1800) return { label: "2구간", rate: 133 };
  if (totalMins <= 3600) return { label: "3구간", rate: 100 };
  return { label: "4구간", rate: 83 };
}

function fmtWon(n) {
  if (n >= 10000) return "₩" + (Math.round(n / 1000) / 10).toFixed(0) + "만원";
  return "₩" + Math.round(n).toLocaleString() + "원";
}

const USAGE_BILLING_MOCK = {
  trialDaysLeft: 5,
  trialDaysTotal: 14,
  sessions: [
    { date: "03/09", cases: 3, mins: 52 },
    { date: "03/10", cases: 5, mins: 88 },
    { date: "03/11", cases: 4, mins: 71 },
    { date: "03/12", cases: 6, mins: 104 },
    { date: "03/13", cases: 4, mins: 69 },
    { date: "03/14", cases: 5, mins: 92 },
    { date: "03/15", cases: 4, mins: 74 },
    { date: "03/16", cases: 4, mins: 68 },
    { date: "03/17", cases: 3, mins: 54 },
  ],
};

function UsageBillingTab({ authUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const url = urlWithOrg("/api/hospital/usage-stats", authUser?.org_code);
    fetch(url, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled && d && (d.sessions || d.trialDaysLeft !== undefined)) setData(d);
        else if (!cancelled) setData(USAGE_BILLING_MOCK);
      })
      .catch(() => {
        if (!cancelled) setData(USAGE_BILLING_MOCK);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authUser?.org_code]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  const sessions = data.sessions || [];
  const totalCases = sessions.reduce((acc, s) => acc + (s.cases || 0), 0);
  const totalMins = sessions.reduce((acc, s) => acc + (s.mins || 0), 0);
  const totalHours = Math.round((totalMins / 60) * 10) / 10;
  const tierInfo = getTierLabel(totalMins);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const projectedMins = daysElapsed > 0 ? (totalMins / daysElapsed) * daysInMonth : totalMins;
  const projectedBill = calcBill(projectedMins);
  const humanRatePerCase = 45000;
  const humanTotal = totalCases * humanRatePerCase;
  const savings = Math.max(0, humanTotal - projectedBill);

  const tierMinutes = [
    Math.min(totalMins, 600),
    Math.min(Math.max(0, totalMins - 600), 1200),
    Math.min(Math.max(0, totalMins - 1800), 1800),
    Math.max(0, totalMins - 3600),
  ];
  const tierLabels = ["1구간 (0~600분)", "2구간 (600~1800분)", "3구간 (1800~3600분)", "4구간 (3600분~)"];
  const tierRates = [167, 133, 100, 83];
  const tierLimits = [600, 1200, 1800, Infinity];
  const maxDayMins = sessions.length ? Math.max(...sessions.map((s) => s.mins || 0), 1) : 1;
  const avgMinsPerDay = sessions.length ? Math.round(totalMins / sessions.length) : 0;
  const avgCasesPerDay = sessions.length ? Math.round((totalCases / sessions.length) * 10) / 10 : 0;

  const scenarioMultipliers = [
    { label: "현재 페이스 유지", mult: 1 },
    { label: "20% 증가", mult: 1.2 },
    { label: "50% 증가", mult: 1.5 },
  ];

  return (
    <div className="space-y-6">
      {/* Section A — Top summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <p className="text-[12px] text-[var(--color-text-secondary)] font-medium mb-1">이번 달 통역 건수</p>
          <p className="text-[28px] font-bold text-[var(--color-text)]">{totalCases}</p>
        </div>
        <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <p className="text-[12px] text-[var(--color-text-secondary)] font-medium mb-1">총 사용 시간</p>
          <p className="text-[28px] font-bold text-[var(--color-text)]">{totalHours}시간</p>
        </div>
        <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <p className="text-[12px] text-[var(--color-text-secondary)] font-medium mb-1">현재 구간</p>
          <p className="text-[28px] font-bold text-[var(--color-text)]">{tierInfo.label} · ₩{tierInfo.rate}원/분</p>
        </div>
        <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <p className="text-[12px] text-[var(--color-text-secondary)] font-medium mb-1">이번 달 예상 청구액</p>
          <p className="text-[28px] font-bold text-[#16A34A]">{fmtWon(projectedBill)}</p>
        </div>
      </div>

      {/* Section B — Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text)]">예상 청구액 상세</h3>
          <div className="space-y-3 mb-4">
            {tierLabels.map((label, i) => (
              <div key={i}>
                <div className="flex justify-between text-[11px] text-[var(--color-text-secondary)] mb-1">
                  <span>{label}</span>
                  <span>{tierMinutes[i]}분</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#3B82F6]"
                    style={{
                      width: `${tierLimits[i] === Infinity ? (tierMinutes[i] > 0 ? 100 : 0) : Math.min(100, (tierMinutes[i] / tierLimits[i]) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1 text-[13px] text-[var(--color-text)] mb-4">
            {tierMinutes.map((mins, i) => {
              const amt = mins * tierRates[i];
              return (
                <div key={i} className="flex justify-between">
                  <span>{tierLabels[i].split(" ")[0]} {mins}분 × ₩{tierRates[i]} =</span>
                  <span>{fmtWon(amt)}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[18px] font-bold text-[#16A34A] mb-3">총 예상: {fmtWon(projectedBill)}</p>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            전문 통역사 동일 건수: {fmtWon(humanTotal)} — MONO 대비 {fmtWon(savings)} 절감
          </p>
        </div>

        <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
          <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text)]">일별 사용 현황</h3>
          <div className="space-y-2 mb-4">
            {sessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-12 text-[12px] text-[var(--color-text)]">{s.date}</span>
                <span className="w-10 text-[12px] text-[var(--color-text-secondary)]">{s.cases}건</span>
                <div className="flex-1 h-5 rounded bg-[var(--color-bg-secondary)] overflow-hidden min-w-[60px]">
                  <div
                    className="h-full rounded bg-[#3B82F6]"
                    style={{ width: `${Math.min(100, ((s.mins || 0) / maxDayMins) * 100)}%` }}
                  />
                </div>
                <span className="w-12 text-[12px] font-medium text-[var(--color-text)]">{s.mins}분</span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            일 평균 {avgMinsPerDay}분 · {avgCasesPerDay}건/일
          </p>
        </div>
      </div>

      {/* Section C — 월말 시나리오 예측 */}
      <div className="p-5 rounded-[16px] bg-[var(--color-bg)] border border-[var(--color-border)]">
        <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text)]">월말 시나리오 예측</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {scenarioMultipliers.map((sc, i) => {
            const projM = Math.round(projectedMins * sc.mult);
            const projC = Math.round((totalCases / (daysElapsed || 1)) * daysInMonth * sc.mult);
            const projH = Math.round((projM / 60) * 10) / 10;
            const bill = calcBill(projM);
            const t = getTierLabel(projM);
            return (
              <div key={i} className="p-4 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <p className="text-[12px] font-medium text-[var(--color-text-secondary)] mb-2">{sc.label} {i === 0 ? "(×1.0)" : i === 1 ? "(+20%)" : "(+50%)"}</p>
                <p className="text-[16px] font-bold text-[#16A34A] mb-1">{fmtWon(bill)}</p>
                <p className="text-[11px] text-[var(--color-text-secondary)]">예상 건수: {projC}건 · {projH}시간 · {t.label} ₩{t.rate}/분</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section D — Trial banner */}
      {(data.trialDaysLeft > 0) && (
        <div className="p-4 rounded-[16px] bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100">
          <p className="text-[14px] font-medium">
            무료 체험 D+{Math.max(0, (data.trialDaysTotal || 14) - (data.trialDaysLeft || 0))} | 잔여 {data.trialDaysLeft}일 | 이번 달 예상 청구액 기준 월 {fmtWon(projectedBill)} 예상
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// SESSION DETAIL MODAL
// ═══════════════════════════════════════════
function SessionDetailModal({ session, messages, loading, onClose, onPrint }) {
  const [copyDone, setCopyDone] = useState(false);

  const getCopyText = useCallback(() => {
    const d = session.created_at ? parseAsUTC(session.created_at) : new Date();
    const dateStr = d && !isNaN(d.getTime()) ? d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const patientNum = session.room_id || formatChartNumber(session.chart_number) || "";
    const guestLang = getLanguageByCode(session.guest_lang)?.name || session.guest_lang || "English";
    const hostLang = getLanguageByCode(session.host_lang)?.name || session.host_lang || "Korean";
    const lines = [
      "[MONO 통역 기록]",
      `날짜: ${dateStr}`,
      `환자번호: ${patientNum}`,
      `언어: ${guestLang} → ${hostLang}`,
      "---",
    ];
    (messages || []).forEach((msg) => {
      if (msg.sender_role === "host") {
        if (msg.original_text) lines.push(`직원 (${hostLang}): ${msg.original_text}`);
        if (msg.translated_text) lines.push(`환자 (${guestLang}): ${msg.translated_text}`);
      } else {
        if (msg.original_text) lines.push(`환자 (${guestLang}): ${msg.original_text}`);
        if (msg.translated_text) lines.push(`직원 (${hostLang}): ${msg.translated_text}`);
      }
    });
    lines.push("---", "Powered by MONO Medical Interpreter");
    return lines.join("\n");
  }, [session, messages]);

  const handleCopy = useCallback(() => {
    const text = getCopyText();
    navigator.clipboard.writeText(text).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    }).catch(() => {});
  }, [getCopyText]);

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
              <span>차트: {session.room_id || formatChartNumber(session.chart_number) || "-"}</span>
              <span>{formatDate(session.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-[#3B82F6] text-white text-[12px] font-medium hover:bg-[#2563EB] transition-colors"
              >
                {copyDone ? "복사됨 ✓" : "📋 대화 내용 복사"}
              </button>
              <span className="text-[9px] text-[var(--color-text-secondary)] mt-0.5">EMR / CRM / 차트 어디든 붙여넣기 가능</span>
            </div>
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
            {getLangDisplay(session.guest_lang)} → {getLangDisplay(session.host_lang)}
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
      <span>📅 ${formatDate(session.created_at)}</span>
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
            <td>${formatDate(s.created_at)}</td>
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
