/* ═══════════════════════════════════════════════════
   Export — Download canvas as PNG
   ═══════════════════════════════════════════════════ */

function exportCanvas(canvasEngine) {
  const exportCanvas = canvasEngine.getExportCanvas();

  exportCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collabboard-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

window.exportCanvas = exportCanvas;
