const FETCH_TIMEOUT_MS = 60000
const LEGACY_ROUTES_PATH = /\/api\/heatmap\/routes\.json\/?$/i
const CURRENT_ROUTES_PATH = '/api/fragment/data/heatmap/routes'

function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
        }),
    ])
}

/**
 * Rewrite pre-v5.2.0 endpoint URLs saved in extension settings to the
 * cache-based fragment API introduced in dreeve v5.2.0.
 * Older dreeve versions are no longer supported.
 */
function resolveRoutesEndpoint(endpoint) {
    const trimmed = String(endpoint || '').trim()
    if (!trimmed) {
        return ''
    }

    try {
        const url = new URL(trimmed)
        if (LEGACY_ROUTES_PATH.test(url.pathname)) {
            url.pathname = CURRENT_ROUTES_PATH
            url.search = ''
            url.hash = ''
            return url.toString()
        }
    } catch {
        // Fall through and fetch the configured value as-is.
    }

    return trimmed
}

function explainJsonParseFailure(rawBody, endpoint) {
    const sample = String(rawBody || '')
        .trimStart()
        .slice(0, 64)
    if (sample.startsWith('<!DOCTYPE') || sample.startsWith('<html')) {
        return (
            `Endpoint returned HTML instead of JSON (${endpoint}). ` +
            `Requires dreeve v5.2.0+ and ${CURRENT_ROUTES_PATH}.`
        )
    }
    return `Endpoint response is not valid JSON (${endpoint}).`
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'FETCH_ROUTES_JSON') {
        return undefined
    }

    const endpoint = resolveRoutesEndpoint(message.endpoint)
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

            const rawBody = await response.text()
            try {
                const data = JSON.parse(rawBody)
                sendResponse({ ok: true, data })
            } catch {
                sendResponse({
                    ok: false,
                    error: explainJsonParseFailure(rawBody, endpoint),
                })
            }
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
