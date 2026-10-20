import React from 'react';
const paths={
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
