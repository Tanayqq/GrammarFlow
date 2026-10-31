/* Basic consent: no Google requests until visitors opt in. Never send draft data. */
document.addEventListener('DOMContentLoaded', () => {
    const measurementId = 'G-WPV2KNM8RV'; // Public GA4 measurement ID, not a secret.
    const key = 'gf_analytics_consent';
    const banner = document.getElementById('analyticsConsent');
    let consent;
    let started = false;
    try { consent = localStorage.getItem(key); } catch (_) {}
    const denied = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
    const track = (name, parameters = {}) => {
        if (consent === 'accepted' && started) window.gtag('event', name, parameters);
    };
    function start() {
        if (started) return;
        started = true;
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('consent', 'default', { ...denied, analytics_storage: 'granted' });
        window.gtag('js', new Date());
        window.gtag('config', measurementId, {
            send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
            page_location: location.origin + '/', page_referrer: '', page_title: 'GrammarFlow'
        });
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
        document.head.appendChild(script);
        track('page_view', { page_location: location.origin + '/', page_referrer: '', page_title: 'GrammarFlow' });
    }
    function choose(value) {
        consent = value;
        try { localStorage.setItem(key, value); } catch (_) {}
        banner.hidden = true;
        if (value === 'accepted') start();
        else if (started) {
            window['ga-disable-' + measurementId] = true;
            window.gtag('consent', 'update', { ...denied, analytics_storage: 'denied' });
            // Reload stops the already-loaded Google script after consent is withdrawn.
            location.reload();
        }
    }
    document.getElementById('acceptAnalyticsBtn').onclick = () => choose('accepted');
    document.getElementById('declineAnalyticsBtn').onclick = () => choose('declined');
    document.getElementById('analyticsPreferencesBtn').onclick = () => { banner.hidden = false; };
    const features = {
        fixGrammarBtn: 'grammar', rewriteBtn: 'rewrite', processDocumentBtn: 'document',
        expandFlowBtn: 'focus', applySuggestionBtn: 'apply_suggestion', downloadPdfBtn: 'export_pdf'
    };
    for (const [id, feature] of Object.entries(features)) {
        document.getElementById(id).addEventListener('click', () => track('feature_clicked', { feature }));
    }
    if (consent === 'accepted') start();
    banner.hidden = consent === 'accepted' || consent === 'declined';
});
