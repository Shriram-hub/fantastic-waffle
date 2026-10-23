export const DEFAULT_BRAND={name:'Veloce',accent:'#4F46E5'};
export function savedPreference(key,fallback) {try{return globalThis.localStorage?.getItem(key) || fallback;}catch{return fallback;}}
export function applyTheme(theme) {
  if(typeof document==='undefined')return;
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark' ? '#090D16' : '#F8FAFC');
  try{localStorage.setItem('veloce-theme',theme);}catch{}
}
export function applyBrand(brand={}) {
  if(typeof document==='undefined')return;
  document.title=`${brand.name==='Veloce AI' ? DEFAULT_BRAND.name : brand.name || DEFAULT_BRAND.name} · Candidate Pipeline & Outbound Desk`;
  const accent=/^#[0-9a-f]{6}$/i.test(brand.accent || '') ? brand.accent : DEFAULT_BRAND.accent;
  document.documentElement.style.setProperty('--accent',accent);
  const channels=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16)/255).map(v=>v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  const luminance=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];
  document.documentElement.style.setProperty('--on-accent',luminance>.179 ? '#090D16' : '#FFFFFF');
}
