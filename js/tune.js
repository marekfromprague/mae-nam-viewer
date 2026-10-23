// Live light tuning panel (open the viewer with ?tune). Copy the values you like into js/config.js.
import GUI from 'three/addons/libs/lil-gui.module.min.js';
export function tune({ CONFIG, renderer, setTime }) {
  const gui = new GUI({ title: 'Lights (copy to config.js)' });
  const re = () => setTime(gui._time || 'day');
  const d = gui.addFolder('Day'); const k = gui.addFolder('Dusk');
  d.add(CONFIG.day, 'sunIntensity', 0, 8, 0.05).onChange(() => setTime(gui._time = 'day'));
  d.addColor(CONFIG.day, 'sunColor').onChange(() => setTime(gui._time = 'day'));
  d.add(CONFIG.day, 'hemiIntensity', 0, 3, 0.05).onChange(() => setTime(gui._time = 'day'));
  d.add(CONFIG.day, 'envIntensity', 0, 2, 0.05).onChange(() => setTime(gui._time = 'day'));
  d.add(CONFIG.day, 'exposure', 0.3, 2.5, 0.01).onChange(() => setTime(gui._time = 'day'));
  k.add(CONFIG.dusk, 'lampIntensity', 0, 80, 0.5).onChange(() => setTime(gui._time = 'dusk'));
  k.add(CONFIG.dusk, 'lampDistance', 2, 30, 0.5).onChange(() => setTime(gui._time = 'dusk'));
  k.addColor(CONFIG.dusk, 'lampColor').onChange(() => setTime(gui._time = 'dusk'));
  k.add(CONFIG.dusk, 'hemiIntensity', 0, 2, 0.01).onChange(() => setTime(gui._time = 'dusk'));
  k.add(CONFIG.dusk, 'envIntensity', 0, 1, 0.01).onChange(() => setTime(gui._time = 'dusk'));
  k.add(CONFIG.dusk, 'bulbEmissiveIntensity', 0, 30, 0.5).onChange(() => setTime(gui._time = 'dusk'));
  k.add(CONFIG.dusk, 'exposure', 0.3, 2.5, 0.01).onChange(() => setTime(gui._time = 'dusk'));
  gui.add({ dump: () => console.log(JSON.stringify({ day: CONFIG.day, dusk: CONFIG.dusk }, null, 1)) }, 'dump').name('Print values to console');
  re();
}
