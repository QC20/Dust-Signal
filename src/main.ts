import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './style.css';
import { AsciiRenderer, DENSITIES } from './engine/AsciiRenderer';
import { Input } from './engine/input';
import { Sfx } from './engine/audio';
import { Game } from './game/game';

const $ = (id: string) => document.getElementById(id)!;

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function loadFonts() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('500 12px "JetBrains Mono"'),
        document.fonts.load('600 12px "JetBrains Mono"'),
        document.fonts.load('700 12px "JetBrains Mono"'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to the system monospace font */
  }
}

function setupTouch(input: Input, game: Game) {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (!coarse && !('ontouchstart' in window)) return;
  $('touch').classList.remove('hidden');
  document.body.classList.add('touch');
  $('start').textContent = '[ TAP TO DESCEND ]';
  document.querySelector('#end .s-hint')!.textContent = 'TAP TO WALK THE BASIN AGAIN';
  input.touch.active = true;
  const stick = $('stick');
  const knob = $('knob');
  let sid = -1;
  const moveStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const max = r.width * 0.38;
    const l = Math.hypot(dx, dy);
    if (l > max) {
      dx *= max / l;
      dy *= max / l;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.touch.mx = dx / max;
    input.touch.my = -dy / max;
  };
  stick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => e.pointerId === sid && moveStick(e));
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== sid) return;
    sid = -1;
    knob.style.transform = '';
    input.touch.mx = 0;
    input.touch.my = 0;
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  const hold = (id: string, key: 'fire' | 'use' | 'run') => {
    const el = $(id);
    const on = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      input.touch[key] = true;
      el.classList.add('held');
      game.sfx.init();
    };
    const off = () => {
      input.touch[key] = false;
      el.classList.remove('held');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  };
  hold('t-fire', 'fire');
  hold('t-use', 'use');
  hold('t-run', 'run');
  $('t-map').addEventListener('pointerdown', () => (game.mapOpen = !game.mapOpen));
  $('t-pause').addEventListener('pointerdown', () => (game.state === 'title' ? game.start() : game.togglePause()));
}

async function boot() {
  await loadFonts();
  const params = new URLSearchParams(location.search);
  const canvas = $('view') as HTMLCanvasElement;
  const renderer = new AsciiRenderer(canvas);
  let density = Number(params.get('density') ?? store('dust-signal-density') ?? 1);
  if (!(density >= 0 && density < DENSITIES.length)) density = 1;
  const resize = () => renderer.resize(window.innerWidth, window.innerHeight, density);
  resize();

  const input = new Input(canvas);
  const sfx = new Sfx();
  const seed = Number(params.get('seed')) || 7;
  const game = new Game(renderer, input, sfx, seed);
  $('p-density').textContent = DENSITIES[density].name;
  game.onDensity = (d) => {
    density = Math.max(0, Math.min(DENSITIES.length - 1, density + d));
    store('dust-signal-density', String(density));
    $('p-density').textContent = DENSITIES[density].name;
    resize();
  };
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = window.setTimeout(resize, 120);
  });

  const call = $('callsign') as HTMLInputElement;
  call.value = game.callsign;
  call.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      game.start();
    }
  });
  $('start').addEventListener('click', () => game.start());
  $('end').addEventListener('pointerdown', () => {
    if (game.state === 'dead' || game.state === 'won') game.restart();
  });
  setupTouch(input, game);

  const fps = params.has('fps') ? document.createElement('div') : null;
  if (fps) {
    fps.style.cssText = 'position:fixed;left:8px;top:50%;color:#7d7a70;font:11px monospace;z-index:9;pointer-events:none';
    document.body.appendChild(fps);
  }
  let frames = 0;
  let acc = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    game.update(dt);
    game.render();
    if (fps) {
      frames++;
      acc += dt;
      if (acc > 0.5) {
        fps.textContent = `${Math.round(frames / acc)} fps · ${renderer.cols}x${renderer.rows}`;
        frames = 0;
        acc = 0;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  $('boot').classList.add('gone');
  if (params.has('autostart')) game.start();

  // debug hooks (used by the screenshot script; harmless in production)
  (window as unknown as { __dust: unknown }).__dust = { game, ...game.debug() };
}

boot().catch((err) => {
  console.error(err);
  $('boot').textContent = 'THE SIGNAL DIED: ' + (err?.message ?? err);
});
