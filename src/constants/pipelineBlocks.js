export const PIPELINE_LANES = [
  { id: 'input',     label: '입력' },
  { id: 'stt',       label: 'STT' },
  { id: 'translate', label: '번역' },
  { id: 'session',   label: '세션' },
  { id: 'output',    label: '출력' },
  { id: 'storage',   label: '저장' },
];

export const PIPELINE_BLOCKS = [
  // 입력
  { id: 'kiosk_qr',   lane: 'input',     label: '키오스크 QR',  icon: '🖥️',  color: '#6366F1' },
  { id: 'staff_ptt',  lane: 'input',     label: '직원 PTT',     icon: '🎙️',  color: '#6366F1' },
  { id: 'text_input', lane: 'input',     label: '텍스트 입력',  icon: '⌨️',  color: '#6366F1' },
  // STT
  { id: 'groq_whisper', lane: 'stt',     label: 'Whisper',      icon: '⚡',  color: '#0EA5E9' },
  { id: 'vad_auto',   lane: 'stt',       label: 'VAD 자동',     icon: '🎯',  color: '#0EA5E9' },
  // 번역
  { id: 'gpt4o_hospital', lane: 'translate', label: 'GPT-4o 병원', icon: '🏥', color: '#10B981' },
  { id: 'gpt4o_general',  lane: 'translate', label: 'GPT-4o 일반', icon: '🌐', color: '#10B981' },
  { id: 'gpt4o_legal',    lane: 'translate', label: 'GPT-4o 법률', icon: '⚖️', color: '#10B981' },
  { id: 'gpt4o_industrial', lane: 'translate', label: 'GPT-4o 현장', icon: '🏗️', color: '#10B981' },
  // 세션
  { id: 'qr_scan',    lane: 'session',   label: 'QR 스캔',      icon: '📱',  color: '#F59E0B' },
  { id: 'fixed_url',  lane: 'session',   label: '고정 URL',     icon: '🔗',  color: '#F59E0B' },
  { id: 'auto_reset', lane: 'session',   label: '자동 리셋',    icon: '🔄',  color: '#F59E0B' },
  // 출력
  { id: 'subtitle',   lane: 'output',    label: '자막형',       icon: '💬',  color: '#8B5CF6' },
  { id: 'chat_bubble',lane: 'output',    label: '채팅형',       icon: '🗨️',  color: '#8B5CF6' },
  // 저장
  { id: 'no_record',  lane: 'storage',   label: '무기록',       icon: '🚫',  color: '#EF4444' },
  { id: 'db_save',    lane: 'storage',   label: 'DB 저장',      icon: '💾',  color: '#EF4444' },
  { id: 'summary',    lane: 'storage',   label: '요약만 저장',  icon: '📝',  color: '#EF4444' },
];

// 기관 유형별 기본 프리셋
export const PRESETS = {
  hospital: {
    label: '병원 기본',
    blocks: {
      input: 'kiosk_qr',
      stt: 'groq_whisper',
      translate: 'gpt4o_hospital',
      session: 'qr_scan',
      output: 'subtitle',
      storage: 'no_record',
    }
  },
  industrial: {
    label: '산업현장 기본',
    blocks: {
      input: 'staff_ptt',
      stt: 'groq_whisper',
      translate: 'gpt4o_industrial',
      session: 'fixed_url',
      output: 'subtitle',
      storage: 'no_record',
    }
  },
};
