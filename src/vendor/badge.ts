// Vendored from covallaby/action (core/src/badge.ts) until packages publish to npm. Do not edit here.
import { formatPercent } from "./format.js";

/** Covallaby's badge color scale — warm, and green arrives early enough to encourage. */
export function badgeColor(percent: number | null): string {
  if (percent === null) return "#9f9f9f";
  if (percent >= 90) return "#2da44e"; // GitHub green
  if (percent >= 75) return "#a3b330";
  if (percent >= 60) return "#d29922";
  return "#cf222e";
}

/** Escape untrusted text before it enters SVG markup (labels are user-supplied). */
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * A flat, self-contained SVG coverage badge in the familiar shields style.
 * No network, no external fonts.
 */
export function renderBadge(percent: number | null, rawLabel = "coverage"): string {
  // Cap and escape the label: it can arrive from an untrusted query string.
  const label = escapeXml(rawLabel.slice(0, 64));
  const value = formatPercent(percent);
  const color = badgeColor(percent);
  // Verdana at 11px averages ~6.1px/char; shields.io uses the same trick.
  const labelWidth = Math.round(label.length * 6.1) + 12;
  const valueWidth = Math.round(value.length * 6.1) + 12;
  const width = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <clipPath id="r"><rect width="${width}" height="20" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}
