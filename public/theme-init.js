// Anti-FOUC: apply the theme's `.dark` class before first paint. ThemeProvider
// only reads localStorage/system preference in an effect (after paint), so a
// static file rather than an inline script keeps the CSP free of an inline
// script exception. Keep the logic identical to lib/theme-context.tsx
// (saved || system).
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
