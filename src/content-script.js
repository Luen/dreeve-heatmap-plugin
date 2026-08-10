const STORAGE_KEYS = {
    endpoint: 'routesEndpoint',
    enabled: 'overlayEnabled',
    lineColor: 'lineColor',
    lineOpacity: 'lineOpacity',
    lineWidth: 'lineWidth',
    sportTypes: 'sportTypes',
}

const DEFAULT_SETTINGS = {
    [STORAGE_KEYS.endpoint]: '',
    [STORAGE_KEYS.enabled]: false,
    [STORAGE_KEYS.lineColor]: '#ff4500',
    [STORAGE_KEYS.lineOpacity]: 0.35,
    [STORAGE_KEYS.lineWidth]: 2,
    [STORAGE_KEYS.sportTypes]: [],
}

const OVERLAY_STATE = {
    active: false,
    lastError: '',
    routeCount: 0,
}

const BRIDGE_EVENT_REQUEST = 'STRAVA_OVERLAY_REQUEST'
const BRIDGE_EVENT_RESPONSE = 'STRAVA_OVERLAY_RESPONSE'
const BRIDGE_TIMEOUT_MS = 7000
const BRIDGE_TIMEOUT_ID_MS = 20000
const EXCLUDED_SPORT_TYPES = new Set(['VirtualRide', 'VirtualRun'])
const SPORT_CATEGORY_MAP = {
    Ride: new Set([
        'Ride',
        'EBikeRide',
        'GravelRide',
        'MountainBikeRide',
        'Handcycle',
        'Velomobile',
    ]),
    Walk: new Set(['Walk', 'Hike', 'Run', 'TrailRun']),
    Water: new Set([
        'Swim',
        'OpenWaterSwim',
        'Kayaking',
        'Canoeing',
        'Rowing',
        'StandUpPaddling',
        'Surfing',
        'Kitesurf',
        'Windsurf',
        'Sail',
    ]),
    Winter: new Set([
        'AlpineSki',
        'BackcountrySki',
        'NordicSki',
        'Snowboard',
        'Snowshoe',
        'IceSkate',
    ]),
}
let bridgeInjected = false

function isOsmIdEditorPage() {
    try {
        // iD boots on /id (often inside the /edit page iframe)
        return (
            window.location.hostname === 'www.openstreetmap.org' &&
            window.location.pathname.startsWith('/id')
        )
    } catch {
        return false
    }
}

function getBridgeScriptPath() {
    return isOsmIdEditorPage() ? 'src/page-bridge-id.js' : 'src/page-bridge.js'
}

function getBridgeTimeoutMs() {
    return isOsmIdEditorPage() ? BRIDGE_TIMEOUT_ID_MS : BRIDGE_TIMEOUT_MS
}

function getCategoryForSportType(sportType) {
    const normalizedType = String(sportType || '').trim()
    for (const [category, mappedTypes] of Object.entries(SPORT_CATEGORY_MAP)) {
        if (mappedTypes.has(normalizedType)) {
            return category
        }
    }
    return ''
}

function isSportTypeInSelectedCategories(sportType, selectedCategories) {
    const normalizedType = String(sportType || '').trim()
    if (!normalizedType) {
        return false
    }

    const directCategory = getCategoryForSportType(normalizedType)
    if (directCategory && selectedCategories.has(directCategory)) {
        return true
    }

    // Dev-friendly fallback logic for evolving Strava ride variants:
    // if user selected Ride, include any non-virtual *Ride type.
    if (
        selectedCategories.has('Ride') &&
        /Ride$/i.test(normalizedType) &&
        !EXCLUDED_SPORT_TYPES.has(normalizedType)
    ) {
        return true
    }

    return false
}

function parseSelectedCategories(rawValue) {
    const validCategories = new Set(Object.keys(SPORT_CATEGORY_MAP))
    const selected = new Set()

    if (!Array.isArray(rawValue)) {
        return selected
    }

    for (const value of rawValue) {
        const normalized = String(value).trim()
        if (!normalized) {
            continue
        }

        if (validCategories.has(normalized)) {
            selected.add(normalized)
        }
    }

    return selected
}

function normalizeStyle(style = {}) {
    const color = String(
        style.lineColor || DEFAULT_SETTINGS[STORAGE_KEYS.lineColor],
    ).trim()
    const lineColor = /^#[0-9a-fA-F]{6}$/.test(color)
        ? color
        : DEFAULT_SETTINGS[STORAGE_KEYS.lineColor]

    const opacity = Number(style.lineOpacity)
    const lineOpacity = Number.isFinite(opacity)
        ? Math.max(0.05, Math.min(1, opacity))
        : DEFAULT_SETTINGS[STORAGE_KEYS.lineOpacity]

    const width = Number(style.lineWidth)
    const lineWidth = Number.isFinite(width)
        ? Math.max(1, Math.min(12, width))
        : DEFAULT_SETTINGS[STORAGE_KEYS.lineWidth]

    return { lineColor, lineOpacity, lineWidth }
}

function buildStravaActivityUrl(activityId) {
    const raw = String(activityId || '').trim()
    const match = raw.match(/(\d+)/)
    if (!match) {
        return ''
    }
    return `https://www.strava.com/activities/${match[1]}`
}

function resolveActivityUrl(activityUrl, endpoint) {
    const raw = String(activityUrl || '').trim()
    if (!raw) {
        return ''
    }

    try {
        const endpointUrl = new URL(endpoint)
        // Legacy: /activity/activity-123.html
        // Current dreeve: /api/fragment/page/activity/activity-123
        const fragmentMatch = raw.match(
            /(?:^|\/)api\/fragment\/page\/activity\/([^/?#]+)/i,
        )
        if (fragmentMatch) {
            return `${endpointUrl.origin}/activities#/api/fragment/page/activity/${fragmentMatch[1]}`
        }
        if (raw.includes('/activity/')) {
            const activityPath = raw.startsWith('/') ? raw : `/${raw}`
            return `${endpointUrl.origin}/activities#${activityPath}`
        }
        return new URL(raw, endpoint).toString()
    } catch {
        return ''
    }
}

function normalizeRoutes(payload, filters = {}) {
    if (!Array.isArray(payload)) {
        throw new Error('Expected routes payload to be an array.')
    }

    const selectedCategories = parseSelectedCategories(filters.sportTypes)
    const shouldFilterByCategory = selectedCategories.size > 0
    const allCategories = Object.keys(SPORT_CATEGORY_MAP)
    const allCategoriesSelected = allCategories.every((category) =>
        selectedCategories.has(category),
    )
    const applyCategoryFilter = shouldFilterByCategory && !allCategoriesSelected

    const routes = []
    for (const item of payload) {
        if (!item || !Array.isArray(item.coordinates)) {
            continue
        }

        const sportType = String(item?.filterables?.sportType || '').trim()
        if (applyCategoryFilter && EXCLUDED_SPORT_TYPES.has(sportType)) {
            continue
        }
        if (
            applyCategoryFilter &&
            !isSportTypeInSelectedCategories(sportType, selectedCategories)
        ) {
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
            const activityId = String(item.id || '').trim()
            routes.push({
                id: activityId,
                points,
                metadata: {
                    activityId,
                    name: String(item.name || '').trim(),
                    startDate: String(item.startDate || '').trim(),
                    distance: String(item.distance || '').trim(),
                    sportType,
                    activityUrl: resolveActivityUrl(
                        item.activityUrl,
                        filters.endpoint,
                    ),
                    stravaUrl: buildStravaActivityUrl(activityId),
                },
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
    script.src = chrome.runtime.getURL(getBridgeScriptPath())
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
        }, getBridgeTimeoutMs())

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

async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(DEFAULT_SETTINGS, resolve)
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

    const settings = await getSettings()
    const payload = await fetchRoutes(endpoint)
    const routes = normalizeRoutes(payload, {
        sportTypes: settings[STORAGE_KEYS.sportTypes],
        endpoint,
    })
    if (!routes.length) {
        throw new Error('No valid routes found in endpoint response.')
    }

    const applyResult = await sendBridgeCommand({
        action: 'apply',
        routes,
        style: normalizeStyle({
            lineColor: settings[STORAGE_KEYS.lineColor],
            lineOpacity: settings[STORAGE_KEYS.lineOpacity],
            lineWidth: settings[STORAGE_KEYS.lineWidth],
        }),
    })
    if (!applyResult.ok) {
        throw new Error(applyResult.error || 'Could not apply overlay.')
    }

    OVERLAY_STATE.active = true
    OVERLAY_STATE.routeCount = routes.length
    return { ok: true, enabled: true, routeCount: routes.length }
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
    // Inject immediately: OSM must restore #id-container before iD boots;
    // MapLibre/Mapbox sites need early constructor hooks.
    injectBridgeScript()

    const settings = await getSettings()
    const endpoint = String(settings[STORAGE_KEYS.endpoint] || '').trim()
    const enabled = Boolean(settings[STORAGE_KEYS.enabled])
    if (enabled) {
        await handleApplyRequested(endpoint, true)
    }
})()
