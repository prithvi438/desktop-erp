// Loaded before the stylesheet to restore appearance without a light-theme flash.
(()=>{
 const key='speedoone-appearance';let saved;try{saved=localStorage.getItem(key);}catch{}
 const root=document.documentElement;
 const apply=value=>{root.dataset.theme=value;root.style.colorScheme=value;const button=document.getElementById('theme-toggle');if(button){button.textContent=value==='dark'?'Light mode':'Dark mode';button.setAttribute('aria-label','Switch to '+(value==='dark'?'light':'dark')+' mode (Ctrl+Shift+L)');button.setAttribute('aria-pressed',String(value==='dark'));}};
 apply(['light','dark'].includes(saved)?saved:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
 const toggle=()=>{const value=root.dataset.theme==='dark'?'light':'dark';apply(value);try{localStorage.setItem(key,value);}catch{}};
 window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyL'){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)toggle();}},true);
 document.addEventListener('DOMContentLoaded',()=>{document.getElementById('theme-toggle')?.addEventListener('click',toggle);apply(root.dataset.theme);});
})();
