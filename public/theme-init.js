// Anti-flash: apply the saved theme before first paint (light | dark | system).
// Kept as an external, render-blocking file so the CSP can forbid inline scripts.
;(function () {
  try {
    var t = localStorage.getItem('nsh_theme') || 'system'
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
    if (localStorage.getItem('nsh_large_text') === '1') document.documentElement.classList.add('text-lg-mode')
  } catch (e) {}
})()
