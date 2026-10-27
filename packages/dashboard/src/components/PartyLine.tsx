import { Line } from 'recharts';

/**
 * A party's series line, drawn the same way on every chart.
 *
 * Party colours are non-negotiable — National's blue and Labour's red are what
 * the reader recognises — but several of them (ACT's yellow, Te Pāti Māori's
 * black, NZ First's near-black) are close to the dark theme's paper. Rather
 * than recolour a party, the line thickens and gains a faint light halo when
 * its luminance is low, which is the only place in the app that adjusts a
 * brand colour for legibility.
 *
 * The line steps with `monotone` interpolation and carries no dots: a count
 * chart is a record of scrapes, not a continuous series, and the dots would
 * number in the hundreds by midnight.
 */
const DARK_LUMINANCE = 0.35;
const HALO = 'drop-shadow(0px 0px 2px rgba(255,255,255,0.5))';

/** Rec. 601 luminance, which tracks perceived brightness well enough here. */
function isDark(color: string): boolean {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < DARK_LUMINANCE;
}

export function PartyLine({
  dataKey,
  name,
  color,
}: {
  /** Field on the chart row holding this series' value. */
  dataKey: string;
  /** Legend and tooltip label — the party's own name. */
  name: string;
  color: string;
}) {
  const dark = isDark(color);
  return (
    <Line
      type="monotone"
      dataKey={dataKey}
      name={name}
      stroke={color}
      strokeWidth={dark ? 3 : 2}
      dot={false}
      activeDot={{ r: 4 }}
      style={dark ? { filter: HALO } : undefined}
    />
  );
}
