/**
 * 가로 고정: 세로로 든 터치 기기(세로로 잠긴 앱 안 포함)에서는 게임 화면 전체를
 * 시계 반대 방향으로 90° 돌려 가로로 보여준다 (폰을 왼쪽으로 눕혀 들면 바로 보인다). 캔버스로 가는 포인터 좌표도 같이 돌려서
 * 카메라 조작과 클릭 판정이 돌린 화면 기준으로 동작하게 한다.
 */

let rotated = false;

export function isRotated(): boolean {
  return rotated;
}

/** 화면 좌표 → 돌린 게임 화면 안의 좌표 (폰을 시계 반대 방향으로 눕힌 기준) */
function toLocal(x: number, y: number): [number, number] {
  return [window.innerHeight - y, x];
}

const PATCHED = Symbol('patched');

function patchEvent(e: PointerEvent | MouseEvent): void {
  const ev = e as MouseEvent & { [PATCHED]?: boolean };
  if (ev[PATCHED]) return;
  const [cx, cy] = toLocal(e.clientX, e.clientY);
  const [px, py] = toLocal(e.pageX, e.pageY);
  const props: Record<string, number> = { clientX: cx, clientY: cy, x: cx, y: cy, pageX: px, pageY: py, offsetX: cx, offsetY: cy };
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  ev[PATCHED] = true;
}

export function setupOrientation(canvas: HTMLCanvasElement, onChange: () => void): void {
  const doc = document.documentElement;
  const coarse = window.matchMedia('(pointer: coarse)');
  const apply = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    rotated = coarse.matches && h > w;
    doc.classList.toggle('force-landscape', rotated);
    doc.style.setProperty('--sw', `${w}px`);
    doc.style.setProperty('--sh', `${h}px`);
    // 게임 화면 기준 크기로 레이아웃 단계를 고른다 (미디어 쿼리 대신)
    const lw = rotated ? h : w;
    const lh = rotated ? w : h;
    doc.classList.toggle('narrow', lw <= 900);
    doc.classList.toggle('compact', lw > lh && lh <= 500);
    onChange();
  };
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 50));
  coarse.addEventListener?.('change', apply);
  apply();

  // 캔버스에서 시작한 포인터는 끝날 때까지 좌표를 돌려 준다 (포인터 캡처 중 document로 가는 이벤트 포함)
  const active = new Set<number>();
  const onPointer = (e: PointerEvent) => {
    if (!rotated) return;
    if (e.type === 'pointerdown' && e.target === canvas) active.add(e.pointerId);
    if (e.target === canvas || active.has(e.pointerId)) patchEvent(e);
    if (e.type === 'pointerup' || e.type === 'pointercancel') active.delete(e.pointerId);
  };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, onPointer, { capture: true });
  }
  window.addEventListener(
    'click',
    (e) => {
      if (rotated && e.target === canvas) patchEvent(e);
    },
    { capture: true },
  );
}
