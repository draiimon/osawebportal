/**
 * OSA Portal Shell — single source of truth for the navbar and footer.
 *
 * Usage on any sub-page:
 *   <body>
 *     <div data-portal-shell data-active="announcements"></div>
 *     ... page content ...
 *   </body>
 *   <script src="/assets/js/portal-shell.js" defer></script>
 *
 * The script replaces <div data-portal-shell> with the full <header>
 * (`.site-navbar`) and injects the shared <footer> (`.site-footer`) at the
 * end of <body>. Any updates here automatically propagate to every page.
 */
(function () {
    /* ----------------------------------------------------------------
     * Context-aware loading indicator
     * ---------------------------------------------------------------- */
    (function initLoader() {
        var THRESHOLD_MS = 220;
        var MIN_VISIBLE_MS = 520;
        var showTimer = null;
        var loaderEl = null;
        var visible = false;
        var shownAt = 0;
        var pending = 1; // initial boot gate pending until app signals ready
        var bootResolved = false;
        var progressTimer = null;
        var progressValue = 8;

        function ensureLoaderAnimationStyles() {
            if (document.getElementById('osa-loader-critical-style')) return;
            var style = document.createElement('style');
            style.id = 'osa-loader-critical-style';
            style.textContent =
                '.osa-loader__spinner{animation:osaLoaderSpin .8s linear infinite !important;transform-origin:center center !important;will-change:transform;border-radius:50% !important}' +
                '.osa-loader__bar span{width:var(--osa-loader-progress,8%) !important;transition:width .18s linear !important}' +
                '@keyframes osaLoaderSpin{to{transform:rotate(360deg)}}';
            document.head.appendChild(style);
        }

        function setProgress(value) {
            progressValue = Math.max(6, Math.min(100, value));
            var el = createLoader();
            if (el) {
                el.style.setProperty('--osa-loader-progress', progressValue + '%');
            }
        }

        function stopProgressTimer() {
            if (!progressTimer) return;
            clearInterval(progressTimer);
            progressTimer = null;
        }

        function startProgressTimer() {
            stopProgressTimer();
            progressTimer = setInterval(function () {
                if (!visible || pending <= 0) return;
                if (progressValue >= 92) return;
                var bump = progressValue < 45 ? 5 : (progressValue < 75 ? 3 : 1.6);
                setProgress(progressValue + bump);
            }, 220);
        }

        function createLoader() {
            ensureLoaderAnimationStyles();
            if (loaderEl) return loaderEl;
            var existing = document.querySelector('.osa-loader');
            if (existing) {
                loaderEl = existing;
                return loaderEl;
            }
            if (!document.body) return null;
            loaderEl = document.createElement('div');
            loaderEl.className = 'osa-loader';
            loaderEl.setAttribute('role', 'status');
            loaderEl.setAttribute('aria-live', 'polite');
            loaderEl.setAttribute('aria-label', 'Loading content');
            loaderEl.innerHTML =
                '<div class="osa-loader__backdrop"></div>' +
                '<div class="osa-loader__card">' +
                '  <div class="osa-loader__spinner" aria-hidden="true"></div>' +
                '  <div class="osa-loader__content">' +
                '    <strong>Loading OSA Portal</strong>' +
                '    <span>Please wait while content is prepared...</span>' +
                '  </div>' +
                '  <div class="osa-loader__bar"><span></span></div>' +
                '</div>';
            document.body.appendChild(loaderEl);
            return loaderEl;
        }

        function renderShow() {
            if (visible) return;
            var el = createLoader();
            if (!el) return;
            visible = true;
            document.body && document.body.classList.add('osa-loading-active');
            shownAt = Date.now();
            setProgress(10);
            startProgressTimer();
            void el.offsetHeight;
            el.classList.add('is-visible');
        }

        function renderHide() {
            if (!visible) return;
            var elapsed = Date.now() - shownAt;
            var delay = Math.max(0, MIN_VISIBLE_MS - elapsed);
            setTimeout(function () {
                if (pending > 0) return;
                setProgress(100);
                stopProgressTimer();
                visible = false;
                if (loaderEl) {
                    setTimeout(function () {
                        if (loaderEl) loaderEl.classList.remove('is-visible');
                        if (document.body) document.body.classList.remove('osa-loading-active');
                    }, 180);
                }
            }, delay);
        }

        function scheduleShow(forceImmediate) {
            if (window.__OSAInlineBootActive) return;
            if (showTimer || visible) return;
            if (forceImmediate) {
                renderShow();
                return;
            }
            showTimer = setTimeout(function () {
                showTimer = null;
                renderShow();
            }, THRESHOLD_MS);
        }

        function cancelOrHide() {
            if (showTimer) { clearTimeout(showTimer); showTimer = null; }
            if (visible) renderHide();
        }

        window.OSALoader = {
            show: function () {
                pending++;
                scheduleShow(false);
            },
            hide: function () {
                pending = Math.max(0, pending - 1);
                if (pending === 0) cancelOrHide();
            },
            track: function (promise) {
                this.show();
                var done = this.hide.bind(this);
                Promise.resolve(promise).then(done, done);
                return promise;
            }
        };

        function resolveBootGate() {
            if (bootResolved) return;
            bootResolved = true;
            pending = Math.max(0, pending - 1);
            if (pending === 0) cancelOrHide();
        }

        if (document.readyState !== 'complete') {
            scheduleShow(false);
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', cancelOrHide, { once: true });
            } else {
                setTimeout(cancelOrHide, 0);
            }
        }

        // Release initial boot only when app reports ready.
        window.addEventListener('osa:app-ready', resolveBootGate, { once: true });
        // Fallback release in case app-ready signal fails.
        window.addEventListener('load', function () {
            setTimeout(resolveBootGate, 2200);
        }, { once: true });

        document.addEventListener('click', function (ev) {
            var anchor = ev.target && ev.target.closest && ev.target.closest('a[href]');
            if (!anchor || ev.defaultPrevented) return;
            if (anchor.target && anchor.target !== '_self') return;
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
            if (ev.button !== undefined && ev.button !== 0) return;

            var href = anchor.getAttribute('href');
            if (!href) return;
            if (href.charAt(0) === '#') return;
            if (/^(javascript|mailto|tel):/i.test(href)) return;

            var url;
            try { url = new URL(href, location.href); } catch (e) { return; }
            if (url.origin !== location.origin) return;
            if (url.pathname === location.pathname && url.search === location.search) return;

            scheduleShow(false);
        }, true);

        window.addEventListener('pageshow', function (ev) {
            if (ev.persisted) cancelOrHide();
        });
    })();

    var NAV_LINKS = [
        { key: 'dashboard', label: 'Home', href: '/', desktopAttr: 'data-nav', mobileAttr: 'data-nav-mobile' },
        { key: 'announcements', label: 'Announcements', href: '/announcements/' },
        { key: 'lost-found', label: 'Lost & Found', href: '/lost-and-found/' },
        { key: 'about-portal', label: 'About', href: '/about-portal/' }
    ];

    function buildNavbar(activeKey) {
        var y = window.scrollY || 0;
        var isMobile = window.innerWidth <= 960;
        var shouldCompact = isMobile || y > 48;
        var scrolledClass = (isMobile || y > 12) ? ' is-scrolled' : '';
        var compactClass = shouldCompact ? ' is-compact' : '';
        var navClasses = 'site-navbar' + scrolledClass + compactClass;

        var links = NAV_LINKS.map(function (l) {
            var active = l.key === activeKey ? ' is-active' : '';
            var attr = l.desktopAttr ? ' ' + l.desktopAttr : '';
            return '<a class="site-navbar__link' + active + '" href="' + l.href + '"' + attr + '>' + l.label + '</a>';
        }).join('');

        var drawerLinks = NAV_LINKS.map(function (l) {
            var active = l.key === activeKey ? ' is-active' : '';
            var attr = l.mobileAttr ? ' ' + l.mobileAttr : '';
            return '<a class="' + active.trim() + '" href="' + l.href + '"' + attr + '>' + l.label + '</a>';
        }).join('');

        return '' +
            '<header class="' + navClasses + '" id="site-navbar">' +
            '  <div class="site-navbar__bar container">' +
            '    <a class="site-navbar__brand" href="/">' +
            '      <img src="/assets/images/eac-emblem.png" alt="EAC emblem" width="60" height="60">' +
            '      <span class="site-navbar__brand-text">' +
            '        <strong>OSA Transaction Guide Portal</strong>' +
            '        <span>Office of Student Affairs · EAC Cavite</span>' +
            '      </span>' +
            '    </a>' +
            '    <nav class="site-navbar__nav" aria-label="Primary navigation">' + links + '</nav>' +
            '    <div class="site-navbar__actions">' +
            '      <button class="site-navbar__toggle" id="nav-menu-toggle" type="button" aria-expanded="false" aria-controls="nav-drawer" aria-label="Open menu">' +
            '        <span class="site-navbar__toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span>' +
            '      </button>' +
            '    </div>' +
            '  </div>' +
            '  <div class="site-navbar__drawer-overlay" id="nav-drawer-overlay" aria-hidden="true"></div>' +
            '  <aside class="site-navbar__drawer" id="nav-drawer" aria-label="Mobile menu" aria-hidden="true">' +
            '    <div class="site-navbar__drawer-head">' +
            '      <div class="site-navbar__drawer-brand" style="display:flex; align-items:center; gap:12px;">' +
            '        <img src="/assets/images/eac-emblem.png" alt="EAC Logo" width="40" height="40" style="flex-shrink:0; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">' +
            '        <div class="site-navbar__drawer-brand-text" style="display:flex; flex-direction:column; gap:3px;">' +
            '          <strong class="site-navbar__drawer-title" style="font-family: Georgia, \'Times New Roman\', serif; font-size:1.02rem; line-height:1.05; letter-spacing:-0.015em; color:#fffaf3;">OSA Transaction Guide Portal</strong>' +
            '          <span class="site-navbar__drawer-kicker" style="font-family: Arial, \'Helvetica Neue\', Helvetica, sans-serif; font-size:0.66rem; color:rgba(255,235,215,0.76); font-weight:700; letter-spacing:0.03em; text-transform:none;">Office of Student Affairs · EAC Cavite</span>' +
            '        </div>' +
            '      </div>' +
            '      <button type="button" class="site-navbar__drawer-close" id="nav-drawer-close" aria-label="Close menu">×</button>' +
            '    </div>' +
            '    <nav class="site-navbar__drawer-nav" aria-label="Mobile primary">' + drawerLinks + '</nav>' +
            '  </aside>' +
            '</header>';
    }

    function buildFooter() {
        return '' +
            '<footer class="site-footer">' +
            '  <div class="site-footer__inner container">' +
            '    <div class="site-footer__main">' +
            '      <div class="site-footer__brand">' +
            '        <img src="/assets/images/eac-emblem.png" alt="EAC Logo" class="site-footer__logo" width="36" height="36">' +
            '        <div class="site-footer__brand-text">' +
            '          <strong class="site-footer__title">Office of Student Affairs</strong>' +
            '          <span class="site-footer__subtitle">Emilio Aguinaldo College Cavite</span>' +
            '        </div>' +
            '      </div>' +
            '      <div class="site-footer__info">' +
            '        <p class="site-footer__text">' +
            '          <a href="mailto:studentaffairs.cvt@eac.edu.ph">studentaffairs.cvt@eac.edu.ph</a>' +
            '          <span class="site-footer__divider">·</span> (046) 416-43-41 loc. 115' +
            '        </p>' +
            '        <p class="site-footer__text">' +
            '          Gov. D. Mangubat Ave., Brgy. Burol Main, Dasmariñas, Cavite 4114, Philippines' +
            '        </p>' +
            '      </div>' +
            '    </div>' +
            '    <div class="site-footer__sub">' +
            '      <p class="site-footer__legal">&copy; 2026 Emilio Aguinaldo College &nbsp;|&nbsp; ' +
            '        <a href="https://www.eac.edu.ph/privacy-policy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a>' +
            '      </p>' +
            '    </div>' +
            '  </div>' +
            '</footer>';
    }

    function wireNavInteractions() {
        var siteNavbar = document.getElementById('site-navbar');
        var toggle = document.getElementById('nav-menu-toggle');
        var overlay = document.getElementById('nav-drawer-overlay');
        var closeBtn = document.getElementById('nav-drawer-close');
        var drawer = document.getElementById('nav-drawer');
        if (!siteNavbar) return;

        function setMenu(open) {
            siteNavbar.classList.toggle('is-menu-open', !!open);
            if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (drawer) drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
            if (overlay) overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
            document.body.style.overflow = open ? 'hidden' : '';

            var fab = document.getElementById('osa-chat-fab');
            if (fab) {
                fab.style.display = open ? 'none' : '';
            }
        }

        if (toggle) toggle.addEventListener('click', function () {
            setMenu(!siteNavbar.classList.contains('is-menu-open'));
        });
        if (closeBtn) closeBtn.addEventListener('click', function () { setMenu(false); });
        if (overlay) overlay.addEventListener('click', function () { setMenu(false); });
        if (drawer) {
            drawer.querySelectorAll('a').forEach(function (link) {
                link.addEventListener('click', function () { setMenu(false); });
            });
        }
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && siteNavbar.classList.contains('is-menu-open')) setMenu(false);
        });

        var _scrollRafId = 0;
        function onScroll() {
            if (_scrollRafId) return;
            _scrollRafId = window.requestAnimationFrame(function () {
                _scrollRafId = 0;
                var y = window.scrollY;
                var isMobile = window.innerWidth <= 960;
                var shouldCompact = isMobile || y > 48;
                siteNavbar.classList.toggle('is-scrolled', isMobile || y > 12);
                siteNavbar.classList.toggle('is-compact', shouldCompact);
                document.documentElement.style.setProperty('--nav-h', shouldCompact ? 'var(--nav-h-compact)' : '108px');
            });
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll, { passive: true });
        onScroll();
    }

    function wireSharedAnimations() {
        var targets = document.querySelectorAll(
            '[data-animate="reveal"], .section-shell, .page-section > .container, .branded-surface > .container'
        );
        if (!targets.length) return;

        targets.forEach(function (target) {
            target.classList.add('ux-reveal');
        });

        if (!('IntersectionObserver' in window)) {
            targets.forEach(function (target) {
                target.classList.add('is-visible');
            });
            return;
        }

        var revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            });
        }, { threshold: 0.14 });

        targets.forEach(function (target) {
            if (!target.classList.contains('is-visible')) {
                revealObserver.observe(target);
            }
        });
    }

    function notifyShellReady() {
        window.__OSAShellReady = true;
        try {
            window.dispatchEvent(new CustomEvent('osa:shell-ready'));
        } catch (e) {
            var evt = document.createEvent('Event');
            evt.initEvent('osa:shell-ready', false, false);
            window.dispatchEvent(evt);
        }
    }

    function initOfflineCache() {
        if (!('serviceWorker' in navigator)) return;
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
            // Non-fatal: app still works without offline cache.
        });
    }

    function mount() {
        if (window.__OSAPortalShellMounted) {
            wireSharedAnimations();
            notifyShellReady();
            return;
        }
        window.__OSAPortalShellMounted = true;

        var mountPoint = document.querySelector('[data-portal-shell]');
        var activeKey = (mountPoint && mountPoint.getAttribute('data-active')) || '';

        if (document.getElementById('site-navbar')) {
            wireNavInteractions();
            notifyShellReady();
            return;
        }

        if (mountPoint) {
            mountPoint.outerHTML = buildNavbar(activeKey);
        } else {
            document.body.insertAdjacentHTML('afterbegin', buildNavbar(activeKey));
        }

        if (!document.querySelector('.site-footer')) {
            document.body.insertAdjacentHTML('beforeend', buildFooter());
        }

        wireNavInteractions();
        wireSharedAnimations();
        notifyShellReady();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    initOfflineCache();
})();
