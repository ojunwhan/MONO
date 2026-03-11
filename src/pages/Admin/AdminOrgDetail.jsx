import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  Save,
  X,
  Plus,
  Settings2,
  Trash2,
  Copy,
  Check,
  Link as LinkIcon,
} from "lucide-react";

// ── 상수 ──
const ORG_TYPES = [
  { value: "hospital", label: "병원" },
  { value: "police", label: "경찰서" },
  { value: "court", label: "법원" },
  { value: "multicultural", label: "다문화센터" },
  { value: "industrial", label: "산업현장" },
  { value: "other", label: "기타" },
];

const PLANS = [
  { value: "trial", label: "Trial (체험)" },
  { value: "free", label: "Free (무료)" },
  { value: "basic", label: "Basic" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
];

const PLAN_BADGES = {
  trial: { label: "Trial", color: "bg-yellow-500/20 text-yellow-300" },
  free: { label: "Free", color: "bg-gray-500/20 text-gray-300" },
  basic: { label: "Basic", color: "bg-blue-500/20 text-blue-300" },
  pro: { label: "Pro", color: "bg-indigo-500/20 text-indigo-300" },
  enterprise: {
    label: "Enterprise",
    color: "bg-emerald-500/20 text-emerald-300",
  },
};

const ORG_TYPE_LABELS = Object.fromEntries(ORG_TYPES.map((t) => [t.value, t.label]));

const TAB_INFO = "info";
const TAB_DEPTS = "depts";

// ── 입력 공통 클래스 ──
const INPUT_CLS =
  "w-full h-11 px-4 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors";
const SELECT_CLS = `${INPUT_CLS} appearance-none cursor-pointer`;
const LABEL_CLS = "block text-sm text-gray-400 mb-1.5";

export default function AdminOrgDetail() {
  const { orgId } = useParams();
  const navigate = useNavigate();

  const [tab, setTab] = useState(TAB_INFO);
  const [loading, setLoading] = useState(true);

  // ── 기관 정보 ──
  const [org, setOrg] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // ── 부서 ──
  const [departments, setDepartments] = useState([]);
  const [showDeptAdd, setShowDeptAdd] = useState(false);
  // 각 부서별 파이프라인 설정 여부 { [deptId]: boolean }
  const [deptPipelineMap, setDeptPipelineMap] = useState({});
  // 복사 성공 토스트 상태 { key: "deptId-type", show: bool }
  const [copiedKey, setCopiedKey] = useState("");

  // ── 기관 상세 조회 ──
  const fetchOrg = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setOrg(data.org);
        const depts = data.departments || [];
        setDepartments(depts);

        // 각 부서의 파이프라인 설정 여부 확인
        const pipeMap = {};
        await Promise.all(
          depts.map(async (dept) => {
            try {
              const pRes = await fetch(
                `/api/admin/orgs/${orgId}/departments/${dept.id}/pipeline`,
                { credentials: "include" }
              );
              const pData = await pRes.json();
              // pipeline config가 있고 하나 이상의 키가 있으면 설정됨
              pipeMap[dept.id] =
                pData.ok &&
                pData.config &&
                Object.keys(pData.config).length > 0;
            } catch {
              pipeMap[dept.id] = false;
            }
          })
        );
        setDeptPipelineMap(pipeMap);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  // ── 편집 모드 진입 ──
  const startEditing = () => {
    setEditForm({
      name: org.name,
      org_type: org.org_type,
      plan: org.plan,
      trial_ends_at: org.trial_ends_at || "",
      is_active: org.is_active,
      emr_enabled: org.emr_enabled ? 1 : 0,
      crm_enabled: org.crm_enabled ? 1 : 0,
      emr_label: org.emr_label ?? "",
      crm_label: org.crm_label ?? "",
    });
    setEditing(true);
    setSaveMsg("");
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveMsg("");
  };

  // ── 기관 정보 저장 ──
  const handleSaveOrg = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchOrg();
        setEditing(false);
        setSaveMsg("저장 완료 ✓");
        setTimeout(() => setSaveMsg(""), 2000);
      } else {
        setSaveMsg(`오류: ${data.error}`);
      }
    } catch {
      setSaveMsg("서버 연결 오류");
    } finally {
      setSaving(false);
    }
  };

  // ── URL 클립보드 복사 ──
  const handleCopyUrl = async (url, key) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 2000);
    }
  };

  // ── 부서 삭제(비활성화) ──
  const handleDeleteDept = async (deptId) => {
    if (!window.confirm("이 부서를 비활성화하시겠습니까?")) return;
    try {
      await fetch(`/api/admin/orgs/${orgId}/departments/${deptId}`, {
        method: "DELETE",
        credentials: "include",
      });
      fetchOrg();
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-10 text-gray-500 text-sm">불러오는 중...</div>
    );
  }

  if (!org) {
    return (
      <div className="p-6 lg:p-10">
        <p className="text-red-400 text-sm">기관을 찾을 수 없습니다.</p>
        <button
          onClick={() => navigate("/admin/orgs")}
          className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm"
        >
          ← 목록으로
        </button>
      </div>
    );
  }

  const planBadge = PLAN_BADGES[org.plan] || PLAN_BADGES.free;

  return (
    <div className="p-6 lg:p-10">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/admin/orgs")}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-white">{org.name}</h2>
          <p className="mt-0.5 text-sm text-gray-500 font-mono">
            {org.org_code}
          </p>
        </div>
      </div>

      {/* ── 탭 바 ── */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {[
          { key: TAB_INFO, label: "기관 정보" },
          { key: TAB_DEPTS, label: "부서 구성" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-indigo-500 text-indigo-300"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════ */}
      {/* ── [기관 정보] 탭 ── */}
      {/* ══════════════════════════════════════ */}
      {tab === TAB_INFO && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl">
          {/* 편집 버튼 */}
          <div className="flex justify-end mb-4">
            {!editing ? (
              <button
                onClick={startEditing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-indigo-300 hover:bg-gray-800 transition-colors"
              >
                <Pencil size={14} />
                수정
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelEditing}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X size={14} />
                  취소
                </button>
                <button
                  onClick={handleSaveOrg}
                  disabled={saving}
                  className="flex items-center gap-1 px-4 py-1.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-colors"
                >
                  <Save size={14} />
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            )}
          </div>

          {saveMsg && (
            <p
              className={`text-sm mb-4 ${
                saveMsg.includes("✓") ? "text-green-400" : "text-red-400"
              }`}
            >
              {saveMsg}
            </p>
          )}

          {/* 필드 목록 */}
          <div className="space-y-5">
            {/* 기관코드 (읽기 전용) */}
            <div>
              <span className={LABEL_CLS}>기관코드</span>
              <p className="text-gray-300 text-sm font-mono">{org.org_code}</p>
            </div>

            {/* 기관명 */}
            <div>
              <label className={LABEL_CLS}>기관명</label>
              {editing ? (
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className={INPUT_CLS}
                />
              ) : (
                <p className="text-white text-sm">{org.name}</p>
              )}
            </div>

            {/* 유형 */}
            <div>
              <label className={LABEL_CLS}>기관 유형</label>
              {editing ? (
                <select
                  value={editForm.org_type}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, org_type: e.target.value }))
                  }
                  className={SELECT_CLS}
                >
                  {ORG_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-gray-300 text-sm">
                  {ORG_TYPE_LABELS[org.org_type] || org.org_type}
                </p>
              )}
            </div>

            {/* 플랜 */}
            <div>
              <label className={LABEL_CLS}>플랜</label>
              {editing ? (
                <select
                  value={editForm.plan}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, plan: e.target.value }))
                  }
                  className={SELECT_CLS}
                >
                  {PLANS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${planBadge.color}`}
                >
                  {planBadge.label}
                </span>
              )}
            </div>

            {/* 트라이얼 만료일 */}
            {(org.plan === "trial" ||
              (editing && editForm.plan === "trial")) && (
              <div>
                <label className={LABEL_CLS}>트라이얼 만료일</label>
                {editing ? (
                  <input
                    type="date"
                    value={editForm.trial_ends_at || ""}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        trial_ends_at: e.target.value,
                      }))
                    }
                    className={INPUT_CLS}
                  />
                ) : (
                  <p className="text-gray-300 text-sm">
                    {org.trial_ends_at || "-"}
                  </p>
                )}
              </div>
            )}

            {/* 상태 */}
            <div>
              <label className={LABEL_CLS}>상태</label>
              {editing ? (
                <select
                  value={editForm.is_active}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      is_active: Number(e.target.value),
                    }))
                  }
                  className={SELECT_CLS}
                >
                  <option value={1}>활성</option>
                  <option value={0}>비활성</option>
                </select>
              ) : (
                <span
                  className={`inline-flex items-center gap-1.5 text-sm ${
                    org.is_active ? "text-green-400" : "text-gray-500"
                  }`}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      org.is_active ? "bg-green-400" : "bg-gray-600"
                    }`}
                  />
                  {org.is_active ? "활성" : "비활성"}
                </span>
              )}
            </div>

            {/* 등록일 */}
            <div>
              <span className={LABEL_CLS}>등록일</span>
              <p className="text-gray-400 text-sm">
                {org.created_at
                  ? new Date(org.created_at).toLocaleString("ko-KR")
                  : "-"}
              </p>
            </div>

            {/* ── 통합 도구 설정 (EMR / CRM) ── */}
            <div className="pt-4 border-t border-gray-800">
              <span className={LABEL_CLS}>통합 도구 설정</span>
              <p className="text-gray-500 text-xs mb-3">
                직원 화면에서 통역 종료 후 표시할 복사 버튼 및 커스텀 이름
              </p>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {editing ? (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!editForm.emr_enabled}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, emr_enabled: e.target.checked ? 1 : 0 }))
                          }
                          className="rounded border-gray-600 bg-gray-800 text-indigo-500"
                        />
                        <span className="text-sm text-gray-300">EMR 사용</span>
                      </label>
                      <input
                        type="text"
                        value={editForm.emr_label ?? ""}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, emr_label: e.target.value }))
                        }
                        placeholder="예: EMR, 의무기록, 차트"
                        className={`${INPUT_CLS} flex-1 max-w-[200px]`}
                      />
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-gray-400">
                        EMR: {org.emr_enabled ? "사용" : "미사용"}
                        {org.emr_label ? ` (${org.emr_label})` : ""}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {editing ? (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!editForm.crm_enabled}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, crm_enabled: e.target.checked ? 1 : 0 }))
                          }
                          className="rounded border-gray-600 bg-gray-800 text-indigo-500"
                        />
                        <span className="text-sm text-gray-300">CRM 사용</span>
                      </label>
                      <input
                        type="text"
                        value={editForm.crm_label ?? ""}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, crm_label: e.target.value }))
                        }
                        placeholder="예: CRM, 고객관리"
                        className={`${INPUT_CLS} flex-1 max-w-[200px]`}
                      />
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-gray-400">
                        CRM: {org.crm_enabled ? "사용" : "미사용"}
                        {org.crm_label ? ` (${org.crm_label})` : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════ */}
      {/* ── [부서 구성] 탭 ── */}
      {/* ══════════════════════════════════════ */}
      {tab === TAB_DEPTS && (
        <div>
          {/* 상단 버튼 */}
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowDeptAdd(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
            >
              <Plus size={16} />
              부서 추가
            </button>
          </div>

          {/* 부서 카드 목록 */}
          {departments.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-500 text-sm">등록된 부서가 없습니다</p>
              <button
                onClick={() => setShowDeptAdd(true)}
                className="mt-3 text-indigo-400 hover:text-indigo-300 text-sm font-medium"
              >
                + 첫 번째 부서 추가하기
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {departments.map((dept) => {
                const hasPipeline = !!deptPipelineMap[dept.id];
                const baseUrl = "https://lingora.chat";
                const orgUrlBase = `${baseUrl}/org/${encodeURIComponent(org.org_code)}/${encodeURIComponent(dept.dept_code)}`;
                const urls = hasPipeline
                  ? [
                      { type: "kiosk", label: "키오스크", url: `${orgUrlBase}/kiosk`, emoji: "📺" },
                      { type: "staff", label: "직원", url: `${orgUrlBase}/staff`, emoji: "👨‍⚕️" },
                      { type: "join", label: "환자 입장", url: `${orgUrlBase}/join`, emoji: "🚪" },
                    ]
                  : [];

                return (
                  <div
                    key={dept.id}
                    className={`bg-gray-900 border rounded-xl p-5 flex flex-col ${
                      dept.is_active
                        ? "border-gray-800"
                        : "border-gray-800/50 opacity-50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="text-white font-semibold text-sm">
                          {dept.dept_name}
                        </h4>
                        <p className="text-gray-500 text-xs font-mono mt-0.5">
                          {dept.dept_code}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-xs ${
                          dept.is_active ? "text-green-400" : "text-gray-500"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            dept.is_active ? "bg-green-400" : "bg-gray-600"
                          }`}
                        />
                        {dept.is_active ? "활성" : "비활성"}
                      </span>
                    </div>

                    {dept.dept_name_en && (
                      <p className="text-gray-400 text-xs mb-3">
                        {dept.dept_name_en}
                      </p>
                    )}

                    {/* ── 생성된 URL 영역 ── */}
                    {hasPipeline ? (
                      <div className="mb-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 mb-2">
                          <LinkIcon size={12} className="text-indigo-400" />
                          <span className="text-[11px] font-semibold text-indigo-400">
                            생성된 URL
                          </span>
                        </div>
                        {urls.map(({ type, label, url, emoji }) => {
                          const copyKey = `${dept.id}-${type}`;
                          const isCopied = copiedKey === copyKey;
                          return (
                            <div
                              key={type}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/60"
                            >
                              <span className="text-[11px]">{emoji}</span>
                              <span className="text-[11px] text-gray-400 whitespace-nowrap">
                                {label}:
                              </span>
                              <span className="flex-1 text-[10px] text-gray-500 font-mono truncate min-w-0">
                                {url}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyUrl(url, copyKey)}
                                className={`flex-none flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                                  isCopied
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600"
                                }`}
                                title={`${label} URL 복사`}
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={10} />
                                    복사됨
                                  </>
                                ) : (
                                  <>
                                    <Copy size={10} />
                                    복사
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mb-3 px-3 py-2 rounded-lg bg-gray-800/30 border border-dashed border-gray-700">
                        <p className="text-[11px] text-gray-600 text-center">
                          파이프라인 설정 후 URL이 생성됩니다
                        </p>
                      </div>
                    )}

                    <div className="mt-auto flex items-center gap-2 pt-3 border-t border-gray-800">
                      <button
                        onClick={() =>
                          navigate(
                            `/admin/orgs/${orgId}/dept/${dept.id}/pipeline`
                          )
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-indigo-300 hover:bg-gray-800 transition-colors"
                      >
                        <Settings2 size={13} />
                        파이프라인 설정
                      </button>
                      <button
                        onClick={() => handleDeleteDept(dept.id)}
                        className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 부서 추가 모달 */}
          {showDeptAdd && (
            <DeptAddModal
              orgId={orgId}
              onClose={() => setShowDeptAdd(false)}
              onAdded={() => {
                setShowDeptAdd(false);
                fetchOrg();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// 부서 추가 모달
// ═══════════════════════════════════════
function DeptAddModal({ orgId, onClose, onAdded }) {
  const [deptName, setDeptName] = useState("");
  const [deptCode, setDeptCode] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!deptName.trim()) {
      setError("부서명을 입력하세요");
      return;
    }
    if (!deptCode.trim()) {
      setError("부서코드를 입력하세요");
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(deptCode)) {
      setError("부서코드는 영소문자+숫자+언더바만 허용 (영소문자로 시작)");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/departments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          dept_name: deptName.trim(),
          dept_code: deptCode.trim(),
          sort_order: sortOrder,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onAdded?.();
      } else {
        const errMap = {
          dept_code_duplicate: "이미 존재하는 부서코드입니다",
          dept_code_invalid_format: "부서코드 형식이 올바르지 않습니다",
        };
        setError(errMap[data.error] || data.error || "저장 실패");
      }
    } catch {
      setError("서버 연결 오류");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[480px] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h3 className="text-lg font-bold text-white">부서 추가</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* 부서명 */}
          <div>
            <label className={LABEL_CLS}>부서명</label>
            <input
              type="text"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="예: 접수처"
              autoFocus
              className={INPUT_CLS}
            />
          </div>

          {/* 부서코드 */}
          <div>
            <label className={LABEL_CLS}>부서코드</label>
            <input
              type="text"
              value={deptCode}
              onChange={(e) =>
                setDeptCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
              }
              placeholder="예: reception, plastic_surgery"
              className={INPUT_CLS}
            />
            <p className="mt-1 text-xs text-gray-600">
              영소문자 + 숫자 + 언더바만 허용
            </p>
          </div>

          {/* 정렬순서 */}
          <div>
            <label className={LABEL_CLS}>정렬 순서</label>
            <input
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
              className={INPUT_CLS}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving || !deptName.trim() || !deptCode.trim()}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
