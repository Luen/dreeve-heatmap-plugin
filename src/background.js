const FETCH_TIMEOUT_MS = 20000

function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
        }),
    ])
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'FETCH_ROUTES_JSON') {
        return undefined
    }

    const endpoint = String(message.endpoint || '').trim()
    if (!endpoint) {
        sendResponse({ ok: false, error: 'No endpoint configured.' })
        return true
    }

    ;(async () => {
        try {
            const response = await withTimeout(
                fetch(endpoint, { method: 'GET', cache: 'no-store' }),
                FETCH_TIMEOUT_MS,
            )

            if (!response.ok) {
                sendResponse({
                    ok: false,
                    error: `Endpoint returned ${response.status} ${response.statusText}.`,
                })
                return
            }

            const data = await response.json()
            sendResponse({ ok: true, data })
        } catch (error) {
            sendResponse({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Unknown fetch error.',
            })
        }
    })()

    return true
})
