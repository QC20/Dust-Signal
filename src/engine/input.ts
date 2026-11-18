/** Keyboard, mouse and touch input, polled once per frame. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mouseClicked = false;
  mouseMovedAt = -1e9;
  mouseInside = false;
  wheel = 0;
  anyKey = false;
  touch = { active: false, mx: 0, my: 0, fire: false, use: false, run: false };
  private now = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    };
    window.addEventListener('keydown', (e) => {
      if (typing(e) && e.code !== 'Enter' && e.code !== 'Escape') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.anyKey = true;
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseMovedAt = this.now;
      this.mouseInside = true;
    });
    canvas.addEventListener('pointerleave', () => (this.mouseInside = false));
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseMovedAt = this.now;
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseClicked = true;
      }
      this.anyKey = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
  }

  isDown(...codes: string[]) {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  wasPressed(...codes: string[]) {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  /** Movement in screen space: x right, y up. */
  move(): [number, number] {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y += 1;
    if (this.isDown('KeyS', 'ArrowDown')) y -= 1;
    if (this.touch.active) {
      x += this.touch.mx;
      y += this.touch.my;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return [x, y];
  }

  usingMouseAim() {
    return this.mouseInside && this.now - this.mouseMovedAt < 2.5;
  }

  tick(now: number) {
    this.now = now;
  }

  endFrame() {
    this.pressed.clear();
    this.mouseClicked = false;
    this.wheel = 0;
    this.anyKey = false;
  }

  get element() {
    return this.canvas;
  }
}
