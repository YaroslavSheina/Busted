// Панель тюнинга: выбор тестовой дороги и слайдеры для всех параметров из config.
import { P, type ParamKey } from './config';
import { LEVELS, type LevelKey } from './levels';

export interface PanelHandlers {
  onLevel: (k: LevelKey) => void;
  onParam: (k: ParamKey) => void;
}

export function initGear(button: HTMLElement, panel: HTMLElement): void {
  button.onclick = () => panel.classList.toggle('open');
}

export function buildPanel(panel: HTMLElement, levelKey: LevelKey, h: PanelHandlers): void {
  panel.innerHTML = '';
  const lv = document.createElement('div'); lv.className = 'levels';
  for (const k of Object.keys(LEVELS) as LevelKey[]) {
    const b = document.createElement('button');
    b.textContent = LEVELS[k].name;
    if (k === levelKey) b.classList.add('on');
    b.onclick = () => h.onLevel(k);
    lv.appendChild(b);
  }
  panel.appendChild(lv);
  for (const k of Object.keys(P) as ParamKey[]) {
    const p = P[k];
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label>${p.l}</label><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.v}"><span>${p.v}</span>`;
    const inp = row.querySelector('input')!, sp = row.querySelector('span')!;
    inp.oninput = () => { p.v = parseFloat(inp.value); sp.textContent = String(p.v); h.onParam(k); };
    panel.appendChild(row);
  }
  const hint = document.createElement('div'); hint.className = 'hint';
  hint.textContent = 'Left/Right — относительно машины, не экрана. На клавиатуре: стрелки или A/D, пробел — заново.';
  panel.appendChild(hint);
}
