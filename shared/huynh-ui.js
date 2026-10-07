// huynh-ui: shared theme (light/dark) for huynh.place and its apps. Load it in <head> (not deferred)
// so the theme is applied before first paint:
//   <script src="https://huynh.place/shared/huynh-ui.js"></script>
// The choice is stored in a cookie on .huynh.place, so switching dark mode on one site (main site,
// B.E.T., Home Search HQ, Gym, Reviews) applies to all of them. Any element with the attribute
// data-hu-theme-toggle becomes a toggle button. Apps can also use window.HuynhUI and listen for the
// "hu-themechange" event on document.
(function () {
    "use strict";

    var COOKIE = "hu_theme";
    var root = document.documentElement;
    var onHuynh = /(^|\.)huynh\.place$/.test(location.hostname);

    function readCookie() {
        var m = document.cookie.match(/(?:^|;\s*)hu_theme=(light|dark)/);
        return m ? m[1] : null;
    }
    function readLegacy() {
        try { var v = localStorage.getItem("theme"); return v === "light" || v === "dark" ? v : null; } catch (e) { return null; }
    }
    function systemTheme() {
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    function current() { return root.getAttribute("data-theme") === "dark" ? "dark" : "light"; }

    function apply(theme) {
        var before = current();
        if (theme === "dark") root.setAttribute("data-theme", "dark");
        else root.removeAttribute("data-theme");
        if (theme !== before) {
            try { document.dispatchEvent(new CustomEvent("hu-themechange", { detail: { theme: theme } })); } catch (e) {}
        }
    }

    function save(theme) {
        // Shared across all *.huynh.place sites; host-only cookie elsewhere (e.g. localhost previews).
        document.cookie = COOKIE + "=" + theme + "; Path=/; Max-Age=31536000; SameSite=Lax" +
            (onHuynh ? "; Domain=.huynh.place" : "") + (location.protocol === "https:" ? "; Secure" : "");
        try { localStorage.setItem("theme", theme); } catch (e) {}
    }

    function preferred() { return readCookie() || readLegacy() || systemTheme(); }

    // Apply immediately (we're in <head>).
    apply(preferred());

    function setTheme(theme) { save(theme); apply(theme); }
    function toggleTheme() { setTheme(current() === "dark" ? "light" : "dark"); }

    // Pick up a change made on another huynh.place site/tab when coming back to this one.
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) { var t = readCookie(); if (t && t !== current()) apply(t); }
    });

    // Wire up toggle buttons (present now or added later, e.g. by React).
    document.addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest("[data-hu-theme-toggle]");
        if (btn) { e.preventDefault(); toggleTheme(); }
    });

    window.HuynhUI = { getTheme: current, setTheme: setTheme, toggleTheme: toggleTheme };
})();
