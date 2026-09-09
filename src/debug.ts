// Панель «уровень»: список уровней и кнопка «тюнинг», раскрывающая слайдеры всех параметров из config.
import { P, type ParamKey } from './config';
import { LEVELS } from './levels';
import { MENU } from './campaign';

export interface PanelHandlers {
  onLevel: (k: string) => void;
  onParam: (k: ParamKey) => void;
}

// Кнопка открывает свою панель и закрывает остальные; after — пересчитать паузу
export function initToggle(button: HTMLElement, panel: HTMLElement, others: HTMLElement[], after: () => void): void {
  button.onclick = () => { const open = panel.classList.toggle('open'); if (open) for (const o of others) o.classList.remove('open'); after(); };
}

let tuningOpen = false; // раскрыты ли слайдеры; переживает пересборку панели при смене уровня

export function buildPanel(panel: HTMLElement, levelKey: string, h: PanelHandlers): void {
  panel.innerHTML = '';
  const lv = document.createElement('div'); lv.className = 'levels';
  for (const k of MENU) {
    const b = document.createElement('button');
    b.textContent = LEVELS[k].name;
    if (k === levelKey) b.classList.add('on');
    b.onclick = () => h.onLevel(k);
    lv.appendChild(b);
  }
  panel.appendChild(lv);
  const tune = document.createElement('button'); tune.className = 'tune'; tune.textContent = '⚙ тюнинг';
  const details = document.createElement('div'); details.className = 'details';
  const sync = () => { details.hidden = !tuningOpen; tune.classList.toggle('on', tuningOpen); };
  tune.onclick = () => { tuningOpen = !tuningOpen; sync(); };
  panel.appendChild(tune); panel.appendChild(details);
  for (const k of Object.keys(P) as ParamKey[]) {
    const p = P[k];
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label>${p.l}</label><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.v}"><span>${p.v}</span>`;
    const inp = row.querySelector('input')!, sp = row.querySelector('span')!;
    inp.oninput = () => { p.v = parseFloat(inp.value); sp.textContent = String(p.v); h.onParam(k); };
    details.appendChild(row);
  }
  const hint = document.createElement('div'); hint.className = 'hint';
  hint.textContent = 'Left/Right — относительно машины, не экрана. На клавиатуре: стрелки или A/D, пробел — заново.';
  details.appendChild(hint);
  sync();
}
