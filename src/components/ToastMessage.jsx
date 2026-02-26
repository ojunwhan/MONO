import React from "react";

export default function ToastMessage({ message, visible }) {
  if (!visible || !message) return null;
  return (
    <div className="fixed left-1/2 bottom-[88px] z-[90] -translate-x-1/2 rounded-[8px] bg-black/80 px-5 py-3 text-[13px] text-white">
      {message}
    </div>
  );
}

