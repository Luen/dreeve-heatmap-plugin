const FETCH_TIMEOUT_MS = 60000
const CACHE_TTL_MS = 20 * 60 * 1000
const CURRENT_ROUTES_PATH = '/api/internal/fragment/data/heatmap/routes'
const SESSION_CACHE_KEY = 'routesCache'

/** @type {{ endpoint: string, etag: string, data: unknown, fetchedAt: number } | null} */
let memoryCache = null

function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
        }),
    ])
}

function explainJsonParseFailure(rawBody, endpoint) {
    const sample = String(rawBody || '')
        .trimStart()
        .slice(0, 64)
    if (sample.startsWith('<!DOCTYPE') || sample.startsWith('<html')) {
        return (
            `Endpoint returned HTML instead of JSON (${endpoint}). ` +
            `Requires dreeve v5.3.0+ and ${CURRENT_ROUTES_PATH}.`
        )
    }
    return `Endpoint response is not valid JSON (${endpoint}).`
}

function isFresh(entry, now = Date.now()) {
    return (
        entry &&
        typeof entry.fetchedAt === 'number' &&
        now - entry.fetchedAt < CACHE_TTL_MS
    )
}

function cacheMatchesEndpoint(entry, endpoint) {
    return entry && entry.endpoint === endpoint && entry.data != null
}

async function readSessionCache(endpoint) {
    try {
        const stored = await chrome.storage.session.get(SESSION_CACHE_KEY)
        const entry = stored?.[SESSION_CACHE_KEY]
        if (cacheMatchesEndpoint(entry, endpoint) && isFresh(entry)) {
            return entry
        }
    } catch {
        // session storage may be unavailable in some contexts
    }
    return null
}

async function writeCaches(endpoint, data, etag) {
    const entry = {
        endpoint,
        etag: etag || '',
        data,
        fetchedAt: Date.now(),
    }
    memoryCache = entry
    try {
        await chrome.storage.session.set({ [SESSION_CACHE_KEY]: entry })
    } catch {
        // best-effort
    }
    return entry
}

async function resolveCachedEntry(endpoint) {
    if (cacheMatchesEndpoint(memoryCache, endpoint) && isFresh(memoryCache)) {
        return memoryCache
    }
    const sessionEntry = await readSessionCache(endpoint)
    if (sessionEntry) {
        memoryCache = sessionEntry
        return sessionEntry
    }
    return null
}

async function fetchRoutesJson(endpoint, forceRefresh) {
    if (!forceRefresh) {
        const cached = await resolveCachedEntry(endpoint)
        if (cached) {
            return { ok: true, data: cached.data, fromCache: true }
        }
    }

    const headers = {}
    const prior =
        (cacheMatchesEndpoint(memoryCache, endpoint) && memoryCache) ||
        (await readSessionCache(endpoint))
    if (prior?.etag && !forceRefresh) {
        headers['If-None-Match'] = prior.etag
    }

    const response = await withTimeout(
        fetch(endpoint, { method: 'GET', headers }),
        FETCH_TIMEOUT_MS,
    )

    if (response.status === 304 && prior?.data != null) {
        await writeCaches(
            endpoint,
            prior.data,
            prior.etag || response.headers.get('ETag') || '',
        )
        return { ok: true, data: prior.data, fromCache: true }
    }

    if (!response.ok) {
        return {
            ok: false,
            error: `Endpoint returned ${response.status} ${response.statusText}.`,
        }
    }

    const etag = response.headers.get('ETag') || ''
    const contentType = String(response.headers.get('Content-Type') || '')

    let data
    if (contentType.includes('application/json')) {
        try {
            data = await response.json()
        } catch {
            return {
                ok: false,
                error: `Endpoint response is not valid JSON (${endpoint}).`,
            }
        }
    } else {
        const rawBody = await response.text()
        try {
            data = JSON.parse(rawBody)
        } catch {
            return {
                ok: false,
                error: explainJsonParseFailure(rawBody, endpoint),
            }
        }
    }

    await writeCaches(endpoint, data, etag)
    return { ok: true, data, fromCache: false }
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

    const forceRefresh = Boolean(message.forceRefresh)

    ;(async () => {
        try {
            const result = await fetchRoutesJson(endpoint, forceRefresh)
            sendResponse(result)
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
