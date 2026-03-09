/**
 * VisualPipelineBuilder — 마우스 블럭 연결 기반 파이프라인 빌더
 * Route: /admin/pipeline (standalone) 또는 /admin/orgs/:orgId/dept/:deptId/pipeline (기관·부서 연동)
 *
 * 순수 React + SVG (외부 라이브러리 없음)
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";

// ═══════════════════════════════════════
// 블럭 정의 (15개, 5 카테고리)
// ═══════════════════════════════════════
const CATEGORIES = [
  {
    id: "input",
    label: "입력",
    color: "#00c9a7",
    blocks: [
      { type: "vad", label: "VAD 음성감지", desc: "Silero VAD 자동 감지" },
      { type: "ptt", label: "PTT 버튼", desc: "Push-to-Talk 수동" },
      { type: "text_input", label: "텍스트 입력", desc: "키보드 직접 입력" },
    ],
  },
  {
    id: "process",
    label: "처리",
    color: "#a78bfa",
    blocks: [
      { type: "stt_whisper", label: "STT·Whisper", desc: "whisper-large-v3 / Groq" },
      { type: "translate_gpt4o", label: "번역·GPT-4o", desc: "OpenAI GPT-4o 번역" },
      { type: "context_inject", label: "컨텍스트 주입", desc: "의료용어 보정" },
    ],
  },
  {
    id: "session",
    label: "세션",
    color: "#38bdf8",
    blocks: [
      { type: "qr_scan", label: "QR 스캔", desc: "환자QR→채널생성" },
      { type: "kiosk_fixed", label: "키오스크 고정", desc: "태블릿 고정 화면" },
      { type: "fixed_url", label: "고정 URL", desc: "고정 주소 접속" },
      { type: "auto_reset", label: "자동 리셋", desc: "세션 종료 후 리셋" },
    ],
  },
  {
    id: "output",
    label: "출력",
    color: "#fbbf24",
    blocks: [
      { type: "subtitle", label: "자막형", desc: "실시간 자막 표시" },
      { type: "chat_bubble", label: "채팅형", desc: "채팅 버블 UI" },
    ],
  },
  {
    id: "storage",
    label: "저장",
    color: "#f87171",
    blocks: [
      { type: "no_record", label: "무기록", desc: "보안최강 · 저장 없음" },
      { type: "db_save", label: "DB 저장", desc: "병원내부 DB 저장" },
      { type: "summary_only", label: "요약만 저장", desc: "AI 요약 후 저장" },
    ],
  },
];

const ALL_BLOCKS = CATEGORIES.flatMap((c) =>
  c.blocks.map((b) => ({ ...b, categoryId: c.id, color: c.color }))
);

function getBlockMeta(type) {
  return ALL_BLOCKS.find((b) => b.type === type) || null;
}

// ═══════════════════════════════════════
// 병원 프리셋
// ═══════════════════════════════════════
const HOSPITAL_PRESET = {
  blocks: [
    { id: "b1", type: "qr_scan", x: 80, y: 120 },
    { id: "b2", type: "vad", x: 320, y: 120 },
    { id: "b3", type: "stt_whisper", x: 560, y: 120 },
    { id: "b4", type: "translate_gpt4o", x: 800, y: 120 },
    { id: "b5", type: "subtitle", x: 1040, y: 60 },
    { id: "b6", type: "chat_bubble", x: 1040, y: 200 },
    { id: "b7", type: "db_save", x: 1280, y: 120 },
  ],
  connections: [
    { id: "c1", from: "b1", to: "b2" },
    { id: "c2", from: "b2", to: "b3" },
    { id: "c3", from: "b3", to: "b4" },
    { id: "c4", from: "b4", to: "b5" },
    { id: "c5", from: "b4", to: "b6" },
    { id: "c6", from: "b5", to: "b7" },
    { id: "c7", from: "b6", to: "b7" },
  ],
};

// 레인 형식 블럭 ID → Visual 타입 매핑 (기존 DB 데이터 로드 시 사용)
const LANE_BLOCK_ID_TO_VISUAL_TYPE = {
  kiosk_qr: "qr_scan",
  staff_ptt: "ptt",
  text_input: "text_input",
  groq_whisper: "stt_whisper",
  vad_auto: "vad",
  gpt4o_hospital: "translate_gpt4o",
  gpt4o_general: "translate_gpt4o",
  gpt4o_legal: "translate_gpt4o",
  gpt4o_industrial: "translate_gpt4o",
  qr_scan: "qr_scan",
  fixed_url: "fixed_url",
  auto_reset: "auto_reset",
  subtitle: "subtitle",
  chat_bubble: "chat_bubble",
  no_record: "no_record",
  db_save: "db_save",
  summary: "summary_only",
};

const LANE_ORDER = ["input", "stt", "translate", "session", "output", "storage"];

// ═══════════════════════════════════════
// 블럭 사이즈 상수
// ═══════════════════════════════════════
const BLOCK_W = 200;
const BLOCK_H = 72;
const PORT_R = 7;

let _nextId = 1;
function uid(prefix = "n") {
  return `${prefix}_${Date.now()}_${_nextId++}`;
}

// ═══════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════
export default function VisualPipelineBuilder() {
  const { orgId, deptId } = useParams();
  const navigate = useNavigate();
  const isOrgDeptMode = Boolean(orgId && deptId);

  // ── State ──
  const [blocks, setBlocks] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedBlockId, setSelectedBlockId] = useState(null);

  // org/dept 모드: 헤더용 + 로드/저장
  const [orgName, setOrgName] = useState("");
  const [deptName, setDeptName] = useState("");
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(isOrgDeptMode);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  // 드래그
  const [dragging, setDragging] = useState(null); // { blockId, offsetX, offsetY }
  // 연결 중
  const [connecting, setConnecting] = useState(null); // { fromBlockId, mouseX, mouseY }
  // 호버 연결선
  const [hoveredConn, setHoveredConn] = useState(null);

  const canvasRef = useRef(null);
  const svgRef = useRef(null);

  // ── 캔버스 영역 크기 ──
  const [canvasSize, setCanvasSize] = useState({ w: 1600, h: 500 });
  useEffect(() => {
    const updateSize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setCanvasSize({ w: rect.width, h: rect.height });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // ── org/dept 모드: 기관 정보 + 파이프라인 로드 ──
  const fetchOrgAndPipeline = useCallback(async () => {
    if (!isOrgDeptMode || !orgId || !deptId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const orgRes = await fetch(`/api/admin/orgs/${orgId}`, { credentials: "include" });
      const orgData = await orgRes.json();
      if (!orgData.ok) {
        setLoadError(orgData.error || "기관 정보를 불러올 수 없습니다.");
        return;
      }
      setOrgName(orgData.org?.name || "");
      const dept = (orgData.departments || []).find((d) => String(d.id) === String(deptId));
      setDeptName(dept?.dept_name || "");

      const pipeRes = await fetch(
        `/api/admin/orgs/${orgId}/departments/${deptId}/pipeline`,
        { credentials: "include" }
      );
      const pipeData = await pipeRes.json();
      if (pipeData.ok && pipeData.config) {
        const config = pipeData.config;
        if (config.visual?.blocks?.length) {
          setBlocks(config.visual.blocks.map((b) => ({ ...b })));
          setConnections((config.visual.connections || []).map((c) => ({ ...c })));
        } else {
          // 레인 형식 → 시각형으로 변환
          const laneBlocks = LANE_ORDER.map((lane) => config[lane]).filter(Boolean);
          const visualType = (id) => LANE_BLOCK_ID_TO_VISUAL_TYPE[id] || null;
          const newBlocks = [];
          const newConns = [];
          let bid = 0;
          const blockIds = [];
          for (let i = 0; i < laneBlocks.length; i++) {
            const vt = visualType(laneBlocks[i]);
            if (!vt || !getBlockMeta(vt)) continue;
            const id = `b${++bid}_${Date.now()}`;
            blockIds.push(id);
            newBlocks.push({
              id,
              type: vt,
              x: 80 + i * 240,
              y: 120,
            });
            if (i > 0) newConns.push({ id: `c${i}_${Date.now()}`, from: blockIds[i - 1], to: id });
          }
          setBlocks(newBlocks);
          setConnections(newConns);
        }
      }
    } catch (e) {
      setLoadError(e?.message || "로드 실패");
    } finally {
      setLoading(false);
    }
  }, [isOrgDeptMode, orgId, deptId]);

  useEffect(() => {
    if (isOrgDeptMode) fetchOrgAndPipeline();
  }, [isOrgDeptMode, fetchOrgAndPipeline]);

  // ── 저장 (org/dept 모드): visual + translate, output 유도 ──
  const savePipeline = useCallback(async () => {
    if (!isOrgDeptMode || !orgId || !deptId) return;
    setSaving(true);
    setToast("");
    try {
      let translate = "gpt4o_general";
      let output = "subtitle";
      for (const b of blocks) {
        if (b.type === "translate_gpt4o") translate = "gpt4o_general";
        if (b.type === "subtitle") output = "subtitle";
        if (b.type === "chat_bubble") output = "chat_bubble";
      }
      const config = {
        visual: { blocks, connections },
        translate,
        output,
      };
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
        setToast(data.error || "저장 실패");
      }
    } catch {
      setToast("서버 연결 오류");
    } finally {
      setSaving(false);
    }
  }, [isOrgDeptMode, orgId, deptId, blocks, connections]);

  // ── 블럭 추가 (팔레트 클릭) ──
  const addBlock = useCallback(
    (type) => {
      const meta = getBlockMeta(type);
      if (!meta) return;
      // 기존 블럭들과 겹치지 않는 위치 계산
      const existing = blocks.length;
      const col = existing % 5;
      const row = Math.floor(existing / 5);
      const x = 60 + col * 240;
      const y = 50 + row * 110;
      setBlocks((prev) => [...prev, { id: uid("b"), type, x, y }]);
    },
    [blocks.length]
  );

  // ── 블럭 삭제 ──
  const deleteBlock = useCallback(
    (blockId) => {
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      setConnections((prev) =>
        prev.filter((c) => c.from !== blockId && c.to !== blockId)
      );
      if (selectedBlockId === blockId) setSelectedBlockId(null);
    },
    [selectedBlockId]
  );

  // ── 연결 삭제 ──
  const deleteConnection = useCallback((connId) => {
    setConnections((prev) => prev.filter((c) => c.id !== connId));
    setHoveredConn(null);
  }, []);

  // ── 초기화 ──
  const clearAll = useCallback(() => {
    setBlocks([]);
    setConnections([]);
    setSelectedBlockId(null);
    setConnecting(null);
    setDragging(null);
    setHoveredConn(null);
  }, []);

  // ── 병원 예시 로드 ──
  const loadHospitalPreset = useCallback(() => {
    setBlocks(HOSPITAL_PRESET.blocks.map((b) => ({ ...b })));
    setConnections(HOSPITAL_PRESET.connections.map((c) => ({ ...c })));
    setSelectedBlockId(null);
    setConnecting(null);
  }, []);

  // ═══════════════════════════════════════
  // 캔버스 마우스 핸들러
  // ═══════════════════════════════════════
  const getCanvasCoords = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // 블럭 드래그 시작
  const onBlockMouseDown = useCallback(
    (e, blockId) => {
      e.stopPropagation();
      if (connecting) return; // 연결 모드 중엔 드래그 안함
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return;
      const coords = getCanvasCoords(e);
      setDragging({
        blockId,
        offsetX: coords.x - block.x,
        offsetY: coords.y - block.y,
      });
      setSelectedBlockId(blockId);
    },
    [blocks, connecting, getCanvasCoords]
  );

  // 마우스 이동 (드래그 + 연결선 미리보기)
  const onCanvasMouseMove = useCallback(
    (e) => {
      const coords = getCanvasCoords(e);
      if (dragging) {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === dragging.blockId
              ? {
                  ...b,
                  x: Math.max(0, Math.min(coords.x - dragging.offsetX, canvasSize.w - BLOCK_W)),
                  y: Math.max(0, Math.min(coords.y - dragging.offsetY, canvasSize.h - BLOCK_H)),
                }
              : b
          )
        );
      }
      if (connecting) {
        setConnecting((prev) =>
          prev ? { ...prev, mouseX: coords.x, mouseY: coords.y } : null
        );
      }
    },
    [dragging, connecting, getCanvasCoords, canvasSize]
  );

  // 마우스 업
  const onCanvasMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // 캔버스 클릭 (선택 해제)
  const onCanvasClick = useCallback(
    (e) => {
      if (e.target === canvasRef.current || e.target === svgRef.current) {
        setSelectedBlockId(null);
        if (connecting) setConnecting(null);
      }
    },
    [connecting]
  );

  // ── 출력 포트 클릭 (연결 시작) ──
  const onOutputPortClick = useCallback(
    (e, blockId) => {
      e.stopPropagation();
      const coords = getCanvasCoords(e);
      if (connecting) {
        // 이미 연결 중이면 취소
        setConnecting(null);
        return;
      }
      setConnecting({ fromBlockId: blockId, mouseX: coords.x, mouseY: coords.y });
    },
    [connecting, getCanvasCoords]
  );

  // ── 입력 포트 클릭 (연결 완료) ──
  const onInputPortClick = useCallback(
    (e, blockId) => {
      e.stopPropagation();
      if (!connecting) return;
      if (connecting.fromBlockId === blockId) {
        setConnecting(null);
        return;
      }
      // 중복 연결 방지
      const exists = connections.some(
        (c) => c.from === connecting.fromBlockId && c.to === blockId
      );
      if (!exists) {
        setConnections((prev) => [
          ...prev,
          { id: uid("c"), from: connecting.fromBlockId, to: blockId },
        ]);
      }
      setConnecting(null);
    },
    [connecting, connections]
  );

  // ═══════════════════════════════════════
  // 연결선 경로 계산
  // ═══════════════════════════════════════
  const getConnectionPath = useCallback(
    (fromId, toId) => {
      const fromBlock = blocks.find((b) => b.id === fromId);
      const toBlock = blocks.find((b) => b.id === toId);
      if (!fromBlock || !toBlock) return null;
      const x1 = fromBlock.x + BLOCK_W;
      const y1 = fromBlock.y + BLOCK_H / 2;
      const x2 = toBlock.x;
      const y2 = toBlock.y + BLOCK_H / 2;
      const cx = Math.abs(x2 - x1) * 0.5;
      return {
        x1, y1, x2, y2,
        path: `M${x1},${y1} C${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`,
        midX: (x1 + x2) / 2,
        midY: (y1 + y2) / 2,
        color: getBlockMeta(fromBlock.type)?.color || "#555",
      };
    },
    [blocks]
  );

  // 연결 미리보기 경로
  const previewPath = useMemo(() => {
    if (!connecting) return null;
    const fromBlock = blocks.find((b) => b.id === connecting.fromBlockId);
    if (!fromBlock) return null;
    const x1 = fromBlock.x + BLOCK_W;
    const y1 = fromBlock.y + BLOCK_H / 2;
    const x2 = connecting.mouseX;
    const y2 = connecting.mouseY;
    const cx = Math.abs(x2 - x1) * 0.4;
    return {
      path: `M${x1},${y1} C${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`,
      color: getBlockMeta(fromBlock.type)?.color || "#555",
    };
  }, [connecting, blocks]);

  // ═══════════════════════════════════════
  // Render
  // ═══════════════════════════════════════
  if (isOrgDeptMode && loading) {
    return (
      <div style={{ width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#060c18", color: "#64748b" }}>
        불러오는 중...
      </div>
    );
  }
  if (isOrgDeptMode && loadError) {
    return (
      <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#060c18", color: "#f87171", gap: 16 }}>
        <span>{loadError}</span>
        <button
          type="button"
          onClick={() => navigate(`/admin/orgs/${orgId}`)}
          style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #1e293b", background: "#0f172a", color: "#e2e8f0", cursor: "pointer" }}
        >
          기관으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#060c18",
        fontFamily: "'Oxanium', 'Inter', system-ui, sans-serif",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Google Fonts import */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Oxanium:wght@300;400;500;600;700&display=swap');`}</style>

      {/* ── Header ── */}
      <Header
        blockCount={blocks.length}
        connectionCount={connections.length}
        onLoadPreset={loadHospitalPreset}
        onClear={clearAll}
        isOrgDeptMode={isOrgDeptMode}
        onBack={isOrgDeptMode ? () => navigate(`/admin/orgs/${orgId}`) : null}
        orgName={orgName}
        deptName={deptName}
        onSave={isOrgDeptMode ? savePipeline : null}
        saving={saving}
        toast={toast}
      />

      {/* ── Canvas (58%) ── */}
      <div
        ref={canvasRef}
        style={{
          flex: "0 0 58%",
          position: "relative",
          overflow: "hidden",
          cursor: dragging ? "grabbing" : connecting ? "crosshair" : "default",
        }}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={onCanvasMouseUp}
        onClick={onCanvasClick}
      >
        {/* 점 그리드 배경 */}
        <DotGrid width={canvasSize.w} height={canvasSize.h} />

        {/* SVG 연결선 레이어 */}
        <svg
          ref={svgRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#888" />
            </marker>
            {/* 흐르는 애니메이션용 */}
            {connections.map((conn) => {
              const pathData = getConnectionPath(conn.from, conn.to);
              if (!pathData) return null;
              return (
                <linearGradient
                  key={`grad-${conn.id}`}
                  id={`flow-${conn.id}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor={pathData.color} stopOpacity="0.2">
                    <animate
                      attributeName="offset"
                      values="-0.5;1"
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                  </stop>
                  <stop offset="50%" stopColor={pathData.color} stopOpacity="1">
                    <animate
                      attributeName="offset"
                      values="0;1.5"
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                  </stop>
                  <stop offset="100%" stopColor={pathData.color} stopOpacity="0.2">
                    <animate
                      attributeName="offset"
                      values="0.5;2"
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                  </stop>
                </linearGradient>
              );
            })}
          </defs>

          {/* 실제 연결선 */}
          {connections.map((conn) => {
            const pathData = getConnectionPath(conn.from, conn.to);
            if (!pathData) return null;
            const isHovered = hoveredConn === conn.id;
            return (
              <g key={conn.id}>
                {/* 배경 라인 (glow) */}
                <path
                  d={pathData.path}
                  fill="none"
                  stroke={pathData.color}
                  strokeWidth={isHovered ? 5 : 3}
                  strokeOpacity={0.15}
                  style={{ filter: "blur(4px)" }}
                />
                {/* 메인 라인 */}
                <path
                  d={pathData.path}
                  fill="none"
                  stroke={`url(#flow-${conn.id})`}
                  strokeWidth={isHovered ? 3 : 2}
                  markerEnd="url(#arrowhead)"
                />
                {/* 히트 영역 (클릭용) */}
                <path
                  d={pathData.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onMouseEnter={() => setHoveredConn(conn.id)}
                  onMouseLeave={() => setHoveredConn(null)}
                />
                {/* × 삭제 버튼 */}
                {isHovered && (
                  <g
                    style={{ cursor: "pointer", pointerEvents: "all" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConnection(conn.id);
                    }}
                  >
                    <circle
                      cx={pathData.midX}
                      cy={pathData.midY}
                      r={11}
                      fill="#1e1e2e"
                      stroke="#f87171"
                      strokeWidth={1.5}
                    />
                    <text
                      x={pathData.midX}
                      y={pathData.midY + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#f87171"
                      fontSize="14"
                      fontWeight="700"
                      style={{ pointerEvents: "none" }}
                    >
                      ×
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* 연결 미리보기 */}
          {previewPath && (
            <path
              d={previewPath.path}
              fill="none"
              stroke={previewPath.color}
              strokeWidth={2}
              strokeDasharray="8 4"
              strokeOpacity={0.6}
            />
          )}
        </svg>

        {/* 블럭 렌더 */}
        {blocks.map((block) => {
          const meta = getBlockMeta(block.type);
          if (!meta) return null;
          const isSelected = selectedBlockId === block.id;
          return (
            <CanvasBlock
              key={block.id}
              block={block}
              meta={meta}
              isSelected={isSelected}
              isConnecting={!!connecting}
              onMouseDown={(e) => onBlockMouseDown(e, block.id)}
              onDelete={() => deleteBlock(block.id)}
              onOutputPortClick={(e) => onOutputPortClick(e, block.id)}
              onInputPortClick={(e) => onInputPortClick(e, block.id)}
            />
          );
        })}

        {/* 빈 캔버스 안내 */}
        {blocks.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#334155",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            <span style={{ fontSize: 48, opacity: 0.4 }}>⬡</span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              아래 팔레트에서 블럭을 클릭하여 추가하세요
            </span>
          </div>
        )}
      </div>

      {/* ── Palette (42%) ── */}
      <Palette categories={CATEGORIES} onAddBlock={addBlock} />
    </div>
  );
}

// ═══════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════

function Header({ blockCount, connectionCount, onLoadPreset, onClear, isOrgDeptMode, onBack, orgName, deptName, onSave, saving, toast }) {
  return (
    <div
      style={{
        flexShrink: 0,
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        borderBottom: "1px solid #1e293b",
        background: "linear-gradient(180deg, #0a1628 0%, #060c18 100%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {isOrgDeptMode && onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              padding: 6,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="기관으로"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        )}
        {isOrgDeptMode ? (
          <div>
            <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{orgName}</span>
              <span>/</span>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{deptName}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>파이프라인 설정</div>
          </div>
        ) : (
          <>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", letterSpacing: 1.2 }}>
              MONO<span style={{ color: "#38bdf8" }}>·</span>Pipeline Builder
            </span>
            <div
              style={{
                display: "flex",
                gap: 10,
                marginLeft: 12,
                fontSize: 11,
                color: "#64748b",
              }}
            >
              <span>
                <b style={{ color: "#94a3b8" }}>{blockCount}</b> 블럭
              </span>
              <span>·</span>
              <span>
                <b style={{ color: "#94a3b8" }}>{connectionCount}</b> 연결
              </span>
            </div>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isOrgDeptMode && onSave && (
          <>
            {toast && (
              <span style={{ fontSize: 12, color: toast.includes("✓") ? "#34d399" : "#f87171" }}>{toast}</span>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid #3730a3",
                background: "#4f46e5",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </>
        )}
        {!isOrgDeptMode && (
          <>
            <button
          type="button"
          onClick={onLoadPreset}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid #1e3a5f",
            background: "rgba(56,189,248,0.08)",
            color: "#38bdf8",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(56,189,248,0.18)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(56,189,248,0.08)";
          }}
        >
          🏥 병원 예시 로드
        </button>
        <button
          type="button"
          onClick={onClear}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid #1e293b",
            background: "rgba(248,113,113,0.06)",
            color: "#f87171",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(248,113,113,0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(248,113,113,0.06)";
          }}
        >
          ↺ 초기화
        </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 캔버스 블럭 ──
function CanvasBlock({
  block,
  meta,
  isSelected,
  isConnecting,
  onMouseDown,
  onDelete,
  onOutputPortClick,
  onInputPortClick,
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        left: block.x,
        top: block.y,
        width: BLOCK_W,
        height: BLOCK_H,
        borderRadius: 12,
        background: isSelected ? "#141c2e" : "#0f1729",
        border: `1.5px solid ${isSelected ? meta.color : "#1e293b"}`,
        borderLeft: `4px solid ${meta.color}`,
        boxShadow: isSelected
          ? `0 0 20px ${meta.color}22, 0 4px 12px rgba(0,0,0,0.4)`
          : "0 2px 8px rgba(0,0,0,0.3)",
        cursor: isConnecting ? "crosshair" : "grab",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "10px 14px 10px 16px",
        transition: "border-color 0.15s, box-shadow 0.15s, background 0.15s",
        zIndex: isSelected ? 10 : 1,
      }}
    >
      {/* 삭제 버튼 */}
      {isSelected && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#f87171",
            border: "2px solid #0f1729",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            zIndex: 20,
          }}
        >
          ×
        </button>
      )}

      {/* 라벨 */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#e2e8f0",
          lineHeight: 1.3,
        }}
      >
        {meta.label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "#64748b",
          marginTop: 2,
          lineHeight: 1.3,
        }}
      >
        {meta.desc}
      </span>

      {/* 입력 포트 (왼쪽) */}
      <div
        onClick={onInputPortClick}
        style={{
          position: "absolute",
          left: -PORT_R,
          top: BLOCK_H / 2 - PORT_R,
          width: PORT_R * 2,
          height: PORT_R * 2,
          borderRadius: "50%",
          background: isConnecting ? meta.color : "#1e293b",
          border: `2px solid ${meta.color}`,
          cursor: "pointer",
          transition: "background 0.15s, transform 0.15s",
          zIndex: 15,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.3)";
          e.currentTarget.style.background = meta.color;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.background = isConnecting ? meta.color : "#1e293b";
        }}
      />

      {/* 출력 포트 (오른쪽) */}
      <div
        onClick={onOutputPortClick}
        style={{
          position: "absolute",
          right: -PORT_R,
          top: BLOCK_H / 2 - PORT_R,
          width: PORT_R * 2,
          height: PORT_R * 2,
          borderRadius: "50%",
          background: "#1e293b",
          border: `2px solid ${meta.color}`,
          cursor: "pointer",
          transition: "background 0.15s, transform 0.15s",
          zIndex: 15,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.3)";
          e.currentTarget.style.background = meta.color;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.background = "#1e293b";
        }}
      />
    </div>
  );
}

// ── 점 그리드 배경 ──
function DotGrid({ width, height }) {
  const gap = 24;
  const dots = [];
  for (let x = gap; x < width; x += gap) {
    for (let y = gap; y < height; y += gap) {
      dots.push(
        <circle key={`${x}-${y}`} cx={x} cy={y} r={0.8} fill="#1e293b" />
      );
    }
  }
  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      {dots}
    </svg>
  );
}

// ── 팔레트 ──
function Palette({ categories, onAddBlock }) {
  return (
    <div
      style={{
        flex: "0 0 42%",
        borderTop: "1px solid #1e293b",
        background: "linear-gradient(180deg, #0a1225 0%, #060c18 100%)",
        overflowX: "auto",
        overflowY: "auto",
        padding: "16px 20px",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 20,
          minWidth: "max-content",
        }}
      >
        {categories.map((cat) => (
          <div
            key={cat.id}
            style={{
              minWidth: 200,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {/* 카테고리 헤더 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: cat.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: cat.color,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                {cat.label}
              </span>
            </div>

            {/* 블럭 목록 */}
            {cat.blocks.map((block) => (
              <button
                type="button"
                key={block.type}
                onClick={() => onAddBlock(block.type)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #1e293b",
                  borderLeft: `3px solid ${cat.color}`,
                  background: "#0c1322",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#141c2e";
                  e.currentTarget.style.borderColor = cat.color;
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = `0 4px 12px ${cat.color}15`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#0c1322";
                  e.currentTarget.style.borderColor = "#1e293b";
                  e.currentTarget.style.borderLeftColor = cat.color;
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#e2e8f0",
                  }}
                >
                  {block.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#64748b",
                    lineHeight: 1.3,
                  }}
                >
                  {block.desc}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
