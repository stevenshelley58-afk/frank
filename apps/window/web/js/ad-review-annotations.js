/** Pure geometry and rendering helpers for review annotations. */
export function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}
export function normalizeRect(start, end) {
  const left = clamp(Math.min(Number(start?.x), Number(end?.x)));
  const top = clamp(Math.min(Number(start?.y), Number(end?.y)));
  const right = clamp(Math.max(Number(start?.x), Number(end?.x)));
  const bottom = clamp(Math.max(Number(start?.y), Number(end?.y)));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
export function pointerToNormalized(point, frame, image) {
  const imageRect = image?.getBoundingClientRect?.() || image;
  if (!imageRect || !imageRect.width || !imageRect.height) return null;
  return { x: clamp((Number(point?.clientX) - imageRect.left) / imageRect.width), y: clamp((Number(point?.clientY) - imageRect.top) / imageRect.height) };
}
export function normalizedToPixels(rect, width, height) {
  const safe = normalizeRect({ x: rect?.x, y: rect?.y }, { x: (rect?.x || 0) + (rect?.width || 0), y: (rect?.y || 0) + (rect?.height || 0) });
  return { left: safe.x * width, top: safe.y * height, width: safe.width * width, height: safe.height * height };
}
export function sanitizeAnnotation(value) {
  const rect = normalizeRect(value, { x: Number(value?.x) + Number(value?.width), y: Number(value?.y) + Number(value?.height) });
  return { ...rect, comment: String(value?.comment || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) };
}
export function safeAnnotationText(value) { return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200); }
export function serializeAnnotations(annotations) { return (Array.isArray(annotations) ? annotations : []).map(sanitizeAnnotation).filter((item) => item.width > 0.005 && item.height > 0.005); }