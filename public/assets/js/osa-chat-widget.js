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

    var DOMAIN = 'student.cvt.eac.edu.ph';
    var THREAD_KEY = 'osaChatThread';
    var EMAIL_KEY = 'osaChatEmail';
    var VERIFIED_KEY = 'osaChatVerified';
    var QUEUE_KEY = 'osaEscalationQueue';
    var LF_KEY = 'osaLostFound';

    function buildMarkup() {
        return '' +
            '<div class="osa-launcher-panel" id="osa-chat-widget" role="dialog" aria-modal="true" aria-labelledby="osa-chat-title" aria-hidden="true">' +
            '  <header class="osa-ai-header">' +
            '    <div class="osa-ai-header__brand">' +
            '      <div class="osa-ai-header__titles">' +
            '        <strong id="osa-chat-title">OSA Assistant</strong>' +
            '        <span>Student Affairs · Live Help</span>' +
            '      </div>' +
            '    </div>' +
            '    <button type="button" class="osa-launcher-head__close" id="osa-chat-close" aria-label="Close">' +
            '      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>' +
            '    </button>' +
            '  </header>' +
            '  <div class="osa-ai-thread" id="osa-chat-thread" role="log" aria-live="polite"></div>' +
            '  <div class="osa-ai-chips-wrapper">' +
            '    <div class="osa-ai-chips" id="osa-chat-chips">' +
            '      <button type="button" class="osa-ai-chip" data-prompt="How do I apply for scholarship?">Scholarship</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need help with lost and found claim.">Lost &amp; Found</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="How can I request good moral certificate?">Good Moral</button>' +
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
            '    <p class="osa-ai-composer__hint">OTP runs inline for restricted keywords (claim, appointment, escalate).</p>' +
            '  </div>' +
            '</div>' +
            '<button class="osa-launcher-fab" id="osa-chat-fab" type="button" aria-controls="osa-chat-widget" aria-expanded="false">' +
            '  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
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

    function parseItemNumber(text) {
        var m = (text || '').match(/\bLF[-\s]?(\d{3,6})\b/i);
        return m ? 'LF-' + m[1] : '';
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
        var otpVerified = !!getLS(VERIFIED_KEY, false) && !!emailStore.value;
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
            arr.forEach(function (m) { renderBubble(m.role, m.html); });
        }

        var delay = function (ms) { return new Promise(function (r) { window.setTimeout(r, reducedMotion ? 0 : ms); }); };

        function routeConcern(message) {
            var text = message.toLowerCase();
            if (text.indexOf('@') >= 0 && text.indexOf('@' + DOMAIN) === -1) {
                return 'Only EAC Cavite student emails are accepted for restricted requests.';
            }
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
                return 'Appointments page lets you book a time with the OSA staff. Use the navbar Appointments link.';
            }
            return 'I cover conduct, Lost &amp; Found, ID, scholarship, Good Moral, ISO/PACUCOA, and LAAP\u2014plus Student Manual references.';
        }

        function needsProtected(message) {
            var t = message.toLowerCase();
            var keys = ['claim', 'appointment', 'escalat', 'human', 'support', 'ticket', 'schedule'];
            for (var i = 0; i < keys.length; i++) { if (t.indexOf(keys[i]) >= 0) return true; }
            return false;
        }

        function injectOtp() {
            return new Promise(function (resolve) {
                var id = 'otp-' + Date.now();
                var code = '';
                var exp = 0;
                var row = document.createElement('div');
                row.className = 'osa-ai-msg osa-ai-msg--assistant';
                row.innerHTML =
                    '<div>' +
                    '  <div class="osa-ai-msg__bubble">' +
                    '    <p style="margin:0">Verify your <strong>@' + DOMAIN + '</strong> email to continue.</p>' +
                    '    <div class="osa-ai-otp" style="margin-top:0.5rem">' +
                    '      <div class="osa-ai-otp__field"><label for="' + id + '-e">Email</label><input id="' + id + '-e" type="email" placeholder="name@' + DOMAIN + '" autocomplete="email"></div>' +
                    '      <div class="osa-ai-otp__actions"><button type="button" class="osa-ai-otp__btn osa-ai-otp__btn--primary" id="' + id + '-s">Send code</button></div>' +
                    '      <div class="osa-ai-otp__field" id="' + id + '-cb" hidden><label for="' + id + '-c">Code</label><input id="' + id + '-c" inputmode="numeric" maxlength="8" autocomplete="one-time-code"></div>' +
                    '      <div class="osa-ai-otp__actions" id="' + id + '-vr" hidden><button type="button" class="osa-ai-otp__btn osa-ai-otp__btn--primary" id="' + id + '-v">Verify</button></div>' +
                    '      <p class="osa-ai-otp__status" id="' + id + '-st"></p>' +
                    '      <p class="osa-ai-otp__demo" id="' + id + '-dm" hidden></p>' +
                    '    </div>' +
                    '  </div>' +
                    '  <div class="osa-ai-msg__meta">Verification</div>' +
                    '</div>';
                thread.appendChild(row);
                revealRow(row);
                scrollThread();

                var st = row.querySelector('#' + id + '-st');
                var dm = row.querySelector('#' + id + '-dm');
                var em = row.querySelector('#' + id + '-e');
                var send = row.querySelector('#' + id + '-s');
                var cb = row.querySelector('#' + id + '-cb');
                var vr = row.querySelector('#' + id + '-vr');
                var cd = row.querySelector('#' + id + '-c');
                var vf = row.querySelector('#' + id + '-v');

                send && send.addEventListener('click', async function () {
                    var v = (em && em.value || '').trim().toLowerCase();
                    if (!v || v.lastIndexOf('@' + DOMAIN) !== v.length - ('@' + DOMAIN).length) {
                        st.textContent = 'Invalid email.';
                        st.className = 'osa-ai-otp__status is-err';
                        return;
                    }
                    st.textContent = 'Sending\u2026';
                    st.className = 'osa-ai-otp__status is-wait';
                    await delay(450);
                    code = String(Math.floor(100000 + Math.random() * 900000));
                    exp = Date.now() + 5 * 60 * 1000;
                    cb.hidden = false;
                    vr.hidden = false;
                    dm.hidden = false;
                    dm.textContent = 'Demo code: ' + code;
                    st.textContent = 'Code sent.';
                    st.className = 'osa-ai-otp__status is-ok';
                    cd && cd.focus();
                });
                vf && vf.addEventListener('click', function () {
                    if ((cd && cd.value || '').trim() !== code || Date.now() > exp) {
                        st.textContent = 'Check the code.';
                        st.className = 'osa-ai-otp__status is-err';
                        return;
                    }
                    var verifiedEmail = (em && em.value || '').trim().toLowerCase();
                    emailStore.value = verifiedEmail;
                    setLS(EMAIL_KEY, verifiedEmail);
                    setLS(VERIFIED_KEY, true);
                    otpVerified = true;
                    st.textContent = 'Verified.';
                    st.className = 'osa-ai-otp__status is-ok';
                    appendBubble('assistant', '<p style="margin:0">Session verified \u2014 you can continue with protected actions.</p>');
                    resolve();
                });
            });
        }

        async function handleSend() {
            var message = input.value.trim();
            if (!message) return;
            appendBubble('user', '<p style="margin:0">' + escapeHtml(message) + '</p>');
            input.value = '';
            sendBtn.disabled = true;

            var typing = document.createElement('div');
            typing.className = 'osa-ai-msg osa-ai-msg--assistant is-visible';
            typing.innerHTML = '<div><div class="osa-ai-msg__bubble"><div class="osa-ai-typing"><span></span><span></span><span></span></div></div><div class="osa-ai-msg__meta">Assistant</div></div>';
            thread.appendChild(typing);
            scrollThread();
            await delay(400 + Math.random() * 280);
            typing.remove();

            var email = (emailStore.value || '').trim();
            var itemNumber = parseItemNumber(message);

            if (needsProtected(message) && !otpVerified) {
                appendBubble('assistant', '<p style="margin:0">This request needs a verified student email. Use the card below.</p>');
                await injectOtp();
                sendBtn.disabled = false;
                input.focus();
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
                var ref = 'LFC-EAC-' + Date.now().toString(36).toUpperCase();
                pushQueue({
                    id: ref,
                    kind: 'lost-found-claim',
                    concern: 'Claim request for ' + itemNumber + ' \u00b7 ' + (item.title || 'Recovered item'),
                    itemNumber: itemNumber,
                    email: email || '',
                    status: 'For OSA verification',
                    createdAt: new Date().toLocaleString()
                });
                appendBubble('assistant', '<p style="margin:0">Claim request submitted. Reference <strong>' + ref + '</strong> for item <strong>' + itemNumber + '</strong>.</p>');
                sendBtn.disabled = false;
                input.focus();
                return;
            }

            var reply = routeConcern(message);
            appendBubble('assistant', '<p style="margin:0">' + reply + '</p>');
            if (reply.indexOf('Student Manual') >= 0) {
                appendBubble('assistant',
                    '<details class="osa-ai-rich" open><summary>Next steps</summary><ul><li>Open Forms from the portal nav</li><li>Note your concern type</li><li>Escalate if unresolved</li></ul></details>');
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

            if (widget.classList.contains('is-open')) {
                var inWidget = widget.contains(ev.target);
                var inFab = fab && fab.contains(ev.target);
                var inClose = closeBtn && closeBtn.contains(ev.target);
                if (!inWidget && !inFab && !inClose) {
                    closeWidget();
                }
            }
        });

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
                input.value = btn.getAttribute('data-prompt') || '';
                openWidget();
                input.focus();
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
