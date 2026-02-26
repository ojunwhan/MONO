import React from "react";

export default function MonoLogo({ className = "" }) {
  return (
    <div className={`text-[40px] font-bold tracking-[0.2em] leading-none ${className}`.trim()}>
      <span style={{ color: "#7C6FEB" }}>M</span>
      <span style={{ color: "#F472B6" }}>O</span>
      <span style={{ color: "#34D399" }}>N</span>
      <span style={{ color: "#FBBF24" }}>O</span>
    </div>
  );
}
