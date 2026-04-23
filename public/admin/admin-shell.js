/* ════════════════════════════════════════════════════════
   OSA Admin Shell JS — v2026
   Shared across all admin pages
   ════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── AUTH GUARD ── */
  const PUBLIC_PATHS = ['/admin/', '/admin', '/admin/index'];
  const isPublic = PUBLIC_PATHS.some(p =>
    window.location.pathname === p ||
    window.location.pathname.endsWith(p) ||
    window.location.pathname.endsWith('/admin/')
  );

  if (!isPublic) {
    const token = sessionStorage.getItem('osa_admin_token');
    if (!token) {
      window.location.replace('/admin');
      return;
    }
  }

  function normalizePath(pathname) {
    return String(pathname || '/')
      .replace(/\/index\.html$/i, '/')
      .replace(/\/index$/i, '/')
      .replace(/\.html$/i, '')
      .replace(/\/+$/, '') || '/';
  }

  function humanizeRoutePart(value) {
    return String(value || '')
      .replace(/\.html$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, m => m.toUpperCase());
  }

  function stripHtmlExt(value) {
    return String(value || '').replace(/\.html\b/gi, '');
  }

  const PAGE_META = {
    '/admin/dashboard': { title: 'Dashboard', crumb: 'Overview' },
    '/admin/modules/announcements': { title: 'Announcements', crumb: 'Manage Announcements' },
    '/admin/modules/lost-found': { title: 'Lost & Found', crumb: 'Manage Items' },
    '/admin/modules/home-content': { title: 'Home Content', crumb: 'Edit Home Content' },
    '/admin/modules/about': { title: 'About Page', crumb: 'Edit About Page' },
    '/admin/modules/chat-support': { title: 'Chat Support', crumb: 'Live Support' },
  };

  /* ── NAV HTML TEMPLATE ── */
  function buildNavHTML(activePage) {
    const pages = [
      { href: '/admin/dashboard',     label: 'Dashboard',      icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>', badge: '' },
      { href: '/admin/modules/announcements', label: 'Announcements', icon: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>', badge: 'ann' },
      { href: '/admin/modules/lost-found',    label: 'Lost & Found',  icon: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', badge: 'lf' },
      { href: '/admin/modules/home-content',  label: 'Home Content',  icon: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>', badge: '' },
      { href: '/admin/modules/about',         label: 'About Page',    icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', badge: '' },
      { href: '/admin/modules/chat-support', label: 'Chat Support',  icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', badge: 'chat' },
    ];

    const currentPath = normalizePath(activePage || window.location.pathname);
    const navLinks = pages.map(p => {
      const linkPath = normalizePath(p.href);
      const isActive = currentPath === linkPath;
      const badgeHtml = p.badge ? `<span class="nav-badge" data-nav-badge="${p.badge}">0</span>` : '';
      return `<a class="nav-link${isActive ? ' active' : ''}" href="${p.href}">
        <svg viewBox="0 0 24 24">${p.icon}</svg>${p.label}${badgeHtml}
      </a>`;
    }).join('');

    const drawerLinks = pages.map(p => {
      const linkPath = normalizePath(p.href);
      const isActive = currentPath === linkPath;
      const badgeHtml = p.badge ? `<span class="nav-badge" data-nav-badge="${p.badge}">0</span>` : '';
      return `<a class="drawer-nav-item${isActive ? ' active' : ''}" href="${p.href}">
        <svg viewBox="0 0 24 24">${p.icon}</svg>${p.label}${badgeHtml}
      </a>`;
    }).join('');

    return `
<!-- TOP NAV -->
<nav class="admin-nav" id="admin-nav" role="navigation" aria-label="Admin navigation">
  <button class="nav-hamburger" id="nav-hamburger" aria-label="Open menu" aria-expanded="false" aria-controls="admin-drawer">
    <svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>
  <a class="admin-nav__brand" href="/admin/dashboard">
    <img class="admin-nav__logo" src="/assets/images/eac-emblem.png" alt="EAC" onerror="this.style.display='none'">
    <div class="admin-nav__title">
      <strong>EAC Cavite</strong>
      <span>OSA Admin Panel</span>
    </div>
  </a>
  <div class="admin-nav__sep" aria-hidden="true"></div>
  <div class="admin-nav__links">
    <a class="nav-link" href="/admin/dashboard">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      Dashboard
    </a>
    <a class="nav-link" href="/admin/modules/announcements">
      <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      Announcements
      <span class="nav-badge" data-nav-badge="ann">0</span>
    </a>
    <a class="nav-link" href="/admin/modules/lost-found">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Lost &amp; Found
      <span class="nav-badge" data-nav-badge="lf">0</span>
    </a>
    <a class="nav-link" href="/admin/modules/home-content">
      <svg viewBox="0 0 24 24"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Home Content
    </a>
    <a class="nav-link" href="/admin/modules/about">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      About Page
    </a>
    <a class="nav-link" href="/admin/modules/chat-support">
      <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Chat Support
      <span class="nav-badge" data-nav-badge="chat" style="display:none">0</span>
    </a>
    <a class="nav-link" href="/" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Live Portal
    </a>
  </div>
  <div class="admin-nav__right">
    <div class="admin-nav-time" aria-live="polite" aria-label="Philippine time">
      <span>PH</span>
      <strong data-ph-time></strong>
    </div>
    <div class="admin-user-menu" id="admin-user-menu">
      <button class="admin-user-trigger" id="admin-user-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="admin-user-menu-panel">
        <span class="admin-user-trigger__label">
          <strong data-admin-name>OSA Administrator</strong>
          <span data-admin-email>admin@eac.edu.ph</span>
        </span>
        <svg class="admin-user-trigger__chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="admin-user-menu__panel" id="admin-user-menu-panel" role="menu" aria-label="Account menu">
        <div class="admin-user-menu__head">
          <strong data-admin-name>OSA Administrator</strong>
          <span data-admin-email>admin@eac.edu.ph</span>
        </div>
        <button class="admin-user-menu__item" data-logout type="button" role="menuitem">
          <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>Log Out</span>
        </button>
      </div>
    </div>
  </div>
</nav>

<!-- UTILITY BAR -->
<div class="admin-util-bar" id="admin-util-bar">
  <div class="util-left">
    <span class="util-page-title" id="util-page-title">Admin</span>
    <div class="util-breadcrumb" id="util-breadcrumb">
      <span>OSA Admin</span>
      <span class="sep">›</span>
      <span id="util-breadcrumb-page">Overview</span>
    </div>
  </div>
  <div class="util-right">
    <div class="util-datetime" id="util-datetime" aria-live="polite" aria-label="Philippine date and time">
      <span class="util-datetime__date" data-ph-date></span>
      <span class="util-datetime__sep">·</span>
      <span class="util-datetime__time" data-ph-time></span>
      <span class="util-datetime__ph">PH</span>
    </div>
    <a class="util-portal-link" href="/" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Live Portal
    </a>
  </div>
</div>

<!-- MOBILE DRAWER -->
<div class="admin-drawer" id="admin-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu">
  <div class="drawer-backdrop" id="drawer-backdrop"></div>
  <div class="drawer-panel">
    <div class="drawer-header">
      <div class="drawer-brand">
        <img src="/assets/images/eac-emblem.png" alt="EAC" onerror="this.style.display='none'">
        <div class="drawer-brand-text">
          <strong>EAC Cavite</strong>
          <span>OSA Admin Panel</span>
        </div>
      </div>
      <button class="drawer-close" id="drawer-close" aria-label="Close menu">
        <svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg>
      </button>
    </div>
    <nav class="drawer-nav">
      <span class="drawer-section-label">Overview</span>
      <a class="drawer-nav-item" href="/admin/dashboard">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Dashboard
      </a>
      <span class="drawer-section-label">Content</span>
      <a class="drawer-nav-item" href="/admin/modules/announcements">
        <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        Announcements
        <span class="nav-badge" data-nav-badge="ann">0</span>
      </a>
      <a class="drawer-nav-item" href="/admin/modules/lost-found">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Lost &amp; Found
        <span class="nav-badge" data-nav-badge="lf">0</span>
      </a>
      <a class="drawer-nav-item" href="/admin/modules/home-content">
        <svg viewBox="0 0 24 24"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Home Content
      </a>
      <a class="drawer-nav-item" href="/admin/modules/about">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        About Page
      </a>
      <a class="drawer-nav-item" href="/admin/modules/chat-support">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Chat Support
        <span class="nav-badge" data-nav-badge="chat" style="display:none">0</span>
      </a>
      <span class="drawer-section-label">Portal</span>
      <a class="drawer-nav-item" href="/" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        View Live Portal
      </a>
    </nav>
    <div class="drawer-footer">
      <div class="drawer-profile">
        <div class="admin-avatar" data-admin-initials>AD</div>
        <div class="drawer-profile-text">
          <strong data-admin-name>Administrator</strong>
          <span data-admin-email></span>
        </div>
      </div>
      <button class="drawer-logout" data-logout type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Log Out
      </button>
    </div>
  </div>
</div>
    `;
  }

  /* ── DOM READY ── */
  document.addEventListener('DOMContentLoaded', () => {
    const currentPath = normalizePath(window.location.pathname);

    /* Inject/replace nav shell to keep all admin pages consistent */
    const navPlaceholder = document.getElementById('admin-nav-shell');
    const shellHTML = buildNavHTML(currentPath);
    if (navPlaceholder) {
      navPlaceholder.outerHTML = shellHTML;
    } else {
      const adminPage = document.querySelector('.admin-page') || document.body;
      const oldNav = document.getElementById('admin-nav');
      const oldUtil = document.getElementById('admin-util-bar');
      const oldDrawer = document.getElementById('admin-drawer');
      if (oldNav) oldNav.remove();
      if (oldUtil) oldUtil.remove();
      if (oldDrawer) oldDrawer.remove();
      adminPage.insertAdjacentHTML('afterbegin', shellHTML);
    }

    /* ── Populate admin identity ── */
    const adminName  = sessionStorage.getItem('osa_admin_name')  || 'Administrator';
    const adminEmail = sessionStorage.getItem('osa_admin_email') || '';
    const initials   = adminName.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase() || 'AD';

    document.querySelectorAll('[data-admin-name]').forEach(el => el.textContent = adminName);
    document.querySelectorAll('[data-admin-email]').forEach(el => el.textContent = adminEmail);
    document.querySelectorAll('[data-admin-initials]').forEach(el => el.textContent = initials);

    /* ── PH Clock with seconds ── */
    const dtDates = Array.from(document.querySelectorAll('[data-ph-date]'));
    const dtTimes = Array.from(document.querySelectorAll('[data-ph-time]'));

    if (dtDates.length || dtTimes.length) {
      const tickClock = () => {
        const now = new Date();
        const dateText = new Intl.DateTimeFormat('en-PH', {
            timeZone: 'Asia/Manila',
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }).format(now);
        const timeText = new Intl.DateTimeFormat('en-PH', {
            timeZone: 'Asia/Manila',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          }).format(now);
        dtDates.forEach(el => { el.textContent = dateText; });
        dtTimes.forEach(el => { el.textContent = timeText; });
      };
      tickClock();
      setInterval(tickClock, 1000);
    }

    /* ── Admin nav stays fixed-size (no scroll compact) ── */
    const adminNav = document.getElementById('admin-nav');
    const adminUtilBar = document.getElementById('admin-util-bar');
    const adminPage = document.querySelector('.admin-page');
    if (adminNav) adminNav.classList.remove('is-compact');
    if (adminUtilBar) adminUtilBar.classList.remove('is-compact');
    if (adminPage) adminPage.classList.remove('is-compact');

    /* ── Ensure Chat Support link exists globally ── */
    function buildChatNavLink(isDrawer) {
      const a = document.createElement('a');
      a.className = isDrawer ? 'drawer-nav-item' : 'nav-link';
      a.href = '/admin/modules/chat-support';
      a.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        'Chat Support' +
        '<span class="nav-badge" data-nav-badge="chat" style="display:none">0</span>';
      return a;
    }

    function ensureChatSupportLinks() {
      document.querySelectorAll('.admin-nav__links').forEach(container => {
        if (container.querySelector('a[href="/admin/modules/chat-support"]')) return;
        const livePortal = container.querySelector('a[href="/"]');
        container.insertBefore(buildChatNavLink(false), livePortal || null);
      });

      document.querySelectorAll('.drawer-nav').forEach(container => {
        if (container.querySelector('a[href="/admin/modules/chat-support"]')) return;
        const livePortal = container.querySelector('a[href="/"]');
        container.insertBefore(buildChatNavLink(true), livePortal || null);
      });
    }

    ensureChatSupportLinks();

    /* ── Active nav links ── */
    const path = currentPath;
    document.querySelectorAll('.nav-link, .drawer-nav-item').forEach(link => {
      const href = normalizePath(link.getAttribute('href') || '');
      if (!href || href === '/') return;
      if (path === href) {
        link.classList.add('active');
      }
    });

    /* ── Utility title / breadcrumb labels ── */
    const utilPageTitle = document.getElementById('util-page-title');
    const utilBreadcrumbPage = document.getElementById('util-breadcrumb-page');
    const pageMeta = PAGE_META[path];
    const routeSlug = stripHtmlExt((path.split('/').filter(Boolean).pop() || 'admin'));
    if (utilPageTitle) {
      utilPageTitle.textContent = routeSlug;
    }
    if (utilBreadcrumbPage) {
      if (pageMeta) {
        utilBreadcrumbPage.textContent = stripHtmlExt(pageMeta.crumb);
      } else {
        utilBreadcrumbPage.textContent = routeSlug;
      }
    }

    if (document.title) {
      document.title = stripHtmlExt(document.title);
    }

    /* ── Badge counts ── */
    const setBadge = (key, count) => {
      document.querySelectorAll(`[data-nav-badge="${key}"]`).forEach(el => {
        el.textContent = count;
        el.style.display = count ? '' : 'none';
      });
    };
    setBadge('ann', 0);
    setBadge('lf', 0);
    Promise.all([
      fetch('/api/v1/admin/announcements').then(r => (r.ok ? r.json() : Promise.reject(new Error('ann')))),
      fetch('/api/v1/admin/lost-found').then(r => (r.ok ? r.json() : Promise.reject(new Error('lf'))))
    ]).then(([annRes, lfRes]) => {
      const annCount = Array.isArray(annRes && annRes.data) ? annRes.data.length : 0;
      const lfCount = Array.isArray(lfRes && lfRes.data) ? lfRes.data.length : 0;
      setBadge('ann', annCount);
      setBadge('lf', lfCount);
    }).catch(() => {});

    /* ── Logout ── */
    const performLogout = () => {
      sessionStorage.clear();
      window.location.replace('/admin');
    };

    document.querySelectorAll('[data-logout]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        performLogout();
      });
    });

    // Delegated fallback for dynamically replaced / nested menu buttons.
    document.addEventListener('click', (e) => {
      const trigger = e.target && e.target.closest ? e.target.closest('[data-logout]') : null;
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      performLogout();
    });

    /* ── Desktop account dropdown ── */
    const userMenu = document.getElementById('admin-user-menu');
    const userTrigger = document.getElementById('admin-user-trigger');
    const closeUserMenu = () => {
      if (!userMenu || !userTrigger) return;
      userMenu.classList.remove('is-open');
      userTrigger.setAttribute('aria-expanded', 'false');
    };
    const openUserMenu = () => {
      if (!userMenu || !userTrigger) return;
      userMenu.classList.add('is-open');
      userTrigger.setAttribute('aria-expanded', 'true');
    };
    if (userMenu && userTrigger) {
      userTrigger.addEventListener('click', e => {
        e.stopPropagation();
        if (userMenu.classList.contains('is-open')) closeUserMenu();
        else openUserMenu();
      });
      document.addEventListener('click', e => {
        if (!userMenu.contains(e.target)) closeUserMenu();
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeUserMenu();
      });
    }

    /* ── Hamburger / Drawer ── */
    const hamburger = document.getElementById('nav-hamburger');
    const drawer    = document.getElementById('admin-drawer');
    const backdrop  = document.getElementById('drawer-backdrop');
    const closeBtn  = document.getElementById('drawer-close');

    if (hamburger && drawer) {
      const openDrawer = () => {
        drawer.classList.add('is-open');
        document.body.classList.add('admin-menu-open');
        hamburger.setAttribute('aria-expanded', 'true');
        // Focus first nav item
        const firstItem = drawer.querySelector('.drawer-nav-item');
        if (firstItem) setTimeout(() => firstItem.focus(), 300);
      };
      const closeDrawer = () => {
        drawer.classList.remove('is-open');
        document.body.classList.remove('admin-menu-open');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.focus();
      };

      hamburger.addEventListener('click', openDrawer);
      if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
      if (backdrop) backdrop.addEventListener('click', closeDrawer);

      // Close on nav click (mobile)
      drawer.querySelectorAll('.drawer-nav-item[href]').forEach(link => {
        link.addEventListener('click', () => {
          if (window.innerWidth <= 900) closeDrawer();
        });
      });

      // Escape key
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && drawer.classList.contains('is-open')) closeDrawer();
      });

      // Close drawer when resized to desktop
      window.addEventListener('resize', () => {
        if (window.innerWidth > 900) closeDrawer();
      });
    }

    /* ── Modal handling ── */
    document.querySelectorAll('[data-modal-open]').forEach(trigger => {
      trigger.addEventListener('click', () => {
        const id = trigger.dataset.modalOpen;
        openModal(id);
      });
    });

    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.modalClose || btn.closest('.modal-backdrop')?.id;
        if (id) closeModal(id);
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) closeModal(backdrop.id);
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => closeModal(m.id));
      }
    });

    /* ── Upload zone drag styling ── */
    document.querySelectorAll('.upload-zone').forEach(zone => {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); });
    });
  });

  /* ── MODAL API ── */
  window.openModal = function (id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
  };
  window.closeModal = function (id) {
    const el = typeof id === 'string' ? document.getElementById(id) : id;
    if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
  };

  /* ── TOAST API ── */
  let toastWrap = null;
  window.showToast = function (msg, type = 'info', duration = 3500) {
    if (!toastWrap) {
      toastWrap = document.createElement('div');
      toastWrap.className = 'toast-wrap';
      document.body.appendChild(toastWrap);
    }
    const icons = {
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
      error:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#841a2d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-msg">${msg}</span>
      <button class="toast-close" onclick="this.closest('.toast').remove()" aria-label="Dismiss">×</button>
    `;
    toastWrap.appendChild(t);
    setTimeout(() => t.style.transition = 'opacity 0.3s', 50);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, duration);
  };

  /* ── CONFIRM DELETE ── */
  window.confirmDelete = function (msg, onConfirm) {
    const id = 'confirm-modal-' + Date.now();
    const backdrop = document.createElement('div');
    backdrop.id = id;
    backdrop.className = 'modal-backdrop open';
    backdrop.innerHTML = `
      <div class="modal" style="max-width:400px;font-family:var(--font-body)">
        <div class="modal-head">
          <h2 style="color:var(--ink);font-family:var(--font-body);font-weight:700">Confirm Delete</h2>
          <button class="modal-close" onclick="closeModal('${id}')">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.88rem;color:var(--muted);line-height:1.65">${msg}</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" onclick="closeModal('${id}')">Cancel</button>
          <button id="${id}-confirm" style="min-height:36px;padding:0 14px;border:1px solid #1d4ed8;background:#2563eb;color:#fff;font:inherit;font-weight:700;border-radius:6px;cursor:pointer">Yes, Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    document.getElementById(`${id}-confirm`).addEventListener('click', () => {
      closeModal(id);
      setTimeout(() => { backdrop.remove(); onConfirm(); }, 140);
    });
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) { closeModal(id); setTimeout(() => backdrop.remove(), 140); }
    });
  };

  /* ── LOCAL DB HELPERS ── */
  window.adminDB = {
    get: (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; } },
    push: (key, item) => { const arr = adminDB.get(key) || []; arr.push(item); return adminDB.set(key, arr); },
    update: (key, id, patch) => {
      const arr = adminDB.get(key) || [];
      const idx = arr.findIndex(i => i.id === id);
      if (idx === -1) return false;
      arr[idx] = { ...arr[idx], ...patch };
      return adminDB.set(key, arr);
    },
    remove: (key, id) => { const arr = (adminDB.get(key) || []).filter(i => i.id !== id); return adminDB.set(key, arr); },
    nextId: (prefix = 'item') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
  };

  /* ── API HELPERS ── */
  window.adminApi = {
    async get(path) {
      const res = await fetch(`/api/v1${path}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    },
    async post(path, body) {
      const res = await fetch(`/api/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    }
  };

  /* ── IMAGE UPLOAD PREVIEW ── */
  window.initImageUpload = function (inputId, previewId) {
    const input   = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    let files = [];

    input.addEventListener('change', () => {
      Array.from(input.files).forEach(file => {
        const reader = new FileReader();
        reader.onload = e => { files.push({ name: file.name, src: e.target.result }); renderPreviews(); };
        reader.readAsDataURL(file);
      });
      input.value = '';
    });

    function renderPreviews() {
      preview.innerHTML = files.map((f, i) => `
        <div class="img-preview-thumb">
          <img src="${f.src}" alt="${f.name}">
          <button type="button" onclick="window._rmThumb(${i},'${inputId}','${previewId}')" aria-label="Remove image">×</button>
        </div>
      `).join('');
    }

    window._rmThumb = (i, inp, prev) => {
      if (inputId === inp && previewId === prev) { files.splice(i, 1); renderPreviews(); }
    };
    input._getFiles = () => files;
  };

})();
