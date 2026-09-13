/**
 * 综合画像雷达（人格卡页）。
 *
 * 与首页的 BoardRadar 是同一族，但样式命名不同（原型里首页用 .r*、人格页用 .pr-*）。
 * 刻意保持两套类名而不强行合并：两者的取值语义不同 ——
 *   首页 BoardRadar：来源类别覆盖度
 *   这里 PersonaRadar：融合特征强度（来自 PersonaFeature）
 * 合并成一个组件会逼着调用方去理解两套语义的差异，反而更难用。
 */

export interface PRadarAxis {
  label: string;
  /** 0~1；null 表示该维无数据 */
  value: number | null;
}

interface Props {
  axes: PRadarAxis[];
  /** 无任何有效数据时的提示 */
  emptyTip?: string;
}

const CX = 150;
const CY = 150;
const R = 92;

function angleAt(i: number, n: number): number {
  return ((-90 + (i * 360) / n) * Math.PI) / 180;
}

export default function PersonaRadar({ axes, emptyTip = "等待蒸馏" }: Props) {
  const n = axes.length;
  if (!n) return null;

  const usable = axes.filter((a) => typeof a.value === "number");
  const ready = usable.length >= 3; /* 少于 3 个点连不成面 */

  const verts = axes.map((_, i) => {
    const a = angleAt(i, n);
    return [CX + R * Math.cos(a), CY + R * Math.sin(a)] as const;
  });

  const rings = [0.25, 0.5, 0.75, 1].map((t, k) => ({
    k,
    pts: verts
      .map((p) => `${(CX + (p[0] - CX) * t).toFixed(1)},${(CY + (p[1] - CY) * t).toFixed(1)}`)
      .join(" "),
  }));

  const dataPts = ready
    ? axes.map((ax, i) => {
        const a = angleAt(i, n);
        const v = Math.max(0, Math.min(1, ax.value ?? 0));
        return [CX + v * R * Math.cos(a), CY + v * R * Math.sin(a)] as const;
      })
    : [];

  return (
    <div className="prShell">
      <svg viewBox="0 0 300 300" role="img" aria-label="综合画像雷达图">
        {rings.map((r) => (
          <polygon
            key={r.k}
            className={r.k === 3 ? "prRing2" : "prRing"}
            points={r.pts}
          />
        ))}

        {verts.map((p, i) => (
          <line
            key={`ax-${i}`}
            className="prAxis"
            x1={CX}
            y1={CY}
            x2={p[0].toFixed(1)}
            y2={p[1].toFixed(1)}
          />
        ))}

        {axes.map((ax, i) => {
          const a = angleAt(i, n);
          const lx = CX + (R + 22) * Math.cos(a);
          const ly = CY + (R + 22) * Math.sin(a);
          return (
            <text key={`nm-${i}`} className="prName" x={lx.toFixed(1)} y={(ly + 3).toFixed(1)}>
              {ax.label}
            </text>
          );
        })}

        {ready ? (
          <>
            <polygon
              className="prVal"
              points={dataPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
            />
            {dataPts.map((p, i) => (
              <circle key={`d-${i}`} className="prDot" cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r="3" />
            ))}
          </>
        ) : null}
      </svg>

      {!ready ? (
        <div className="prEmpty">
          <span>{emptyTip}</span>
        </div>
      ) : null}
    </div>
  );
}
