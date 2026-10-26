import { WATER } from '../data/balance';

/**
 * 가상 파이프 방식 셸로 워터.
 * 셀마다 네 방향 유출 플럭스를 들고, 수면 높이 차로 가속하며 마찰로 감쇠한다.
 * 플럭스 유효 단면은 "높은 쪽 바닥 위 수심"이라 얕은 물은 느리고 깊은 물은 빠르다.
 */
export class WaterGrid {
  readonly w: number;
  readonly h: number;
  readonly n: number;
  ground: Float64Array;
  /** 댐 장벽 높이 (지면에 더해짐) */
  barrier: Float64Array;
  depth: Float64Array;
  fL: Float64Array;
  fR: Float64Array;
  fU: Float64Array;
  fD: Float64Array;
  /** 오른쪽 끝 열은 하류 출구 */
  outletRight = true;

  // 누적 회계 (저장량 변화 = 유입 + 강수 − 유출 − 증발)
  totalInflow = 0;
  totalRain = 0;
  totalOutflow = 0;
  totalEvap = 0;

  private surf: Float64Array;
  private lo: Int32Array;
  private hi: Int32Array;
  private rowLoBuf: Int32Array;
  private rowHiBuf: Int32Array;

  constructor(w: number, h: number, ground: Float64Array) {
    this.w = w;
    this.h = h;
    this.n = w * h;
    this.ground = ground;
    this.barrier = new Float64Array(this.n);
    this.depth = new Float64Array(this.n);
    this.fL = new Float64Array(this.n);
    this.fR = new Float64Array(this.n);
    this.fU = new Float64Array(this.n);
    this.fD = new Float64Array(this.n);
    this.surf = new Float64Array(this.n);
    this.lo = new Int32Array(h);
    this.hi = new Int32Array(h);
    this.rowLoBuf = new Int32Array(h);
    this.rowHiBuf = new Int32Array(h);
  }

  volume(): number {
    let v = 0;
    const d = this.depth;
    for (let i = 0; i < this.n; i++) v += d[i];
    return v;
  }

  addInflow(cells: number[], amount: number): void {
    if (amount <= 0 || cells.length === 0) return;
    const per = amount / cells.length;
    for (const c of cells) this.depth[c] += per;
    this.totalInflow += per * cells.length;
  }

  addRain(perCell: number): void {
    if (perCell <= 0) return;
    const d = this.depth;
    for (let i = 0; i < this.n; i++) d[i] += perCell;
    this.totalRain += perCell * this.n;
  }

  /** 증발 + 얇은 물막이 땅에 스미는 손실 */
  evaporate(perCell: number): void {
    const d = this.depth;
    const film = WATER.FILM_DEPTH;
    let lost = 0;
    for (let i = 0; i < this.n; i++) {
      const v = d[i];
      if (v <= 0) continue;
      let take = perCell < v ? perCell : v;
      if (v - take < film) {
        take = v;
        this.fL[i] = 0;
        this.fR[i] = 0;
        this.fU[i] = 0;
        this.fD[i] = 0;
      }
      d[i] = v - take;
      lost += take;
    }
    this.totalEvap += lost;
  }

  /** 서브스텝 하나. 이번 스텝에 하류 출구로 나간 양을 돌려준다. */
  step(): number {
    const { w, h, ground, barrier, depth, fL, fR, fU, fD, surf } = this;
    const A = WATER.PIPE_ACCEL;
    const damp = WATER.PIPE_DAMPING;
    const minD = WATER.MIN_FLOW_DEPTH;
    const maxFrac = WATER.MAX_OUT_FRACTION;
    const drop = WATER.OUTLET_DROP;

    // 젖은 셀이 있는 행별 x 범위를 구하고, 위아래 행과 합쳐 1칸 넓힌다
    const { lo, hi } = this;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let a = -1;
      let b = -2;
      for (let x = 0; x < w; x++) {
        if (depth[row + x] > 0) {
          if (a < 0) a = x;
          b = x;
        }
      }
      lo[y] = a;
      hi[y] = b;
    }
    const rlo = this.rowLoBuf;
    const rhi = this.rowHiBuf;
    for (let y = 0; y < h; y++) {
      let a = w;
      let b = -1;
      for (let k = y - 1; k <= y + 1; k++) {
        if (k < 0 || k >= h || hi[k] < lo[k] || lo[k] < 0) continue;
        if (lo[k] < a) a = lo[k];
        if (hi[k] > b) b = hi[k];
      }
      if (b < 0) {
        rlo[y] = 0;
        rhi[y] = -1;
      } else {
        rlo[y] = a > 0 ? a - 1 : 0;
        rhi[y] = b < w - 1 ? b + 1 : w - 1;
      }
    }
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = rlo[y]; x <= rhi[y]; x++) {
        const i = row + x;
        surf[i] = ground[i] + barrier[i] + depth[i];
      }
    }

    for (let y = 0; y < h; y++) {
      const row = y * w;
      const xe = rhi[y];
      for (let x = rlo[y]; x <= xe; x++) {
        const i = row + x;
        const d = depth[i];
        if (d <= 0) {
          fL[i] = 0;
          fR[i] = 0;
          fU[i] = 0;
          fD[i] = 0;
          continue;
        }
        const s = surf[i];
        const b = ground[i] + barrier[i];
        let l = 0;
        let r = 0;
        let u = 0;
        let dn = 0;
        if (x > 0) {
          const j = i - 1;
          const dh = s - surf[j];
          if (dh > 0 || fL[i] > 0) {
            const bj = ground[j] + barrier[j];
            const fd = s - (b > bj ? b : bj);
            l = fL[i] * damp + A * dh * ((fd > 0 ? fd : 0) + minD);
            if (l < 0) l = 0;
          }
        }
        if (x < w - 1) {
          const j = i + 1;
          const dh = s - surf[j];
          if (dh > 0 || fR[i] > 0) {
            const bj = ground[j] + barrier[j];
            const fd = s - (b > bj ? b : bj);
            r = fR[i] * damp + A * dh * ((fd > 0 ? fd : 0) + minD);
            if (r < 0) r = 0;
          }
        } else if (this.outletRight) {
          // 가상의 하류 셀: 수심 0, 지면은 drop만큼 낮다
          const dh = d + drop;
          r = fR[i] * damp + A * dh * (d + minD);
        }
        if (y > 0) {
          const j = i - w;
          const dh = s - surf[j];
          if (dh > 0 || fU[i] > 0) {
            const bj = ground[j] + barrier[j];
            const fd = s - (b > bj ? b : bj);
            u = fU[i] * damp + A * dh * ((fd > 0 ? fd : 0) + minD);
            if (u < 0) u = 0;
          }
        }
        if (y < h - 1) {
          const j = i + w;
          const dh = s - surf[j];
          if (dh > 0 || fD[i] > 0) {
            const bj = ground[j] + barrier[j];
            const fd = s - (b > bj ? b : bj);
            dn = fD[i] * damp + A * dh * ((fd > 0 ? fd : 0) + minD);
            if (dn < 0) dn = 0;
          }
        }
        const total = l + r + u + dn;
        const cap = d * maxFrac;
        if (total > cap) {
          const k = cap / total;
          l *= k;
          r *= k;
          u *= k;
          dn *= k;
        }
        fL[i] = l;
        fR[i] = r;
        fU[i] = u;
        fD[i] = dn;
      }
    }

    let out = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const xe = rhi[y];
      for (let x = rlo[y]; x <= xe; x++) {
        const i = row + x;
        let inflow = 0;
        if (x > 0) inflow += fR[i - 1];
        if (x < w - 1) inflow += fL[i + 1];
        if (y > 0) inflow += fD[i - w];
        if (y < h - 1) inflow += fU[i + w];
        const outflow = fL[i] + fR[i] + fU[i] + fD[i];
        if (inflow === 0 && outflow === 0) continue;
        let nd = depth[i] + inflow - outflow;
        if (nd < 0) nd = 0; // 수치 오차 방어 (상한 비율 덕에 실제로는 발생하지 않음)
        depth[i] = nd;
      }
      if (this.outletRight && xe === w - 1) out += fR[row + w - 1];
    }
    this.totalOutflow += out;
    return out;
  }

  /** 계측선을 지나는 순유량: 열 x에서 x+1로 (동쪽) */
  fluxAcrossColumn(x: number): number {
    const { w, h, fR, fL } = this;
    let q = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      q += fR[i];
      if (x + 1 < w) q -= fL[i + 1];
    }
    return q;
  }
}
