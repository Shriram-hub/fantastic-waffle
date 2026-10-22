import React,{useId} from 'react';
const paths={
  documents:'M14 2H6v20h14V8l-6-6M14 2v6h6M9 12h8M9 16h6',
  sun:'M12 3v1M12 20v1M3 12h1M20 12h1M5.6 5.6l.7.7M17.7 17.7l.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon:'M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13',
  sidebar:'M3 4h18v16H3zM9 4v16M5.5 8h1M5.5 12h1',
  download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  command:'M8 8V5a2 2 0 1 0-2 2h12a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H6a2 2 0 1 0 2 2V8',
  career:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 14h3M7 17h7',
  jobs:'M21 21l-4.5-4.5M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15',
  overview:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  applications:'M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12h8M8 16h5',
  profile:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  contacts:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75',
  outreach:'M22 2 9 15M22 2l-7 20-4-9-9-4 20-7',inbox:'M3 3h18v18H3zM3 14h5l2 3h4l2-3h5',
  automation:'m13 2-3 8H3l8 12 3-8h7L13 2',connections:'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
  arrow:'M7 17 17 7M7 7h10v10',check:'m5 12 4 4L19 6',clock:'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 1l1 5M18 18a8 8 0 0 1-13-1l-1-5',
  bookmark:'M6 3h12v18l-6-4-6 4V3',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3',
};
export function Icon({name,size=20,...rest}) {return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}><path d={paths[name] || paths.jobs}/></svg>;}

export function BrandMark({size=36,...rest}) {const gradient=useId();return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="brand-mark" {...rest}><defs><linearGradient id={gradient} x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse"><stop stopColor="#4F46E5"/><stop offset="1" stopColor="#06B6D4"/></linearGradient></defs><rect width="40" height="40" rx="12" fill={`url(#${gradient})`}/><path d="m9 12 8 17 14-19h-8l-6 9-3-7H9Z" fill="white"/><path d="m23 29 8-11v11h-8Z" fill="white" opacity=".5"/></svg>;}
