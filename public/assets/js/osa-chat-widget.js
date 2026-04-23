/**
 * OSA Chat Widget — global "Ask OSA" launcher + panel, available on every page.
 *
 * Usage:
 *   <script src="/assets/js/osa-chat-widget.js" defer></script>
 *
 * Any element that should open the chat can add `data-chat-open` (attribute).
 * The widget is self-contained: markup, styles (via osa-ai.css), and behavior.
 *
 * Persistent state:
 *   - localStorage "osaChatThread" → last 80 messages (re-renders across pages)
 *   - localStorage "osaChatEmail"  → verified student email
 *   - localStorage "osaChatVerified" → boolean OTP verified flag
 *   - localStorage "osaEscalationQueue" → escalation tickets
 *   - localStorage "osaLostFound" → LF items (written by Lost & Found page)
 */
(function () {
    'use strict';

    var DOMAIN = String(window.__OSA_ALLOWED_EMAIL_DOMAIN__ || '').trim().toLowerCase();
    var THREAD_KEY = 'osaChatThread';
    var THREAD_SCHEMA_KEY = 'osaChatThreadSchemaV';
    var EMAIL_KEY = 'osaChatEmail';
    var VERIFIED_KEY = 'osaChatVerified';
    var SESSION_KEY = 'osaChatSessionId';
    var SESSION_TS_KEY = 'osaChatSessionTs';
    var NAME_KEY = 'osaChatName';
    var QUEUE_KEY = 'osaEscalationQueue';
    var LF_KEY = 'osaLostFound';
    var SESSION_TTL_MS = 10 * 60 * 1000;
    var SESSION_EXP_KEY = 'osaChatSessionExpiresAt';

    function buildMarkup() {
        return '' +
            '<div class="osa-launcher-panel" id="osa-chat-widget" role="dialog" aria-modal="true" aria-labelledby="osa-chat-title" aria-hidden="true">' +
            '  <header class="osa-ai-header">' +
            '    <div class="osa-ai-header__brand">' +
            '      <div class="osa-ai-header__avatar" aria-hidden="true">' +
            '        <span class="osa-ai-header__avatar-dot"></span>' +
            '      </div>' +
            '      <div class="osa-ai-header__titles">' +
            '        <strong id="osa-chat-title">OSA Assistant</strong>' +
            '        <div class="osa-ai-header__sub">' +
            '          <span id="osa-chat-mode-badge" class="osa-ai-mode osa-ai-mode--ai">AI Mode</span>' +
            '          <div class="osa-ai-session-timer" id="osa-chat-timer" hidden aria-live="polite" title="Session time remaining">' +
            '            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>' +
            '            <span id="osa-chat-timer-text">--:--</span>' +
            '          </div>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <button type="button" class="osa-launcher-head__close" id="osa-chat-close" aria-label="Close">' +
            '      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '    </button>' +
            '  </header>' +
            '  <button type="button" class="osa-ai-scroll-bottom" id="osa-chat-scroll-bottom" aria-label="Scroll to latest" hidden>' +
            '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
            '  </button>' +
            '  <div class="osa-ai-thread" id="osa-chat-thread" role="log" aria-live="polite"></div>' +
            '  <div class="osa-ai-service-row">' +
            '    <label class="osa-ai-service-row__label" for="osa-service-topic">OSA service</label>' +
            '    <select id="osa-service-topic" class="osa-ai-service-select" aria-label="Choose OSA service topic">' +
            '      <option value="">Browse services…</option>' +
            '      <option value="__visitor__">Visitor / non-EAC (information)</option>' +
            '      <option value="I need an appointment with OSA. Please guide me on scheduling a face-to-face visit and what to bring.">Appointment</option>' +
            '      <option value="What are OSA office hours and where is the office located at EAC Cavite?">Office hours &amp; location</option>' +
            '      <option value="How do I apply for scholarship programs and what documents are required?">Scholarship</option>' +
            '      <option value="I have enrollment or registration-related questions for OSA. What should I prepare?">Enrollment</option>' +
            '      <option value="How do I request TOR, transcript of records, diploma verification, or other school documents through OSA?">TOR &amp; documents</option>' +
            '      <option value="I need help with lost and found claim.">Lost &amp; Found</option>' +
            '      <option value="How can I request good moral certificate and what are fees and processing time?">Good Moral</option>' +
            '      <option value="How do I apply for or replace my student ID as posted by OSA?">Student ID</option>' +
            '      <option value="Where do I check fees, assessment, and payment procedures for OSA-related transactions?">Fees &amp; payment</option>' +
            '      <option value="How do I inquire about student organizations and clearance related to organizations?">Organizations</option>' +
            '      <option value="What are important OSA policies, guidelines, or forms students should know?">Policies &amp; forms</option>' +
            '      <option value="I need human support">Human support</option>' +
            '    </select>' +
            '  </div>' +
            '  <div class="osa-ai-chips-wrapper">' +
            '    <div class="osa-ai-chips" id="osa-chat-chips">' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need an appointment with OSA. Please guide me on scheduling a visit or meeting.">Appointment</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="What are OSA office hours and where is the office located?">OSA hours</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="How do I apply for scholarship programs and what are the requirements?">Scholarship</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I have enrollment or registration questions. Who should I coordinate with at OSA?">Enrollment</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="How do I request TOR, transcript of records, diploma verification, or other school documents?">TOR &amp; documents</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need help with lost and found claim.">Lost &amp; Found</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="How can I request good moral certificate?">Good Moral</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="How do I apply for a new student ID or replace a lost ID?">Student ID</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="Where do I check fees, assessment, and payment procedures for school transactions?">Fees &amp; payment</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="How do I inquire about student organizations and organization-related procedures?">Organizations</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="What are important OSA policies, guidelines, or forms students should know?">Policies &amp; forms</button>' +
            '      <button type="button" class="osa-ai-chip osa-visitor-chip">Visitor info</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need human support">Human support</button>' +
            '    </div>' +
            '  </div>' +
            '  <div class="osa-ai-composer">' +
            '    <input type="hidden" id="osa-chat-email-store" autocomplete="off">' +
            '    <div class="osa-ai-composer__row">' +
            '      <label for="osa-chat-message" class="sr-only">Message</label>' +
            '      <textarea id="osa-chat-message" rows="1" placeholder="Aa" autocomplete="off"></textarea>' +
            '      <button type="button" class="osa-ai-btn-send" id="osa-chat-send" aria-label="Send">' +
            '        <svg viewBox="0 0 24 24"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
            '      </button>' +
            '    </div>' +
            '    <p class="osa-ai-composer__hint">Quick topics above send automatically. OTP may appear for sensitive requests (claim, appointment, escalate).</p>' +
            '  </div>' +
            '</div>' +
            '<button class="osa-launcher-fab" id="osa-chat-fab" type="button" aria-controls="osa-chat-widget" aria-expanded="false">' +
            '  Ask OSA' +
            '</button>';
    }

    function mountOnce() {
        if (document.getElementById('osa-chat-widget')) return;
        var wrap = document.createElement('div');
        wrap.setAttribute('data-osa-chat-root', '');
        wrap.innerHTML = buildMarkup();
        document.body.appendChild(wrap);
    }

    function getLS(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            return JSON.parse(raw);
        } catch (e) { return fallback; }
    }
    function setLS(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { }
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Never expose raw upstream/provider payloads in chat bubbles.
    function userSafeErrorHint(err) {
        var status = Number(err && err.status);
        var code = String((err && err.code) || '').toUpperCase();
        if (status === 401 || code === 'SESSION_EXPIRED') {
            return 'Your secure session expired. Please verify OTP again.';
        }
        if (status === 429 || code === 'RESOURCE_EXHAUSTED' || code === 'RATE_LIMITED') {
            return 'Assistant is temporarily busy. Please wait a few seconds and try again.';
        }
        if (status >= 500) {
            return 'Assistant is temporarily unavailable. Please try again shortly.';
        }
        if (status >= 400) {
            return 'Request could not be processed right now. Please try again.';
        }
        return 'Cannot reach secure API right now. Ensure API server is running on port 8787, then refresh.';
    }

    function renderAssistantText(raw) {
        var safe = escapeHtml(String(raw || '')).replace(/\r\n/g, '\n');

        function inlineFmt(s) {
            return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        }

        var lines = safe.split('\n');
        var html = '';
        var inList = false;

        lines.forEach(function (line) {
            var trimmed = String(line || '').trim();
            var bullet = trimmed.match(/^[*-]\s+(.+)$/);

            if (bullet) {
                if (!inList) {
                    html += '<ul style="margin:0.25rem 0 0.35rem 1.1rem;padding:0;">';
                    inList = true;
                }
                html += '<li style="margin:0.15rem 0;">' + inlineFmt(bullet[1]) + '</li>';
                return;
            }

            if (inList) {
                html += '</ul>';
                inList = false;
            }

            if (!trimmed) return;
            html += '<p style="margin:0 0 0.35rem;">' + inlineFmt(trimmed) + '</p>';
        });

        if (inList) html += '</ul>';
        if (!html) html = '<p style="margin:0;">...</p>';
        return html;
    }

    async function submitEscalationFromWidget(postApi, appendBubble, sessionId, concernText) {
        if (!sessionId) {
            appendBubble('assistant', '<p style="margin:0">Please verify your email first before escalating.</p>');
            return;
        }

        var concern = String(concernText || '').trim();
        if (!concern) {
            concern = String(window.prompt('Share your concern details for OSA staff:', '') || '').trim();
        }
        if (!concern) return;

        try {
            var result = await postApi('/chat/escalate', { session_id: sessionId, concern: concern });
            var cid = result && result.case_id ? result.case_id : '';
            if (cid) {
                renderWaitingBanner(cid, Date.now(), true);
                setMode('staff');
            }
            var handoffHtml =
                '<div class="osa-ai-handoff">' +
                '<p style="margin:0 0 6px"><strong>Escalated to OSA staff.</strong></p>' +
                (cid ? '<p style="margin:0 0 6px">Case ID: <strong>' + escapeHtml(cid) + '</strong></p>' : '') +
                '<p style="margin:0 0 4px">Keep this chat window open — an OSA staff member will reply <strong>right here</strong> once they pick up your case. You\'ll also get an email confirmation.</p>' +
                '<p style="margin:0;font-size:12px;color:#65574d">AI replies are paused for this case while staff handles it.</p>' +
                '</div>';
            appendBubble('assistant', handoffHtml);
        } catch (err) {
            if (err && (err.code === 'SESSION_EXPIRED' || err.status === 401)) {
                appendBubble('assistant', '<p style="margin:0">Session expired. Please verify a new OTP code, then escalate again.</p>');
            } else {
                appendBubble('assistant', '<p style="margin:0">Failed to escalate. ' + escapeHtml(userSafeErrorHint(err)) + '</p>');
            }
        }
    }

    function parseItemNumber(text) {
        var m = (text || '').match(/\bLF[-\s]?(\d{3,6})\b/i);
        return m ? 'LF-' + m[1] : '';
    }

    /** Buttons for claim visit type / day / time window (delegated `.osa-lf-appt-btn`). */
    function lfPreferencePanelHtml(caseId) {
        var c = escapeHtml(caseId);
        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        var dayBtns = days.map(function (d) {
            return '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="day" data-lf-value="' + d + '">' + d + '</button>';
        }).join('');
        return '' +
            '<details class="osa-ai-rich" open style="margin-top:6px">' +
            '<summary>Claim visit preferences</summary>' +
            '<p style="margin:0 0 10px;font-size:13px;color:#675a4f;">Choose visit type, weekday, and time window. OSA staff will confirm the final schedule.</p>' +
            '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1c1917">Visit type</p>' +
            '<div class="osa-ai-chips" style="margin-bottom:12px">' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="track" data-lf-value="claiming">Claiming appointment</button>' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="track" data-lf-value="private">Private appointment</button>' +
            '</div>' +
            '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1c1917">Preferred day</p>' +
            '<div class="osa-ai-chips" style="margin-bottom:12px">' + dayBtns + '</div>' +
            '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1c1917">Time window</p>' +
            '<div class="osa-ai-chips">' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="window" data-lf-value="Morning">Morning</button>' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="window" data-lf-value="Afternoon">Afternoon</button>' +
            '</div>' +
            '</details>';
    }

    function getLostFoundItem(itemNumber) {
        var data = getLS(LF_KEY, []);
        if (!Array.isArray(data)) return null;
        for (var i = 0; i < data.length; i++) {
            if (String(data[i].itemNumber || '').toUpperCase() === itemNumber.toUpperCase()) return data[i];
        }
        return null;
    }

    function pushQueue(entry) {
        var q = getLS(QUEUE_KEY, []);
        if (!Array.isArray(q)) q = [];
        q.unshift(entry);
        setLS(QUEUE_KEY, q.slice(0, 40));
    }

    function init() {
        mountOnce();

        var widget = document.getElementById('osa-chat-widget');
        var fab = document.getElementById('osa-chat-fab');
        var closeBtn = document.getElementById('osa-chat-close');
        var thread = document.getElementById('osa-chat-thread');
        var input = document.getElementById('osa-chat-message');
        var sendBtn = document.getElementById('osa-chat-send');
        var emailStore = document.getElementById('osa-chat-email-store');

        if (!widget || !fab || !thread || !input || !sendBtn) return;

        emailStore.value = String(getLS(EMAIL_KEY, '') || '');
        var savedName = String(getLS(NAME_KEY, '') || '').trim();
        var chatSessionId = String(getLS(SESSION_KEY, '') || '');
        var sessionTs = Number(getLS(SESSION_TS_KEY, 0) || 0);
        var otpVerified = !!getLS(VERIFIED_KEY, false) && !!emailStore.value && !!chatSessionId;
        var lastEscalationDraft = '';

        if (String(getLS(THREAD_SCHEMA_KEY, '') || '') !== '2') {
            setLS(THREAD_KEY, []);
            setLS(THREAD_SCHEMA_KEY, '2');
        }

        // Auto-clear visible chat history on every page load. This prevents
        // stale escalate buttons, old handoff cards, and prior ticket replies
        // from being re-triggered after a refresh. Server-side message log and
        // the escalation ticket itself are preserved — only the client view
        // resets. Users continue protected actions via their session as long
        // as the idle TTL hasn't elapsed.
        setLS(THREAD_KEY, []);

        function looksLikeEmailHandle(name) {
            if (!name) return true;
            if (name.indexOf(' ') >= 0) return false;
            return /[0-9]/.test(name) || name.length >= 14;
        }

        if (looksLikeEmailHandle(savedName)) {
            chatSessionId = '';
            otpVerified = false;
            setLS(SESSION_KEY, '');
            setLS(SESSION_TS_KEY, 0);
            setLS(VERIFIED_KEY, false);
            setLS(THREAD_KEY, []);
        }

        if (chatSessionId && sessionTs && (Date.now() - sessionTs >= SESSION_TTL_MS)) {
            chatSessionId = '';
            otpVerified = false;
            setLS(SESSION_KEY, '');
            setLS(SESSION_TS_KEY, 0);
            setLS(VERIFIED_KEY, false);
            setLS(THREAD_KEY, []);
        }

        if (!otpVerified) setLS(VERIFIED_KEY, false);
        var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        var suppressFabClickFromTouch = false;

        // Make FAB draggable on mobile so it doesn't block content
        (function initFabDrag() {
            var isDragging = false;
            var startY = 0, startX = 0;
            var initY = 0, initX = 0;
            var didMove = false;

            fab.addEventListener('touchstart', function (e) {
                if (e.touches.length !== 1) return;
                isDragging = true;
                didMove = false;
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
                var rect = fab.getBoundingClientRect();
                initY = rect.top;
                initX = rect.left;
                fab.style.transition = 'none';
                fab.style.bottom = 'auto';
                fab.style.right = 'auto';
                /* Must pin top/left immediately — otherwise removing bottom/right jumps the FAB and the tap misses. */
                fab.style.top = initY + 'px';
                fab.style.left = initX + 'px';
            }, { passive: true });

            fab.addEventListener('touchmove', function (e) {
                if (!isDragging) return;
                var dy = e.touches[0].clientY - startY;
                var dx = e.touches[0].clientX - startX;
                if (Math.abs(dy) > 10 || Math.abs(dx) > 10) didMove = true;

                if (didMove) {
                    e.preventDefault();
                    var newY = Math.max(0, Math.min(window.innerHeight - fab.offsetHeight, initY + dy));
                    var newX = Math.max(0, Math.min(window.innerWidth - fab.offsetWidth, initX + dx));
                    fab.style.top = newY + 'px';
                    fab.style.left = newX + 'px';
                }
            }, { passive: false });

            fab.addEventListener('touchend', function (e) {
                if (!isDragging) return;
                isDragging = false;
                var tap = !didMove;
                fab.style.transition = 'top 0.3s ease, left 0.3s ease, transform 0.2s';

                if (didMove) {
                    var snapX = window.innerWidth - fab.offsetWidth - 16;
                    fab.style.left = snapX + 'px';
                }

                if (tap) {
                    suppressFabClickFromTouch = true;
                    window.setTimeout(function () { suppressFabClickFromTouch = false; }, 450);
                    e.preventDefault();
                    if (widget.classList.contains('is-open')) closeWidget(); else openWidget();
                }
            }, { passive: false });

            fab.addEventListener('click', function (e) {
                if (didMove) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    didMove = false;
                    return;
                }
                if (suppressFabClickFromTouch) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            }, true);
        })();

        function setTriggerState(isOpen) {
            fab.setAttribute('aria-expanded', String(isOpen));
            widget.setAttribute('aria-hidden', String(!isOpen));
            document.querySelectorAll('[data-chat-open]').forEach(function (el) {
                el.setAttribute('aria-expanded', String(isOpen));
            });
        }

        function openWidget() {
            widget.classList.add('is-open');
            fab.classList.add('is-hidden');
            setTriggerState(true);
            window.setTimeout(function () { input && input.focus(); }, 80);
        }
        function closeWidget() {
            widget.classList.remove('is-open');
            fab.classList.remove('is-hidden');
            setTriggerState(false);
        }

        function scrollThread() {
            window.requestAnimationFrame(function () { thread.scrollTop = thread.scrollHeight; });
        }

        function revealRow(el) {
            if (!el) return;
            if (reducedMotion) el.classList.add('is-visible');
            else window.requestAnimationFrame(function () { el.classList.add('is-visible'); });
        }

        function renderBubble(role, html) {
            var row = document.createElement('div');
            row.className = 'osa-ai-msg osa-ai-msg--' + (role === 'user' ? 'user' : 'assistant');
            row.innerHTML = '<div><div class="osa-ai-msg__bubble">' + html +
                '</div><div class="osa-ai-msg__meta">' + (role === 'user' ? 'You' : 'Assistant') + '</div></div>';
            thread.appendChild(row);
            revealRow(row);
            scrollThread();
            return row;
        }

        function appendBubble(role, html, opts) {
            renderBubble(role, html);
            if (!opts || opts.persist !== false) {
                var arr = getLS(THREAD_KEY, []);
                if (!Array.isArray(arr)) arr = [];
                arr.push({ role: role, html: html, t: Date.now() });
                setLS(THREAD_KEY, arr.slice(-80));
            }
        }

        function restoreThread() {
            thread.innerHTML = '';
            var arr = getLS(THREAD_KEY, []);
            if (!Array.isArray(arr) || !arr.length) {
                appendBubble('assistant',
                    '<p style="margin:0">Hello! I can help with OSA services, forms, Lost &amp; Found, and policies. How can I help today?</p>',
                    { persist: true });
                return;
            }
            arr.forEach(function (m) {
                if (m.role === 'system') {
                    // The stored html was already escaped on persist.
                    var plain = String(m.html || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                    renderSystemBubble(plain);
                    return;
                }
                renderBubble(m.role, m.html);
            });
        }

        var delay = function (ms) { return new Promise(function (r) { window.setTimeout(r, reducedMotion ? 0 : ms); }); };

        function appendTypingIndicator() {
            var typing = document.createElement('div');
            typing.className = 'osa-ai-msg osa-ai-msg--assistant is-visible';
            typing.innerHTML = '<div><div class="osa-ai-msg__bubble"><div class="osa-ai-typing"><span></span><span></span><span></span></div></div><div class="osa-ai-msg__meta">Assistant</div></div>';
            thread.appendChild(typing);
            scrollThread();
            return typing;
        }

        function isLocalHost(hostname) {
            return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
        }

        function pushUniqueApiBase(list, value) {
            var base = String(value || '').trim().replace(/\/+$/, '');
            if (!base) return;
            if (list.indexOf(base) === -1) list.push(base);
        }

        function getApiBases() {
            var bases = [];
            var configured = window.__OSA_API_BASE__;
            if (configured && String(configured).trim()) {
                pushUniqueApiBase(bases, configured);
                return bases;
            }

            var port = String((window.__OSA_API_PORT__ != null && window.__OSA_API_PORT__ !== '') ? window.__OSA_API_PORT__ : '8787');
            var loc = window.location;
            if (!loc || loc.protocol === 'file:') {
                pushUniqueApiBase(bases, 'http://127.0.0.1:' + port);
                pushUniqueApiBase(bases, 'http://localhost:' + port);
                return bases;
            }

            var host = String(loc.hostname || '').toLowerCase();
            var origin = (window.location && window.location.origin) ? window.location.origin : '';
            if (isLocalHost(String(loc.hostname || '').toLowerCase())) {
                // Local static servers commonly return 501 for POST requests; route chat traffic to the Node API.
                pushUniqueApiBase(bases, 'http://127.0.0.1:' + port);
                pushUniqueApiBase(bases, 'http://localhost:' + port);
                if (origin && String(loc.port || '') === port) pushUniqueApiBase(bases, origin);
                return bases;
            }

            var currentPort = String(loc.port || '');
            var staticDevPorts = { '3000': 1, '4173': 1, '5000': 1, '5173': 1, '5500': 1, '5501': 1, '8000': 1, '8888': 1 };
            if (currentPort && currentPort !== port && staticDevPorts[currentPort]) {
                pushUniqueApiBase(bases, loc.protocol + '//' + host + ':' + port);
                pushUniqueApiBase(bases, 'http://127.0.0.1:' + port);
                pushUniqueApiBase(bases, 'http://localhost:' + port);
            }

            if (origin) pushUniqueApiBase(bases, origin);
            pushUniqueApiBase(bases, loc.protocol + '//' + host + ':' + port);
            pushUniqueApiBase(bases, 'http://127.0.0.1:' + port);
            pushUniqueApiBase(bases, 'http://localhost:' + port);
            return bases;
        }

        function shouldRetryApi(err) {
            return !err || !err.status || err.status === 404 || err.status === 405 || err.status === 501;
        }

        function postJson(base, path, body) {
            return fetch(base + '/api/v1' + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(body || {})
            }).then(function (res) {
                return res.text().then(function (text) {
                    var data = {};
                    try { data = text ? JSON.parse(text) : {}; } catch (_e) { data = {}; }
                    if (!res.ok || data.success === false) {
                        var err = new Error(data.message || ('HTTP ' + res.status));
                        err.status = res.status;
                        err.code = data.code;
                        err.retryAfterSeconds = data.retryAfterSeconds;
                        throw err;
                    }
                    return data;
                });
            });
        }

        function getApi(path) {
            var bases = getApiBases();
            if (!bases.length) return Promise.reject(new Error('API address is not configured.'));
            function attempt(idx, lastErr) {
                if (idx >= bases.length) throw lastErr || new Error('Could not reach the assistant.');
                var base = bases[idx];
                return fetch(base + '/api/v1' + path, {
                    method: 'GET',
                    headers: { Accept: 'application/json' }
                }).then(function (res) {
                    return res.text().then(function (text) {
                        var data = {};
                        try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
                        if (!res.ok || data.success === false) {
                            var err = new Error(data.message || ('HTTP ' + res.status));
                            err.status = res.status;
                            err.code = data.code;
                            throw err;
                        }
                        return data;
                    });
                }).catch(function (err) {
                    if (shouldRetryApi(err)) return attempt(idx + 1, err);
                    throw err;
                });
            }
            return attempt(0, null);
        }

        function postApi(path, body) {
            var bases = getApiBases();
            if (!bases.length) {
                return Promise.reject(new Error('API address is not configured. Set window.__OSA_API_BASE__.'));
            }

            var idx = 0;
            function attempt(lastErr) {
                if (idx >= bases.length) throw lastErr || new Error('Could not reach the assistant.');
                var base = bases[idx++];
                return postJson(base, path, body).catch(function (err) {
                    if (idx < bases.length && shouldRetryApi(err)) {
                        return attempt(err);
                    }
                    throw err;
                });
            }

            return attempt(null);
        }

        function postChatbotApi(message) {
            var convoId = chatSessionId ? ('session-' + chatSessionId) : ('guest-' + Date.now());
            return postApi('/chatbot/message', {
                message: String(message || ''),
                conversation_id: convoId
            }).then(function (payload) {
                var body = payload && payload.data ? payload.data : payload;
                var reply = String((body && body.response) || '').trim();
                if (!reply) throw new Error('Empty chatbot response.');
                return reply;
            });
        }

        function expireSecureSessionLocal() {
            stopSSE();
            stopSessionCountdown();
            chatSessionId = '';
            otpVerified = false;
            setLS(SESSION_KEY, '');
            setLS(SESSION_TS_KEY, 0);
            setLS(SESSION_EXP_KEY, '');
            setLS(VERIFIED_KEY, false);
            setLS(THREAD_KEY, []);
        }

        function createChatSession(chatToken, email, studentName) {
            return postApi('/chat/session', { token: chatToken, email: email, student_name: studentName || '' }).then(function (payload) {
                chatSessionId = String(payload.session_id || '');
                if (!chatSessionId) throw new Error('Missing chat session ID.');
                setLS(SESSION_KEY, chatSessionId);
                setLS(SESSION_TS_KEY, Date.now());
                if (payload && payload.student_name) setLS(NAME_KEY, String(payload.student_name));
                if (payload && payload.session_expires_at) {
                    setLS(SESSION_EXP_KEY, payload.session_expires_at);
                    startSessionCountdown();
                }
                startSSE();
                hydrateActiveTicketBanner();
                return payload;
            });
        }

        // ── Session countdown timer ───────────────────────────────
        // Reads `session_expires_at` (set by the server on every success
        // response) and renders MM:SS remaining in the header. When it
        // reaches 0 we proactively clear local session state and prompt
        // the student to re-verify, instead of waiting for the next API
        // call to fail with SESSION_EXPIRED.
        var sessionTimerHandle = null;
        var timerEl = document.getElementById('osa-chat-timer');
        var timerTextEl = document.getElementById('osa-chat-timer-text');

        function pad2(n) { return n < 10 ? '0' + n : String(n); }

        function renderCountdownTick() {
            if (!timerEl || !timerTextEl) return;
            var iso = String(getLS(SESSION_EXP_KEY, '') || '');
            if (!iso || !chatSessionId) {
                timerEl.hidden = true;
                return;
            }
            var expMs = Date.parse(iso);
            if (!isFinite(expMs)) { timerEl.hidden = true; return; }
            var remaining = Math.max(0, expMs - Date.now());
            timerEl.hidden = false;
            var mins = Math.floor(remaining / 60000);
            var secs = Math.floor((remaining % 60000) / 1000);
            timerTextEl.textContent = pad2(mins) + ':' + pad2(secs);
            timerEl.classList.toggle('is-warning', remaining > 0 && remaining <= 60 * 1000);
            timerEl.classList.toggle('is-critical', remaining > 0 && remaining <= 15 * 1000);

            if (remaining <= 0) {
                stopSessionCountdown();
                expireSecureSessionLocal();
                appendBubble('assistant', '<p style="margin:0">Your secure chat session has ended after 10 minutes of inactivity. Verify your email again to continue.</p>');
                setMode('ai');
            }
        }

        function startSessionCountdown() {
            stopSessionCountdown();
            renderCountdownTick();
            sessionTimerHandle = window.setInterval(renderCountdownTick, 1000);
        }

        function stopSessionCountdown() {
            if (sessionTimerHandle) { window.clearInterval(sessionTimerHandle); sessionTimerHandle = null; }
            if (timerEl) timerEl.hidden = true;
        }

        // ── Header mode badge (Tier indicator) ────────────────────
        var modeBadgeEl = document.getElementById('osa-chat-mode-badge');
        var MODE_COPY = {
            faq:   { label: 'Instant (FAQ)',     cls: 'osa-ai-mode--faq' },
            ai:    { label: 'AI Assistant',      cls: 'osa-ai-mode--ai' },
            staff: { label: 'Connected to Staff', cls: 'osa-ai-mode--staff' }
        };
        var currentMode = 'ai';
        function setMode(next) {
            if (!modeBadgeEl) return;
            var target = MODE_COPY[next] || MODE_COPY.ai;
            modeBadgeEl.textContent = target.label;
            modeBadgeEl.className = 'osa-ai-mode ' + target.cls;
            currentMode = next;
        }
        setMode('ai');

        // ── Scroll-to-bottom button ───────────────────────────────
        var scrollBtn = document.getElementById('osa-chat-scroll-bottom');
        function updateScrollBtn() {
            if (!scrollBtn || !thread) return;
            var nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
            scrollBtn.hidden = nearBottom;
        }
        if (thread) thread.addEventListener('scroll', updateScrollBtn);
        if (scrollBtn) scrollBtn.addEventListener('click', function () {
            thread.scrollTop = thread.scrollHeight;
            updateScrollBtn();
        });

        // ── Real-time staff channel (SSE) ─────────────────────────
        // Subscribes to /chat/stream/:sessionId so staff messages sent via the
        // admin portal appear instantly in the student chat. Also receives a
        // `staff_joined` event on the first staff reply and renders it as a
        // distinct system-style bubble ("OSA Staff X has joined the chat").
        var sseConn = null;

        function renderSystemBubble(text) {
            var row = document.createElement('div');
            row.className = 'osa-ai-msg osa-ai-msg--system';
            row.innerHTML = '<div class="osa-ai-system"><span class="osa-ai-system__dot"></span><span>' + escapeHtml(text) + '</span></div>';
            thread.appendChild(row);
            revealRow(row);
            scrollThread();
        }

        function startSSE() {
            stopSSE();
            if (!chatSessionId) return;
            var bases = getApiBases();
            if (!bases.length) return;
            // EventSource can't attempt multiple fallbacks the way fetch can, so
            // we just use the first configured base. If the portal is served from
            // the same origin as the API, this is already correct.
            var url = bases[0] + '/api/v1/chat/stream/' + encodeURIComponent(chatSessionId);
            try { sseConn = new EventSource(url); } catch (_) { return; }

            sseConn.onmessage = function (e) {
                var payload;
                try { payload = JSON.parse(e.data); } catch (_) { return; }
                if (!payload || typeof payload !== 'object') return;

                if (payload.type === 'staff_joined') {
                    clearWaitingBanner();
                    setMode('staff');
                    var joinText = String(payload.content || ('OSA Staff ' + (payload.staff_name || '') + ' has joined the chat.')).trim();
                    renderSystemBubble(joinText);
                    // Persist so it survives reloads like other bubbles.
                    var arr = getLS(THREAD_KEY, []);
                    if (!Array.isArray(arr)) arr = [];
                    arr.push({ role: 'system', html: escapeHtml(joinText), t: Date.now() });
                    setLS(THREAD_KEY, arr.slice(-80));
                    return;
                }

                if (payload.type === 'staff_message') {
                    clearWaitingBanner();
                    var body = String(payload.content || '').trim();
                    if (body) appendBubble('assistant', renderAssistantText(body));

                    if (payload.appointment_approved) {
                        setMode('staff');
                    }

                    if (payload.session_closed) {
                        stopSSE();
                        setMode('ai');
                        renderSystemBubble('This support session has been closed by OSA staff. You may open a new concern anytime.');
                        input.disabled = true;
                        input.placeholder = 'Session closed — open a new chat to continue.';
                        sendBtn.disabled = true;
                        // Persist session-closed system message in thread
                        var arr = getLS(THREAD_KEY, []);
                        if (!Array.isArray(arr)) arr = [];
                        arr.push({ role: 'system', html: 'This support session has been closed by OSA staff. You may open a new concern anytime.', t: Date.now() });
                        setLS(THREAD_KEY, arr.slice(-80));
                    }
                    return;
                }
            };

            sseConn.onerror = function () {
                // EventSource reconnects automatically on transient errors.
            };
        }

        function stopSSE() {
            if (sseConn) { try { sseConn.close(); } catch (_) {} sseConn = null; }
        }

        // ── Waiting-for-staff banner ─────────────────────────────
        // Shown after escalation while status is 'open' (no staff reply yet).
        // Contains an elapsed-time ticker and a Cancel button. Hidden and
        // replaced by the "OSA Staff joined" pill when staff engages.
        var waitingState = { caseId: '', startedAt: 0, tickHandle: null, cancellable: true };

        function renderWaitingBanner(caseId, startedAtMs, cancellable) {
            clearWaitingBanner();
            waitingState.caseId = String(caseId || '');
            waitingState.startedAt = Number(startedAtMs || Date.now());
            waitingState.cancellable = cancellable !== false;

            var row = document.createElement('div');
            row.className = 'osa-ai-msg osa-ai-msg--waiting';
            row.setAttribute('data-osa-waiting', waitingState.caseId || '1');
            row.innerHTML =
                '<div class="osa-ai-waiting">' +
                '  <div class="osa-ai-waiting__head">' +
                '    <span class="osa-ai-waiting__spinner" aria-hidden="true"></span>' +
                '    <div class="osa-ai-waiting__titles">' +
                '      <strong>Waiting for OSA staff</strong>' +
                '      <span class="osa-ai-waiting__est">Estimated wait 3–5 min</span>' +
                '    </div>' +
                '    <span class="osa-ai-waiting__elapsed" id="osa-wait-elapsed">0:00</span>' +
                '  </div>' +
                (waitingState.caseId
                    ? '  <p class="osa-ai-waiting__case">Case ID: <strong>' + escapeHtml(waitingState.caseId) + '</strong></p>'
                    : '') +
                '  <p class="osa-ai-waiting__note">AI is paused while staff handles this case. You can cancel and bring AI back as long as staff hasn’t replied yet.</p>' +
                (waitingState.cancellable
                    ? '  <div class="osa-ai-waiting__actions"><button type="button" class="osa-ai-waiting__cancel" data-osa-cancel-escalation>Cancel request</button></div>'
                    : '') +
                '</div>';
            thread.appendChild(row);
            revealRow(row);
            scrollThread();

            tickWaiting();
            waitingState.tickHandle = window.setInterval(tickWaiting, 1000);
        }

        function tickWaiting() {
            var el = document.getElementById('osa-wait-elapsed');
            if (!el || !waitingState.startedAt) return;
            var secs = Math.max(0, Math.floor((Date.now() - waitingState.startedAt) / 1000));
            var m = Math.floor(secs / 60);
            var s = secs % 60;
            el.textContent = m + ':' + (s < 10 ? '0' + s : String(s));
        }

        function clearWaitingBanner() {
            if (waitingState.tickHandle) {
                window.clearInterval(waitingState.tickHandle);
                waitingState.tickHandle = null;
            }
            waitingState.caseId = '';
            waitingState.startedAt = 0;
            waitingState.cancellable = true;
            var existing = thread.querySelector('[data-osa-waiting]');
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        }

        function cancelEscalation(caseId) {
            if (!chatSessionId) return;
            var btn = thread.querySelector('[data-osa-cancel-escalation]');
            if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
            postApi('/chat/escalate/cancel', { session_id: chatSessionId, case_id: caseId || waitingState.caseId })
                .then(function (res) {
                    clearWaitingBanner();
                    appendBubble('assistant', '<p style="margin:0">' + escapeHtml(String((res && res.message) || 'Escalation cancelled. AI is back on.')) + '</p>');
                    setMode('ai');
                })
                .catch(function (err) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Cancel request'; }
                    if (err && err.code === 'NOT_CANCELLABLE') {
                        appendBubble('assistant', '<p style="margin:0">' + escapeHtml(err.message) + '</p>');
                        // Replace with non-cancellable variant so the button disappears.
                        renderWaitingBanner(waitingState.caseId, waitingState.startedAt, false);
                    } else {
                        appendBubble('assistant', '<p style="margin:0">Could not cancel: ' + escapeHtml((err && err.message) || 'Try again.') + '</p>');
                    }
                });
        }

        // On page load with a restored session, ask the server if there's an
        // active ticket for this session and re-render the waiting banner.
        function hydrateActiveTicketBanner() {
            if (!chatSessionId) return;
            getApi('/chat/session/' + encodeURIComponent(chatSessionId) + '/ticket')
                .then(function (res) {
                    if (res && res.ticket) {
                        var startedAt = Date.parse(res.ticket.created_at) || Date.now();
                        renderWaitingBanner(res.ticket.case_id, startedAt, !!res.ticket.cancellable);
                        setMode('staff');
                    }
                })
                .catch(function () { /* non-fatal */ });
        }

        function routeConcern(message) {
            var text = message.toLowerCase();
            if (text.indexOf('manual') >= 0 || text.indexOf('policy') >= 0 || text.indexOf('handbook') >= 0) {
                return 'Open the Student Manual (PDF) for authoritative policy text. I can help interpret sections in relation to OSA services.';
            }
            if (text.indexOf('scholarship') >= 0) {
                return 'Scholarship: confirm deadlines and required documents from official OSA postings.';
            }
            if (text.indexOf('good moral') >= 0) {
                return 'Good Moral requests follow OSA\u2019s published process\u2014requirements, fees, and release expectations.';
            }
            if (text.indexOf('lost') >= 0 || text.indexOf('found') >= 0 || text.indexOf('claim') >= 0) {
                return 'Lost &amp; Found: describe the item, when/where it was lost or found, and keep your school ID ready for verification.';
            }
            if (text.indexOf('appointment') >= 0 || text.indexOf('schedule') >= 0) {
                return 'You can request an appointment with OSA staff directly from chat.';
            }
            return 'I cover conduct, Lost &amp; Found, ID, scholarship, Good Moral, ISO/PACUCOA, and LAAP\u2014plus Student Manual references.';
        }

        function hasAppointmentIntent(message) {
            var text = String(message || '').toLowerCase();
            return text.indexOf('appointment') >= 0 || text.indexOf('schedule') >= 0 || text.indexOf('book') >= 0;
        }

        function needsProtected(message) {
            // Only trigger OTP for phrases that clearly indicate a protected action.
            // Generic words like "schedule" or "support" alone were too broad and
            // were forcing OTP on normal Tier-1 FAQ questions.
            var t = ' ' + message.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
            var phrases = [
                ' claim ',
                ' claim lf',
                ' lf-',
                ' file a ticket',
                ' create ticket',
                ' appointment ',
                ' schedule ',
                ' book an appointment',
                ' book appointment',
                ' schedule an appointment',
                ' set an appointment',
                ' request appointment',
                ' escalate',
                ' human support',
                ' human agent',
                ' talk to staff',
                ' speak to staff',
                ' live agent',
                ' report concern',
                ' file complaint',
                ' complaint'
            ];
            for (var i = 0; i < phrases.length; i++) {
                if (t.indexOf(phrases[i]) >= 0) return true;
            }
            return false;
        }

        function appendLocalAssistantReply(message, offlineNotice) {
            var reply = routeConcern(message);
            appendBubble('assistant', '<p style="margin:0">' + reply + '</p>');
            if (hasAppointmentIntent(message)) {
                appendBubble(
                    'assistant',
                    '<details class="osa-ai-rich" open><summary>Appointment options</summary>' +
                    '<ul><li>Use secure chat to book preferred day/time</li><li>OSA staff will confirm schedule in-chat</li></ul>' +
                    '<div class="osa-ai-actions">' +
                    '<a href="/chat" target="_blank" rel="noopener" class="osa-escalate-btn" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;">Open Appointment Chat</a>' +
                    '</div></details>'
                );
            }
            if (reply.indexOf('Student Manual') >= 0) {
                appendBubble('assistant',
                    '<details class="osa-ai-rich" open><summary>Next steps</summary><ul><li>Open Forms from the portal navigation</li><li>Check the Student Manual for the official policy text</li><li>Use secure chat again when the live assistant is back for protected requests</li></ul></details>');
            }
            if (offlineNotice) {
                appendBubble('assistant',
                    '<p style="margin:0">Live assistant is temporarily offline. I can still give quick OSA guidance here, but OTP, claims, and staff escalation need the API running on port <strong>8787</strong>.</p>');
            }
        }

        function appendProtectedUnavailableReply(message) {
            appendBubble(
                'assistant',
                '<p style="margin:0 0 6px">The assistant is having trouble responding right now. Please try again in a moment.</p>' +
                '<p style="margin:0;font-size:13px;color:#65574d">If this keeps happening, verify your email below to reach OSA staff directly.</p>'
            );
        }

        function injectOtp() {
            return new Promise(function (resolve) {
                var id = 'otp-' + Date.now();
                var row = document.createElement('div');
                row.className = 'osa-ai-msg osa-ai-msg--assistant';
                row.innerHTML =
                    '<div>' +
                    '  <div class="osa-ai-msg__bubble">' +
                    '    <div class="osa-ai-otp__head">' +
                    '      <span class="osa-ai-otp__eyebrow">Secure Verification</span>' +
                    '      <p class="osa-ai-otp__desc">Verify your email to continue with protected OSA support requests.</p>' +
                    '    </div>' +
                    '    <div class="osa-ai-otp" style="margin-top:0.5rem">' +
                    '      <div class="osa-ai-otp__field"><label for="' + id + '-n">Full name</label><input id="' + id + '-n" type="text" placeholder="Juan Dela Cruz" autocomplete="name"></div>' +
                    '      <div class="osa-ai-otp__field"><label for="' + id + '-e">Email</label><input id="' + id + '-e" type="email" placeholder="name@example.com" autocomplete="email" enterkeyhint="done"></div>' +
                    '      <div class="osa-ai-otp__actions"><button type="button" class="osa-ai-otp__btn osa-ai-otp__btn--primary" id="' + id + '-s">Send OTP Code</button></div>' +
                    '      <div class="osa-ai-otp__field" id="' + id + '-cb" hidden><label for="' + id + '-c">6-digit code</label><input id="' + id + '-c" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022"></div>' +
                    '      <div class="osa-ai-otp__actions" id="' + id + '-vr" hidden><button type="button" class="osa-ai-otp__btn osa-ai-otp__btn--primary" id="' + id + '-v">Verify</button></div>' +
                    '      <p class="osa-ai-otp__status" id="' + id + '-st"></p>' +
                    '    </div>' +
                    '  </div>' +
                    '  <div class="osa-ai-msg__meta">Verification</div>' +
                    '</div>';
                thread.appendChild(row);
                revealRow(row);
                scrollThread();

                var st = row.querySelector('#' + id + '-st');
                var nm = row.querySelector('#' + id + '-n');
                var em = row.querySelector('#' + id + '-e');
                var send = row.querySelector('#' + id + '-s');
                var cb = row.querySelector('#' + id + '-cb');
                var vr = row.querySelector('#' + id + '-vr');
                var cd = row.querySelector('#' + id + '-c');
                var vf = row.querySelector('#' + id + '-v');

                if (nm) nm.value = String(getLS(NAME_KEY, '') || '');

                var cooldownTimer = null;
                function clearCooldown() {
                    if (cooldownTimer) {
                        window.clearInterval(cooldownTimer);
                        cooldownTimer = null;
                    }
                }

                function startResendCooldown(seconds) {
                    clearCooldown();
                    var left = Math.max(0, Math.floor(Number(seconds) || 0));
                    send.disabled = true;
                    function tick() {
                        send.textContent = left > 0 ? ('Resend (' + left + 's)') : 'Resend code';
                        if (left <= 0) {
                            send.disabled = false;
                            send.textContent = 'Resend code';
                            clearCooldown();
                            return;
                        }
                        left -= 1;
                    }
                    tick();
                    cooldownTimer = window.setInterval(tick, 1000);
                }

                send && send.addEventListener('click', function () {
                    var n = (nm && nm.value || '').trim();
                    var v = (em && em.value || '').trim().toLowerCase();
                    if (!n || n.length < 2) {
                        st.textContent = 'Enter your full name.';
                        st.className = 'osa-ai-otp__status is-err';
                        return;
                    }
                    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
                        st.textContent = 'Invalid email.';
                        st.className = 'osa-ai-otp__status is-err';
                        return;
                    }
                    if (DOMAIN && DOMAIN !== '*' && !v.endsWith('@' + DOMAIN)) {
                        st.textContent = 'Only official @' + DOMAIN + ' student emails are accepted. Tap Visitor info or use “Visitor” in OSA service for guidance.';
                        st.className = 'osa-ai-otp__status is-err';
                        return;
                    }
                    st.textContent = 'Sending\u2026';
                    st.className = 'osa-ai-otp__status is-wait';
                    send.disabled = true;
                    postApi('/otp/send', { email: v })
                        .then(function (payload) {
                            cb.hidden = false;
                            vr.hidden = false;
                            st.textContent = 'Code sent. Check your inbox (and spam).';
                            st.className = 'osa-ai-otp__status is-ok';
                            cd && cd.focus();
                            var cool = (payload && payload.cooldownSeconds) ? payload.cooldownSeconds : 30;
                            startResendCooldown(cool);
                        })
                        .catch(function (err) {
                            if (err && err.code === 'OTP_DAILY_LIMIT') {
                                st.textContent = err.message || 'You have reached today’s verification limit. Please try again tomorrow.';
                                st.className = 'osa-ai-otp__status is-err';
                                send.disabled = true;
                                send.textContent = 'Daily limit reached';
                                return;
                            }
                            if (err.status === 429 && err.retryAfterSeconds) {
                                st.textContent = err.message || ('Wait ' + err.retryAfterSeconds + 's.');
                                st.className = 'osa-ai-otp__status is-err';
                                startResendCooldown(err.retryAfterSeconds);
                            } else {
                                st.textContent = shouldRetryApi(err)
                                    ? 'Secure verification is offline right now. General OSA questions still work without OTP.'
                                    : (err.message || 'Could not send code.');
                                st.className = 'osa-ai-otp__status is-err';
                                send.disabled = false;
                            }
                        });
                });

                vf && vf.addEventListener('click', function () {
                    var verifiedName = (nm && nm.value || '').trim();
                    var verifiedEmail = (em && em.value || '').trim().toLowerCase();
                    var digits = String(cd && cd.value || '').replace(/\D/g, '').slice(0, 6);
                    if (!verifiedName || verifiedName.length < 2) {
                        st.textContent = 'Enter your full name.';
                        st.className = 'osa-ai-otp__status is-err';
                        return;
                    }
                    if (digits.length !== 6) {
                        st.textContent = 'Enter the 6-digit code.';
                        st.className = 'osa-ai-otp__status is-err';
                        return;
                    }
                    st.textContent = 'Checking\u2026';
                    st.className = 'osa-ai-otp__status is-wait';
                    vf.disabled = true;
                    cd.disabled = true;
                    postApi('/otp/verify', { email: verifiedEmail, otp: digits })
                        .then(function (payload) {
                            return createChatSession(payload.chat_token, verifiedEmail, verifiedName);
                        })
                        .then(function () {
                            emailStore.value = verifiedEmail;
                            setLS(EMAIL_KEY, verifiedEmail);
                            setLS(NAME_KEY, verifiedName);
                            setLS(VERIFIED_KEY, true);
                            otpVerified = true;
                            st.textContent = 'Verified.';
                            st.className = 'osa-ai-otp__status is-ok';
                            appendBubble('assistant', '<p style="margin:0">Session verified \u2014 you can continue with protected actions.</p>');
                            resolve();
                        })
                        .catch(function (err) {
                            st.textContent = shouldRetryApi(err)
                                ? 'Secure verification is offline right now. General OSA questions still work without OTP.'
                                : (err.message || 'Verification failed.');
                            st.className = 'osa-ai-otp__status is-err';
                            vf.disabled = false;
                            cd.disabled = false;
                            cd.focus();
                        });
                });
            });
        }

        async function handleSend() {
            var message = input.value.trim();
            if (!message) return;
            lastEscalationDraft = message;
            appendBubble('user', '<p style="margin:0">' + escapeHtml(message) + '</p>');
            input.value = '';
            sendBtn.disabled = true;

            var email = (emailStore.value || '').trim();
            var itemNumber = parseItemNumber(message);
            sessionTs = Number(getLS(SESSION_TS_KEY, 0) || 0);

            // Queue the message and auto-resume after OTP verification so users
            // don't have to retype what they already asked.
            function resumeAfterOtp() {
                sendBtn.disabled = false;
                input.value = message;
                handleSend();
            }

            if (chatSessionId && sessionTs && (Date.now() - sessionTs >= SESSION_TTL_MS)) {
                expireSecureSessionLocal();
                appendBubble('assistant', '<p style="margin:0">Your secure chat expired after 5 minutes. Please request and verify a new OTP code — your message will resend automatically.</p>');
                injectOtp().then(resumeAfterOtp);
                return;
            }

            if (!chatSessionId && !needsProtected(message)) {
                try {
                    var guestReply = await postChatbotApi(message);
                    appendBubble('assistant', renderAssistantText(guestReply));
                } catch (_guestErr) {
                    appendLocalAssistantReply(message, true);
                }
                sendBtn.disabled = false;
                input.focus();
                return;
            }

            if (needsProtected(message) && !otpVerified) {
                appendBubble('assistant', '<p style="margin:0">This request needs a verified student email. Use the card below — your message will resend automatically after verification.</p>');
                injectOtp().then(resumeAfterOtp);
                return;
            }

            if (!chatSessionId) {
                appendBubble('assistant', '<p style="margin:0">To continue, please verify your email first using the card below.</p>');
                injectOtp().then(resumeAfterOtp);
                return;
            }

            if (itemNumber && message.toLowerCase().indexOf('claim') >= 0) {
                var item = getLostFoundItem(itemNumber);
                if (!item) {
                    appendBubble('assistant', '<p style="margin:0">Item <strong>' + itemNumber + '</strong> was not found. Check the Lost &amp; Found page item number.</p>');
                    sendBtn.disabled = false;
                    input.focus();
                    return;
                }
                if ((item.status || '').toLowerCase() === 'claimed') {
                    appendBubble('assistant', '<p style="margin:0">Item <strong>' + itemNumber + '</strong> is already marked claimed.</p>');
                    sendBtn.disabled = false;
                    input.focus();
                    return;
                }
                var typingClaim = appendTypingIndicator();
                try {
                    var claimRes = await postApi('/chat/claim', {
                        session_id: chatSessionId,
                        item_number: itemNumber,
                        item_title: item.title || ''
                    });
                    var claimText = String((claimRes && claimRes.assistant_message) || '').trim();
                    if (claimText) {
                        appendBubble('assistant', renderAssistantText(claimText));
                    }
                    var cid = String((claimRes && claimRes.case_id) || '').trim();
                    if (cid) {
                        appendBubble('assistant', lfPreferencePanelHtml(cid));
                    }
                } catch (err) {
                    if (err && (err.code === 'SESSION_EXPIRED' || err.status === 401)) {
                        expireSecureSessionLocal();
                        appendBubble('assistant', '<p style="margin:0">Your secure chat expired after 5 minutes. Please verify a new OTP code, then submit your claim again.</p>');
                        await injectOtp();
                    } else {
                        appendBubble('assistant', '<p style="margin:0">Could not submit claim: ' + escapeHtml(err.message || 'Unknown error') + '</p>');
                    }
                } finally {
                    if (typingClaim && typingClaim.parentNode) typingClaim.remove();
                }
                sendBtn.disabled = false;
                input.focus();
                return;
            }

            if (otpVerified && !chatSessionId) {
                otpVerified = false;
                setLS(VERIFIED_KEY, false);
                appendBubble('assistant', '<p style="margin:0">Your secure chat session expired. Please verify your email again.</p>');
                sendBtn.disabled = false;
                input.focus();
                return;
            }

            var typingAI = null;
            try {
                if (chatSessionId) {
                    typingAI = appendTypingIndicator();
                    try {
                        var payload = await postApi('/chat/message', { session_id: chatSessionId, message: message });

                        // Refresh the session-expiry countdown (server returns a
                        // fresh `session_expires_at` on every successful reply).
                        if (payload && payload.session_expires_at) {
                            setLS(SESSION_EXP_KEY, payload.session_expires_at);
                            startSessionCountdown();
                        }
                        // Update header mode badge based on which tier answered.
                        if (payload && payload.human_mode) {
                            setMode('staff');
                            if (payload.case_id) {
                                var startAt = waitingState.startedAt || Date.now();
                                renderWaitingBanner(String(payload.case_id), startAt, waitingState.cancellable);
                            }
                        }
                        else if (payload && payload.tier === 1) setMode('faq');
                        else setMode('ai');

                        var aiReply = String((payload && payload.reply) || '').trim();
                        if (aiReply) {
                            appendBubble('assistant', renderAssistantText(aiReply));
                            if (payload && payload.auto_escalated && payload.case_id) {
                                renderWaitingBanner(String(payload.case_id), Date.now(), true);
                                setMode('staff');
                                appendBubble('assistant',
                                    '<div class="osa-ai-handoff">' +
                                    '<p style="margin:0 0 6px"><strong>Forwarded to OSA staff.</strong></p>' +
                                    '<p style="margin:0 0 6px">Case ID: <strong>' + escapeHtml(String(payload.case_id)) + '</strong></p>' +
                                    '<p style="margin:0 0 4px">Keep this chat open — an OSA staff member will reply <strong>right here</strong> once they pick up your case. You\'ll also get an email confirmation.</p>' +
                                    '<p style="margin:0;font-size:12px;color:#65574d">AI replies are paused for this case while staff handles it.</p>' +
                                    '</div>');
                            }
                            if (payload && payload.suggest_escalation) {
                                appendBubble('assistant',
                                    '<details class="osa-ai-rich" open><summary>Next steps</summary><ul><li>This concern may need staff review</li><li>Use this same chat to continue details</li><li>Escalate your concern to OSA staff below</li></ul><div class="osa-ai-actions"><button type="button" class="osa-escalate-btn">Escalate to OSA Staff</button></div></details>');
                            }
                        } else {
                            appendBubble('assistant', '<p style="margin:0">I did not receive a response. Please try again.</p>');
                        }
                    } finally {
                        if (typingAI && typingAI.parentNode) typingAI.remove();
                        typingAI = null;
                    }
                } else {
                    appendBubble('assistant', '<p style="margin:0">Please verify your email first to continue secure AI chat.</p>');
                    await injectOtp();
                }
            } catch (_err) {
                if (typingAI && typingAI.parentNode) typingAI.remove();
                if (_err && (_err.code === 'SESSION_EXPIRED' || _err.status === 401)) {
                    expireSecureSessionLocal();
                    appendBubble('assistant', '<p style="margin:0">Your secure chat expired after 5 minutes. Please request and verify a new OTP code.</p>');
                    await injectOtp();
                } else {
                    var protectedIntent = needsProtected(message);
                    var recoverableApiFailure = shouldRetryApi(_err) ||
                        Number(_err && _err.status) >= 500 ||
                        Number(_err && _err.status) === 429 ||
                        String((_err && _err.code) || '').toUpperCase() === 'RESOURCE_EXHAUSTED' ||
                        String((_err && _err.code) || '').toUpperCase() === 'RATE_LIMITED';

                    if (recoverableApiFailure) {
                        var liveFallbackWorked = false;
                        if (!protectedIntent) {
                            try {
                                var chatbotReply = await postChatbotApi(message);
                                appendBubble('assistant', renderAssistantText(chatbotReply));
                                liveFallbackWorked = true;
                            } catch (_chatbotErr) {
                                liveFallbackWorked = false;
                            }
                        }

                        if (!liveFallbackWorked) {
                            if (protectedIntent && hasAppointmentIntent(message)) {
                                try {
                                    var apptFallbackReply = await postChatbotApi(message);
                                    appendBubble('assistant', renderAssistantText(apptFallbackReply));
                                    appendBubble(
                                        'assistant',
                                        '<details class="osa-ai-rich" open><summary>Appointment action</summary>' +
                                        '<p style="margin:0 0 8px">When secure booking stabilizes, continue in this chat to submit your preferred day/time.</p>' +
                                        '<div class="osa-ai-actions">' +
                                        '<a href="/chat" target="_blank" rel="noopener" class="osa-escalate-btn" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;">Open Appointment Chat</a>' +
                                        '</div></details>'
                                    );
                                    liveFallbackWorked = true;
                                } catch (_apptFallbackErr) {
                                    liveFallbackWorked = false;
                                }
                            }
                        }

                        if (!liveFallbackWorked) {
                            if (protectedIntent) {
                                appendProtectedUnavailableReply(message);
                            } else {
                                appendLocalAssistantReply(message, true);
                            }
                        }
                    } else {
                        var hint = escapeHtml(userSafeErrorHint(_err));
                        appendBubble('assistant', '<p style="margin:0">Could not reach the assistant. ' + hint + '</p>');
                    }
                }
            }
            sendBtn.disabled = false;
            input.focus();
        }

        // --- Wire up events ---
        fab.addEventListener('click', function () {
            if (suppressFabClickFromTouch) return;
            if (widget.classList.contains('is-open')) closeWidget(); else openWidget();
        });

        var suppressDataChatOpenClick = false;
        document.addEventListener('touchend', function (ev) {
            var trig = ev.target && ev.target.closest && ev.target.closest('[data-chat-open]');
            if (!trig) return;
            suppressDataChatOpenClick = true;
            window.setTimeout(function () { suppressDataChatOpenClick = false; }, 500);
            ev.preventDefault();
            if (widget.classList.contains('is-open')) closeWidget(); else openWidget();
        }, { passive: false, capture: true });
        closeBtn && closeBtn.addEventListener('click', closeWidget);
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && widget.classList.contains('is-open')) closeWidget();
        });
        var isDown = false;
        var didDrag = false;
        var startX;
        var scrollLeft;

        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        // Global click handler: triggers and outside-click minimization
        document.addEventListener('click', function (ev) {
            var trigger = ev.target && ev.target.closest && ev.target.closest('[data-chat-open]');
            if (trigger) {
                if (suppressDataChatOpenClick) {
                    ev.preventDefault();
                    return;
                }
                ev.preventDefault();
                if (widget.classList.contains('is-open')) closeWidget(); else openWidget();
                return;
            }

            var escBtn = ev.target && ev.target.closest && ev.target.closest('.osa-escalate-btn');
            if (escBtn && widget.contains(escBtn)) {
                ev.preventDefault();
                if (escBtn.disabled) return;
                escBtn.disabled = true;
                escBtn.textContent = 'Escalating…';
                submitEscalationFromWidget(postApi, appendBubble, chatSessionId, lastEscalationDraft);
                return;
            }

            var cancelEscBtn = ev.target && ev.target.closest && ev.target.closest('[data-osa-cancel-escalation]');
            if (cancelEscBtn && widget.contains(cancelEscBtn)) {
                ev.preventDefault();
                if (cancelEscBtn.disabled) return;
                cancelEscalation(waitingState.caseId);
                return;
            }

            var lfBtn = ev.target && ev.target.closest && ev.target.closest('.osa-lf-appt-btn');
            if (lfBtn && widget.contains(lfBtn)) {
                ev.preventDefault();
                var cid = (lfBtn.getAttribute('data-lf-case') || '').trim();
                var field = (lfBtn.getAttribute('data-lf-field') || '').trim();
                var val = (lfBtn.getAttribute('data-lf-value') || '').trim();
                if (!chatSessionId || !cid || !field) return;
                var body = { session_id: chatSessionId, case_id: cid };
                if (field === 'track') body.appointment_track = val;
                else if (field === 'day') body.preferred_day = val;
                else if (field === 'window') body.preferred_time_window = val;
                postApi('/chat/claim/appointment-preference', body)
                    .then(function (data) {
                        var summary = String((data && data.summary) || 'Preference saved.');
                        appendBubble('assistant', renderAssistantText(summary));
                    })
                    .catch(function (err) {
                        if (err && (err.code === 'SESSION_EXPIRED' || err.status === 401)) {
                            expireSecureSessionLocal();
                            appendBubble('assistant', '<p style="margin:0">Session expired. Verify OTP again to continue.</p>');
                        } else {
                            appendBubble('assistant', '<p style="margin:0">' + escapeHtml(err.message || 'Could not save preference.') + '</p>');
                        }
                    });
                return;
            }

            if (widget.classList.contains('is-open')) {
                var inWidget = widget.contains(ev.target);
                var inFab = fab && fab.contains(ev.target);
                var inClose = closeBtn && closeBtn.contains(ev.target);
                if (!inWidget && !inFab && !inClose) {
                    closeWidget();
                }
            }
        });

        function visitorAssistHtml() {
            var custom = window.__OSA_VISITOR_NOTICE_HTML__;
            if (custom && String(custom).trim()) return String(custom);
            return '' +
                '<div class="osa-ai-visitor">' +
                '<p style="margin:0 0 10px;"><strong>For visitors &amp; accounts without campus email</strong></p>' +
                '<p style="margin:0 0 8px;">OTP-secured chat requires an official <strong>EAC Cavite student email</strong>. Visit the Office of Student Affairs during posted hours for walk-in guidance.</p>' +
                '<p style="margin:0;"><a href="https://www.eac.edu.ph/osa/" target="_blank" rel="noopener noreferrer">Official OSA · eac.edu.ph</a></p>' +
                '</div>';
        }

        var serviceTopicEl = document.getElementById('osa-service-topic');
        if (serviceTopicEl) {
            serviceTopicEl.addEventListener('change', function () {
                var val = serviceTopicEl.value;
                if (!val) return;
                if (val === '__visitor__') {
                    appendBubble('assistant', visitorAssistHtml());
                    serviceTopicEl.value = '';
                    openWidget();
                    scrollThread();
                    return;
                }
                input.value = val;
                serviceTopicEl.value = '';
                openWidget();
                input.focus();
                window.requestAnimationFrame(function () {
                    handleSend();
                });
            });
        }

        // Horizontal drag-to-scroll + delegated chip clicks
        var chipsContainer = document.getElementById('osa-chat-chips');
        if (chipsContainer) {
            chipsContainer.addEventListener('click', function (e) {
                var btn = e.target && e.target.closest && e.target.closest('.osa-ai-chip');
                if (!btn || !chipsContainer.contains(btn)) return;
                if (didDrag) {
                    e.preventDefault();
                    return;
                }
                if (btn.classList.contains('osa-visitor-chip')) {
                    e.preventDefault();
                    appendBubble('assistant', visitorAssistHtml());
                    openWidget();
                    scrollThread();
                    return;
                }
                var prompt = btn.getAttribute('data-prompt') || '';
                if (!prompt) return;
                input.value = prompt;
                openWidget();
                input.focus();
                window.requestAnimationFrame(function () {
                    handleSend();
                });
            });
            chipsContainer.addEventListener('mousedown', function (e) {
                isDown = true;
                didDrag = false;
                chipsContainer.classList.add('is-dragging');
                startX = e.pageX - chipsContainer.offsetLeft;
                scrollLeft = chipsContainer.scrollLeft;
            });
            chipsContainer.addEventListener('mouseleave', function () {
                isDown = false;
                chipsContainer.classList.remove('is-dragging');
            });
            chipsContainer.addEventListener('mouseup', function () {
                isDown = false;
                chipsContainer.classList.remove('is-dragging');
                // Give click event a tiny window to resolve before resetting didDrag
                setTimeout(function () { didDrag = false; }, 50);
            });
            chipsContainer.addEventListener('mousemove', function (e) {
                if (!isDown) return;
                var x = e.pageX - chipsContainer.offsetLeft;
                var walk = (x - startX) * 1.5;
                if (Math.abs(walk) > 3) {
                    didDrag = true;
                    e.preventDefault();
                }
                chipsContainer.scrollLeft = scrollLeft - walk;
            });
            // Allow vertical scroll wheel to scroll horizontally (common paradigm)
            chipsContainer.addEventListener('wheel', function (e) {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    chipsContainer.scrollLeft += e.deltaY;
                }
            });
        }

        restoreThread();

        // If we restored a verified session on page load, open the real-time
        // staff channel + resume the countdown immediately so incoming admin
        // replies don't go missed and the timer stays accurate.
        if (chatSessionId) {
            startSSE();
            if (getLS(SESSION_EXP_KEY, '')) startSessionCountdown();
            hydrateActiveTicketBanner();
        }
        updateScrollBtn();

        // Clean up SSE on tab close so the server can drop the subscriber.
        window.addEventListener('beforeunload', stopSSE);

        // Public API for other pages / buttons
        window.OSAChat = {
            open: openWidget,
            close: closeWidget,
            send: function (text) { input.value = String(text || ''); openWidget(); handleSend(); },
            clear: function () { setLS(THREAD_KEY, []); restoreThread(); }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
