"use client";

type DownloadJsonButtonProps = {
  fileName: string;
  jsonContent: string;
};

export function DownloadJsonButton({ fileName, jsonContent }: DownloadJsonButtonProps) {
  function handleDownload() {
    const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="rounded-2xl border border-brand-border bg-brand-card px-5 py-3 text-sm font-semibold text-brand-deep transition hover:-translate-y-0.5 hover:border-brand-accent hover:text-brand-accent"
    >
      Descargar datos (.json)
    </button>
  );
}
