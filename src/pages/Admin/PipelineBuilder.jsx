import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Save, X, ChevronRight } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import {
  PIPELINE_LANES,
  PIPELINE_BLOCKS,
  PRESETS,
} from "../../constants/pipelineBlocks";

// ── 블럭 ID → 정의 매핑 ──
const BLOCK_MAP = Object.fromEntries(PIPELINE_BLOCKS.map((b) => [b.id, b]));

// ── 레인별 블럭 그룹핑 ──
const BLOCKS_BY_LANE = {};
for (const b of PIPELINE_BLOCKS) {
  if (!BLOCKS_BY_LANE[b.lane]) BLOCKS_BY_LANE[b.lane] = [];
  BLOCKS_BY_LANE[b.lane].push(b);
}

// ═══════════════════════════════════════
// 드래그 가능한 블럭 카드 (팔레트용)
// ═══════════════════════════════════════
function PaletteBlock({ block }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${block.id}`,
    data: { type: "palette", block },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 cursor-grab active:cursor-grabbing select-none transition-all"
      style={{
        width: 80,
        height: 90,
        backgroundColor: `${block.color}15`,
        borderColor: isDragging ? block.color : `${block.color}40`,
        boxShadow: isDragging
          ? `0 8px 24px ${block.color}30`
          : `0 2px 8px rgba(0,0,0,0.15)`,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <span className="text-2xl leading-none">{block.icon}</span>
      <span
        className="text-[10px] font-medium text-center leading-tight px-1"
        style={{ color: block.color }}
      >
        {block.label}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════
// 블럭 카드 (캔버스 내 표시용 — non-draggable)
// ═══════════════════════════════════════
function BlockCard({ block, onRemove }) {
  return (
    <div
      className="relative flex flex-col items-center justify-center gap-1 rounded-xl border-2"
      style={{
        width: 80,
        height: 90,
        backgroundColor: `${block.color}15`,
        borderColor: block.color,
        boxShadow: `0 2px 8px rgba(0,0,0,0.15)`,
      }}
    >
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center text-gray-400 hover:text-red-400 hover:border-red-400 transition-colors"
        >
          <X size={10} />
        </button>
      )}
      <span className="text-2xl leading-none">{block.icon}</span>
      <span
        className="text-[10px] font-medium text-center leading-tight px-1"
        style={{ color: block.color }}
      >
        {block.label}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════
// 오버레이용 블럭 (드래그 중 표시)
// ═══════════════════════════════════════
function DragOverlayBlock({ block }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 shadow-2xl"
      style={{
        width: 80,
        height: 90,
        backgroundColor: `${block.color}25`,
        borderColor: block.color,
        boxShadow: `0 12px 32px ${block.color}40`,
      }}
    >
      <span className="text-2xl leading-none">{block.icon}</span>
      <span
        className="text-[10px] font-medium text-center leading-tight px-1"
        style={{ color: block.color }}
      >
        {block.label}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════
// 드롭 존 (캔버스 레인)
// ═══════════════════════════════════════
function LaneDropZone({ lane, placedBlockId, onRemove }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `lane-${lane.id}`,
    data: { type: "lane", laneId: lane.id },
  });

  const block = placedBlockId ? BLOCK_MAP[placedBlockId] : null;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col items-center rounded-xl border-2 transition-all ${
        isOver
          ? "border-indigo-400 bg-indigo-500/10 scale-[1.02]"
          : "border-gray-700 bg-gray-900/50"
      }`}
      style={{ width: 120, minHeight: 160 }}
    >
      {/* 레인 헤더 */}
      <div className="w-full py-2 text-center border-b border-gray-700/50">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {lane.label}
        </span>
      </div>

      {/* 블럭 영역 */}
      <div className="flex-1 flex items-center justify-center p-3">
        {block ? (
          <BlockCard block={block} onRemove={() => onRemove(lane.id)} />
        ) : (
          <div className="flex flex-col items-center justify-center w-[80px] h-[90px] rounded-lg border-2 border-dashed border-gray-700 text-gray-600">
            <span className="text-[10px] text-center leading-tight">
              블럭을
              <br />
              여기에
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// 메인 PipelineBuilder
// ═══════════════════════════════════════
export default function PipelineBuilder() {
  const { orgId, deptId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [deptName, setDeptName] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  // 캔버스 상태: { input: 'kiosk_qr', stt: null, ... }
  const [canvas, setCanvas] = useState(() => {
    const init = {};
    for (const l of PIPELINE_LANES) init[l.id] = null;
    return init;
  });

  // 드래그 중인 블럭
  const [activeBlock, setActiveBlock] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // ── 데이터 로드 ──
  const fetchData = useCallback(async () => {
    try {
      // 기관 + 부서 정보
      const orgRes = await fetch(`/api/admin/orgs/${orgId}`, {
        credentials: "include",
      });
      const orgData = await orgRes.json();
      if (orgData.ok) {
        setOrgName(orgData.org?.name || "");
        const dept = (orgData.departments || []).find(
          (d) => String(d.id) === String(deptId)
        );
        setDeptName(dept?.dept_name || "");
      }

      // 파이프라인 설정
      const pipeRes = await fetch(
        `/api/admin/orgs/${orgId}/departments/${deptId}/pipeline`,
        { credentials: "include" }
      );
      const pipeData = await pipeRes.json();
      if (pipeData.ok && pipeData.config) {
        setCanvas((prev) => {
          const next = { ...prev };
          for (const [lane, blockId] of Object.entries(pipeData.config)) {
            if (next.hasOwnProperty(lane) && BLOCK_MAP[blockId]) {
              next[lane] = blockId;
            }
          }
          return next;
        });
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [orgId, deptId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── 프리셋 적용 ──
  const applyPreset = (presetKey) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    setCanvas((prev) => {
      const next = { ...prev };
      for (const l of PIPELINE_LANES) {
        next[l.id] = preset.blocks[l.id] || null;
      }
      return next;
    });
  };

  // ── 레인에서 블럭 제거 ──
  const removeFromLane = (laneId) => {
    setCanvas((prev) => ({ ...prev, [laneId]: null }));
  };

  // ── DnD 핸들러 ──
  const handleDragStart = (event) => {
    const { active } = event;
    const data = active.data?.current;
    if (data?.type === "palette" && data?.block) {
      setActiveBlock(data.block);
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveBlock(null);

    if (!over) return;
    const overData = over.data?.current;
    const activeData = active.data?.current;

    if (
      overData?.type === "lane" &&
      activeData?.type === "palette" &&
      activeData?.block
    ) {
      const block = activeData.block;
      const laneId = overData.laneId;

      // 블럭이 해당 레인에 속하는지 확인
      if (block.lane === laneId) {
        setCanvas((prev) => ({ ...prev, [laneId]: block.id }));
      }
    }
  };

  // ── 저장 ──
  const handleSave = async () => {
    setSaving(true);
    setToast("");
    try {
      // null 값 제거 후 저장
      const config = {};
      for (const [lane, blockId] of Object.entries(canvas)) {
        if (blockId) config[lane] = blockId;
      }
      const res = await fetch(
        `/api/admin/orgs/${orgId}/departments/${deptId}/pipeline`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ config }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        setToast("저장되었습니다 ✓");
        setTimeout(() => setToast(""), 2000);
      } else {
        setToast(`오류: ${data.error}`);
      }
    } catch {
      setToast("서버 연결 오류");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-10 text-gray-500 text-sm">불러오는 중...</div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full min-h-[100dvh]">
        {/* ══════════════════════════════ */}
        {/* 상단 헤더 */}
        {/* ══════════════════════════════ */}
        <div className="flex-none flex items-center gap-3 px-6 py-4 border-b border-gray-800 bg-gray-950">
          <button
            onClick={() => navigate(`/admin/orgs/${orgId}`)}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-sm text-gray-400">
              <span className="truncate">{orgName}</span>
              <ChevronRight size={14} />
              <span className="truncate text-white font-medium">
                {deptName}
              </span>
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">
              파이프라인 설정
            </h2>
          </div>

          {/* 프리셋 */}
          <select
            onChange={(e) => {
              if (e.target.value) applyPreset(e.target.value);
              e.target.value = "";
            }}
            defaultValue=""
            className="h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none"
          >
            <option value="" disabled>
              프리셋 적용
            </option>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>

          {/* 저장 */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
          >
            <Save size={14} />
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>

        {/* 토스트 */}
        {toast && (
          <div
            className={`text-center py-2 text-sm font-medium ${
              toast.includes("✓")
                ? "bg-green-500/10 text-green-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {toast}
          </div>
        )}

        {/* ══════════════════════════════ */}
        {/* 메인 영역: 팔레트 + 캔버스 */}
        {/* ══════════════════════════════ */}
        <div className="flex-1 flex overflow-hidden">
          {/* ── 왼쪽 팔레트 ── */}
          <aside className="w-[200px] flex-shrink-0 border-r border-gray-800 bg-gray-900/50 overflow-y-auto">
            <div className="p-4 space-y-5">
              {PIPELINE_LANES.map((lane) => {
                const blocks = BLOCKS_BY_LANE[lane.id] || [];
                if (blocks.length === 0) return null;
                return (
                  <div key={lane.id}>
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                      {lane.label}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {blocks.map((block) => (
                        <PaletteBlock key={block.id} block={block} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ── 오른쪽 캔버스 ── */}
          <main className="flex-1 overflow-x-auto overflow-y-auto bg-gray-950 p-6 lg:p-10">
            <div className="flex items-start gap-3 min-w-max mx-auto">
              {PIPELINE_LANES.map((lane, idx) => (
                <div key={lane.id} className="flex items-center">
                  <LaneDropZone
                    lane={lane}
                    placedBlockId={canvas[lane.id]}
                    onRemove={removeFromLane}
                  />
                  {/* 레인 사이 화살표 */}
                  {idx < PIPELINE_LANES.length - 1 && (
                    <div className="flex items-center px-2 text-gray-600">
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 가이드 텍스트 */}
            <p className="text-center text-xs text-gray-600 mt-8">
              왼쪽 팔레트에서 블럭을 드래그하여 해당 레인에 배치하세요.
              <br />
              같은 레인에 다른 블럭을 드롭하면 기존 블럭이 교체됩니다.
            </p>
          </main>
        </div>
      </div>

      {/* ── 드래그 오버레이 ── */}
      <DragOverlay dropAnimation={null}>
        {activeBlock ? <DragOverlayBlock block={activeBlock} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
