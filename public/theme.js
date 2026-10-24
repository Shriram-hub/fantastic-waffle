// Run before the app and styles render to avoid a bright flash on dark workspaces.
try { const theme=localStorage.getItem('veloce-theme'); document.documentElement.dataset.theme=theme==='light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme='dark'; }
