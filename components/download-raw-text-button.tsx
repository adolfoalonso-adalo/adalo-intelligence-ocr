"use client";

type DownloadRawTextButtonProps = {
  fileName: string;
  textContent: string;
};

export function DownloadRawTextButton({
  fileName,
  textContent,
}: DownloadRawTextButtonProps) {
  function handleDownload() {
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
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
      className="rounded-2xl border border-red-200 bg-white px-5 py-3 text-sm font-semibold text-red-700 transition hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50"
    >
      Descargar texto OCR bruto
    </button>
  );
}
