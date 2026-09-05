import './style.css';
import { createGame } from './game';
import { levelByName } from './levels';
import { buildPanel, initGear } from './debug';

const $ = (id: string) => document.getElementById(id)!;
const panel = $('panel');

const game = createGame({
  canvas: $('c') as HTMLCanvasElement,
  hud: $('hud'), overlay: $('overlay'), ovTitle: $('ovTitle'), ovSub: $('ovSub'),
  left: $('left'), right: $('right'),
}, levelByName('straight'));

function selectLevel(key: string): void {
  game.load(levelByName(key));
  showPanel(key);
}
function showPanel(key: string): void {
  buildPanel(panel, key, {
    onLevel: selectLevel,
    onParam: k => { if (k === 'width' || k === 'traffic') game.reset(); },
  });
}

initGear($('gear'), panel);
showPanel('straight');
