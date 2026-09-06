// Панель тюнинга: выбор тестовой дороги и слайдеры для всех параметров из config.
import { P, type ParamKey } from './config';
import { LEVEL_KEYS, LEVELS } from './levels';

export interface PanelHandlers {
  onLevel: (k: string) => void;
  onParam: (k: ParamKey) => void;
}

// Кнопка открывает свою панель и закрывает остальные
export function initToggle(button: HTMLElement, panel: HTMLElement, others: HTMLElement[]): void {
  button.onclick = () => { const open = panel.classList.toggle('open'); if (open) for (const o of others) o.classList.remove('open'); };
}

export function buildPanel(panel: HTMLElement, levelKey: string, h: PanelHandlers): void {
  panel.innerHTML = '';
  const lv = document.createElement('div'); lv.className = 'levels';
  for (const k of LEVEL_KEYS) {
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
