/**
 * The UI sketch (SKETCH.json): a wireframe made of numbered figures, each with a kind, a short label shown
 * inside it, and a description of what it is and does. Claude reads it (plus SKETCH.png) as the agreed layout.
 */

export const KINDS = ["container", "button", "input", "dropdown", "image", "text", "circle", "line", "list", "nav", "other"];
export const FRAMES = { desktop: [1280, 800], tablet: [834, 1112], phone: [390, 844] };

const num = (v, lo, hi, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const str = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").slice(0, max);

/** Validate and normalize a sketch coming from the page. Throws on anything that isn't a sketch. */
export function cleanSketch(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.shapes)) throw Object.assign(new Error("That isn't a sketch."), { status: 400 });
  if (input.shapes.length > 400) throw Object.assign(new Error("That's more than 400 figures."), { status: 400 });
  const preset = FRAMES[input.frame?.preset] ? input.frame.preset : "desktop";
  const [w, h] = FRAMES[preset];
  const frame = { preset, w, h: num(input.frame?.h, 200, 6000, h) };
  const seen = new Set();
  const shapes = input.shapes.map((s, i) => {
    let id = str(s?.id, 40).replace(/[^\w-]/g, "") || `s${i + 1}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    const kind = KINDS.includes(s?.kind) ? s.kind : "other";
    return {
      id,
      n: num(s?.n, 1, 9999, i + 1),
      kind,
      x: num(s?.x, -frame.w, frame.w * 2),
      y: num(s?.y, -frame.h, frame.h * 2),
      w: num(s?.w, kind === "line" ? -frame.w : 8, frame.w * 2, 120),
      h: num(s?.h, kind === "line" ? -frame.h : 8, frame.h * 2, 48),
      label: str(s?.label, 120),
      desc: str(s?.desc, 2000),
    };
  });
  return { version: 1, frame, shapes, note: str(input.note, 2000) };
}

/** The PNG picture of the sketch, sent as a data URL. Returns a Buffer, or null if missing or not a PNG. */
export function sketchPngBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 3_000_000) throw Object.assign(new Error("The sketch picture is too big."), { status: 413 });
  // PNG signature check
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return buf;
}
