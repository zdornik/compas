// Measured innermost pocket of the extended portrait environment. Its sparse
// outer bands continue behind the controls even when the entire group shrinks.
export const ENVIRONMENT = { width: 971, height: 1619, anchorX: 503, anchorY: 748, pocketWidth: 160, pocketHeight: 244 };
export function contourPlacement({ width, height, centerX, centerY, figureWidth, figureHeight, cover = true, scaleOverride }) {
  const a = ENVIRONMENT;
  const scale = scaleOverride ?? Math.max(
    figureWidth * .78 * 1.55 / a.pocketWidth,
    figureHeight * .78 * 1.55 / a.pocketHeight,
    cover ? (centerX + 2) / a.anchorX : 0,
    cover ? (width - centerX + 2) / (a.width - a.anchorX) : 0,
    cover ? (centerY + 2) / a.anchorY : 0,
    cover ? (height - centerY + 2) / (a.height - a.anchorY) : 0,
  );
  return { left: centerX - a.anchorX * scale, top: centerY - a.anchorY * scale, width: a.width * scale, height: a.height * scale };
}
