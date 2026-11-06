/**
 * Where a seat sits on the chamber floor.
 *
 * The debating chamber is a horseshoe with straight benches either side of the
 * Table and a round end, so the seat block is a path: up the left bench, around
 * the end, down the right bench. A seat is a point on that path — column `c` at
 * `c * spacing` of arc length, ring `r` offset `r * gap` in towards the floor —
 * and the component places every seat by percentage of this reference frame,
 * which keeps the drawing proportional at any width with nothing to measure.
 *
 * The frame is CHAMBER_WIDTH units wide and the component renders it at
 * `width / height`; 704 is the desktop size it was drawn at, and the widest it
 * is allowed to get.
 */

export const CHAMBER_ROWS = 3;

/** Reference frame width, in px, before CSS scales it. */
export const CHAMBER_WIDTH = 704;

const PAD_TOP = 28; // room for the majority label above the back bench
const ARM_FACTOR = 0.42; // straight bench each side of the Table
const SEAT_FACTOR = 0.66; // seat size as a share of the tightest pitch
const SEAT_MAX = 21;
const GAP_FACTOR = 1.32; // ring spacing as a multiple of the seat size
const MARKER_OUT = 7; // the divider starts just above the back bench
const MARKER_TAIL = 26; // and runs this far into the floor past the front bench

export type SeatPosition = {
  /** px in the reference frame, centre of the seat */
  x: number;
  y: number;
  /** seat diameter, px */
  size: number;
  /** radians, so a square mark would face the floor. Round seats ignore it. */
  rotate: number;
};

export type ChamberLayout = {
  seats: SeatPosition[];
  /** the majority divider, a radial line through the apex */
  marker: {
    x: number;
    y: number;
    length: number;
    angle: number;
    labelX: number;
    labelY: number;
  };
  width: number;
  height: number;
};

type Point = { x: number; y: number; rotate: number };

function shape(seatCount: number, radius: number) {
  const columns = Math.max(2, Math.ceil(seatCount / CHAMBER_ROWS));
  const arm = radius * ARM_FACTOR;
  const length = 2 * arm + Math.PI * radius;
  const spacing = length / (columns - 1);
  // The tightest ring is the inside of the round end, where the pitch shrinks
  // by 2 * gap / R. Solve size = k * spacing * (1 - 2.6 * size / R).
  const size = Math.min(
    SEAT_MAX,
    (SEAT_FACTOR * spacing) / (1 + (2.6 * SEAT_FACTOR * spacing) / radius)
  );
  return { columns, arm, length, spacing, size, radius };
}

export function chamberLayout(seatCount: number): ChamberLayout {
  // A seat is centred on its position, so the room is drawn a seat narrower
  // than the frame: the outermost seats' edges then land on the frame instead
  // of half a seat outside it.
  const first = shape(seatCount, CHAMBER_WIDTH / 2);
  const { arm, length, spacing, size, radius } = shape(
    seatCount,
    (CHAMBER_WIDTH - first.size) / 2
  );
  const gap = size * GAP_FACTOR;
  const cx = CHAMBER_WIDTH / 2;
  const yDome = PAD_TOP + radius;
  const height = PAD_TOP + radius + arm + size / 2 + 2;
  const domeLength = Math.PI * radius;

  const at = (s: number, offset: number): Point => {
    if (s <= arm) {
      return { x: cx - radius + offset, y: yDome + arm - s, rotate: -Math.PI / 2 };
    }
    if (s <= arm + domeLength) {
      const theta = Math.PI - (s - arm) / radius;
      const r = radius - offset;
      return {
        x: cx + r * Math.cos(theta),
        y: yDome - r * Math.sin(theta),
        rotate: theta - Math.PI / 2,
      };
    }
    return {
      x: cx + radius - offset,
      y: yDome + (s - arm - domeLength),
      rotate: Math.PI / 2,
    };
  };

  const seats: SeatPosition[] = [];
  for (let i = 0; i < seatCount; i++) {
    const column = Math.floor(i / CHAMBER_ROWS);
    const ring = i % CHAMBER_ROWS;
    const p = at(column * spacing, ring * gap);
    seats.push({ x: p.x, y: p.y, size, rotate: p.rotate });
  }

  // Half a column past the apex, so the divider falls in the gap between two
  // columns instead of through the middle of one.
  const sMid = length / 2 + spacing / 2;
  const p1 = at(sMid, -MARKER_OUT);
  const p2 = at(sMid, (CHAMBER_ROWS - 1) * gap + size * 0.8 + MARKER_TAIL);

  return {
    seats,
    marker: {
      x: p1.x,
      y: p1.y,
      length: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      angle: Math.atan2(p2.x - p1.x, p2.y - p1.y),
      labelX: p1.x,
      // The top edge of the back bench: the label clears the seats by a fixed
      // 8px in CSS, so the gap does not shrink with the drawing on a phone.
      labelY: PAD_TOP - size / 2,
    },
    width: CHAMBER_WIDTH,
    height,
  };
}
