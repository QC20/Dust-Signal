const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function bar(v: number, max: number, len: number, full = '#', empty = '·') {
  const n = Math.max(0, Math.min(len, Math.round((v / max) * len)));
  return full.repeat(n) + empty.repeat(len - n);
}

interface RadioMsg {
  who: string;
  text: string;
}

/** DOM heads-up display. Writes only when values change. */
export class Hud {
  private root = $('hud');
  private vitals = $('h-vitals');
  private weapon = $('h-weapon');
  private count = $('h-count');
  private hint = $('h-hint');
  private objLabel = $('h-objlabel');
  private arrow = $('h-arrow');
  private dist = $('h-dist');
  private storm = $('h-storm');
  private stormBar = $('h-stormbar');
  private radioEl = $('h-radio');
  private keys = $('h-keys');
  private cache = new Map<string, string>();
  private queue: RadioMsg[] = [];
  private cur: RadioMsg | null = null;
  private typed = 0;
  private hold = 0;
  onRadio: (() => void) | null = null;

  private set(el: HTMLElement, key: string, value: string, html = false) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (html) el.innerHTML = value;
    else el.textContent = value;
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  fadeKeys(faded: boolean) {
    this.keys.classList.toggle('faded', faded);
  }

  setVitals(hp: number, maxHp: number, rads: number, stamina: number) {
    const low = hp / 100 < 0.3;
    const cap = Math.round(100 - maxHp);
    const hpBar = bar(hp, 100, 18);
    const capped = cap > 0 ? hpBar.slice(0, 18 - Math.round((cap / 100) * 18)) + 'x'.repeat(Math.round((cap / 100) * 18)) : hpBar;
    const s =
      `<span class="dim">HP  </span><span class="${low ? 'low' : 'hp'}">[${capped}] ${String(Math.ceil(hp)).padStart(3)}</span>\n` +
      `<span class="dim">RAD </span><span class="rad">[${bar(rads, 100, 18)}] ${String(Math.floor(rads)).padStart(3)}</span>\n` +
      `<span class="dim">STA </span><span class="sta">[${bar(stamina, 100, 18)}]</span>`;
    this.set(this.vitals, 'v', s, true);
  }

  setWeapon(ammo: number, maxAmmo: number, scrap: number, kills: number) {
    const s =
      `<span class="dim">SCRAP RIFLE</span>\n` +
      `<span class="ammo">${ammo > 0 ? String(ammo).padStart(2, '0') : '--'}</span><span class="dim"> / ${maxAmmo}${ammo === 0 ? '  PIPE' : ''}</span>\n` +
      `<span class="dim">SCRAP ${String(scrap).padStart(3, '0')} · KILLS ${String(kills).padStart(3, '0')}</span>`;
    this.set(this.weapon, 'w', s, true);
  }

  setObjective(label: string, count: string, hint: string, angleDeg: number, meters: number) {
    this.set(this.objLabel, 'ol', label);
    this.set(this.count, 'c', count);
    this.set(this.hint, 'h', hint);
    const a = Math.round(angleDeg / 3) * 3;
    if (this.cache.get('a') !== String(a)) {
      this.cache.set('a', String(a));
      this.arrow.style.transform = `rotate(${a}deg)`;
    }
    this.set(this.dist, 'd', `${Math.round(meters)}m`);
  }

  setStorm(secondsLeft: number, level: number) {
    const s = Math.max(0, Math.ceil(secondsLeft));
    const txt = secondsLeft <= 0 ? 'IT IS HERE' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    this.set(this.storm, 's', txt);
    const danger = secondsLeft < 60;
    if (this.cache.get('sd') !== String(danger)) {
      this.cache.set('sd', String(danger));
      this.storm.classList.toggle('danger', danger);
    }
    this.set(this.stormBar, 'sb', bar(level, 1, 20, '~', ' '));
  }

  radio(who: string, text: string, priority = false) {
    if (priority) {
      this.queue.length = 0;
      this.cur = null;
    }
    this.queue.push({ who, text });
  }

  clearRadio() {
    this.queue.length = 0;
    this.cur = null;
    this.radioEl.innerHTML = '';
    this.cache.delete('r');
  }

  update(dt: number) {
    if (!this.cur) {
      const next = this.queue.shift();
      if (!next) return;
      this.cur = next;
      this.typed = 0;
      this.hold = 0;
      this.onRadio?.();
    }
    const m = this.cur;
    if (this.typed < m.text.length) {
      this.typed = Math.min(m.text.length, this.typed + dt * 55);
    } else {
      this.hold += dt;
      if (this.hold > 3.2 + m.text.length * 0.03) {
        this.cur = null;
        this.set(this.radioEl, 'r', '', true);
        return;
      }
    }
    const shown = m.text.slice(0, Math.floor(this.typed));
    const cursor = this.typed < m.text.length ? '▪' : '';
    this.set(this.radioEl, 'r', `<span class="who">${m.who}</span>${escapeHtml(shown)}${cursor}`, true);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
