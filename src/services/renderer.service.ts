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
  title:       { x: 44,  y: 218, width: 504, fontSize: 70,  lineHeight: 1.15 },
  link:        { x: 44,          width: 490, height: 54,    cornerRadius: 27, fontSize: 18, paddingLeft: 24 },
  timeRowGapY: 39,
  timeRow:     { x: 50,  fontSize: 17, iconSize: 22, dateOffsetX: 200 },
  photo:       { x: 557, y: 340, width: 509, height: 522,   cornerRadius: 22 },
  badge:       { offsetX: 1, offsetY: -23, width: 108, height: 34, fontSize: 15, cornerRadius: 17 },
  name:        { x: 570, width: 492, fontSize: 25, lineHeight: 1.2 },
  role:        { x: 570, width: 492, fontSize: 18, lineHeight: 1.2 },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function wordWrap(ctx: Ctx, text: string, fontSize: number, fontStyle: string, maxWidth: number): string[] {
  if (!text.trim()) return [text];
  ctx.font = `${fontStyle} ${fontSize}px "${FONT}"`;
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current !== "") {
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

  // ── Title with auto-split (last 2 lines → teal) ───────────────────────────
  const { title } = F;
  const titleLines = wordWrap(ctx, briefing.topic, title.fontSize, "bold", title.width);
  const splitAt = Math.max(0, titleLines.length - 2);
  const titleLineH = title.fontSize * title.lineHeight;

  ctx.font = `bold ${title.fontSize}px "${FONT}"`;
  titleLines.forEach((line, i) => {
    ctx.fillStyle = i < splitAt ? WHITE : ACCENT;
    ctx.fillText(line, title.x, title.y + i * titleLineH);
  });

  const titleH = titleLines.length * titleLineH;

  // ── Link pill ─────────────────────────────────────────────────────────────
  const { link } = F;
  const linkY = title.y + titleH + 28;

  roundedRectPath(ctx, link.x, linkY, link.width, link.height, link.cornerRadius);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.save();
  roundedRectPath(ctx, link.x, linkY, link.width, link.height, link.cornerRadius);
  ctx.clip();
  ctx.font = `bold ${link.fontSize}px "${FONT}"`;
  ctx.fillStyle = WHITE;
  ctx.textBaseline = "middle";
  ctx.fillText(`→  ${briefing.link}`, link.x + link.paddingLeft, linkY + link.height / 2);
  ctx.restore();

  ctx.textBaseline = "top";

  // ── Time row ──────────────────────────────────────────────────────────────
  const { timeRow, timeRowGapY } = F;
  const timeY = linkY + link.height + timeRowGapY;
  const { iconSize } = timeRow;
  const iconOffsetY = -iconSize / 2 + timeRow.fontSize / 2 - 2;

  ctx.font = `bold ${timeRow.fontSize}px "${FONT}"`;
  ctx.fillStyle = WHITE;

  if (briefing.time) {
    drawClockIcon(ctx, timeRow.x, timeY + iconOffsetY, iconSize, WHITE);
    ctx.fillText(briefing.time, timeRow.x + iconSize + 10, timeY);
  }

  if (briefing.date) {
    const dateX = timeRow.x + timeRow.dateOffsetX;
    drawCalendarIcon(ctx, dateX, timeY + iconOffsetY, iconSize, WHITE);
    ctx.fillText(briefing.date, dateX + iconSize + 10, timeY);
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
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("SPEAKER", badgeX + badge.width / 2, badgeY + badge.height / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // ── Speaker name (bold, centered under photo) ─────────────────────────────
  const { name } = F;
  const nameY = photo.y + photo.height + 20;

  ctx.fillStyle = WHITE;
  ctx.font = `bold ${name.fontSize}px "${FONT}"`;
  const nameLines = wordWrap(ctx, briefing.handle, name.fontSize, "bold", name.width);
  ctx.textAlign = "center";
  nameLines.forEach((line, i) => {
    ctx.fillText(line, name.x + name.width / 2, nameY + i * name.fontSize * name.lineHeight);
  });

  // ── Speaker role (centered under name) ───────────────────────────────────
  const { role } = F;
  const roleY = nameY + 46;

  ctx.fillStyle = WHITE;
  ctx.font = `bold ${role.fontSize}px "${FONT}"`;
  const roleLines = wordWrap(ctx, briefing.occupation, role.fontSize, "bold", role.width);
  roleLines.forEach((line, i) => {
    ctx.fillText(line, role.x + role.width / 2, roleY + i * role.fontSize * role.lineHeight);
  });

  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}
