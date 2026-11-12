// Screen stack. A screen is { title, hints, el, onShow(returning), onKey(event), canLeave() }.
// The first screen pushed is the home screen. Esc pops; the screen underneath gets its focus back.
import { h } from './ui.js';

const stack = [];
const main = document.getElementById('main');
const title = document.getElementById('title');
const hints = document.getElementById('hints');

export const top = () => stack.at(-1);
export const atHome = () => stack.length === 1;

// Redraw the title and the key hints, after a screen changes either.
export function chrome() {
  title.textContent = top().title;
  const globalHints = top().showGlobalHints === false ? [] : [[top().functionKey ? 'Ctrl+B' : 'F10', 'Sidebar'], ['Ctrl+H', 'Home'], ['Ctrl+Shift+L','Light / dark']];
  hints.replaceChildren(...[...top().hints, ...globalHints].map(([key, label]) => h('span', {}, h('kbd', {}, key), label)));
}

async function show(returning) {
  const screen = top();
  main.replaceChildren(screen.el);
  chrome();
  await screen.onShow?.(returning);
  if(returning){
    if(screen.focused?.isConnected&&main.contains(screen.focused)){
      for(let parent=screen.focused.parentElement;parent;parent=parent.parentElement)parent.revealEntry?.(screen.focused);
      screen.focused.focus();
    }else if(!atHome()) [...main.querySelectorAll('input,button,select,textarea')].find(node=>!node.disabled&&node.getClientRects().length)?.focus();
  }
}

export function push(screen) {
  if (top()) top().focused = document.activeElement;
  stack.push(screen);
  return show(false);
}

export function pop() {
  if (stack.length < 2) return false;
  const closed=stack.pop();
  closed.onClose?.();
  show(true).then(()=>closed.afterClose?.());
  return true;
}

// Closes every screen above home. A screen with unsaved work can refuse, which stops it.
export async function goHome() {
  while (stack.length > 1) {
    if (top().canLeave && !(await top().canLeave())) { await show(true); return false; }
    stack.pop().onClose?.();
  }
  await show(true);
  return true;
}
