;(() => {
    if (globalThis.__DREEVE_HEATMAP_CONTENT_SCRIPT__) {
        return
    }
    globalThis.__DREEVE_HEATMAP_CONTENT_SCRIPT__ = true

    const STORAGE_KEYS = {
        endpoint: 'routesEndpoint',
        enabled: 'overlayEnabled',
        lineColor: 'lineColor',
        lineOpacity: 'lineOpacity',
        lineWidth: 'lineWidth',
        sportTypes: 'sportTypes',
        showRoutes: 'showRoutes',
        showTiles: 'showTiles',
    }

    const CURRENT_ROUTES_PATH = '/api/internal/heatmap/routes'
    const CURRENT_TILES_PATH = '/api/internal/heatmap/tiles'

    const DEFAULT_SETTINGS = {
        [STORAGE_KEYS.endpoint]: '',
        [STORAGE_KEYS.enabled]: false,
        [STORAGE_KEYS.lineColor]: '#ff4500',
        [STORAGE_KEYS.lineOpacity]: 0.35,
        [STORAGE_KEYS.lineWidth]: 2,
        [STORAGE_KEYS.sportTypes]: [],
        [STORAGE_KEYS.showRoutes]: true,
        [STORAGE_KEYS.showTiles]: true,
    }

    const OVERLAY_STATE = {
        active: false,
        lastError: '',
        routeCount: 0,
        tileCount: 0,
        endpoint: '',
        sportTypesKey: '',
        showRoutes: true,
        showTiles: true,
        style: null,
        tilesWarning: '',
    }

    const BRIDGE_EVENT_REQUEST = 'STRAVA_OVERLAY_REQUEST'
    const BRIDGE_EVENT_RESPONSE = 'STRAVA_OVERLAY_RESPONSE'
    const BRIDGE_TIMEOUT_MS = 7000
    const BRIDGE_TIMEOUT_ID_MS = 20000
    const NORMALIZE_CHUNK_SIZE = 40
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
        return isOsmIdEditorPage()
            ? 'src/page-bridge-id.js'
            : 'src/page-bridge.js'
    }

    function getBridgeTimeoutMs() {
        return isOsmIdEditorPage() ? BRIDGE_TIMEOUT_ID_MS : BRIDGE_TIMEOUT_MS
    }

    function getCategoryForSportType(sportType) {
        const normalizedType = String(sportType || '').trim()
        for (const [category, mappedTypes] of Object.entries(
            SPORT_CATEGORY_MAP,
        )) {
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

    function sportTypesKey(rawValue) {
        return [...parseSelectedCategories(rawValue)].sort().join(',')
    }

    function stylesEqual(a, b) {
        if (!a || !b) {
            return false
        }
        return (
            a.lineColor === b.lineColor &&
            a.lineOpacity === b.lineOpacity &&
            a.lineWidth === b.lineWidth
        )
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
            // Current Dreeve: /api/fragment/page/activity/activity-123
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

    function yieldToMain() {
        return new Promise((resolve) => {
            setTimeout(resolve, 0)
        })
    }

    /**
     * Normalize API routes once into GeoJSON-ready [lng, lat] points.
     * Yields periodically so large payloads do not freeze the content script.
     */
    async function normalizeRoutes(payload, filters = {}) {
        if (!Array.isArray(payload)) {
            throw new Error('Expected routes payload to be an array.')
        }

        const selectedCategories = parseSelectedCategories(filters.sportTypes)
        const shouldFilterByCategory = selectedCategories.size > 0
        const allCategories = Object.keys(SPORT_CATEGORY_MAP)
        const allCategoriesSelected = allCategories.every((category) =>
            selectedCategories.has(category),
        )
        const applyCategoryFilter =
            shouldFilterByCategory && !allCategoriesSelected

        const routes = []
        for (let index = 0; index < payload.length; index += 1) {
            if (index > 0 && index % NORMALIZE_CHUNK_SIZE === 0) {
                await yieldToMain()
            }

            const item = payload[index]
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

            const coordinates = item.coordinates
            const points = []
            for (let i = 0; i < coordinates.length; i += 1) {
                const pair = coordinates[i]
                if (
                    !Array.isArray(pair) ||
                    pair.length < 2 ||
                    !Number.isFinite(pair[0]) ||
                    !Number.isFinite(pair[1])
                ) {
                    continue
                }
                // API is [lat, lng]; emit GeoJSON [lng, lat] once.
                points.push([pair[1], pair[0]])
            }

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

    function injectPageScript(path) {
        const script = document.createElement('script')
        script.src = chrome.runtime.getURL(path)
        script.async = false
        ;(
            document.documentElement ||
            document.head ||
            document.body
        ).appendChild(script)
        script.remove()
    }

    function injectBridgeScript() {
        if (bridgeInjected) {
            return
        }
        bridgeInjected = true

        if (!isOsmIdEditorPage()) {
            injectPageScript('src/explorer-tiles.js')
        }
        injectPageScript(getBridgeScriptPath())
    }

    function deriveTilesEndpoint(routesEndpoint) {
        const endpoint = String(routesEndpoint || '').trim()
        if (!endpoint.includes(CURRENT_ROUTES_PATH)) {
            return null
        }
        return endpoint.split(CURRENT_ROUTES_PATH).join(CURRENT_TILES_PATH)
    }

    function toActivityTileKey(activityId) {
        const raw = String(activityId || '').trim()
        if (!raw) {
            return ''
        }
        if (raw.startsWith('activity-')) {
            return raw
        }
        const match = raw.match(/(\d+)/)
        return match ? `activity-${match[1]}` : raw
    }

    function collectTileIdsForRoutes(tilesPayload, routes) {
        if (!tilesPayload || typeof tilesPayload !== 'object') {
            return []
        }
        const visited = new Set()
        for (const route of routes) {
            const key = toActivityTileKey(
                route?.metadata?.activityId || route?.id || '',
            )
            if (!key) {
                continue
            }
            const ids = tilesPayload[key]
            if (!Array.isArray(ids)) {
                continue
            }
            for (const id of ids) {
                const tileId = Number(id)
                if (Number.isFinite(tileId)) {
                    visited.add(tileId)
                }
            }
        }
        return [...visited]
    }

    function readVisibilityFlags(settings, isOsm) {
        const showRoutes = settings[STORAGE_KEYS.showRoutes] !== false
        const showTiles = !isOsm && settings[STORAGE_KEYS.showTiles] !== false
        return { showRoutes, showTiles }
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

    function fetchJsonMessage(type, endpoint, forceRefresh = false) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type, endpoint, forceRefresh },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message))
                        return
                    }
                    if (!response || !response.ok) {
                        reject(
                            new Error(
                                response?.error || `Failed to fetch (${type}).`,
                            ),
                        )
                        return
                    }
                    resolve(response.data)
                },
            )
        })
    }

    async function fetchRoutes(endpoint, forceRefresh = false) {
        return fetchJsonMessage('FETCH_ROUTES_JSON', endpoint, forceRefresh)
    }

    async function fetchTiles(endpoint, forceRefresh = false) {
        return fetchJsonMessage('FETCH_TILES_JSON', endpoint, forceRefresh)
    }

    async function getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(DEFAULT_SETTINGS, resolve)
        })
    }

    function rememberAppliedState({
        endpoint,
        sportTypes,
        style,
        routeCount,
        tileCount,
        showRoutes,
        showTiles,
        tilesWarning,
    }) {
        OVERLAY_STATE.active = true
        OVERLAY_STATE.routeCount = routeCount
        OVERLAY_STATE.tileCount = tileCount
        OVERLAY_STATE.endpoint = endpoint
        OVERLAY_STATE.sportTypesKey = sportTypesKey(sportTypes)
        OVERLAY_STATE.style = style
        OVERLAY_STATE.showRoutes = showRoutes
        OVERLAY_STATE.showTiles = showTiles
        OVERLAY_STATE.tilesWarning = tilesWarning || ''
    }

    function clearAppliedState() {
        OVERLAY_STATE.active = false
        OVERLAY_STATE.routeCount = 0
        OVERLAY_STATE.tileCount = 0
        OVERLAY_STATE.endpoint = ''
        OVERLAY_STATE.sportTypesKey = ''
        OVERLAY_STATE.style = null
        OVERLAY_STATE.showRoutes = true
        OVERLAY_STATE.showTiles = true
        OVERLAY_STATE.tilesWarning = ''
    }

    async function applyOverlay({ endpoint, enabled, forceRefresh = false }) {
        injectBridgeScript()

        if (!enabled) {
            const disableResult = await sendBridgeCommand({ action: 'disable' })
            if (!disableResult.ok) {
                throw new Error(
                    disableResult.error || 'Failed to disable overlay.',
                )
            }
            clearAppliedState()
            return { ok: true, enabled: false, routeCount: 0, tileCount: 0 }
        }

        if (!endpoint) {
            throw new Error(
                'Set a routes endpoint in the extension popup first.',
            )
        }

        const settings = await getSettings()
        const isOsm = isOsmIdEditorPage()
        const { showRoutes, showTiles } = readVisibilityFlags(settings, isOsm)
        const style = normalizeStyle({
            lineColor: settings[STORAGE_KEYS.lineColor],
            lineOpacity: settings[STORAGE_KEYS.lineOpacity],
            lineWidth: settings[STORAGE_KEYS.lineWidth],
        })
        const nextSportKey = sportTypesKey(settings[STORAGE_KEYS.sportTypes])
        const geometryUnchanged =
            OVERLAY_STATE.active &&
            OVERLAY_STATE.endpoint === endpoint &&
            OVERLAY_STATE.sportTypesKey === nextSportKey &&
            OVERLAY_STATE.showRoutes === showRoutes &&
            OVERLAY_STATE.showTiles === showTiles

        if (geometryUnchanged && !forceRefresh) {
            if (stylesEqual(style, OVERLAY_STATE.style)) {
                return {
                    ok: true,
                    enabled: true,
                    routeCount: OVERLAY_STATE.routeCount,
                    tileCount: OVERLAY_STATE.tileCount,
                    tilesWarning: OVERLAY_STATE.tilesWarning,
                }
            }

            const styleResult = await sendBridgeCommand({
                action: 'updateStyle',
                style,
            })
            if (styleResult.ok) {
                OVERLAY_STATE.style = style
                return {
                    ok: true,
                    enabled: true,
                    routeCount: OVERLAY_STATE.routeCount,
                    tileCount: OVERLAY_STATE.tileCount,
                    tilesWarning: OVERLAY_STATE.tilesWarning,
                }
            }
            // Fall through to full apply if bridge does not support updateStyle yet.
        }

        if (!showRoutes && !showTiles) {
            const disableResult = await sendBridgeCommand({ action: 'disable' })
            if (!disableResult.ok) {
                throw new Error(
                    disableResult.error || 'Failed to clear overlay.',
                )
            }
            rememberAppliedState({
                endpoint,
                sportTypes: settings[STORAGE_KEYS.sportTypes],
                style,
                routeCount: 0,
                tileCount: 0,
                showRoutes,
                showTiles,
                tilesWarning: '',
            })
            return {
                ok: true,
                enabled: true,
                routeCount: 0,
                tileCount: 0,
                tilesWarning: '',
            }
        }

        const payload = await fetchRoutes(endpoint, forceRefresh)
        const routes = await normalizeRoutes(payload, {
            sportTypes: settings[STORAGE_KEYS.sportTypes],
            endpoint,
        })

        let tileIds = []
        let tilesWarning = ''
        if (showTiles) {
            const tilesEndpoint = deriveTilesEndpoint(endpoint)
            if (!tilesEndpoint) {
                tilesWarning = `Could not derive tiles URL (expected ${CURRENT_ROUTES_PATH}).`
            } else {
                try {
                    const tilesPayload = await fetchTiles(
                        tilesEndpoint,
                        forceRefresh,
                    )
                    tileIds = collectTileIdsForRoutes(tilesPayload, routes)
                } catch (error) {
                    tilesWarning =
                        error instanceof Error
                            ? `${error.message} Explorer tiles require Dreeve v5.6.0+ (${CURRENT_TILES_PATH}).`
                            : `Explorer tiles require Dreeve v5.6.0+ (${CURRENT_TILES_PATH}).`
                }
            }
        }

        const routesToDraw = showRoutes ? routes : []
        if (
            showRoutes &&
            !routesToDraw.length &&
            !(showTiles && tileIds.length)
        ) {
            throw new Error('No valid routes found in endpoint response.')
        }
        if (
            !routesToDraw.length &&
            showTiles &&
            !tileIds.length &&
            !tilesWarning
        ) {
            throw new Error(
                'No explorer tiles found for the selected activities.',
            )
        }
        if (
            !routesToDraw.length &&
            showTiles &&
            !tileIds.length &&
            tilesWarning
        ) {
            throw new Error(tilesWarning)
        }

        // OSM iD: routes only; ignore tiles payload.
        const applyResult = await sendBridgeCommand({
            action: 'apply',
            routes: routesToDraw,
            tileIds: isOsm ? [] : tileIds,
            showRoutes,
            showTiles: isOsm ? false : showTiles,
            style,
        })
        if (!applyResult.ok) {
            throw new Error(applyResult.error || 'Could not apply overlay.')
        }

        rememberAppliedState({
            endpoint,
            sportTypes: settings[STORAGE_KEYS.sportTypes],
            style,
            routeCount: routesToDraw.length,
            tileCount: tileIds.length,
            showRoutes,
            showTiles,
            tilesWarning,
        })
        return {
            ok: true,
            enabled: true,
            routeCount: routesToDraw.length,
            tileCount: tileIds.length,
            tilesWarning,
        }
    }

    async function handleApplyRequested(
        endpoint,
        enabled,
        forceRefresh = false,
    ) {
        try {
            const result = await applyOverlay({
                endpoint,
                enabled,
                forceRefresh,
            })
            OVERLAY_STATE.lastError = ''
            return result
        } catch (error) {
            OVERLAY_STATE.lastError =
                error instanceof Error ? error.message : 'Overlay failed.'
            clearAppliedState()
            return { ok: false, error: OVERLAY_STATE.lastError }
        }
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== 'APPLY_OVERLAY') {
            return undefined
        }

        handleApplyRequested(
            message.endpoint ? message.endpoint : '',
            Boolean(message.enabled),
            Boolean(message.forceRefresh),
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
            tileCount: OVERLAY_STATE.tileCount,
            tilesWarning: OVERLAY_STATE.tilesWarning,
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
            await handleApplyRequested(endpoint, true, false)
        }
    })()
})()
