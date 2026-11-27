// The feedback form under the workspace. Sends only what is typed into it: no draft text, no account details.
(function () {
    const form = document.getElementById('feedbackForm');
    if (!form) return;
    const field = name => form.elements[name];
    const button = document.getElementById('feedbackSend');
    const status = document.getElementById('feedbackStatus');

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const typed = field('message').value;
        const message = typed.trim();
        if (message.length < 3) {
            status.textContent = 'Please write a few words about what happened.';
            field('message').focus();
            return;
        }
        button.disabled = true;
        status.textContent = 'Sending...';
        try {
            const base = typeof getBaseUrl === 'function' ? getBaseUrl() : '/api/v1';
            const response = await fetch(base + '/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: field('kind').value, message, email: field('email').value.trim(), website: field('website').value }),
                signal: AbortSignal.timeout(60000)
            });
            const result = await response.json().catch(() => ({}));
            if (response.status === 429) throw new Error('You have sent several messages. Please wait a few minutes and try again.');
            if (!response.ok || !result.success) throw new Error((result.error && result.error.message) || 'Your feedback was not sent. Please try again.');
            if (field('message').value === typed) field('message').value = ''; // keep anything typed while sending
            status.textContent = 'Thank you. Your feedback was sent.';
        } catch (error) {
            // the typed text stays in the box
            status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
                ? 'Could not reach the server. Your text is still here, so please try again.'
                : error.message;
        } finally {
            button.disabled = false;
        }
    });
})();
