import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Building2 } from "lucide-react";
import AdminOrgAdd from "./AdminOrgAdd";

const ORG_TYPE_LABELS = {
  hospital: "병원",
  police: "경찰서",
  court: "법원",
  multicultural: "다문화센터",
  industrial: "산업현장",
  other: "기타",
};

const PLAN_BADGES = {
  trial: { label: "Trial", color: "bg-yellow-500/20 text-yellow-300" },
  free: { label: "Free", color: "bg-gray-500/20 text-gray-300" },
  basic: { label: "Basic", color: "bg-blue-500/20 text-blue-300" },
  pro: { label: "Pro", color: "bg-indigo-500/20 text-indigo-300" },
  enterprise: { label: "Enterprise", color: "bg-emerald-500/20 text-emerald-300" },
};

export default function AdminOrgs() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const fetchOrgs = async () => {
    try {
      const res = await fetch("/api/admin/orgs", { credentials: "include" });
      const data = await res.json();
      if (data.ok) setOrgs(data.orgs || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  const handleAdded = () => {
    setShowAdd(false);
    setLoading(true);
    fetchOrgs();
  };

  return (
    <div className="p-6 lg:p-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">기관 관리</h2>
          <p className="mt-1 text-sm text-gray-500">
            등록된 기관 {orgs.length}개
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
        >
          <Plus size={16} />
          기관 추가
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-gray-500 text-sm py-20 text-center">
          불러오는 중...
        </div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-20">
          <Building2 size={48} className="mx-auto mb-4 text-gray-700" />
          <p className="text-gray-500 text-sm">등록된 기관이 없습니다</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm font-medium"
          >
            + 첫 번째 기관 추가하기
          </button>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">기관코드</th>
                  <th className="px-4 py-3 font-medium">기관명</th>
                  <th className="px-4 py-3 font-medium">유형</th>
                  <th className="px-4 py-3 font-medium">플랜</th>
                  <th className="px-4 py-3 font-medium text-center">상태</th>
                  <th className="px-4 py-3 font-medium text-center">부서</th>
                  <th className="px-4 py-3 font-medium">등록일</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => {
                  const plan = PLAN_BADGES[org.plan] || PLAN_BADGES.free;
                  return (
                    <tr
                      key={org.id}
                      onClick={() => navigate(`/admin/orgs/${org.id}`)}
                      className="border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                        {org.org_code}
                      </td>
                      <td className="px-4 py-3 text-white font-medium">
                        {org.name}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {ORG_TYPE_LABELS[org.org_type] || org.org_type}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${plan.color}`}
                        >
                          {plan.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            org.is_active ? "bg-green-400" : "bg-gray-600"
                          }`}
                        />
                      </td>
                      <td className="px-4 py-3 text-center text-gray-400">
                        {org.dept_count || 0}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {org.created_at
                          ? new Date(org.created_at).toLocaleDateString("ko-KR")
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <AdminOrgAdd
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
