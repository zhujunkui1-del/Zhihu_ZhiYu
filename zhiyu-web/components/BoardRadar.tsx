/**
 * 人格五维雷达（首页 / 我的人格页共用）。
 *
 * 纯 SVG、无交互，所以是 Server Component 也能渲染。
 * 算法移植自原型 `zhiyu-home.html` 的 `paintPersonaRadar`：
 * 五等分顶点 → 四道同心多边形网格 → 轴线 → 顶点标签 → 数据面。
 *
 * 归一化：传入的 values 是 0~1 的强度，直接乘半径。
 */

export interface RadarAxis {
  label: string;
  /** 0~1 */
  value: number;
}

interface Props {
  axes: RadarAxis[];
  /** 有数据才画数据面；没有则只画网格 + 提示 */
  ready?: boolean;
  emptyTip?: string;
  className?: string;
}

const CX = 140;
const CY = 150;
const R = 84;

/** 第 i 个顶点的角度：从正上方开始顺时针 */
function angleAt(i: number, n: number): number {
  return ((-90 + (i * 360) / n) * Math.PI) / 180;
}

export default function BoardRadar({ axes, ready = false, emptyTip, className }: Props) {
  const n = axes.length;
  if (!n) return null;

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
        const rr = Math.max(0, Math.min(1, ax.value)) * R;
        return [CX + rr * Math.cos(a), CY + rr * Math.sin(a)] as const;
      })
    : [];

  return (
    <svg viewBox="0 0 280 300" role="img" aria-label="人格五维示意" className={className}>
      {/* 同心网格：最外圈用强调色，其余用弱色 */}
      {rings.map((r) => (
        <polygon
          key={r.k}
          className={r.k === 3 ? "brRingOuter" : "brRing"}
          fill="none"
          points={r.pts}
        />
      ))}

      {/* 轴线 */}
      {verts.map((p, i) => (
        <line
          key={`axis-${i}`}
          className="brAxis"
          x1={CX}
          y1={CY}
          x2={p[0].toFixed(1)}
          y2={p[1].toFixed(1)}
        />
      ))}

      {/* 顶点标签 */}
      {axes.map((ax, i) => {
        const a = angleAt(i, n);
        const lx = CX + (R + 21) * Math.cos(a);
        const ly = CY + (R + 21) * Math.sin(a);
        return (
          <text key={`lbl-${i}`} className="brName" x={lx.toFixed(1)} y={(ly + 3).toFixed(1)}>
            {ax.label}
          </text>
        );
      })}

      {/* 数据面 */}
      {ready && dataPts.length ? (
        <>
          <polygon
            className="brValue"
            points={dataPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
          />
          {dataPts.map((p, i) => (
            <circle key={`dot-${i}`} className="brDot" cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r="3.4" />
          ))}
        </>
      ) : null}

      {!ready && emptyTip ? (
        <text className="brEmpty" x={CX} y={CY + 4}>
          {emptyTip}
        </text>
      ) : null}
    </svg>
  );
}
