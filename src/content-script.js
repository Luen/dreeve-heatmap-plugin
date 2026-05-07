const STORAGE_KEYS = {
    endpoint: 'routesEndpoint',
    enabled: 'overlayEnabled',
}

const OVERLAY_STATE = {
    active: false,
    lastError: '',
    routeCount: 0,
}

const BRIDGE_EVENT_REQUEST = 'STRAVA_OVERLAY_REQUEST'
const BRIDGE_EVENT_RESPONSE = 'STRAVA_OVERLAY_RESPONSE'
const BRIDGE_TIMEOUT_MS = 7000
let bridgeInjected = false

function normalizeRoutes(payload) {
    if (!Array.isArray(payload)) {
        throw new Error('Expected routes payload to be an array.')
    }

    const routes = []
    for (const item of payload) {
        if (!item || !Array.isArray(item.coordinates)) {
            continue
        }

        const points = item.coordinates
            .filter(
                (pair) =>
                    Array.isArray(pair) &&
                    pair.length >= 2 &&
                    Number.isFinite(pair[0]) &&
                    Number.isFinite(pair[1]),
            )
            .map((pair) => [pair[0], pair[1]])

        if (points.length >= 2) {
            routes.push({
                id: item.id || '',
                points,
            })
        }
    }

    return routes
}

function injectBridgeScript() {
    if (bridgeInjected) {
        return
    }
    bridgeInjected = true

    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('src/page-bridge.js')
    script.async = false
    ;(document.documentElement || document.head || document.body).appendChild(
        script,
    )
    script.remove()
}

function sendBridgeCommand(payload) {
    return new Promise((resolve) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
        let done = false

        const onResponse = (event) => {
            const detail = event.detail || {}
            if (detail.requestId !== requestId || done) {
                return
            }
            done = true
            clearTimeout(timer)
            window.removeEventListener(BRIDGE_EVENT_RESPONSE, onResponse)
            resolve(detail)
        }

        const timer = window.setTimeout(() => {
            if (done) {
                return
            }
            done = true
            window.removeEventListener(BRIDGE_EVENT_RESPONSE, onResponse)
            resolve({
                ok: false,
                error: 'Map bridge timed out waiting for page response.',
            })
        }, BRIDGE_TIMEOUT_MS)

        window.addEventListener(BRIDGE_EVENT_RESPONSE, onResponse)
        window.dispatchEvent(
            new CustomEvent(BRIDGE_EVENT_REQUEST, {
                detail: { ...payload, requestId },
            }),
        )
    })
}

async function fetchRoutes(endpoint) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'FETCH_ROUTES_JSON', endpoint },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message))
                    return
                }
                if (!response || !response.ok) {
                    reject(
                        new Error(response?.error || 'Failed to fetch routes.'),
                    )
                    return
                }
                resolve(response.data)
            },
        )
    })
}

async function applyOverlay({ endpoint, enabled }) {
    injectBridgeScript()

    if (!enabled) {
        const disableResult = await sendBridgeCommand({ action: 'disable' })
        if (!disableResult.ok) {
            throw new Error(disableResult.error || 'Failed to disable overlay.')
        }
        OVERLAY_STATE.active = false
        OVERLAY_STATE.routeCount = 0
        return { ok: true, enabled: false, routeCount: 0 }
    }

    if (!endpoint) {
        throw new Error('Set a routes endpoint in the extension popup first.')
    }

    const payload = await fetchRoutes(endpoint)
    const routes = normalizeRoutes(payload)
    if (!routes.length) {
        throw new Error('No valid routes found in endpoint response.')
    }

    const applyResult = await sendBridgeCommand({ action: 'apply', routes })
    if (!applyResult.ok) {
        throw new Error(applyResult.error || 'Could not apply overlay.')
    }

    OVERLAY_STATE.active = true
    OVERLAY_STATE.routeCount = routes.length
    return { ok: true, enabled: true, routeCount: routes.length }
}

async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(
            {
                [STORAGE_KEYS.endpoint]: '',
                [STORAGE_KEYS.enabled]: false,
            },
            resolve,
        )
    })
}

async function handleApplyRequested(endpoint, enabled) {
    try {
        const result = await applyOverlay({ endpoint, enabled })
        OVERLAY_STATE.lastError = ''
        return result
    } catch (error) {
        OVERLAY_STATE.lastError =
            error instanceof Error ? error.message : 'Overlay failed.'
        OVERLAY_STATE.active = false
        OVERLAY_STATE.routeCount = 0
        return { ok: false, error: OVERLAY_STATE.lastError }
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'APPLY_OVERLAY') {
        return undefined
    }

    handleApplyRequested(
        Boolean(message.endpoint) ? message.endpoint : '',
        Boolean(message.enabled),
    ).then((result) => sendResponse(result))
    return true
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'GET_OVERLAY_STATUS') {
        return undefined
    }

    sendResponse({
        ok: true,
        active: OVERLAY_STATE.active,
        routeCount: OVERLAY_STATE.routeCount,
        error: OVERLAY_STATE.lastError,
    })
    return false
})

;(async () => {
    injectBridgeScript()
    const settings = await getSettings()
    const endpoint = String(settings[STORAGE_KEYS.endpoint] || '').trim()
    const enabled = Boolean(settings[STORAGE_KEYS.enabled])
    if (enabled) {
        await handleApplyRequested(endpoint, true)
    }
})()
