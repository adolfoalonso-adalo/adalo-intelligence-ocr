"use client";

type DownloadXlsxButtonProps = {
  base64Content: string;
  fileName: string;
};

export function DownloadXlsxButton({
  base64Content,
  fileName,
}: DownloadXlsxButtonProps) {
  function download() {
    const binary = window.atob(base64Content);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="rounded-xl border border-brand-border bg-white px-4 py-3 text-sm font-semibold text-brand-deep shadow-sm transition hover:bg-brand-soft"
    >
      Descargar Excel (.xlsx)
    </button>
  );
}
