// Stamp the stored theme on <html> before first paint, so a dark-theme visitor
// never sees a white flash while the module graph loads.
//
// This is a separate file rather than an inline <script> for one reason: the
// page ships a Content-Security-Policy with no 'unsafe-inline', and an inline
// script would need either that or a hash pinned to its exact bytes. A plain
// (non-module) script tag in the head is render-blocking, so it still runs
// before anything is painted.
(function () {
  try {
    var t = localStorage.getItem('dmp-template:theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) {
    /* private mode: the OS preference applies, which is the right default */
  }
})();
