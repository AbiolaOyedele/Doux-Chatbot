import { createCanvas, loadImage, registerFont } from "canvas";
import path from "path";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import type { ParsedBriefing } from "../types/briefing";

// Register font once at module load — must happen before any canvas text draw
registerFont(path.join(env.ASSETS_DIR, "fonts", "RedditSans-SemiBold.ttf"), {
  family: "Reddit Sans",
  weight: "bold",
  style: "normal",
});

const CANVAS_SIZE = 1080;
const FONT = "Reddit Sans";
const ACCENT = "#CDFBFB";
const WHITE = "#ffffff";

// Dark-doux template field config — mirrors src/config/templates.ts in flyer-gen
const F = {
  title:        { x: 42,  y: 222, width: 494, height: 400,  fontSize: 400, lineHeight: 1.05, letterSpacing: -2 },
  link:         { x: 44,  y: 630, width: 490, height: 54,   cornerRadius: 27, fontSize: 21, paddingLeft: 24, letterSpacing: 0 },
  clockIcon:    { x: 72,  y: 718 },
  time:         { x: 102, y: 719 },
  calendarIcon: { x: 252, y: 718 },
  date:         { x: 281, y: 718 },
  timeRow:      { fontSize: 18, iconSize: 22, letterSpacing: 0 },
  photo:        { x: 557, y: 340, width: 506, height: 515,  cornerRadius: 22 },
  badge:        { offsetX: 4, offsetY: -23, width: 108, height: 34, fontSize: 15, cornerRadius: 17 },
  name:         { x: 567, y: 889, width: 492, fontSize: 25, lineHeight: 1.2, letterSpacing: -1 },
  role:         { x: 569, y: 922, width: 492, fontSize: 18, lineHeight: 1.2, letterSpacing: 0 },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function measureWithSpacing(ctx: Ctx, text: string, letterSpacing: number): number {
  if (letterSpacing === 0) return ctx.measureText(text).width;
  return ctx.measureText(text).width + (text.length - 1) * letterSpacing;
}

function fillTextSpaced(ctx: Ctx, text: string, x: number, y: number, letterSpacing: number): void {
  if (letterSpacing === 0) { ctx.fillText(text, x, y); return; }
  let cx = x;
  for (const char of text) {
    ctx.fillText(char, cx, y);
    cx += ctx.measureText(char).width + letterSpacing;
  }
}

function fillTextSpacedCentered(ctx: Ctx, text: string, cx: number, cy: number, letterSpacing: number): void {
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const totalWidth = measureWithSpacing(ctx, text, letterSpacing);
  fillTextSpaced(ctx, text, cx - totalWidth / 2, cy, letterSpacing);
}

function fitFontSize(ctx: Ctx, text: string, fontStyle: string, maxWidth: number, maxHeight: number, maxFS: number, lineHeight: number, minFS = 18): number {
  if (!text.trim()) return maxFS;
  let bestFS = minFS;
  let bestFill = 0;
  for (let fs = maxFS; fs >= minFS; fs--) {
    ctx.font = `${fontStyle} ${fs}px "${FONT}"`;
    const words = text.split(" ");
    let lines = 1, current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && current !== "") { lines++; current = word; }
      else { current = candidate; }
    }
    const h = lines * fs * lineHeight;
    if (h <= maxHeight && h > bestFill) { bestFill = h; bestFS = fs; }
  }
  return bestFS;
}

// Largest size, stepping down from maxFS, at which text fits maxWidth on a
// single line. Used for the link pill, which is clipped to its rounded rect —
// without this a long URL is silently cut off at the pill's right edge.
function fitSingleLineFontSize(ctx: Ctx, text: string, fontStyle: string, maxWidth: number, maxFS: number, letterSpacing: number, minFS = 14): number {
  for (let fs = maxFS; fs > minFS; fs--) {
    ctx.font = `${fontStyle} ${fs}px "${FONT}"`;
    if (measureWithSpacing(ctx, text, letterSpacing) <= maxWidth) return fs;
  }
  return minFS;
}

function wordWrap(ctx: Ctx, text: string, fontSize: number, fontStyle: string, maxWidth: number, letterSpacing = 0): string[] {
  if (!text.trim()) return [text];
  ctx.font = `${fontStyle} ${fontSize}px "${FONT}"`;
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureWithSpacing(ctx, candidate, letterSpacing) > maxWidth && current !== "") {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundedRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

function drawClockIcon(ctx: Ctx, x: number, y: number, size: number, color: string): void {
  const r = size / 2;
  const cx = x + r, cy = y + r;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - r * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.45, cy + r * 0.3);
  ctx.stroke();
}

function drawCalendarIcon(ctx: Ctx, x: number, y: number, size: number, color: string): void {
  const headerH = size * 0.34;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  roundedRectPath(ctx, x, y, size, size, 3);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x,        y + headerH);
  ctx.lineTo(x + size, y + headerH);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.28, y);
  ctx.lineTo(x + size * 0.28, y + headerH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.72, y);
  ctx.lineTo(x + size * 0.72, y + headerH);
  ctx.stroke();
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderFlyer(briefing: ParsedBriefing, photoBuffer: Buffer): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext("2d");

  // ── Background ────────────────────────────────────────────────────────────
  try {
    const bg = await loadImage(path.join(env.ASSETS_DIR, "templates", "dark-doux.png"));
    ctx.drawImage(bg, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  } catch {
    throw new AppError(500, "Background template image not found.", "RENDERER_MISSING_ASSET");
  }

  ctx.textBaseline = "top";

  // ── Title with auto-shrink + split (last 2 lines → teal) ────────────────
  const { title } = F;
  const TITLE_SPACING = F.title.letterSpacing;
  const actualTitleFS = fitFontSize(ctx, briefing.topic, "bold", title.width, title.height, title.fontSize, title.lineHeight);
  const titleLines = wordWrap(ctx, briefing.topic, actualTitleFS, "bold", title.width, TITLE_SPACING);
  const splitAt = Math.max(0, titleLines.length - 2);
  const titleLineH = actualTitleFS * title.lineHeight;

  ctx.font = `bold ${actualTitleFS}px "${FONT}"`;
  titleLines.forEach((line, i) => {
    ctx.fillStyle = i < splitAt ? WHITE : ACCENT;
    fillTextSpaced(ctx, line, title.x, title.y + i * titleLineH, TITLE_SPACING);
  });

  // Dynamic positions — link pill sits 24px below the last title line;
  // clock/date row sits 34px below the link pill bottom.
  const titleBottom  = title.y + titleLines.length * titleLineH;
  const linkY        = Math.round(titleBottom + 24);
  const clockRowY    = linkY + F.link.height + 34;

  // ── Link pill ─────────────────────────────────────────────────────────────
  const { link } = F;

  roundedRectPath(ctx, link.x, linkY, link.width, link.height, link.cornerRadius);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.save();
  roundedRectPath(ctx, link.x, linkY, link.width, link.height, link.cornerRadius);
  ctx.clip();
  // Shrink to fit: reserve paddingLeft on both sides so the URL never runs
  // into the pill edge, then step the font down until the whole string fits.
  const linkText = `→  ${briefing.link}`;
  const linkMaxW = link.width - link.paddingLeft * 2;
  const linkFS   = fitSingleLineFontSize(ctx, linkText, "bold", linkMaxW, link.fontSize, link.letterSpacing);

  ctx.font = `bold ${linkFS}px "${FONT}"`;
  ctx.fillStyle = WHITE;
  ctx.textBaseline = "middle";
  fillTextSpaced(ctx, linkText, link.x + link.paddingLeft, linkY + link.height / 2, link.letterSpacing);
  ctx.restore();

  ctx.textBaseline = "top";

  // ── Time / Date ───────────────────────────────────────────────────────────
  const { timeRow } = F;
  const { iconSize } = timeRow;

  ctx.font = `bold ${timeRow.fontSize}px "${FONT}"`;
  ctx.fillStyle = WHITE;

  if (briefing.time) {
    drawClockIcon(ctx, F.clockIcon.x, clockRowY, iconSize, WHITE);
    fillTextSpaced(ctx, briefing.time, F.time.x, clockRowY + 1, timeRow.letterSpacing);
  }

  if (briefing.date) {
    drawCalendarIcon(ctx, F.calendarIcon.x, clockRowY, iconSize, WHITE);
    fillTextSpaced(ctx, briefing.date, F.date.x, clockRowY + 1, timeRow.letterSpacing);
  }

  // ── Speaker photo (center crop + rounded clip) ────────────────────────────
  const { photo } = F;
  let photoImage: Awaited<ReturnType<typeof loadImage>>;
  try {
    photoImage = await loadImage(photoBuffer);
  } catch {
    throw new AppError(400, "Could not read the attached image. Please attach a valid JPEG or PNG.", "RENDERER_INVALID_PHOTO");
  }

  const scale = Math.max(photo.width / photoImage.width, photo.height / photoImage.height);
  const sw = photo.width  / scale;
  const sh = photo.height / scale;
  const sx = (photoImage.width  - sw) / 2;
  const sy = (photoImage.height - sh) / 2;

  ctx.save();
  roundedRectPath(ctx, photo.x, photo.y, photo.width, photo.height, photo.cornerRadius);
  ctx.clip();
  ctx.drawImage(photoImage, sx, sy, sw, sh, photo.x, photo.y, photo.width, photo.height);
  ctx.restore();

  // ── Speaker badge ─────────────────────────────────────────────────────────
  const { badge } = F;
  const badgeX = photo.x + photo.width - badge.width + badge.offsetX;
  const badgeY = photo.y + badge.offsetY;

  roundedRectPath(ctx, badgeX, badgeY, badge.width, badge.height, badge.cornerRadius);
  ctx.fillStyle = WHITE;
  ctx.fill();

  ctx.fillStyle = "#0a0d0b";
  ctx.font = `bold ${badge.fontSize}px "${FONT}"`;
  fillTextSpacedCentered(ctx, "SPEAKER", badgeX + badge.width / 2, badgeY + badge.height / 2, 1.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // ── Speaker name — absolute position ────────────────────────────────────
  const { name } = F;

  ctx.fillStyle = WHITE;
  ctx.font = `bold ${name.fontSize}px "${FONT}"`;
  const nameLines = wordWrap(ctx, briefing.handle, name.fontSize, "bold", name.width, name.letterSpacing);
  ctx.textAlign = "center";
  nameLines.forEach((line, i) => {
    fillTextSpacedCentered(ctx, line, name.x + name.width / 2, name.y + i * name.fontSize * name.lineHeight + name.fontSize / 2, name.letterSpacing);
  });

  // ── Speaker role — absolute position ─────────────────────────────────────
  const { role } = F;

  ctx.fillStyle = WHITE;
  ctx.font = `bold ${role.fontSize}px "${FONT}"`;
  const roleLines = wordWrap(ctx, briefing.occupation, role.fontSize, "bold", role.width, role.letterSpacing);
  roleLines.forEach((line, i) => {
    fillTextSpacedCentered(ctx, line, role.x + role.width / 2, role.y + i * role.fontSize * role.lineHeight + role.fontSize / 2, role.letterSpacing);
  });

  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}
