import React from "react";

export default function BottomSheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
      />
      <div className="relative w-full max-w-[480px] rounded-t-[16px] bg-[var(--color-bg)] pb-[calc(14px+env(safe-area-inset-bottom))] shadow-2xl">
        <div className="pt-2">
          <div className="mx-auto h-1 w-9 rounded-full bg-[#D1D1D6]" />
        </div>
        {title ? <div className="px-4 pt-3 text-[16px] font-semibold">{title}</div> : null}
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

