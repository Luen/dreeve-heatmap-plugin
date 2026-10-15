const FETCH_TIMEOUT_MS = 60000
const CACHE_TTL_MS = 20 * 60 * 1000
const CURRENT_ROUTES_PATH = '/api/internal/heatmap/routes'
const CURRENT_TILES_PATH = '/api/internal/heatmap/tiles'
const ROUTES_SESSION_CACHE_KEY = 'routesCache'
const TILES_SESSION_CACHE_KEY = 'tilesCache'

/** @type {{ endpoint: string, etag: string, data: unknown, fetchedAt: number } | null} */
let routesMemoryCache = null
/** @type {{ endpoint: string, etag: string, data: unknown, fetchedAt: number } | null} */
let tilesMemoryCache = null

function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
        }),
    ])
}

function explainJsonParseFailure(rawBody, endpoint, requiredPath) {
    const sample = String(rawBody || '')
        .trimStart()
        .slice(0, 64)
    if (sample.startsWith('<!DOCTYPE') || sample.startsWith('<html')) {
        const versionHint =
            requiredPath === CURRENT_TILES_PATH
                ? 'Requires Dreeve v5.6.0+'
                : 'Requires Dreeve v5.3.0+'
        return (
            `Endpoint returned HTML instead of JSON (${endpoint}). ` +
            `${versionHint} and ${requiredPath}.`
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

function createJsonFetcher(cache) {
    async function readSessionCache(endpoint) {
        try {
            const stored = await chrome.storage.session.get(cache.sessionKey)
            const entry = stored?.[cache.sessionKey]
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
        cache.setMemory(entry)
        try {
            await chrome.storage.session.set({ [cache.sessionKey]: entry })
        } catch {
            // best-effort
        }
        return entry
    }

    async function resolveCachedEntry(endpoint) {
        const memoryCache = cache.getMemory()
        if (
            cacheMatchesEndpoint(memoryCache, endpoint) &&
            isFresh(memoryCache)
        ) {
            return memoryCache
        }
        const sessionEntry = await readSessionCache(endpoint)
        if (sessionEntry) {
            cache.setMemory(sessionEntry)
            return sessionEntry
        }
        return null
    }

    return async function fetchJson(endpoint, forceRefresh) {
        if (!forceRefresh) {
            const cached = await resolveCachedEntry(endpoint)
            if (cached) {
                return { ok: true, data: cached.data, fromCache: true }
            }
        }

        const headers = {}
        const memoryCache = cache.getMemory()
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
                    error: explainJsonParseFailure(
                        rawBody,
                        endpoint,
                        cache.requiredPath,
                    ),
                }
            }
        }

        await writeCaches(endpoint, data, etag)
        return { ok: true, data, fromCache: false }
    }
}

const fetchRoutesJson = createJsonFetcher({
    sessionKey: ROUTES_SESSION_CACHE_KEY,
    getMemory: () => routesMemoryCache,
    setMemory: (entry) => {
        routesMemoryCache = entry
    },
    requiredPath: CURRENT_ROUTES_PATH,
})

const fetchTilesJson = createJsonFetcher({
    sessionKey: TILES_SESSION_CACHE_KEY,
    getMemory: () => tilesMemoryCache,
    setMemory: (entry) => {
        tilesMemoryCache = entry
    },
    requiredPath: CURRENT_TILES_PATH,
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
        !message ||
        (message.type !== 'FETCH_ROUTES_JSON' &&
            message.type !== 'FETCH_TILES_JSON')
    ) {
        return undefined
    }

    const endpoint = String(message.endpoint || '').trim()
    if (!endpoint) {
        sendResponse({ ok: false, error: 'No endpoint configured.' })
        return true
    }

    const forceRefresh = Boolean(message.forceRefresh)
    const fetchJson =
        message.type === 'FETCH_TILES_JSON' ? fetchTilesJson : fetchRoutesJson

    ;(async () => {
        try {
            const result = await fetchJson(endpoint, forceRefresh)
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
