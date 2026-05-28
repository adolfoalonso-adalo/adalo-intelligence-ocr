"use client";

type DownloadCsvButtonProps = {
  csvContent: string;
  fileName: string;
};

export function DownloadCsvButton({ csvContent, fileName }: DownloadCsvButtonProps) {
  function handleDownload() {
    const content = csvContent.startsWith("\uFEFF") ? csvContent : `\uFEFF${csvContent}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
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
      className="rounded-2xl bg-brand-accent px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-accent/20 transition hover:-translate-y-0.5 hover:bg-brand-petrol"
    >
      Descargar resultados (.csv)
    </button>
  );
}
