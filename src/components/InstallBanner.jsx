// src/components/InstallBanner.jsx
import React from "react";
import usePWAInstall from "../hooks/usePWAInstall";
import { useTranslation } from "react-i18next";

export default function InstallBanner() {
  const { t } = useTranslation();
  const { canInstall, promptInstall } = usePWAInstall();

  if (!canInstall) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 bg-[#F5F5F5] text-[#111111] p-3 border border-[#111111] text-center z-50">
      <p className="mb-2 text-[14px]">{t("installBanner.desc")}</p>
      <button
        onClick={promptInstall}
        className="px-2 py-2 text-[16px] font-medium underline underline-offset-4"
      >
        {t("installBanner.addToHome")}
      </button>
    </div>
  );
}
