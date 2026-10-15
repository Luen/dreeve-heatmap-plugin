;(function () {
    const STATE = {
        map: null,
        ready: false,
        overlayApplied: false,
        activePopupEl: null,
        activeTooltipEl: null,
        clickHandler: null,
        mapClickHandler: null,
        mouseEnterHandler: null,
        mouseLeaveHandler: null,
        mouseMoveHandler: null,
        style: null,
        showRoutes: true,
        showTiles: true,
    }

    const SOURCE_ID = 'strava-routes-source'
    const LAYER_ID = 'strava-routes-layer'
    const HITBOX_LAYER_ID = 'strava-routes-hitbox-layer'
    const TILES_SOURCE_ID = 'strava-tiles-source'
    const TILES_MAX_SQUARE_SOURCE_ID = 'strava-tiles-max-square-source'
    const TILES_VISITED_FILL_ID = 'strava-tiles-visited-fill'
    const TILES_VISITED_LINE_ID = 'strava-tiles-visited-line'
    const TILES_CLUSTER_FILL_ID = 'strava-tiles-cluster-fill'
    const TILES_CLUSTER_LINE_ID = 'strava-tiles-cluster-line'
    const TILES_MAX_CLUSTER_FILL_ID = 'strava-tiles-max-cluster-fill'
    const TILES_MAX_CLUSTER_LINE_ID = 'strava-tiles-max-cluster-line'
    const TILES_MAX_SQUARE_LINE_ID = 'strava-tiles-max-square-line'
    const TILE_LAYER_IDS = [
        TILES_VISITED_FILL_ID,
        TILES_VISITED_LINE_ID,
        TILES_CLUSTER_FILL_ID,
        TILES_CLUSTER_LINE_ID,
        TILES_MAX_CLUSTER_FILL_ID,
        TILES_MAX_CLUSTER_LINE_ID,
        TILES_MAX_SQUARE_LINE_ID,
    ]
    const DEFAULT_ROUTE_OPACITY = 0.35
    const EVENT_REQUEST = 'STRAVA_OVERLAY_REQUEST'
    const EVENT_RESPONSE = 'STRAVA_OVERLAY_RESPONSE'
    const KNOWN_MAP_GLOBALS = [
        'map',
        '__map',
        '_map',
        'maplibreMap',
        'mapboxMap',
    ]

    let entityDecoderEl = null

    function postResponse(detail) {
        window.dispatchEvent(new CustomEvent(EVENT_RESPONSE, { detail }))
    }

    function isValidMapCandidate(candidate) {
        return (
            candidate &&
            typeof candidate.addSource === 'function' &&
            typeof candidate.getSource === 'function' &&
            typeof candidate.addLayer === 'function' &&
            typeof candidate.getLayer === 'function' &&
            typeof candidate.removeLayer === 'function' &&
            typeof candidate.removeSource === 'function'
        )
    }

    function setMapInstance(map) {
        if (!isValidMapCandidate(map)) {
            return
        }
        STATE.map = map
        STATE.ready = true
    }

    function hookConstructor(globalName) {
        const globalObj = window[globalName]
        if (!globalObj || !globalObj.Map) {
            return
        }

        const OriginalMap = globalObj.Map
        if (OriginalMap.__stravaHooked) {
            return
        }

        function WrappedMap(...args) {
            const instance = new OriginalMap(...args)
            setMapInstance(instance)
            return instance
        }

        WrappedMap.prototype = OriginalMap.prototype
        WrappedMap.__stravaHooked = true
        globalObj.Map = WrappedMap
    }

    function discoverExistingMap() {
        if (STATE.ready && STATE.map) {
            return true
        }

        for (const key of KNOWN_MAP_GLOBALS) {
            try {
                if (isValidMapCandidate(window[key])) {
                    setMapInstance(window[key])
                    return true
                }
            } catch {
                // ignore inaccessible globals
            }
        }

        // Last resort: shallow scan of own enumerable window properties only.
        try {
            for (const key of Object.keys(window)) {
                try {
                    const value = window[key]
                    if (isValidMapCandidate(value)) {
                        setMapInstance(value)
                        return true
                    }
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }
        return false
    }

    function hideTooltip() {
        if (STATE.activeTooltipEl) {
            STATE.activeTooltipEl.remove()
            STATE.activeTooltipEl = null
        }
    }

    function hidePopup() {
        if (STATE.activePopupEl) {
            STATE.activePopupEl.remove()
            STATE.activePopupEl = null
        }
    }

    function unbindLayerInteractions() {
        if (!STATE.map) {
            return
        }
        if (STATE.clickHandler) {
            STATE.map.off('click', HITBOX_LAYER_ID, STATE.clickHandler)
            STATE.clickHandler = null
        }
        if (STATE.mapClickHandler) {
            STATE.map.off('click', STATE.mapClickHandler)
            STATE.mapClickHandler = null
        }
        if (STATE.mouseEnterHandler) {
            STATE.map.off(
                'mouseenter',
                HITBOX_LAYER_ID,
                STATE.mouseEnterHandler,
            )
            STATE.mouseEnterHandler = null
        }
        if (STATE.mouseLeaveHandler) {
            STATE.map.off(
                'mouseleave',
                HITBOX_LAYER_ID,
                STATE.mouseLeaveHandler,
            )
            STATE.mouseLeaveHandler = null
        }
        if (STATE.mouseMoveHandler) {
            STATE.map.off('mousemove', HITBOX_LAYER_ID, STATE.mouseMoveHandler)
            STATE.mouseMoveHandler = null
        }
    }

    function getExplorerTilesApi() {
        return globalThis.DreeveExplorerTiles || null
    }

    function emptyFeatureCollection() {
        return { type: 'FeatureCollection', features: [] }
    }

    function scaleOpacity(tierOpacity, lineOpacity) {
        return Math.max(
            0,
            Math.min(1, (lineOpacity * tierOpacity) / DEFAULT_ROUTE_OPACITY),
        )
    }

    function removeTileLayersAndSources() {
        if (!STATE.map) {
            return
        }
        for (const layerId of TILE_LAYER_IDS) {
            if (STATE.map.getLayer(layerId)) {
                STATE.map.removeLayer(layerId)
            }
        }
        if (STATE.map.getSource(TILES_SOURCE_ID)) {
            STATE.map.removeSource(TILES_SOURCE_ID)
        }
        if (STATE.map.getSource(TILES_MAX_SQUARE_SOURCE_ID)) {
            STATE.map.removeSource(TILES_MAX_SQUARE_SOURCE_ID)
        }
    }

    function removeRouteLayersAndSources() {
        if (!STATE.map) {
            return
        }
        if (STATE.map.getLayer(HITBOX_LAYER_ID)) {
            STATE.map.removeLayer(HITBOX_LAYER_ID)
        }
        if (STATE.map.getLayer(LAYER_ID)) {
            STATE.map.removeLayer(LAYER_ID)
        }
        if (STATE.map.getSource(SOURCE_ID)) {
            STATE.map.removeSource(SOURCE_ID)
        }
    }

    function removeOverlay() {
        if (!STATE.map) {
            return
        }
        hidePopup()
        hideTooltip()
        unbindLayerInteractions()
        removeRouteLayersAndSources()
        removeTileLayersAndSources()
        STATE.overlayApplied = false
        STATE.style = null
        STATE.showRoutes = true
        STATE.showTiles = true
    }

    function simplifyLine(coordinates, maxPoints) {
        if (!Array.isArray(coordinates) || coordinates.length <= maxPoints) {
            return coordinates
        }
        const stride = Math.ceil(coordinates.length / maxPoints)
        const simplified = []
        for (let i = 0; i < coordinates.length; i += stride) {
            simplified.push(coordinates[i])
        }
        const last = coordinates[coordinates.length - 1]
        const prev = simplified[simplified.length - 1]
        if (!prev || prev[0] !== last[0] || prev[1] !== last[1]) {
            simplified.push(last)
        }
        return simplified
    }

    function toGeoJsonLineCollection(routes) {
        return {
            type: 'FeatureCollection',
            features: routes.map((route, index) => {
                const points = Array.isArray(route.points) ? route.points : []
                return {
                    type: 'Feature',
                    id: route.id || `route-${index}`,
                    properties: {
                        activityId:
                            route?.metadata?.activityId || route.id || '',
                        name: route?.metadata?.name || '',
                        startDate: route?.metadata?.startDate || '',
                        distance: route?.metadata?.distance || '',
                        sportType: route?.metadata?.sportType || '',
                        activityUrl: route?.metadata?.activityUrl || '',
                        stravaUrl: route?.metadata?.stravaUrl || '',
                    },
                    geometry: {
                        type: 'LineString',
                        // points are already [lng, lat]
                        coordinates: simplifyLine(points, 2000),
                    },
                }
            }),
        }
    }

    function normalizeStyle(style = {}) {
        const color = String(style.lineColor || '#ff4500').trim()
        const lineColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ff4500'

        const opacity = Number(style.lineOpacity)
        const lineOpacity = Number.isFinite(opacity)
            ? Math.max(0.05, Math.min(1, opacity))
            : 0.35

        const width = Number(style.lineWidth)
        const lineWidth = Number.isFinite(width)
            ? Math.max(1, Math.min(12, width))
            : 2

        return { lineColor, lineOpacity, lineWidth }
    }

    function escapeHtml(value) {
        return String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;')
    }

    function decodeHtmlEntities(value) {
        const text = String(value || '')
        if (!text.includes('&')) {
            return text
        }
        if (!entityDecoderEl) {
            entityDecoderEl = document.createElement('textarea')
        }
        entityDecoderEl.innerHTML = text
        return entityDecoderEl.value
    }

    function activityTitle(properties = {}) {
        const name = decodeHtmlEntities(properties.name)
        const activityId = decodeHtmlEntities(properties.activityId)
        return name || `Activity ${activityId || 'unknown'}`
    }

    function buildPopupHtml(properties) {
        const activityId = escapeHtml(decodeHtmlEntities(properties.activityId))
        const distance = escapeHtml(decodeHtmlEntities(properties.distance))
        const startDate = escapeHtml(decodeHtmlEntities(properties.startDate))
        const sportType = escapeHtml(decodeHtmlEntities(properties.sportType))
        const activityUrl = String(properties.activityUrl || '').trim()
        const stravaUrl = String(properties.stravaUrl || '').trim()

        const title = escapeHtml(activityTitle(properties))
        const details = [distance, startDate, sportType]
            .filter(Boolean)
            .join(' • ')

        let links = ''
        if (stravaUrl) {
            links += `<div style="margin-bottom:4px;"><a href="${escapeHtml(stravaUrl)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa; text-decoration:underline; font-weight:600; cursor:pointer;">Open in Strava</a></div>`
        }
        if (activityUrl) {
            links += `<div><a href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa; text-decoration:underline; font-weight:600; cursor:pointer;">Open in Dreeve</a></div>`
        }

        return `
            <div style="font-family: Arial, sans-serif; font-size: 12px; line-height: 1.4;">
                <div style="display:flex; justify-content:flex-end; margin-bottom:4px;">
                    <button data-strava-popup-close="1" style="border:none; background:#1f2937; color:#e5e7eb; border-radius:4px; padding:2px 6px; cursor:pointer;">x</button>
                </div>
                <div style="font-weight: 700; margin-bottom: 4px;">${title}</div>
                <div style="margin-bottom: 4px;">ID: ${activityId || 'unknown'}</div>
                ${details ? `<div style="margin-bottom: 6px;">${details}</div>` : ''}
                ${links}
            </div>
        `
    }

    function ensureMapContainerRelative(container) {
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative'
        }
    }

    function showTooltipAt(point, properties) {
        if (!STATE.map) {
            return
        }

        const container = STATE.map.getContainer()
        if (!container) {
            return
        }

        ensureMapContainerRelative(container)

        let tooltip = STATE.activeTooltipEl
        if (!tooltip) {
            tooltip = document.createElement('div')
            tooltip.style.position = 'absolute'
            tooltip.style.zIndex = '9998'
            tooltip.style.maxWidth = '240px'
            tooltip.style.background = '#111827'
            tooltip.style.color = '#f9fafb'
            tooltip.style.border = '1px solid #374151'
            tooltip.style.borderRadius = '4px'
            tooltip.style.padding = '3px 8px'
            tooltip.style.fontFamily = 'Arial, sans-serif'
            tooltip.style.fontSize = '11px'
            tooltip.style.lineHeight = '1.3'
            tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'
            tooltip.style.pointerEvents = 'none'
            tooltip.style.whiteSpace = 'nowrap'
            tooltip.style.overflow = 'hidden'
            tooltip.style.textOverflow = 'ellipsis'
            container.appendChild(tooltip)
            STATE.activeTooltipEl = tooltip
        }

        tooltip.textContent = activityTitle(properties)
        tooltip.style.left = `${Math.round(point.x + 12)}px`
        tooltip.style.top = `${Math.round(point.y + 12)}px`
    }

    function showCustomPopup(lngLat, html) {
        if (!STATE.map) {
            return
        }

        const container = STATE.map.getContainer()
        if (!container) {
            return
        }

        hidePopup()
        hideTooltip()
        ensureMapContainerRelative(container)

        const point = STATE.map.project(lngLat)
        const popup = document.createElement('div')
        popup.style.position = 'absolute'
        popup.style.left = `${Math.round(point.x + 10)}px`
        popup.style.top = `${Math.round(point.y + 10)}px`
        popup.style.zIndex = '9999'
        popup.style.maxWidth = '320px'
        popup.style.background = '#111827'
        popup.style.color = '#f9fafb'
        popup.style.border = '1px solid #374151'
        popup.style.borderRadius = '8px'
        popup.style.padding = '8px'
        popup.style.boxShadow = '0 6px 20px rgba(0,0,0,0.35)'
        popup.style.pointerEvents = 'auto'
        popup.innerHTML = html

        popup.addEventListener('click', (event) => {
            const target = event.target
            if (!(target instanceof Element)) {
                return
            }
            if (
                target instanceof HTMLElement &&
                target.dataset.stravaPopupClose === '1'
            ) {
                hidePopup()
                return
            }
            if (target.closest('a[href]')) {
                hidePopup()
            }
        })

        container.appendChild(popup)
        STATE.activePopupEl = popup
    }

    function bindLayerInteractions() {
        if (!STATE.map) {
            return
        }

        unbindLayerInteractions()

        STATE.mouseEnterHandler = () => {
            STATE.map.getCanvas().style.cursor = 'pointer'
        }

        STATE.mouseLeaveHandler = () => {
            STATE.map.getCanvas().style.cursor = ''
            hideTooltip()
        }

        STATE.mouseMoveHandler = (event) => {
            const feature = event?.features?.[0]
            if (!feature) {
                hideTooltip()
                return
            }
            showTooltipAt(event.point, feature.properties || {})
        }

        STATE.clickHandler = (event) => {
            const feature = event?.features?.[0]
            if (!feature) {
                return
            }
            const html = buildPopupHtml(feature.properties || {})
            showCustomPopup(event.lngLat, html)
        }

        STATE.mapClickHandler = (event) => {
            if (!STATE.activePopupEl) {
                return
            }
            if (event?.originalEvent?.target instanceof Element) {
                if (STATE.activePopupEl.contains(event.originalEvent.target)) {
                    return
                }
            }
            const features = STATE.map.queryRenderedFeatures(event.point, {
                layers: [HITBOX_LAYER_ID],
            })
            if (features && features.length > 0) {
                return
            }
            hidePopup()
        }

        STATE.map.on('mouseenter', HITBOX_LAYER_ID, STATE.mouseEnterHandler)
        STATE.map.on('mouseleave', HITBOX_LAYER_ID, STATE.mouseLeaveHandler)
        STATE.map.on('mousemove', HITBOX_LAYER_ID, STATE.mouseMoveHandler)
        STATE.map.on('click', HITBOX_LAYER_ID, STATE.clickHandler)
        STATE.map.on('click', STATE.mapClickHandler)
    }

    function tilePolygonFeature(tileId, tier, explorer) {
        const [[south, west], [north, east]] = explorer.tileBounds(tileId)
        return {
            type: 'Feature',
            properties: { tier },
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [west, north],
                        [east, north],
                        [east, south],
                        [west, south],
                        [west, north],
                    ],
                ],
            },
        }
    }

    function buildTilesGeoJson(tileIds) {
        const explorer = getExplorerTilesApi()
        if (!explorer) {
            throw new Error('Explorer tiles module is not loaded.')
        }

        const visitedTiles = new Set(
            (Array.isArray(tileIds) ? tileIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id)),
        )
        const { clusterTiles, maxCluster } = explorer.clusters(visitedTiles)
        const features = []

        for (const tile of visitedTiles) {
            let tier = 'visited'
            if (maxCluster.has(tile)) {
                tier = 'maxCluster'
            } else if (clusterTiles.has(tile)) {
                tier = 'cluster'
            }
            features.push(tilePolygonFeature(tile, tier, explorer))
        }

        let maxSquareCollection = emptyFeatureCollection()
        const square = explorer.maxSquare(visitedTiles)
        if (square && square.size > 0) {
            const sw = explorer.tileBounds(explorer.tileKey(square.x, square.y))
            const ne = explorer.tileBounds(
                explorer.tileKey(
                    square.x + square.size - 1,
                    square.y + square.size - 1,
                ),
            )
            const south = sw[0][0]
            const west = sw[0][1]
            const north = ne[1][0]
            const east = ne[1][1]
            maxSquareCollection = {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { tier: 'maxSquare' },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [
                                [
                                    [west, north],
                                    [east, north],
                                    [east, south],
                                    [west, south],
                                    [west, north],
                                ],
                            ],
                        },
                    },
                ],
            }
        }

        return {
            tiles: { type: 'FeatureCollection', features },
            maxSquare: maxSquareCollection,
            tileCount: visitedTiles.size,
        }
    }

    function applyTilePaintStyle(normalizedStyle) {
        if (!STATE.map) {
            return
        }
        const color = normalizedStyle.lineColor
        const opacity = normalizedStyle.lineOpacity
        const borderOpacity = scaleOpacity(0.5, opacity)

        const fillSpecs = [
            [TILES_VISITED_FILL_ID, 0.15],
            [TILES_CLUSTER_FILL_ID, 0.35],
            [TILES_MAX_CLUSTER_FILL_ID, 0.55],
        ]
        for (const [layerId, tier] of fillSpecs) {
            if (!STATE.map.getLayer(layerId)) {
                continue
            }
            STATE.map.setPaintProperty(layerId, 'fill-color', color)
            STATE.map.setPaintProperty(
                layerId,
                'fill-opacity',
                scaleOpacity(tier, opacity),
            )
        }

        const lineSpecs = [
            TILES_VISITED_LINE_ID,
            TILES_CLUSTER_LINE_ID,
            TILES_MAX_CLUSTER_LINE_ID,
        ]
        for (const layerId of lineSpecs) {
            if (!STATE.map.getLayer(layerId)) {
                continue
            }
            STATE.map.setPaintProperty(layerId, 'line-color', color)
            STATE.map.setPaintProperty(layerId, 'line-opacity', borderOpacity)
            STATE.map.setPaintProperty(layerId, 'line-width', 1)
        }

        if (STATE.map.getLayer(TILES_MAX_SQUARE_LINE_ID)) {
            STATE.map.setPaintProperty(
                TILES_MAX_SQUARE_LINE_ID,
                'line-color',
                color,
            )
            STATE.map.setPaintProperty(
                TILES_MAX_SQUARE_LINE_ID,
                'line-opacity',
                scaleOpacity(1, opacity),
            )
            STATE.map.setPaintProperty(
                TILES_MAX_SQUARE_LINE_ID,
                'line-width',
                3,
            )
        }
    }

    function applyPaintStyle(normalizedStyle) {
        if (!STATE.map) {
            return
        }
        const hitboxWidth = Math.max(normalizedStyle.lineWidth + 8, 12)
        if (STATE.map.getLayer(LAYER_ID)) {
            STATE.map.setPaintProperty(
                LAYER_ID,
                'line-color',
                normalizedStyle.lineColor,
            )
            STATE.map.setPaintProperty(
                LAYER_ID,
                'line-opacity',
                normalizedStyle.lineOpacity,
            )
            STATE.map.setPaintProperty(
                LAYER_ID,
                'line-width',
                normalizedStyle.lineWidth,
            )
        }
        if (STATE.map.getLayer(HITBOX_LAYER_ID)) {
            STATE.map.setPaintProperty(
                HITBOX_LAYER_ID,
                'line-width',
                hitboxWidth,
            )
        }
        applyTilePaintStyle(normalizedStyle)
        STATE.style = normalizedStyle
    }

    function ensureTileLayers(normalizedStyle) {
        const color = normalizedStyle.lineColor
        const opacity = normalizedStyle.lineOpacity
        const borderOpacity = scaleOpacity(0.5, opacity)

        const addFill = (id, tier, fillOpacity) => {
            if (STATE.map.getLayer(id)) {
                return
            }
            STATE.map.addLayer({
                id,
                type: 'fill',
                source: TILES_SOURCE_ID,
                filter: ['==', ['get', 'tier'], tier],
                paint: {
                    'fill-color': color,
                    'fill-opacity': scaleOpacity(fillOpacity, opacity),
                },
                layout: {
                    visibility: STATE.showTiles ? 'visible' : 'none',
                },
            })
        }

        const addLine = (id, tier) => {
            if (STATE.map.getLayer(id)) {
                return
            }
            STATE.map.addLayer({
                id,
                type: 'line',
                source: TILES_SOURCE_ID,
                filter: ['==', ['get', 'tier'], tier],
                paint: {
                    'line-color': color,
                    'line-opacity': borderOpacity,
                    'line-width': 1,
                },
                layout: {
                    visibility: STATE.showTiles ? 'visible' : 'none',
                },
            })
        }

        addFill(TILES_VISITED_FILL_ID, 'visited', 0.15)
        addLine(TILES_VISITED_LINE_ID, 'visited')
        addFill(TILES_CLUSTER_FILL_ID, 'cluster', 0.35)
        addLine(TILES_CLUSTER_LINE_ID, 'cluster')
        addFill(TILES_MAX_CLUSTER_FILL_ID, 'maxCluster', 0.55)
        addLine(TILES_MAX_CLUSTER_LINE_ID, 'maxCluster')

        if (!STATE.map.getLayer(TILES_MAX_SQUARE_LINE_ID)) {
            STATE.map.addLayer({
                id: TILES_MAX_SQUARE_LINE_ID,
                type: 'line',
                source: TILES_MAX_SQUARE_SOURCE_ID,
                paint: {
                    'line-color': color,
                    'line-opacity': scaleOpacity(1, opacity),
                    'line-width': 3,
                },
                layout: {
                    visibility: STATE.showTiles ? 'visible' : 'none',
                },
            })
        }
    }

    function ensureRouteLayers(normalizedStyle) {
        const hitboxWidth = Math.max(normalizedStyle.lineWidth + 8, 12)
        const visibility = STATE.showRoutes ? 'visible' : 'none'

        if (!STATE.map.getLayer(HITBOX_LAYER_ID)) {
            STATE.map.addLayer({
                id: HITBOX_LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                paint: {
                    'line-color': '#000000',
                    'line-opacity': 0,
                    'line-width': hitboxWidth,
                },
                layout: {
                    'line-cap': 'round',
                    'line-join': 'round',
                    visibility,
                },
            })
        }

        if (!STATE.map.getLayer(LAYER_ID)) {
            STATE.map.addLayer({
                id: LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                paint: {
                    'line-color': normalizedStyle.lineColor,
                    'line-opacity': normalizedStyle.lineOpacity,
                    'line-width': normalizedStyle.lineWidth,
                },
                layout: {
                    'line-cap': 'round',
                    'line-join': 'round',
                    visibility,
                },
            })
        } else {
            applyPaintStyle(normalizedStyle)
        }

        if (STATE.map.getLayer(HITBOX_LAYER_ID)) {
            STATE.map.setLayoutProperty(
                HITBOX_LAYER_ID,
                'visibility',
                visibility,
            )
        }
        if (STATE.map.getLayer(LAYER_ID)) {
            STATE.map.setLayoutProperty(LAYER_ID, 'visibility', visibility)
        }
    }

    function setTileLayersVisibility(visible) {
        const visibility = visible ? 'visible' : 'none'
        for (const layerId of TILE_LAYER_IDS) {
            if (STATE.map.getLayer(layerId)) {
                STATE.map.setLayoutProperty(layerId, 'visibility', visibility)
            }
        }
    }

    function drawOverlay(routes, tileIds, style, showRoutes, showTiles) {
        if (!STATE.map) {
            throw new Error('Map instance is not ready yet.')
        }

        STATE.showRoutes = Boolean(showRoutes)
        STATE.showTiles = Boolean(showTiles)

        const routeList = Array.isArray(routes) ? routes : []
        const normalizedStyle = normalizeStyle(style)
        const routeData = STATE.showRoutes
            ? toGeoJsonLineCollection(routeList)
            : emptyFeatureCollection()

        let tilesData = emptyFeatureCollection()
        let maxSquareData = emptyFeatureCollection()
        let tileCount = 0
        if (STATE.showTiles) {
            const built = buildTilesGeoJson(tileIds)
            tilesData = built.tiles
            maxSquareData = built.maxSquare
            tileCount = built.tileCount
        }

        hidePopup()
        hideTooltip()
        unbindLayerInteractions()

        // Keep tiles under routes: remove routes, ensure tiles, then routes.
        removeRouteLayersAndSources()

        const tilesSource = STATE.map.getSource(TILES_SOURCE_ID)
        const maxSquareSource = STATE.map.getSource(TILES_MAX_SQUARE_SOURCE_ID)
        if (
            tilesSource &&
            typeof tilesSource.setData === 'function' &&
            maxSquareSource &&
            typeof maxSquareSource.setData === 'function'
        ) {
            tilesSource.setData(tilesData)
            maxSquareSource.setData(maxSquareData)
        } else {
            removeTileLayersAndSources()
            STATE.map.addSource(TILES_SOURCE_ID, {
                type: 'geojson',
                data: tilesData,
            })
            STATE.map.addSource(TILES_MAX_SQUARE_SOURCE_ID, {
                type: 'geojson',
                data: maxSquareData,
            })
        }

        ensureTileLayers(normalizedStyle)
        setTileLayersVisibility(STATE.showTiles)
        applyTilePaintStyle(normalizedStyle)

        STATE.map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: routeData,
        })
        ensureRouteLayers(normalizedStyle)
        applyPaintStyle(normalizedStyle)

        if (STATE.showRoutes && routeList.length > 0) {
            bindLayerInteractions()
        }

        STATE.overlayApplied = true
        STATE.style = normalizedStyle
        return { routeCount: routeList.length, tileCount }
    }

    function updateOverlayStyle(style) {
        if (!STATE.overlayApplied || !STATE.map) {
            throw new Error('Overlay is not active.')
        }
        applyPaintStyle(normalizeStyle(style))
    }

    function ensureMapReady() {
        if (STATE.ready && STATE.map) {
            return true
        }
        return discoverExistingMap()
    }

    window.addEventListener(EVENT_REQUEST, (event) => {
        const detail = event.detail || {}
        const requestId = detail.requestId

        try {
            if (!requestId) {
                return
            }

            if (detail.action === 'status') {
                postResponse({
                    requestId,
                    ok: true,
                    ready: ensureMapReady(),
                    active: STATE.overlayApplied,
                })
                return
            }

            if (detail.action === 'disable') {
                removeOverlay()
                postResponse({
                    requestId,
                    ok: true,
                    enabled: false,
                    routeCount: 0,
                })
                return
            }

            if (detail.action === 'updateStyle') {
                updateOverlayStyle(detail.style)
                postResponse({
                    requestId,
                    ok: true,
                    enabled: true,
                })
                return
            }

            if (detail.action !== 'apply') {
                postResponse({
                    requestId,
                    ok: false,
                    error: 'Unknown action.',
                })
                return
            }

            if (!ensureMapReady()) {
                throw new Error('Could not detect map instance on this page.')
            }

            const routes = Array.isArray(detail.routes) ? detail.routes : []
            const tileIds = Array.isArray(detail.tileIds) ? detail.tileIds : []
            const showRoutes = detail.showRoutes !== false
            const showTiles = detail.showTiles === true

            if (!showRoutes && !showTiles) {
                removeOverlay()
                STATE.overlayApplied = true
                postResponse({
                    requestId,
                    ok: true,
                    enabled: true,
                    routeCount: 0,
                    tileCount: 0,
                })
                return
            }

            if (
                (showRoutes && routes.length === 0 && !showTiles) ||
                (showTiles && tileIds.length === 0 && !showRoutes) ||
                (showRoutes &&
                    routes.length === 0 &&
                    showTiles &&
                    tileIds.length === 0)
            ) {
                throw new Error('Nothing to draw for the selected layers.')
            }

            const counts = drawOverlay(
                routes,
                tileIds,
                detail.style,
                showRoutes,
                showTiles,
            )
            postResponse({
                requestId,
                ok: true,
                enabled: true,
                routeCount: counts.routeCount,
                tileCount: counts.tileCount,
            })
        } catch (error) {
            postResponse({
                requestId,
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Overlay bridge failed.',
            })
        }
    })

    hookConstructor('maplibregl')
    hookConstructor('mapboxgl')
    discoverExistingMap()
})()
