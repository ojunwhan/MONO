import { useState } from "react";
import { X } from "lucide-react";

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

export default function AdminOrgAdd({ onClose, onAdded }) {
  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState("hospital");
  const [plan, setPlan] = useState("trial");
  const [trialDays, setTrialDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("기관명을 입력하세요");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          org_type: orgType,
          plan,
          trial_days: plan === "trial" ? trialDays : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onAdded?.();
      } else {
        setError(data.error || "저장 실패");
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
          <h3 className="text-lg font-bold text-white">기관 추가</h3>
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
          {/* 기관명 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">기관명</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 서울성형외과"
              autoFocus
              className="w-full h-11 px-4 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>

          {/* 기관 유형 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              기관 유형
            </label>
            <select
              value={orgType}
              onChange={(e) => setOrgType(e.target.value)}
              className="w-full h-11 px-4 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors appearance-none cursor-pointer"
            >
              {ORG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* 플랜 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">플랜</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full h-11 px-4 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors appearance-none cursor-pointer"
            >
              {PLANS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* 트라이얼 기간 */}
          {plan === "trial" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">
                트라이얼 기간 (일)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={trialDays}
                onChange={(e) => setTrialDays(Number(e.target.value) || 30)}
                className="w-full h-11 px-4 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
            </div>
          )}

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
            disabled={saving || !name.trim()}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
