/**
 * Deferred chat widget: avoids loading/parsing widget JS until it is likely needed.
 * - With [data-chat-open]: IntersectionObserver on triggers OR first pointer/click on a trigger.
 * - Without triggers: requestIdleCallback (timeout) or load + delay fallback.
 */
(function () {
    'use strict';

    var cur = '';
    if (document.currentScript && document.currentScript.src) {
        cur = document.currentScript.src;
    } else {
        var nodes = document.getElementsByTagName('script');
        for (var i = nodes.length - 1; i >= 0; i--) {
            if (nodes[i].src && nodes[i].src.indexOf('osa-chat-loader') !== -1) {
                cur = nodes[i].src;
                break;
            }
        }
    }

    var widgetUrl = '/assets/js/osa-chat-widget.js?v=83';

    var done = false;

    function inject() {
        if (done) return;
        done = true;
        document.removeEventListener('pointerdown', onChatTriggerPointer, true);
        document.removeEventListener('click', onChatTriggerClick, true);
        var s = document.createElement('script');
        s.src = widgetUrl;
        s.async = false;
        document.head.appendChild(s);
    }

    function onChatTriggerPointer(ev) {
        if (done) return;
        var t = ev.target;
        if (t && t.closest && t.closest('[data-chat-open]')) {
            inject();
        }
    }

    function onChatTriggerClick(ev) {
        onChatTriggerPointer(ev);
    }

    function arm() {
        var triggers = document.querySelectorAll('[data-chat-open]');

        if (triggers.length) {
            if ('IntersectionObserver' in window) {
                var io = new IntersectionObserver(function (entries) {
                    for (var i = 0; i < entries.length; i++) {
                        if (entries[i].isIntersecting) {
                            io.disconnect();
                            inject();
                            return;
                        }
                    }
                }, { rootMargin: '200px 0px 240px 0px', threshold: 0.01 });
                triggers.forEach(function (t) {
                    io.observe(t);
                });
            }
            document.addEventListener('pointerdown', onChatTriggerPointer, true);
            document.addEventListener('click', onChatTriggerClick, true);
        } else {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(function () {
                    inject();
                }, { timeout: 5000 });
            } else {
                window.addEventListener('load', function () {
                    setTimeout(inject, 4000);
                });
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arm);
    } else {
        arm();
    }
})();
