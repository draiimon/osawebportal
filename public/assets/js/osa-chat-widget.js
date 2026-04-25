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
    var GUEST_CONVO_KEY = 'osaChatGuestConvoId';

    function buildMarkup() {
        return '' +
            '<div class="osa-launcher-panel osa-launcher-panel--chat-ui" id="osa-chat-widget" role="dialog" aria-modal="true" aria-labelledby="osa-chat-title" aria-hidden="true">' +
            '  <header class="osa-ai-header">' +
            '    <div class="osa-ai-header__brand">' +
            '      <div class="osa-ai-header__avatar" aria-hidden="true">' +
            '        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '      </div>' +
            '      <div class="osa-ai-header__titles">' +
            '        <strong id="osa-chat-title">Ask OSA</strong>' +
            '        <div class="osa-ai-header__sub">' +
            '          <span class="osa-ai-header__status-line" id="osa-chat-status-line">Ready</span>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <div class="osa-ai-header__trailing">' +
            '      <span id="osa-chat-mode-badge" class="osa-ai-mode osa-ai-mode--ai">OSA</span>' +
            '      <button type="button" class="osa-launcher-head__close" id="osa-chat-close" aria-label="Close">' +
            '        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '      </button>' +
            '    </div>' +
            '  </header>' +
            '  <button type="button" class="osa-ai-scroll-bottom" id="osa-chat-scroll-bottom" aria-label="Scroll to latest" hidden>' +
            '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
            '  </button>' +
            '  <div class="osa-ai-thread" id="osa-chat-thread" role="log" aria-live="polite"></div>' +
            '  <div class="osa-ai-verified-bar" id="osa-chat-verified-bar" hidden role="status" aria-live="polite">' +
            '    <div class="osa-ai-verified-bar__left">' +
            '      <span class="osa-ai-verified-bar__shield" aria-hidden="true">' +
            '        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3z"/><polyline points="9 12 11 14 15 10"/></svg>' +
            '      </span>' +
            '      <span class="osa-ai-verified-bar__text">Verified as <strong id="osa-chat-verified-name">student</strong></span>' +
            '      <div class="osa-ai-session-timer osa-ai-verified-bar__timer" id="osa-chat-timer" hidden aria-live="polite" title="Session time remaining">' +
            '        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>' +
            '        <span id="osa-chat-timer-text">--:--</span>' +
            '      </div>' +
            '    </div>' +
            '    <button type="button" class="osa-ai-verified-bar__end" id="osa-chat-end-session" aria-label="End verified session">' +
            '      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
            '      <span>End session</span>' +
            '    </button>' +
            '  </div>' +
            '  <div class="osa-ai-chips-wrapper">' +
            '    <div class="osa-ai-chips" id="osa-chat-chips">' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need an appointment with OSA. Please guide me on scheduling a visit or meeting.">Appointment</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need help with lost and found claim.">Lost &amp; Found</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="What are the latest OSA announcements?">Announcements</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need a new OTP code for secure chat verification.">New OTP request</button>' +
            '      <button type="button" class="osa-ai-chip" data-prompt="I need human support">Human support</button>' +
            '    </div>' +
            '  </div>' +
            '  <div class="osa-ai-composer">' +
            '    <input type="hidden" id="osa-chat-email-store" autocomplete="off">' +
            '    <div class="osa-ai-composer__row">' +
            '      <label for="osa-chat-message" class="sr-only">Message</label>' +
            '      <textarea id="osa-chat-message" rows="1" placeholder="Ask OSA anything\u2026" autocomplete="off"></textarea>' +
            '      <button type="button" class="osa-ai-btn-send" id="osa-chat-send" aria-label="Send">' +
            '        <svg viewBox="0 0 24 24"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
            '      </button>' +
            '    </div>' +
            '    <p class="osa-ai-composer__hint">Quick topics above send automatically. OTP may appear for sensitive requests (claim, appointment, escalate).</p>' +
            '    <div class="osa-ai-quota" id="osa-chat-quota" aria-live="polite" hidden><span class="osa-ai-quota__dot" aria-hidden="true"></span><span class="osa-ai-quota__text" id="osa-chat-quota-text">-- / -- today</span></div>' +
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

    async function submitEscalationFromWidget(postApi, appendBubble, sessionId, concernText, hooks) {
        if (!sessionId) {
            appendBubble('assistant', '<p style="margin:0">Please verify your email first before escalating.</p>');
            return;
        }
        var h = hooks || {};
        var hookRenderWaitingBanner = typeof h.renderWaitingBanner === 'function' ? h.renderWaitingBanner : function () {};
        var hookSetMode = typeof h.setMode === 'function' ? h.setMode : function () {};
        var hookGetApi = typeof h.getApi === 'function' ? h.getApi : null;

        var concern = String(concernText || '').trim();
        if (!concern) {
            concern = String(window.prompt('Share your concern details for OSA staff:', '') || '').trim();
        }
        if (!concern) return;

        try {
            var result = await postApi('/chat/escalate', { session_id: sessionId, concern: concern });
            if (result && result.appointment_locked_today) {
                appendBubble('assistant', '<p style="margin:0">' + escapeHtml(String(result.message || result.reply || 'Your appointment case for today is already resolved. Please email OSA for follow-up.')) + '</p>');
                return;
            }
            var cid = result && result.case_id ? result.case_id : '';
            if (cid) {
                hookRenderWaitingBanner(cid, Date.now(), true);
                hookSetMode('staff');
            }
            var handoffHtml =
                '<div class="osa-ai-handoff">' +
                '<p style="margin:0 0 6px"><strong>Escalated to OSA staff.</strong></p>' +
                (cid ? '<p style="margin:0 0 6px">Case ID: <strong>' + escapeHtml(cid) + '</strong></p>' : '') +
                '<p style="margin:0 0 4px">Keep this chat window open — an OSA staff member will reply <strong>right here</strong> once they pick up your case.</p>' +
                '<p style="margin:0;font-size:12px;color:#65574d">AI replies are paused for this case while staff handles it.</p>' +
                '</div>';
            appendBubble('assistant', handoffHtml);
        } catch (err) {
            // If escalation request likely succeeded but response failed to return,
            // recover by checking active ticket state before showing a hard failure.
            if (hookGetApi) {
                try {
                    var active = await hookGetApi('/chat/session/' + encodeURIComponent(sessionId) + '/ticket');
                    if (active && active.ticket && active.ticket.case_id) {
                        var fallbackCase = String(active.ticket.case_id || '').trim();
                        if (fallbackCase) {
                            hookRenderWaitingBanner(fallbackCase, Date.parse(active.ticket.created_at) || Date.now(), !!active.ticket.cancellable);
                            hookSetMode('staff');
                            appendBubble('assistant', '<p style="margin:0">Your escalation request is active (Case ID: <strong>' + escapeHtml(fallbackCase) + '</strong>). OSA staff will reply in this chat.</p>');
                            return;
                        }
                    }
                } catch (_) {}
            }
            if (err && (err.code === 'SESSION_EXPIRED' || err.status === 401)) {
                appendBubble('assistant', '<p style="margin:0">Session expired. Please verify a new OTP code, then escalate again.</p>');
            } else if (err && String(err.code || '').toUpperCase() === 'SESSION_ALREADY_RESOLVED_TODAY') {
                appendBubble('assistant', '<p style="margin:0">' + escapeHtml(String(err.message || 'Your support case for today is already resolved. Please email OSA for follow-up.')) + '</p>');
            } else if (err && String(err.code || '').toUpperCase() === 'APPOINTMENT_LIMIT_DAILY') {
                appendBubble('assistant', '<p style="margin:0">' + escapeHtml(String(err.message || 'You can only request one appointment per day. Please wait for OSA updates or email OSA for follow-up.')) + '</p>');
            } else if (err && String(err.code || '').toUpperCase() === 'APPOINTMENT_ALREADY_RESOLVED_TODAY') {
                appendBubble('assistant', '<p style="margin:0">' + escapeHtml(String(err.message || 'Your appointment case for today is already resolved. Please email OSA for follow-up.')) + '</p>');
            } else {
                appendBubble('assistant', '<p style="margin:0">Failed to escalate. ' + escapeHtml(userSafeErrorHint(err)) + '</p>');
            }
        }
    }

    function parseItemNumber(text) {
        var m = (text || '').match(/\bLF[-\s]?(\d{3,6})\b/i);
        return m ? 'LF-' + m[1] : '';
    }

    /**
     * Buttons for claim visit type / time window (delegated `.osa-lf-appt-btn`).
     * Preferred day is typed in chat — chip row removed because it overflowed
     * the narrow bubble width on common screens. Server parses typed day names
     * (Mon/Monday/etc.) directly from the next message in human-mode.
     * Chip rows use flex-wrap inline so labels never get clipped.
     */
    function lfPreferencePanelHtml(caseId) {
        var c = escapeHtml(caseId);
        var wrapStyle = 'display:flex;flex-wrap:wrap;gap:6px;overflow:visible;margin-bottom:12px;padding:0';
        return '' +
            '<details class="osa-ai-rich" open style="margin-top:6px">' +
            '<summary>Claim visit preferences</summary>' +
            '<p style="margin:0 0 10px;font-size:13px;color:#675a4f;">Choose a visit type and time window below. For your <strong>preferred day</strong>, simply type it in the chat (e.g., Mon, Tue, Wed, Thu, or Fri). OSA staff will confirm the final schedule.</p>' +
            '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1c1917">Visit type</p>' +
            '<div class="osa-ai-chips" style="' + wrapStyle + '">' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="track" data-lf-value="claiming">Claiming appointment</button>' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="track" data-lf-value="private">Private appointment</button>' +
            '</div>' +
            '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1c1917">Time window</p>' +
            '<div class="osa-ai-chips" style="' + wrapStyle + ';margin-bottom:0">' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="window" data-lf-value="Morning">Morning</button>' +
            '<button type="button" class="osa-ai-chip osa-lf-appt-btn" data-lf-case="' + c + '" data-lf-field="window" data-lf-value="Afternoon">Afternoon</button>' +
            '</div>' +
            '<p style="margin:10px 0 0;font-size:12px;color:#65574d"><em>Tip: type your preferred day here in the chat (Mon / Tue / Wed / Thu / Fri).</em></p>' +
            '</details>';
    }

    /**
     * Preference buttons for a visit/appointment ticket.
     * Student picks preferred day + time window; OSA confirms the final slot.
     */
    function visitPreferencePanelHtml(caseId) {
        var c = escapeHtml(caseId);
        var wrapStyle = 'display:flex;flex-wrap:wrap;gap:6px;overflow:visible;margin-bottom:12px;padding:0';
        return '' +
            '<details class="osa-ai-rich" open style="margin-top:6px">' +
            '<summary>Visit appointment preferences</summary>' +
            '<p style="margin:0 0 10px;font-size:13px;color:#675a4f;">Choose your preferred day and time window. OSA staff will review and confirm the exact schedule.</p>' +
            '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1c1917">Preferred day</p>' +
            '<div class="osa-ai-chips" style="' + wrapStyle + '">' +
            '<button type="button" class="osa-ai-chip osa-visit-appt-btn" data-visit-case="' + c + '" data-visit-field="day" data-visit-value="Mon">Mon</button>' +
            '<button type="button" class="osa-ai-chip osa-visit-appt-btn" data-visit-case="' + c + '" data-visit-field="day" data-visit-value="Tue">Tue</button>' +
            '<button type="button" class="osa-ai-chip osa-visit-appt-btn" data-visit-case="' + c + '" data-visit-field="day" data-visit-value="Wed">Wed</button>' +
            '<button type="button" class="osa-ai-chip osa-visit-appt-btn" data-visit-case="' + c + '" data-visit-field="day" data-visit-value="Thu">Thu</button>' +
            '<button type="button" class="osa-ai-chip osa-visit-appt-btn" data-visit-case="' + c + '" data-visit-field="day" data-visit-value="Fri">Fri</button>' +
            '</div>' +
            '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1c1917">Time window</p>' +
            '<div class="osa-ai-chips" style="' + wrapStyle + ';margin-bottom:0">' +
            '<button type="button" class="osa-ai-chip osa-visit-appt-btn" data-visit-case="' + c + '" data-visit-field="window" data-visit-value="Morning">Morning</button>' +
            '<button type="button" class="osa-ai-chip osa-visit-appt-btn" data-visit-case="' + c + '" data-visit-field="window" data-visit-value="Afternoon">Afternoon</button>' +
            '</div>' +
            '<p style="margin:10px 0 0;font-size:12px;color:#65574d"><em>OSA staff will confirm the exact date and time once they review your request.</em></p>' +
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

    /**
     * Quick-pick panel listing currently-unclaimed Lost & Found items as
     * clickable buttons. Each button auto-fires the existing claim flow so
     * students don't have to type the LF-#### number themselves.
     */
    function lfPickerPanelHtml(items) {
        if (!items || !items.length) {
            return '' +
                '<div class="osa-ai-rich" style="margin-top:6px">' +
                '<p style="margin:0 0 6px"><strong>Lost &amp; Found</strong></p>' +
                '<p style="margin:0;font-size:13px;color:#675a4f">No claimable items are available right now. Please try again later or visit the ' +
                '<a href="/lost-and-found" target="_blank" rel="noopener">Lost &amp; Found page</a>.</p>' +
                '</div>';
        }
        var max = 12;
        var visible = items.slice(0, max);
        var rows = visible.map(function (it) {
            var num   = escapeHtml(String(it.itemNumber || ''));
            var title = escapeHtml(String(it.title || 'Recovered Item'));
            var tag   = escapeHtml(String(it.tag || 'Personal Item'));
            var date  = escapeHtml(String(it.date || ''));
            if (!num) return '';
            return '' +
                '<button type="button" class="osa-lf-claim-btn" ' +
                'data-lf-item="' + num + '" data-lf-title="' + title + '" ' +
                'style="display:block;width:100%;text-align:left;background:#fffaf6;border:1px solid #e7d9cf;border-radius:10px;padding:10px 12px;margin:0 0 8px;cursor:pointer;font:inherit;color:#1c1917;transition:background 0.15s,border-color 0.15s" ' +
                'onmouseover="this.style.background=\'#fff3ea\';this.style.borderColor=\'#841a2d\'" ' +
                'onmouseout="this.style.background=\'#fffaf6\';this.style.borderColor=\'#e7d9cf\'">' +
                '<div style="font-weight:700;font-size:13px;color:#841a2d">' + num + ' &middot; ' + title + '</div>' +
                '<div style="font-size:12px;color:#65574d;margin-top:2px">' + tag + (date ? ' &middot; ' + date : '') + '</div>' +
                '</button>';
        }).join('');
        var more = items.length > max
            ? '<p style="margin:6px 0 0;font-size:12px;color:#65574d">Showing ' + visible.length + ' of ' + items.length + ' items. ' +
              '<a href="/lost-and-found" target="_blank" rel="noopener">View all on the Lost &amp; Found page</a>.</p>'
            : '';
        return '' +
            '<div>' +
            '<p style="margin:0 0 8px"><strong>Tap an item to start your claim:</strong></p>' +
            rows +
            more +
            '</div>';
    }

    /** True for L&F intent that does NOT already include a specific LF-#### number. */
    function isLostFoundPickerIntent(text) {
        var raw = String(text || '');
        if (parseItemNumber(raw)) return false;
        var t = raw.toLowerCase();
        return /(lost\s*(and|&)?\s*found|claim|lost\s+item|found\s+item|nahanap|nawala|na\s*claim)/.test(t);
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

        if (!widget || !fab || !thread || !input || !sendBtn) {
            return;
        }

        // #region agent log
        fetch('http://127.0.0.1:7583/ingest/0b5f4c8a-4bec-4e5e-bd89-fa937b11a18b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'48e504'},body:JSON.stringify({sessionId:'48e504',runId:'run1',hypothesisId:'H0',location:'public/assets/js/osa-chat-widget.js:init',message:'instrumented widget initialized',data:{hasWidget:!!widget,hasThread:!!thread},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        emailStore.value = String(getLS(EMAIL_KEY, '') || '');
        var savedName = String(getLS(NAME_KEY, '') || '').trim();
        var chatSessionId = String(getLS(SESSION_KEY, '') || '');
        var sessionTs = Number(getLS(SESSION_TS_KEY, 0) || 0);
        var otpVerified = !!getLS(VERIFIED_KEY, false) && !!emailStore.value && !!chatSessionId;
        var lastEscalationDraft = '';
        var pendingOtpReverify = false;
        var pendingOtpReverifyMessage = '';

        if (String(getLS(THREAD_SCHEMA_KEY, '') || '') !== '2') {
            setLS(THREAD_KEY, []);
            setLS(THREAD_SCHEMA_KEY, '2');
        }

        // Keep chat history across page navigation for the same browser user.
        // Only clear thread on explicit new-session flows (e.g., account switch
        // via OTP verification or server-driven session expiry handling).

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
            // Do not wipe thread automatically on page load; preserve UX.
        }

        // If the saved session expiry has already passed (10-min window),
        // clear the personalized identity on page load so we don't greet
        // the user with "Hi, <Name>" for an expired session.
        (function clearExpiredIdentityOnLoad() {
            var iso = String(getLS(SESSION_EXP_KEY, '') || '');
            if (!iso) return;
            var expMs = Date.parse(iso);
            if (!isFinite(expMs)) return;
            if (Date.now() >= expMs) {
                chatSessionId = '';
                otpVerified = false;
                savedName = '';
                setLS(SESSION_KEY, '');
                setLS(SESSION_TS_KEY, 0);
                setLS(SESSION_EXP_KEY, '');
                setLS(VERIFIED_KEY, false);
                setLS(NAME_KEY, '');
            }
        })();

        if (!otpVerified) setLS(VERIFIED_KEY, false);
        var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Personalize the chat header once a student is OTP-verified.
        // Replaces the generic "Ask OSA" title with "Hi, <FirstName>" so
        // the user immediately sees that the session belongs to them.
        // Passing an empty / falsy name resets the header back to default.
        function getFirstName(fullName) {
            var s = String(fullName || '').trim();
            if (!s) return '';
            var first = s.split(/\s+/)[0] || '';
            // Cap to keep header tidy on iPhone SE width.
            return first.length > 18 ? first.slice(0, 18) + '\u2026' : first;
        }
        function applyVerifiedHeader(name) {
            var titleEl = document.getElementById('osa-chat-title');
            if (titleEl) {
                var first = getFirstName(name);
                titleEl.textContent = first ? ('Hi, ' + first) : 'Ask OSA';
            }
            updateVerifiedBar(name);
        }
        // Show / hide the "Verified as <Name> · End session" bar
        // that sits above the Quick topics.
        function updateVerifiedBar(name) {
            var bar = document.getElementById('osa-chat-verified-bar');
            var nameEl = document.getElementById('osa-chat-verified-name');
            if (!bar) return;
            var first = getFirstName(name);
            var canShow = !!(otpVerified && chatSessionId && first);
            if (canShow) {
                if (nameEl) nameEl.textContent = first;
                bar.hidden = false;
            } else {
                bar.hidden = true;
            }
        }
        // Restore the personalized header on page load for an already-verified
        // browser (avoids flashing "Ask OSA" before the user sees their name).
        if (otpVerified && savedName) applyVerifiedHeader(savedName);

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

        // Prevent underlying page scroll on mobile while chat overlay is open.
        var pageScrollLockY = 0;
        function isMobileViewport() {
            return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
        }
        function lockPageScroll() {
            if (!isMobileViewport()) return;
            if (document.body.getAttribute('data-osa-scroll-locked') === '1') return;
            pageScrollLockY = window.scrollY || window.pageYOffset || 0;
            document.body.setAttribute('data-osa-scroll-locked', '1');
            document.body.style.position = 'fixed';
            document.body.style.top = '-' + pageScrollLockY + 'px';
            document.body.style.left = '0';
            document.body.style.right = '0';
            document.body.style.width = '100%';
            document.body.style.overflow = 'hidden';
        }
        function unlockPageScroll() {
            if (document.body.getAttribute('data-osa-scroll-locked') !== '1') return;
            document.body.removeAttribute('data-osa-scroll-locked');
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
            window.scrollTo(0, pageScrollLockY);
        }

        function debugLayoutSnapshot(source, hypothesisId) {
            var headerEl = widget ? widget.querySelector('.osa-ai-header') : null;
            var firstMsgEl = thread ? thread.querySelector('.osa-ai-msg') : null;
            var firstBubbleEl = firstMsgEl ? firstMsgEl.querySelector('.osa-ai-msg__bubble') : null;
            var threadStyles = thread ? window.getComputedStyle(thread) : null;
            var firstMsgStyles = firstMsgEl ? window.getComputedStyle(firstMsgEl) : null;
            var bubbleStyles = firstBubbleEl ? window.getComputedStyle(firstBubbleEl) : null;
            var headerRect = headerEl ? headerEl.getBoundingClientRect() : null;
            var firstMsgRect = firstMsgEl ? firstMsgEl.getBoundingClientRect() : null;
            var overlapPx = (headerRect && firstMsgRect) ? Math.max(0, headerRect.bottom - firstMsgRect.top) : null;
            var snapshotData = {
                source: source,
                threadPaddingTop: threadStyles ? threadStyles.paddingTop : null,
                threadOverflowY: threadStyles ? threadStyles.overflowY : null,
                threadScrollTop: thread ? thread.scrollTop : null,
                threadClientHeight: thread ? thread.clientHeight : null,
                threadScrollHeight: thread ? thread.scrollHeight : null,
                firstMsgCount: thread ? thread.querySelectorAll('.osa-ai-msg').length : 0,
                firstMsgOffsetTop: firstMsgEl ? firstMsgEl.offsetTop : null,
                firstMsgMarginTop: firstMsgStyles ? firstMsgStyles.marginTop : null,
                firstMsgPaddingTop: firstMsgStyles ? firstMsgStyles.paddingTop : null,
                bubbleMarginTop: bubbleStyles ? bubbleStyles.marginTop : null,
                headerBottom: headerRect ? Math.round(headerRect.bottom) : null,
                firstMsgTop: firstMsgRect ? Math.round(firstMsgRect.top) : null,
                overlapPx: overlapPx
            };
            var line = 'gap=' + String(snapshotData.overlapPx) +
                ' padTop=' + String(snapshotData.threadPaddingTop) +
                ' firstOff=' + String(snapshotData.firstMsgOffsetTop) +
                ' firstM=' + String(snapshotData.firstMsgMarginTop) +
                ' sTop=' + String(snapshotData.threadScrollTop);
            var probe = document.getElementById('osa-gap-debug-probe');
            if (probe) probe.textContent = line;
            var probe2 = document.getElementById('osa-gap-debug-probe-inline');
            if (probe2) probe2.textContent = line;
            // #region agent log
            fetch('http://127.0.0.1:7583/ingest/0b5f4c8a-4bec-4e5e-bd89-fa937b11a18b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'48e504'},body:JSON.stringify({sessionId:'48e504',runId:'run2',hypothesisId:hypothesisId,location:'public/assets/js/osa-chat-widget.js:debugLayoutSnapshot',message:'chat layout snapshot',data:snapshotData,timestamp:Date.now()})}).catch(()=>{});
            // #endregion
        }
        var debugScrollLogCount = 0;
        function debugLayoutOnScroll() {
            if (debugScrollLogCount >= 6) return;
            debugScrollLogCount += 1;
            debugLayoutSnapshot('thread:scroll#' + debugScrollLogCount, 'H5');
        }

        function openWidget() {
            widget.classList.add('is-open');
            fab.classList.add('is-hidden');
            setTriggerState(true);
            lockPageScroll();
            // Ack any pending staff messages as seen now that the widget is visible.
            try { notifySeen(); } catch (_) {}
            var headerBrand = widget.querySelector('.osa-ai-header__brand');
            if (headerBrand && !document.getElementById('osa-gap-debug-probe')) {
                var probe = document.createElement('small');
                probe.id = 'osa-gap-debug-probe';
                probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
                probe.textContent = 'gap probe init';
                headerBrand.appendChild(probe);
            }
            if (thread && !document.getElementById('osa-gap-debug-probe-inline')) {
                var probeInline = document.createElement('div');
                probeInline.id = 'osa-gap-debug-probe-inline';
                probeInline.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
                probeInline.textContent = 'gap probe inline init';
                thread.appendChild(probeInline);
            }
            window.requestAnimationFrame(function () {
                debugLayoutSnapshot('openWidget:raf', 'H1');
            });
            window.setTimeout(function () {
                debugLayoutSnapshot('openWidget:120ms', 'H6');
            }, 120);
            window.setTimeout(function () { input && input.focus(); }, 80);
            try { fetchQuotaAndRender(); } catch (_) {}
        }
        function closeWidget() {
            widget.classList.remove('is-open');
            fab.classList.remove('is-hidden');
            setTriggerState(false);
            unlockPageScroll();
        }

        // ── Daily quota pill ────────────────────────────────────
        var quotaState = { used: 0, limit: 20, remaining: 20, fetched: false };

        function updateQuotaPill(quota) {
            if (!quota || typeof quota !== 'object') return;
            var pill = document.getElementById('osa-chat-quota');
            var text = document.getElementById('osa-chat-quota-text');
            if (!pill || !text) return;
            var limit = Number(quota.limit) || 20;
            var used = Math.max(0, Math.min(limit, Number(quota.used) || 0));
            var remaining = (typeof quota.remaining === 'number')
                ? Math.max(0, Number(quota.remaining))
                : Math.max(0, limit - used);
            quotaState = { used: used, limit: limit, remaining: remaining, fetched: true };
            text.textContent = used + ' / ' + limit + ' today';
            pill.removeAttribute('hidden');
            pill.classList.remove('is-low', 'is-empty');
            if (remaining === 0) {
                pill.classList.add('is-empty');
                text.textContent = 'Daily limit reached — try again tomorrow';
            } else if (remaining <= 3) {
                pill.classList.add('is-low');
            }
        }

        function fetchQuotaAndRender() {
            try {
                getApi('/chatbot/quota').then(function (data) {
                    if (data && data.quota) updateQuotaPill(data.quota);
                }).catch(function () { /* non-fatal */ });
            } catch (_) {}
        }

        function scrollThread() {
            window.requestAnimationFrame(function () { thread.scrollTop = thread.scrollHeight; });
        }

        function revealRow(el) {
            if (!el) return;
            if (reducedMotion) el.classList.add('is-visible');
            else window.requestAnimationFrame(function () { el.classList.add('is-visible'); });
        }

        function formatMetaTime(ts) {
            var d = ts ? new Date(ts) : new Date();
            if (!d || isNaN(d.getTime())) d = new Date();
            var h = d.getHours();
            var m = d.getMinutes();
            var ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
        }

        // ── Per-message status (sent/delivered/seen) ──────────────────
        // Status is tracked client-side and persisted in the thread record,
        // and rendered as small check marks under user bubbles only.
        var STATUS_RANK = { queued: 0, sent: 1, delivered: 2, seen: 3 };
        function statusBadgeHtml(status) {
            var s = String(status || 'queued');
            var label = s.charAt(0).toUpperCase() + s.slice(1);
            var glyph = '\u00b7'; // queued: dot
            if (s === 'sent') glyph = '\u2713';                 // single check
            else if (s === 'delivered') glyph = '\u2713\u2713'; // double check
            else if (s === 'seen') glyph = '\u2713\u2713';      // double check (accent via class)
            return '<span class="osa-msg-status osa-msg-status--' + s + '" title="' + label + '">' + glyph + '</span>';
        }

        function osaGenMsgId() {
            return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        }

        function renderBubble(role, html, opts) {
            var metaLabel = (opts && opts.metaLabel) || (role === 'user' ? 'You' : 'Assistant');
            var metaTime = formatMetaTime(opts && opts.ts);
            var row = document.createElement('div');
            row.className = 'osa-ai-msg osa-ai-msg--' + (role === 'user' ? 'user' : 'assistant');
            if (opts && opts.rowClass) row.className += ' ' + opts.rowClass;
            var msgId = (opts && opts.clientId) ? String(opts.clientId) : '';
            if (msgId) row.setAttribute('data-osa-msg-id', msgId);
            var statusHtml = '';
            if (role === 'user') {
                var initialStatus = (opts && opts.status) ? String(opts.status) : 'queued';
                statusHtml = statusBadgeHtml(initialStatus);
            }
            row.innerHTML = '<div><div class="osa-ai-msg__bubble">' + html +
                '</div><div class="osa-ai-msg__meta"><span class="osa-ai-msg__who">' + metaLabel + '</span><span class="osa-ai-msg__time">' + metaTime + '</span>' + statusHtml + '</div></div>';
            thread.appendChild(row);
            revealRow(row);
            scrollThread();
            return row;
        }

        function appendBubble(role, html, opts) {
            opts = opts || {};
            if (role === 'user' && !opts.clientId) {
                opts.clientId = osaGenMsgId();
                if (!opts.status) opts.status = 'queued';
            }
            renderBubble(role, html, opts);
            if (role === 'assistant') {
                debugLayoutSnapshot('appendBubble:assistant', 'H2');
            }
            if (opts.persist !== false) {
                var arr = getLS(THREAD_KEY, []);
                if (!Array.isArray(arr)) arr = [];
                arr.push({
                    role: role,
                    html: html,
                    t: Date.now(),
                    metaLabel: opts.metaLabel ? String(opts.metaLabel) : '',
                    rowClass: opts.rowClass ? String(opts.rowClass) : '',
                    clientId: opts.clientId || '',
                    status: role === 'user' ? (opts.status || 'queued') : ''
                });
                setLS(THREAD_KEY, arr.slice(-80));
            }
            return opts.clientId || '';
        }

        function setBubbleStatus(clientId, nextStatus) {
            if (!clientId || !nextStatus) return;
            var row = thread.querySelector('[data-osa-msg-id="' + clientId + '"]');
            if (row) {
                var current = '';
                var existing = row.querySelector('.osa-msg-status');
                if (existing) {
                    var cls = existing.className || '';
                    var m = cls.match(/osa-msg-status--(\w+)/);
                    if (m) current = m[1];
                }
                if (current && STATUS_RANK[current] >= STATUS_RANK[nextStatus]) return;
                if (existing) {
                    existing.outerHTML = statusBadgeHtml(nextStatus);
                } else {
                    var meta = row.querySelector('.osa-ai-msg__meta');
                    if (meta) meta.insertAdjacentHTML('beforeend', statusBadgeHtml(nextStatus));
                }
            }
            var arr = getLS(THREAD_KEY, []);
            if (Array.isArray(arr)) {
                for (var i = arr.length - 1; i >= 0; i--) {
                    if (arr[i].clientId === clientId) {
                        var prev = arr[i].status || 'queued';
                        if (STATUS_RANK[nextStatus] > STATUS_RANK[prev]) {
                            arr[i].status = nextStatus;
                            setLS(THREAD_KEY, arr);
                        }
                        break;
                    }
                }
            }
            if (window.__OSA_CHAT_DEBUG__) {
                try { console.debug('[osa-chat] status', clientId, '->', nextStatus); } catch (_) {}
            }
            if (nextStatus === 'seen') {
                try {
                    window.dispatchEvent(new CustomEvent('osa:message_seen', { detail: { clientId: clientId } }));
                } catch (_) {}
            }
        }

        function markAllUserBubblesAtLeast(nextStatus) {
            var rank = STATUS_RANK[nextStatus] || 0;
            var rows = thread.querySelectorAll('.osa-ai-msg--user[data-osa-msg-id]');
            for (var i = 0; i < rows.length; i++) {
                var existing = rows[i].querySelector('.osa-msg-status');
                var cur = '';
                if (existing) {
                    var cls = existing.className || '';
                    var m = cls.match(/osa-msg-status--(\w+)/);
                    if (m) cur = m[1];
                }
                if (!cur || (STATUS_RANK[cur] || 0) < rank) {
                    setBubbleStatus(rows[i].getAttribute('data-osa-msg-id'), nextStatus);
                }
            }
        }

        /** Inline escalation draft must not stack or persist in the saved thread. */
        function removeDomEscalationDrafts() {
            if (!thread) return;
            thread.querySelectorAll('.osa-esc-draft-form').forEach(function (form) {
                var row = form.closest('.osa-ai-msg');
                if (row && row.parentNode) row.parentNode.removeChild(row);
            });
        }

        function restoreThread() {
            thread.innerHTML = '';
            var raw = getLS(THREAD_KEY, []);
            var arr = Array.isArray(raw) ? raw : [];
            // #region agent log
            fetch('http://127.0.0.1:7583/ingest/0b5f4c8a-4bec-4e5e-bd89-fa937b11a18b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'48e504'},body:JSON.stringify({sessionId:'48e504',runId:'run1',hypothesisId:'H3',location:'public/assets/js/osa-chat-widget.js:restoreThread',message:'restoreThread start',data:{storedThreadCount:arr.length},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            arr = arr.filter(function (m) {
                if (!m.html) return true;
                var html = String(m.html);
                if (html.indexOf('osa-esc-draft-form') !== -1) return false;
                if (html.indexOf('osa-visit-timeline') !== -1) return false;
                return true;
            });
            setLS(THREAD_KEY, arr);
            if (!arr.length) {
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
                renderBubble(m.role, m.html, {
                    ts: m.t,
                    metaLabel: m.metaLabel || undefined,
                    rowClass: m.rowClass || undefined,
                    clientId: m.clientId || undefined,
                    status: m.role === 'user' ? (m.status || 'sent') : undefined
                });
            });
            debugLayoutSnapshot('restoreThread:end', 'H4');
        }

        // ── Presence: typing + seen receipts ─────────────────────────
        // Throttled POSTs to ephemeral SSE-fanout endpoints so the staff
        // portal can render "Student is typing…" and so the student can
        // ack staff messages as seen.
        var presenceTypingTimer = null;
        var presenceLastTypingAt = 0;
        var presenceLastTypingState = null; // 'start' | 'stop'
        var staffTypingPillNode = null;
        var staffTypingPillHideTimer = null;

        function presenceFetch(path, body) {
            var bases = getApiBases();
            if (!bases.length) return Promise.resolve(null);
            var url = bases[0] + '/api/v1' + path;
            return fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {}),
                credentials: 'same-origin'
            }).then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
              .catch(function () { return null; });
        }

        function notifyTypingNow(stopped) {
            if (!chatSessionId) return;
            var nowState = stopped ? 'stop' : 'start';
            if (presenceLastTypingState === nowState && (Date.now() - presenceLastTypingAt) < 2000) return;
            presenceLastTypingState = nowState;
            presenceLastTypingAt = Date.now();
            if (window.__OSA_CHAT_DEBUG__) {
                try { console.debug('[osa-chat] typing:' + nowState); } catch (_) {}
            }
            try {
                window.dispatchEvent(new CustomEvent('osa:typing_' + (stopped ? 'stop' : 'start'), { detail: { sessionId: chatSessionId } }));
            } catch (_) {}
            presenceFetch('/chat/typing', { session_id: chatSessionId, stopped: !!stopped });
        }

        function notifyTyping() {
            if (!chatSessionId) return;
            // Edge-throttle: if we recently emitted "start", skip another POST until 2s pass.
            if (presenceLastTypingState !== 'start' || (Date.now() - presenceLastTypingAt) > 1800) {
                notifyTypingNow(false);
            }
            // Auto-emit "stop" after 1.5s of silence.
            if (presenceTypingTimer) {
                window.clearTimeout(presenceTypingTimer);
                presenceTypingTimer = null;
            }
            presenceTypingTimer = window.setTimeout(function () {
                presenceTypingTimer = null;
                notifyTypingNow(true);
            }, 1500);
        }

        function notifySeen() {
            if (!chatSessionId) return;
            if (window.__OSA_CHAT_DEBUG__) {
                try { console.debug('[osa-chat] seen:ack'); } catch (_) {}
            }
            presenceFetch('/chat/seen', { session_id: chatSessionId });
        }

        function showStaffTypingPill() {
            if (!staffTypingPillNode) {
                staffTypingPillNode = document.createElement('div');
                staffTypingPillNode.className = 'osa-staff-typing-pill';
                staffTypingPillNode.setAttribute('aria-live', 'polite');
                staffTypingPillNode.innerHTML = '<span class="osa-staff-typing-pill__dots"><span></span><span></span><span></span></span><span class="osa-staff-typing-pill__text">OSA Staff is typing\u2026</span>';
                thread.appendChild(staffTypingPillNode);
            } else if (staffTypingPillNode.parentNode !== thread) {
                thread.appendChild(staffTypingPillNode);
            }
            scrollThread();
            if (staffTypingPillHideTimer) { window.clearTimeout(staffTypingPillHideTimer); }
            staffTypingPillHideTimer = window.setTimeout(hideStaffTypingPill, 4000);
        }

        function hideStaffTypingPill() {
            if (staffTypingPillHideTimer) {
                window.clearTimeout(staffTypingPillHideTimer);
                staffTypingPillHideTimer = null;
            }
            if (staffTypingPillNode && staffTypingPillNode.parentNode) {
                staffTypingPillNode.parentNode.removeChild(staffTypingPillNode);
            }
        }

        var delay = function (ms) { return new Promise(function (r) { window.setTimeout(r, reducedMotion ? 0 : ms); }); };

        // In-bubble typing indicator disabled per design — we no longer render
        // a fake assistant bubble with dots while waiting for a reply. The
        // staff typing pill (showStaffTypingPill) remains for realtime presence.
        function appendTypingIndicator() {
            return null;
        }

        function showTyping(reason) {
            return null;
        }

        function hideTyping(node, reason) {
            if (node && node.parentNode) {
                try { node.parentNode.removeChild(node); } catch (_) {}
            }
            // Defensive sweep: remove any stray typing bubbles left over from
            // a prior version of the widget cached in the user's browser.
            try {
                var orphans = thread.querySelectorAll('[data-osa-typing="1"]');
                for (var i = 0; i < orphans.length; i++) {
                    if (orphans[i].parentNode) {
                        orphans[i].parentNode.removeChild(orphans[i]);
                    }
                }
            } catch (_) {}
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
                        err.body = data;
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
                            err.body = data;
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

        function getGuestConvoId() {
            // Stable per browser tab/session so the AI can read prior turns
            // (chatbot_conversation_memory). sessionStorage clears when the
            // tab/window closes — matching "session-bound" memory: context-aware
            // within the visit, fresh start on next open.
            try {
                var existing = sessionStorage.getItem(GUEST_CONVO_KEY);
                if (existing) return existing;
                var fresh = 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                sessionStorage.setItem(GUEST_CONVO_KEY, fresh);
                return fresh;
            } catch (e) {
                return 'guest-' + Date.now();
            }
        }

        function clearGuestConvoId() {
            try { sessionStorage.removeItem(GUEST_CONVO_KEY); } catch (e) { }
        }

        function postChatbotApi(message) {
            var convoId = chatSessionId ? ('session-' + chatSessionId) : getGuestConvoId();
            return postApi('/chatbot/message', {
                message: String(message || ''),
                conversation_id: convoId
            }).then(function (payload) {
                var body = payload && payload.data ? payload.data : payload;
                var reply = String((body && (body.answer || body.response)) || '').trim();
                var escalate = !!(body && body.escalate);
                var otpAction = !!(body && body.otp_action);
                // Quota lives at top-level of the envelope (added by server middleware).
                if (payload && payload.quota) {
                    try { updateQuotaPill(payload.quota); } catch (_) {}
                }
                if (!reply) throw new Error('Empty chatbot response.');
                return { reply: reply, escalate: escalate, otpAction: otpAction, quota: payload && payload.quota };
            });
        }

        /** Renders guest /chatbot reply and optional Contact OSA card when server sets escalate. */
        function appendGuestChatbotTurn(chatbotResult) {
            var text = typeof chatbotResult === 'string'
                ? chatbotResult
                : String((chatbotResult && chatbotResult.reply) || '');
            var esc = chatbotResult && typeof chatbotResult === 'object' ? !!chatbotResult.escalate : false;
            var otpAction = chatbotResult && typeof chatbotResult === 'object' ? !!chatbotResult.otpAction : false;
            if (text) appendBubble('assistant', renderAssistantText(text));
            if (esc) {
                appendBubble('assistant',
                    '<details class="osa-ai-rich" open><summary>Contact OSA</summary>' +
                    '<p style="margin:0 0 8px">This topic needs staff confirmation. Verify your campus email here to continue in secure chat.</p>' +
                    '<div class="osa-ai-actions">' +
                    '<button type="button" class="osa-escalate-btn" data-osa-open-otp>Verify email &amp; escalate</button>' +
                    '</div></details>');
            }
            if (otpAction) {
                appendBubble('assistant',
                    '<details class="osa-ai-rich" open><summary>Verification</summary>' +
                    '<p style="margin:0 0 8px">' + (otpVerified && chatSessionId
                        ? 'Need to switch account? Request a new OTP below.'
                        : 'Need a fresh OTP code? Open the verification card below.') + '</p>' +
                    '<div class="osa-ai-actions">' +
                    '<button type="button" class="osa-escalate-btn" data-osa-open-otp>Get New OTP Code</button>' +
                    '</div></details>');
            }
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
            // Clear personalized identity so the next page load /
            // chat open doesn't keep showing "Hi, <Name>" for an
            // already-expired session.
            setLS(NAME_KEY, '');
            savedName = '';
            applyVerifiedHeader('');
            // Reset guest memory id so the next guest turn starts a fresh
            // context-aware conversation rather than inheriting OTP-era memory.
            clearGuestConvoId();
            // Preserve visible thread by default; chat history may still be useful.
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
                // Refresh the "Verified as <Name>" bar above Quick topics.
                updateVerifiedBar(String(getLS(NAME_KEY, '') || ''));
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
                // 10-minute session window is over — actually expire so the
                // header returns to "Ask OSA" and the next protected action
                // re-prompts for OTP. Without this, "Hi, <Name>" lingers
                // even though the session is no longer valid.
                stopSessionCountdown();
                timerEl.hidden = true;
                expireSecureSessionLocal();
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
        var statusLineEl = document.getElementById('osa-chat-status-line');
        var MODE_COPY = {
            faq:   { label: 'Guide', cls: 'osa-ai-mode--faq' },
            ai:    { label: 'OSA',   cls: 'osa-ai-mode--ai' },
            staff: { label: 'Staff', cls: 'osa-ai-mode--staff' }
        };
        var currentMode = 'ai';
        function setMode(next) {
            if (!modeBadgeEl) return;
            var target = MODE_COPY[next] || MODE_COPY.ai;
            modeBadgeEl.textContent = target.label;
            modeBadgeEl.className = 'osa-ai-mode ' + target.cls;
            currentMode = next;
            if (statusLineEl) {
                statusLineEl.textContent = next === 'staff' ? 'Live OSA Staff' : (next === 'faq' ? 'Guided Flow' : 'Ready');
                statusLineEl.classList.toggle('is-staff', next === 'staff');
            }
        }
        setMode('ai');

        // ── Scroll-to-bottom button ───────────────────────────────
        var scrollBtn = document.getElementById('osa-chat-scroll-bottom');
        function updateScrollBtn() {
            if (!scrollBtn || !thread) return;
            var nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
            scrollBtn.hidden = nearBottom;
        }
        if (thread) thread.addEventListener('scroll', function () {
            updateScrollBtn();
            debugLayoutOnScroll();
        });
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

        function parseStaffMessage(content, payload) {
            var raw = String(content || '').trim();
            if (!raw) return { label: '', text: '' };
            var staffLabel = 'OSA Staff';
            var withName = raw.match(/^\[OSA Staff\s*[·-]\s*([^\]]+)\]\s*/i);
            if (withName) {
                raw = raw.slice(withName[0].length).trim();
            }
            raw = raw.replace(/^\[OSA Staff Reply\s*[—-]\s*Case[^\]]+\]\s*/i, '').trim();
            raw = raw.replace(/\badmin user\b/gi, 'OSA Staff').trim();
            return { label: staffLabel, text: raw };
        }

        function parseStaffJoinText(content, staffName) {
            var raw = String(content || '').trim();
            if (!raw) raw = 'OSA Staff has joined the chat.';
            raw = raw.replace(/\badmin user\b/gi, 'OSA Staff');
            raw = raw.replace(/\bosa staff\s+osa staff\b/gi, 'OSA Staff');
            raw = raw.replace(/\s+/g, ' ').trim();
            if (/has joined the chat\.?$/i.test(raw)) {
                return 'OSA Staff has joined the chat.';
            }
            if (/joined the chat/i.test(raw)) {
                return 'OSA Staff has joined the chat.';
            }
            return 'OSA Staff has joined the chat.';
        }

        function simplifyEscalationQuestionnaire(text, payload) {
            var raw = String(text || '').trim();
            if (!raw) return raw;
            if (!(payload && payload.suggest_escalation)) return raw;
            var asksDetailedForm =
                /(purpose of your visit|preferred weekday|preferred time window|morning or afternoon|once i have this information)/i.test(raw);
            if (!asksDetailedForm) return raw;
            return [
                'I recommend escalating this to an OSA staff member.',
                '',
                'Please type your concern in one clear message, then tap **Escalate to OSA Staff**.'
            ].join('\n');
        }

        function collectEscalationRequirements(text) {
            var raw = String(text || '').trim();
            var lc = raw.toLowerCase();
            var hasAppointment = hasAppointmentIntent(raw);
            var hasLostFound = lc.indexOf('lost') >= 0 || lc.indexOf('found') >= 0 || lc.indexOf('claim') >= 0 || /\blf[-\s]?\d{3,6}\b/i.test(raw);
            // If the student already wrote a detailed message (≥50 chars), purpose is satisfied.
            var hasPurpose = raw.length >= 50 ||
                /(scholar|id card|good moral|conduct|enroll|registr|claim|lost|found|appointment|schedule|complaint|human|support|staff|concern|clearance|payment|bayad|grade|gwa|suspend|violas|cheat|plagiar|disciplin|appeal|harass|bully|misconduct|expel|probation|violation|uniform|absent|tardiness|document|certificate|medical|mental|health|org|club|tuition|refund|receipt|library|fine|thesis|diploma|tor|withdrawal|leave of absence|transfer)/i.test(raw);
            var hasDay = /(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri)/i.test(raw);
            var hasWindow = /(morning|afternoon)/i.test(raw);
            var hasLfDetail = /\blf[-\s]?\d{3,6}\b/i.test(raw) || raw.length >= 24;
            var missing = [];

            if (!hasPurpose) missing.push('purpose');
            if (hasAppointment) {
                if (!hasDay) missing.push('day');
                if (!hasWindow) missing.push('window');
            }
            if (hasLostFound && !hasLfDetail) {
                missing.push('lf_detail');
            }
            return {
                isAppointment: hasAppointment,
                isLostFound: hasLostFound,
                missing: missing,
                draft: raw
            };
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

                if (payload.type === 'staff_typing') {
                    if (window.__OSA_CHAT_DEBUG__) { try { console.debug('[osa-chat] sse:staff_typing'); } catch (_) {} }
                    showStaffTypingPill();
                    return;
                }
                if (payload.type === 'staff_typing_stop') {
                    if (window.__OSA_CHAT_DEBUG__) { try { console.debug('[osa-chat] sse:staff_typing_stop'); } catch (_) {} }
                    hideStaffTypingPill();
                    return;
                }
                if (payload.type === 'staff_seen') {
                    if (window.__OSA_CHAT_DEBUG__) { try { console.debug('[osa-chat] sse:staff_seen'); } catch (_) {} }
                    markAllUserBubblesAtLeast('seen');
                    return;
                }

                if (payload.type === 'staff_joined') {
                    clearWaitingBanner();
                    setMode('staff');
                    hideStaffTypingPill();
                    var joinText = parseStaffJoinText(payload.content, payload.staff_name);
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
                    setMode('staff');
                    hideStaffTypingPill();
                    // Staff just sent a reply — they obviously read what we sent.
                    markAllUserBubblesAtLeast('seen');
                    var parsedStaff = parseStaffMessage(payload.content, payload);
                    if (parsedStaff.text) {
                        appendBubble('assistant', renderAssistantText(parsedStaff.text), { rowClass: 'osa-ai-msg--staff', metaLabel: 'OSA Staff' });
                    }
                    // If the widget is open, ack the new staff message as seen too.
                    if (widget.classList.contains('is-open')) {
                        try { notifySeen(); } catch (_) {}
                    }

                    if (payload.session_closed) {
                        setMode('ai');
                        renderSystemBubble('This support session has been closed by OSA staff. You may open a new concern anytime.');
                        input.disabled = false;
                        input.placeholder = 'Aa';
                        sendBtn.disabled = !String(input.value || '').trim();
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
        //
        // The banner must ONLY appear when the ticket is genuinely waiting:
        //   - status === 'open' (no staff reply yet)               AND
        //   - appointment_status is NOT 'approved' or 'scheduled'  (for visits)
        // Otherwise (staff already engaged, or visit already approved/scheduled)
        // we still mark the widget as 'staff' mode (AI stays paused) but skip
        // the misleading "Waiting for OSA staff" banner — the conversation
        // history already shows the approved/scheduled bubbles, no need to
        // claim staff hasn't responded.
        function hydrateActiveTicketBanner() {
            if (!chatSessionId) return;
            getApi('/chat/session/' + encodeURIComponent(chatSessionId) + '/ticket')
                .then(function (res) {
                    if (!res || !res.ticket) return;
                    var ticket = res.ticket;
                    var apptStatus = String(ticket.appointment_status || '').toLowerCase();
                    var isApproved = apptStatus === 'approved' || apptStatus === 'scheduled';
                    var isStaffEngaged = String(ticket.status || '') === 'in_progress';

                    if (isApproved) {
                        // Visit is approved/scheduled — lock any stale day/time
                        // chips left in the restored thread so a re-tap can't
                        // post a duplicate "Preference saved" bubble.
                        lockVisitChipsInThread(ticket.case_id);
                    }

                    if (!isApproved && !isStaffEngaged) {
                        var startedAt = Date.parse(ticket.created_at) || Date.now();
                        renderWaitingBanner(ticket.case_id, startedAt, !!ticket.cancellable);
                    }
                    setMode('staff');
                })
                .catch(function () { /* non-fatal */ });
        }

        // Disable every visit-pref chip (Mon/Tue/.../Morning/Afternoon) for the
        // given case in the rendered thread. Used after the appointment is
        // approved/scheduled so a stale chip click is impossible. If caseId is
        // empty, lock all visit chips for any case currently in the thread.
        function lockVisitChipsInThread(caseId) {
            var sel = caseId
                ? '.osa-visit-appt-btn[data-visit-case="' + String(caseId).replace(/"/g, '\\"') + '"]'
                : '.osa-visit-appt-btn';
            var btns = thread.querySelectorAll(sel);
            for (var i = 0; i < btns.length; i++) {
                btns[i].disabled = true;
                btns[i].setAttribute('aria-disabled', 'true');
                btns[i].style.opacity = '0.5';
                btns[i].style.cursor = 'not-allowed';
            }
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

        function isOtpRequestIntent(message) {
            var text = String(message || '').toLowerCase();
            return text.indexOf('otp') >= 0 ||
                text.indexOf('one time password') >= 0 ||
                text.indexOf('one-time password') >= 0 ||
                text.indexOf('verification code') >= 0;
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
                    '<ul><li>Verify your campus email in this panel to book preferred day/time</li><li>OSA staff will confirm schedule in this same chat</li></ul>' +
                    '<div class="osa-ai-actions">' +
                    '<button type="button" class="osa-escalate-btn" data-osa-open-otp>Verify email in this chat</button>' +
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
                    if (digits.length < 5 || digits.length > 6) {
                        st.textContent = 'Enter the code from your email.';
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
                            // New OTP verification means fresh session + fresh chat.
                            setLS(THREAD_KEY, []);
                            restoreThread();
                            st.textContent = 'Verified.';
                            st.className = 'osa-ai-otp__status is-ok';
                            // Personalize header + welcome bubble with the
                            // student's name (bold) so the verification feels
                            // tied to *them*, not a generic system message.
                            applyVerifiedHeader(verifiedName);
                            var firstNameForGreeting = getFirstName(verifiedName) || 'there';
                            appendBubble(
                                'assistant',
                                '<p style="margin:0">Welcome, <strong>' + escapeHtml(firstNameForGreeting) +
                                '</strong>! Your session is verified \u2014 you can continue with protected actions like appointments, claims, and human escalation.</p>'
                            );
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

            // Confirm before requesting a new OTP while the student is still
            // in a verified session — re-verifying logs them out of the
            // current session and starts a fresh one.
            if (otpVerified && chatSessionId && isOtpRequestIntent(message) && !pendingOtpReverify) {
                var firstName = getFirstName(savedName) || getFirstName(getLS(NAME_KEY, '') || '') || 'student';
                input.value = '';
                appendBubble('user', '<p style="margin:0">' + escapeHtml(message) + '</p>');
                appendBubble(
                    'assistant',
                    '<details class="osa-ai-rich" open><summary>Confirm new OTP</summary>' +
                    '<p style="margin:0 0 8px">When requesting a new OTP, you, <strong>' + escapeHtml(firstName) +
                    '</strong>, will be automatically logged out of your current verified session. Do you want to continue?</p>' +
                    '<div class="osa-ai-actions">' +
                    '<button type="button" class="osa-escalate-btn" data-osa-confirm-otp-relogin>Yes, log me out &amp; send new OTP</button>' +
                    '<button type="button" class="osa-escalate-btn" data-osa-cancel-otp-relogin>Cancel</button>' +
                    '</div></details>'
                );
                pendingOtpReverifyMessage = message;
                sendBtn.disabled = false;
                input.focus();
                return;
            }

            lastEscalationDraft = message;
            var lastUserClientId = appendBubble('user', '<p style="margin:0">' + escapeHtml(message) + '</p>');
            input.value = '';
            sendBtn.disabled = true;
            // Stop the typing indicator on the staff side immediately on send,
            // and optimistically transition queued → sent → delivered so the
            // checkmarks animate naturally even before any reply lands.
            try { notifyTypingNow(true); } catch (_) {}
            if (lastUserClientId) {
                setBubbleStatus(lastUserClientId, 'sent');
                window.setTimeout(function () { setBubbleStatus(lastUserClientId, 'delivered'); }, 260);
            }

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

            // No local timeout gate here. Same browser user should not be
            // forced to re-verify OTP repeatedly by frontend timers.

            if (!chatSessionId && !needsProtected(message)) {
                var typingGuest = showTyping('guest-chatbot');
                try {
                    var guestReply = await postChatbotApi(message);
                    appendGuestChatbotTurn(guestReply);
                } catch (_guestErr) {
                    if (_guestErr && _guestErr.body && _guestErr.body.quota) {
                        try { updateQuotaPill(_guestErr.body.quota); } catch (_) {}
                    }
                    if (_guestErr && (_guestErr.code === 'DAILY_LIMIT_REACHED' || _guestErr.code === 'BURST_LIMIT_REACHED')) {
                        appendBubble('assistant', '<p style="margin:0">' + escapeHtml(_guestErr.message || 'You have reached your daily limit. Try again tomorrow.') + '</p>');
                    } else {
                        appendLocalAssistantReply(message, true);
                    }
                } finally {
                    hideTyping(typingGuest, 'guest-chatbot:finally');
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

            // Quick-pick: student says something L&F related but did not type a
            // specific LF-#### number → render a clickable list of currently
            // unclaimed items so they don't have to hunt for the number.
            if (!itemNumber && isLostFoundPickerIntent(message)) {
                var typingPicker = showTyping('lf-picker');
                try {
                    var pickerData = await getApi('/lost-found/items');
                    var allItems = (pickerData && Array.isArray(pickerData.data) ? pickerData.data : []);
                    var openItems = allItems.filter(function (it) {
                        return String((it && it.status) || '').toLowerCase() !== 'claimed';
                    });
                    appendBubble('assistant', lfPickerPanelHtml(openItems));
                } catch (_pickerErr) {
                    appendBubble('assistant', '<p style="margin:0">Could not load Lost &amp; Found items right now. Please try again or visit the <a href="/lost-and-found" target="_blank" rel="noopener">Lost &amp; Found page</a>.</p>');
                } finally {
                    hideTyping(typingPicker, 'lf-picker:finally');
                }
                sendBtn.disabled = false;
                input.focus();
                return;
            }

            if (itemNumber && message.toLowerCase().indexOf('claim') >= 0) {
                // Server is the single source of truth for L&F item validity.
                // The cached localStorage view (LF_KEY) is only used to enrich the
                // outgoing payload with a title hint when available, so the OSA
                // ticket has a friendlier label even before the server resolves
                // the canonical title from the DB.
                var cachedItem = getLostFoundItem(itemNumber) || {};
                var typingClaim = showTyping('claim-submit');
                try {
                    var claimRes = await postApi('/chat/claim', {
                        session_id: chatSessionId,
                        item_number: itemNumber,
                        item_title: cachedItem.title || ''
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
                    } else if (err && (err.code === 'LF_ITEM_NOT_FOUND' || err.status === 404)) {
                        appendBubble('assistant', '<p style="margin:0">' + escapeHtml(err.message || ('Item ' + itemNumber + ' was not found in Lost & Found.')) + '</p>');
                    } else if (err && (err.code === 'LF_ITEM_ALREADY_CLAIMED' || err.status === 409)) {
                        appendBubble('assistant', '<p style="margin:0">' + escapeHtml(err.message || ('Item ' + itemNumber + ' is already marked claimed.')) + '</p>');
                    } else {
                        appendBubble('assistant', '<p style="margin:0">Could not submit claim: ' + escapeHtml(err.message || 'Unknown error') + '</p>');
                    }
                } finally {
                    hideTyping(typingClaim, 'claim-submit:finally');
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

            // Explicit appointment/visit request: create a visit ticket and show preference panel.
            if (chatSessionId && !itemNumber && hasAppointmentIntent(message)) {
                var purposeText = message.length > 20 ? message : '';
                var typingVisit = showTyping('visit-submit');
                try {
                    var visitRes = await postApi('/chat/visit', {
                        session_id: chatSessionId,
                        purpose: purposeText,
                    });
                    if (visitRes && visitRes.code === 'VISIT_LOCKED_TODAY') {
                        appendBubble('assistant', renderAssistantText(visitRes.message || 'You already have an appointment request for today.'));
                    } else if (visitRes && visitRes.success) {
                        var visitText = String((visitRes && visitRes.assistant_message) || '').trim();
                        if (visitText) appendBubble('assistant', renderAssistantText(visitText));
                        var vid = String((visitRes && visitRes.case_id) || '').trim();
                        if (vid) {
                            renderWaitingBanner(vid, Date.now(), true);
                            setMode('staff');
                            appendBubble('assistant', visitPreferencePanelHtml(vid));
                        }
                    }
                } catch (err) {
                    if (err && (err.code === 'SESSION_EXPIRED' || err.status === 401)) {
                        expireSecureSessionLocal();
                        appendBubble('assistant', '<p style="margin:0">Your secure chat expired. Please verify your email again.</p>');
                        await injectOtp();
                    } else {
                        appendBubble('assistant', '<p style="margin:0">Could not submit visit request: ' + escapeHtml(err.message || 'Unknown error') + '</p>');
                    }
                } finally {
                    hideTyping(typingVisit, 'visit-submit:finally');
                }
                sendBtn.disabled = false;
                input.focus();
                return;
            }

            var typingAI = null;
            try {
                if (chatSessionId) {
                    typingAI = showTyping('secure-chat-message');
                    try {
                        var chatApiStartMs = Date.now();
                        var payload = await postApi('/chat/message', { session_id: chatSessionId, message: message });

                        // Update quota pill from the server-attached snapshot.
                        if (payload && payload.quota) {
                            try { updateQuotaPill(payload.quota); } catch (_) {}
                        }

                        // The AI tier has read our message and is replying; in
                        // human-mode the message is queued for staff and only
                        // reaches `delivered` until staff_seen arrives via SSE.
                        if (payload && !payload.human_mode) {
                            markAllUserBubblesAtLeast('seen');
                        } else if (payload && payload.human_mode && lastUserClientId) {
                            setBubbleStatus(lastUserClientId, 'delivered');
                        }

                        // Refresh the session-expiry countdown (server returns a
                        // fresh `session_expires_at` on every successful reply).
                        if (payload && payload.session_expires_at && !isOtpRequestIntent(message)) {
                            setLS(SESSION_EXP_KEY, payload.session_expires_at);
                            startSessionCountdown();
                        }
                        // Update header mode badge based on which tier answered.
                        if (payload && payload.human_mode) {
                            setMode('staff');
                            var humanTicketStatus = String((payload && payload.human_ticket_status) || '').toLowerCase();
                            if (payload.case_id && humanTicketStatus === 'open') {
                                var startAt = waitingState.startedAt || Date.now();
                                renderWaitingBanner(String(payload.case_id), startAt, waitingState.cancellable);
                            } else {
                                clearWaitingBanner();
                            }
                        }
                        else if (payload && payload.tier === 1) setMode('faq');
                        else setMode('ai');

                        var aiReply = String((payload && payload.reply) || '').trim();
                        aiReply = simplifyEscalationQuestionnaire(aiReply, payload);
                        if (aiReply) {
                            if (payload && (payload.appointment_locked_today || payload.escalation_blocked_resolved)) {
                                clearWaitingBanner();
                            }
                            if (payload && payload.human_mode) {
                                var parsedHuman = parseStaffMessage(aiReply, payload);
                                if (parsedHuman.text) {
                                    appendBubble('assistant', renderAssistantText(parsedHuman.text), { rowClass: 'osa-ai-msg--staff', metaLabel: 'OSA Staff' });
                                }
                            } else {
                                appendBubble('assistant', renderAssistantText(aiReply));
                            }
                            if (payload && payload.auto_escalated && payload.case_id && !(payload && payload.appointment_locked_today) && !(payload && payload.escalation_blocked_resolved)) {
                                renderWaitingBanner(String(payload.case_id), Date.now(), true);
                                setMode('staff');
                                appendBubble('assistant',
                                    '<div class="osa-ai-handoff">' +
                                    '<p style="margin:0 0 6px"><strong>Forwarded to OSA staff.</strong></p>' +
                                    '<p style="margin:0 0 6px">Case ID: <strong>' + escapeHtml(String(payload.case_id)) + '</strong></p>' +
                                    '<p style="margin:0 0 4px">Keep this chat open — an OSA staff member will reply <strong>right here</strong> once they pick up your case.</p>' +
                                    '<p style="margin:0;font-size:12px;color:#65574d">AI replies are paused for this case while staff handles it.</p>' +
                                    '</div>');
                                if (String((payload && payload.ticket_type) || '') === 'appointment') {
                                    appendBubble('assistant', visitPreferencePanelHtml(String(payload.case_id)));
                                }
                            }
                            if (payload && (payload.suggest_escalation || payload.escalate) && !(payload && payload.human_mode) && !(payload && payload.auto_escalated)) {
                                appendBubble('assistant',
                                    '<details class="osa-ai-rich" open><summary>Next steps</summary><ul><li>This concern may need staff review</li><li>Use this same chat to continue details</li><li>Escalate your concern to OSA staff below</li></ul><div class="osa-ai-actions"><button type="button" class="osa-escalate-btn">Escalate to OSA Staff</button></div></details>');
                            }
                            if (payload && payload.otp_action) {
                                appendBubble('assistant',
                                    '<details class="osa-ai-rich" open><summary>Verification</summary><p style="margin:0 0 8px">' + (otpVerified && chatSessionId ? 'Need to switch account? Request a new OTP below.' : 'Need a fresh OTP code? Use the verification card in this chat.') + '</p><div class="osa-ai-actions"><button type="button" class="osa-escalate-btn" data-osa-open-otp>Get New OTP Code</button></div></details>',
                                    { persist: false });
                            }
                        } else {
                            if (!(payload && payload.human_mode)) {
                                appendBubble('assistant', '<p style="margin:0">I did not receive a response. Please try again.</p>');
                            }
                        }
                    } finally {
                        hideTyping(typingAI, 'secure-chat-message:finally');
                        typingAI = null;
                    }
                } else {
                    appendBubble('assistant', '<p style="margin:0">Please verify your email first to continue secure AI chat.</p>');
                    await injectOtp();
                }
            } catch (_err) {
                hideTyping(typingAI, 'secure-chat-message:catch');
                if (_err && _err.body && _err.body.quota) {
                    try { updateQuotaPill(_err.body.quota); } catch (_) {}
                }
                if (_err && (_err.code === 'DAILY_LIMIT_REACHED' || _err.code === 'BURST_LIMIT_REACHED')) {
                    appendBubble('assistant', '<p style="margin:0">' + escapeHtml(_err.message || 'You have reached your daily limit. Try again tomorrow.') + '</p>');
                    sendBtn.disabled = false;
                    input.focus();
                    return;
                }
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
                                var chatbotRes = await postChatbotApi(message);
                                appendGuestChatbotTurn(chatbotRes);
                                liveFallbackWorked = true;
                            } catch (_chatbotErr) {
                                liveFallbackWorked = false;
                            }
                        }

                        if (!liveFallbackWorked) {
                            if (protectedIntent && hasAppointmentIntent(message)) {
                                try {
                                    var apptFallbackRes = await postChatbotApi(message);
                                    appendGuestChatbotTurn(apptFallbackRes);
                                    appendBubble(
                                        'assistant',
                                        '<details class="osa-ai-rich" open><summary>Appointment action</summary>' +
                                        '<p style="margin:0 0 8px">Continue in this chat: verify your email below, then submit your preferred day/time here.</p>' +
                                        '<div class="osa-ai-actions">' +
                                        '<button type="button" class="osa-escalate-btn" data-osa-open-otp>Verify email in this chat</button>' +
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

        // Manual "End session" — student can sign out of their verified
        // session at any time without waiting for the 10-minute timer.
        var endSessionBtn = document.getElementById('osa-chat-end-session');
        endSessionBtn && endSessionBtn.addEventListener('click', function () {
            if (!otpVerified && !chatSessionId) return;
            expireSecureSessionLocal();
            appendBubble(
                'assistant',
                '<p style="margin:0">You ended your verified session. Sensitive actions (claims, appointments, escalations) will need a fresh OTP next time.</p>'
            );
        });
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
        input.addEventListener('input', function () {
            var hasText = !!String(input.value || '').trim();
            sendBtn.disabled = !hasText;
            if (hasText) {
                try { notifyTyping(); } catch (_) {}
            } else {
                try { notifyTypingNow(true); } catch (_) {}
            }
        });
        input.addEventListener('blur', function () {
            try { notifyTypingNow(true); } catch (_) {}
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
                if (escBtn.getAttribute('data-osa-confirm-otp-relogin') != null) {
                    var hostDetails = escBtn.closest('details.osa-ai-rich');
                    if (hostDetails) {
                        var actionsRow = hostDetails.querySelector('.osa-ai-actions');
                        if (actionsRow) actionsRow.remove();
                        var summaryEl = hostDetails.querySelector('summary');
                        if (summaryEl) summaryEl.textContent = 'New OTP requested';
                    }
                    pendingOtpReverify = true;
                    try { expireSecureSessionLocal(); } catch (_e1) {}
                    appendBubble('assistant', '<p style="margin:0">You\'ve been logged out. Please verify your email below to get a new OTP.</p>');
                    var openedOtp = injectOtp();
                    if (openedOtp && typeof openedOtp.then === 'function') {
                        openedOtp.finally(function () { pendingOtpReverify = false; });
                    } else {
                        pendingOtpReverify = false;
                    }
                    pendingOtpReverifyMessage = '';
                    return;
                }
                if (escBtn.getAttribute('data-osa-cancel-otp-relogin') != null) {
                    var hostDetails2 = escBtn.closest('details.osa-ai-rich');
                    if (hostDetails2) {
                        var actionsRow2 = hostDetails2.querySelector('.osa-ai-actions');
                        if (actionsRow2) actionsRow2.remove();
                        var summaryEl2 = hostDetails2.querySelector('summary');
                        if (summaryEl2) summaryEl2.textContent = 'New OTP request cancelled';
                    }
                    pendingOtpReverifyMessage = '';
                    appendBubble('assistant', '<p style="margin:0">No worries — you\'re still verified. Just type your next question whenever you\'re ready.</p>');
                    return;
                }
                if (escBtn.getAttribute('data-osa-open-otp') != null) {
                    var otpWrap = thread.querySelector('.osa-ai-otp');
                    if (otpWrap) {
                        otpWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        var mailIn = otpWrap.querySelector('input[type="email"]');
                        if (mailIn) mailIn.focus();
                    } else {
                        injectOtp();
                    }
                    return;
                }

                // If this click came from the inline draft form, capture textarea value first.
                var draftWrapper = escBtn.closest('.osa-esc-draft-form');
                if (draftWrapper) {
                    var draftTa = draftWrapper.querySelector('.osa-esc-draft-ta');
                    var draftVal = draftTa ? String(draftTa.value || '').trim() : '';
                    if (draftVal) lastEscalationDraft = draftVal;
                }

                var escalationCheck = collectEscalationRequirements(lastEscalationDraft || input.value || '');
                if (escalationCheck.missing.length) {
                    var prefill = escapeHtml(lastEscalationDraft || '');
                    var hintParts = [];
                    if (escalationCheck.missing.indexOf('purpose') >= 0)
                        hintParts.push('purpose of your concern (e.g., scholarship appeal, ID replacement, clearance issue, violation)');
                    if (escalationCheck.missing.indexOf('day') >= 0)
                        hintParts.push('preferred weekday (Mon–Fri)');
                    if (escalationCheck.missing.indexOf('window') >= 0)
                        hintParts.push('preferred time window (Morning or Afternoon)');
                    if (escalationCheck.missing.indexOf('lf_detail') >= 0)
                        hintParts.push('Lost &amp; Found item number or full description');

                    var hintHtml = hintParts.map(function (h) { return '<li>' + h + '</li>'; }).join('');
                    removeDomEscalationDrafts();
                    appendBubble(
                        'assistant',
                        '<div class="osa-esc-draft-form">' +
                        '<p style="margin:0 0 6px;font-weight:600">Before escalation, include:</p>' +
                        '<ul style="margin:0 0 10px;padding-left:18px">' + hintHtml + '</ul>' +
                        '<textarea class="osa-esc-draft-ta" rows="3" ' +
                        'placeholder="Describe your concern in full detail (e.g., I am appealing a violation case, my student number is 20-12345, I need help with clearance…)">' +
                        prefill + '</textarea>' +
                        '<button class="osa-escalate-btn" style="margin-top:8px;width:100%">Submit &amp; Escalate to OSA Staff</button>' +
                        '</div>',
                        { persist: false }
                    );
                    return;
                }
                if (escBtn.disabled) return;
                escBtn.disabled = true;
                escBtn.textContent = 'Escalating…';
                submitEscalationFromWidget(postApi, appendBubble, chatSessionId, lastEscalationDraft, {
                    renderWaitingBanner: renderWaitingBanner,
                    setMode: setMode,
                    getApi: getApi
                });
                return;
            }

            var cancelEscBtn = ev.target && ev.target.closest && ev.target.closest('[data-osa-cancel-escalation]');
            if (cancelEscBtn && widget.contains(cancelEscBtn)) {
                ev.preventDefault();
                if (cancelEscBtn.disabled) return;
                cancelEscalation(waitingState.caseId);
                return;
            }

            // Quick-pick claim: clicking an item card auto-fires the claim flow
            // (no typing needed). Re-uses the same code path as a typed claim.
            var lfPickBtn = ev.target && ev.target.closest && ev.target.closest('.osa-lf-claim-btn');
            if (lfPickBtn && widget.contains(lfPickBtn)) {
                ev.preventDefault();
                if (lfPickBtn.disabled) return;
                var pickedNum = (lfPickBtn.getAttribute('data-lf-item') || '').trim();
                if (!pickedNum) return;
                lfPickBtn.disabled = true;
                lfPickBtn.style.opacity = '0.6';
                input.value = 'I want to claim ' + pickedNum;
                handleSend();
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

            var visitBtn = ev.target && ev.target.closest && ev.target.closest('.osa-visit-appt-btn');
            if (visitBtn && widget.contains(visitBtn)) {
                ev.preventDefault();
                var vcid = (visitBtn.getAttribute('data-visit-case') || '').trim();
                var vfield = (visitBtn.getAttribute('data-visit-field') || '').trim();
                var vval = (visitBtn.getAttribute('data-visit-value') || '').trim();
                if (!chatSessionId || !vcid || !vfield) return;
                var vbody = { session_id: chatSessionId, case_id: vcid };
                if (vfield === 'day') vbody.preferred_day = vval;
                else if (vfield === 'window') vbody.preferred_time_window = vval;
                postApi('/chat/visit/appointment-preference', vbody)
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
        window.addEventListener('beforeunload', function () {
            unlockPageScroll();
            stopSSE();
        });

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
