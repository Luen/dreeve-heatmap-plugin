;(function () {
    const EVENT_REQUEST = 'STRAVA_OVERLAY_REQUEST'
    const EVENT_RESPONSE = 'STRAVA_OVERLAY_RESPONSE'
    const OVERLAY_ID = 'dreeve-routes'
    const OVERLAY_NAME = 'Dreeve Routes'
    const OVERLAY_ICON = '🗺️'
    const OVERLAY_LABEL = `${OVERLAY_ICON} ${OVERLAY_NAME}`
    const LAYER_ID = 'dreeve'
    const SVG_NS = 'http://www.w3.org/2000/svg'
    // 1x1 transparent PNG — satisfies iD overlay tile template without a CDN
    const TRANSPARENT_TILE =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const GRID_CELL_SIZE = 64

    const STATE = {
        context: null,
        ready: false,
        overlayApplied: false,
        overlayRegistered: false,
        routesVisible: false,
        features: [],
        style: {
            lineColor: '#ff4500',
            lineOpacity: 0.35,
            lineWidth: 2,
        },
        activeTooltipEl: null,
        mapHoverHandler: null,
        mapHoverLeaveHandler: null,
        mapHoverTarget: null,
        hoverRaf: 0,
        hoverClientX: 0,
        hoverClientY: 0,
        lastHoverFeatureId: null,
        pending: null,
        backgroundBound: false,
        layerAdded: false,
        spatialGrid: null,
        spatialGridKey: '',
    }

    let entityDecoderEl = null

    function postResponse(detail) {
        window.dispatchEvent(new CustomEvent(EVENT_RESPONSE, { detail }))
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

    function computeGeoBbox(coordinates) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (let i = 0; i < coordinates.length; i += 1) {
            const coord = coordinates[i]
            if (!Array.isArray(coord) || coord.length < 2) {
                continue
            }
            const x = coord[0]
            const y = coord[1]
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue
            }
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
        }
        if (!Number.isFinite(minX)) {
            return null
        }
        return { minX, minY, maxX, maxY }
    }

    function toGeoJsonFeatures(routes) {
        return (Array.isArray(routes) ? routes : [])
            .map((route, index) => {
                const points = Array.isArray(route.points) ? route.points : []
                if (points.length < 2) {
                    return null
                }
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
                        coordinates: points,
                    },
                    _bbox: computeGeoBbox(points),
                }
            })
            .filter(Boolean)
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

    function getMapContainer() {
        if (!STATE.context) {
            return document.getElementById('id-container') || document.body
        }
        try {
            const container = STATE.context.container?.()
            if (container && typeof container.node === 'function') {
                return container.node() || document.body
            }
        } catch {
            // fall through
        }
        return (
            document.querySelector('.main-map') ||
            document.getElementById('id-container') ||
            document.body
        )
    }

    function ensureContainerRelative(container) {
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative'
        }
    }

    function hideTooltip() {
        if (STATE.activeTooltipEl) {
            STATE.activeTooltipEl.remove()
            STATE.activeTooltipEl = null
        }
        STATE.lastHoverFeatureId = null
    }

    function showTooltipAt(clientX, clientY, properties, featureId) {
        const container = getMapContainer()
        if (!container) {
            return
        }

        ensureContainerRelative(container)

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

        if (STATE.lastHoverFeatureId !== featureId) {
            tooltip.textContent = activityTitle(properties)
            STATE.lastHoverFeatureId = featureId
        }

        const bounds = container.getBoundingClientRect()
        tooltip.style.left = `${Math.round(clientX - bounds.left + 12)}px`
        tooltip.style.top = `${Math.round(clientY - bounds.top + 12)}px`
    }

    // Screen-space distance² from point to segment (for passive hover hit-testing)
    function distSqPointToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1
        const dy = y2 - y1
        const len2 = dx * dx + dy * dy
        if (len2 === 0) {
            const ex = px - x1
            const ey = py - y1
            return ex * ex + ey * ey
        }
        let t = ((px - x1) * dx + (py - y1) * dy) / len2
        t = Math.max(0, Math.min(1, t))
        const nx = x1 + t * dx - px
        const ny = y1 + t * dy - py
        return nx * nx + ny * ny
    }

    function getSurfaceNode() {
        if (!STATE.context) {
            return null
        }
        try {
            const surface = STATE.context.surface?.()
            if (surface && typeof surface.node === 'function') {
                const node = surface.node()
                if (node) {
                    return node
                }
            }
        } catch {
            // fall through
        }
        return (
            document.querySelector('.main-map svg') ||
            document.querySelector('#id-container svg')
        )
    }

    function clientToSurfacePoint(clientX, clientY) {
        const surface = getSurfaceNode()
        if (!surface) {
            return null
        }
        const rect = surface.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
            return null
        }
        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
            width: rect.width,
            height: rect.height,
        }
    }

    function getViewGeoExtent(padPx = 0) {
        const projection = STATE.context?.projection
        const surface = getSurfaceNode()
        if (
            !projection ||
            !surface ||
            typeof projection.invert !== 'function'
        ) {
            return null
        }
        const rect = surface.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
            return null
        }
        const corners = [
            projection.invert([-padPx, -padPx]),
            projection.invert([rect.width + padPx, -padPx]),
            projection.invert([-padPx, rect.height + padPx]),
            projection.invert([rect.width + padPx, rect.height + padPx]),
        ]
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const corner of corners) {
            if (
                !corner ||
                !Number.isFinite(corner[0]) ||
                !Number.isFinite(corner[1])
            ) {
                return null
            }
            if (corner[0] < minX) minX = corner[0]
            if (corner[1] < minY) minY = corner[1]
            if (corner[0] > maxX) maxX = corner[0]
            if (corner[1] > maxY) maxY = corner[1]
        }
        return { minX, minY, maxX, maxY }
    }

    function bboxesIntersect(a, b) {
        return !(
            a.maxX < b.minX ||
            a.minX > b.maxX ||
            a.maxY < b.minY ||
            a.minY > b.maxY
        )
    }

    function getProjectionScale() {
        const projection = STATE.context?.projection
        if (!projection) {
            return 1
        }
        try {
            if (typeof projection.scale === 'function') {
                return projection.scale() || 1
            }
            if (typeof projection.k === 'number') {
                return projection.k || 1
            }
        } catch {
            // ignore
        }
        return 1
    }

    function simplifyStrideForZoom() {
        const scale = getProjectionScale()
        // Higher scale = more zoomed in = keep more points.
        if (scale >= 256) return 1
        if (scale >= 64) return 2
        if (scale >= 16) return 4
        if (scale >= 4) return 8
        return 16
    }

    function simplifyCoordinates(coordinates, stride) {
        if (
            !Array.isArray(coordinates) ||
            coordinates.length <= 2 ||
            stride <= 1
        ) {
            return coordinates
        }
        const simplified = []
        for (let i = 0; i < coordinates.length; i += stride) {
            simplified.push(coordinates[i])
        }
        const last = coordinates[coordinates.length - 1]
        const prev = simplified[simplified.length - 1]
        if (!prev || prev[0] !== last[0] || prev[1] !== last[1]) {
            simplified.push(last)
        }
        return simplified.length >= 2 ? simplified : coordinates
    }

    function buildSpatialGrid(features, projection, width, height) {
        const cols = Math.max(1, Math.ceil(width / GRID_CELL_SIZE))
        const rows = Math.max(1, Math.ceil(height / GRID_CELL_SIZE))
        const cells = new Map()

        const addToCell = (cx, cy, feature) => {
            if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) {
                return
            }
            const key = `${cx},${cy}`
            let bucket = cells.get(key)
            if (!bucket) {
                bucket = []
                cells.set(key, bucket)
            }
            if (bucket[bucket.length - 1] !== feature) {
                bucket.push(feature)
            }
        }

        for (const feature of features) {
            const coords = feature.geometry?.coordinates
            if (!Array.isArray(coords) || coords.length < 2) {
                continue
            }
            let minSX = Infinity
            let minSY = Infinity
            let maxSX = -Infinity
            let maxSY = -Infinity
            for (let i = 0; i < coords.length; i += 1) {
                const coord = coords[i]
                if (!Array.isArray(coord) || coord.length < 2) {
                    continue
                }
                const projected = projection(coord)
                if (
                    !projected ||
                    !Number.isFinite(projected[0]) ||
                    !Number.isFinite(projected[1])
                ) {
                    continue
                }
                if (projected[0] < minSX) minSX = projected[0]
                if (projected[1] < minSY) minSY = projected[1]
                if (projected[0] > maxSX) maxSX = projected[0]
                if (projected[1] > maxSY) maxSY = projected[1]
            }
            if (!Number.isFinite(minSX)) {
                continue
            }
            feature._screenBbox = {
                minX: minSX,
                minY: minSY,
                maxX: maxSX,
                maxY: maxSY,
            }
            const x0 = Math.floor(minSX / GRID_CELL_SIZE)
            const x1 = Math.floor(maxSX / GRID_CELL_SIZE)
            const y0 = Math.floor(minSY / GRID_CELL_SIZE)
            const y1 = Math.floor(maxSY / GRID_CELL_SIZE)
            for (let cy = y0; cy <= y1; cy += 1) {
                for (let cx = x0; cx <= x1; cx += 1) {
                    addToCell(cx, cy, feature)
                }
            }
        }

        return { cells, cols, rows }
    }

    function ensureSpatialGrid(point) {
        const projection = STATE.context?.projection
        if (!projection || !point) {
            return null
        }
        const key = `${Math.round(point.width)}x${Math.round(point.height)}:${Math.round(getProjectionScale() * 100)}:${STATE.features.length}`
        if (STATE.spatialGrid && STATE.spatialGridKey === key) {
            return STATE.spatialGrid
        }
        const view = getViewGeoExtent(40)
        const candidates = view
            ? STATE.features.filter(
                  (feature) =>
                      feature._bbox && bboxesIntersect(feature._bbox, view),
              )
            : STATE.features
        STATE.spatialGrid = buildSpatialGrid(
            candidates,
            projection,
            point.width,
            point.height,
        )
        STATE.spatialGridKey = key
        return STATE.spatialGrid
    }

    function invalidateSpatialGrid() {
        STATE.spatialGrid = null
        STATE.spatialGridKey = ''
    }

    function findFeatureNearClientPoint(clientX, clientY) {
        if (
            !STATE.routesVisible ||
            !STATE.features.length ||
            !STATE.context?.projection
        ) {
            return null
        }

        const point = clientToSurfacePoint(clientX, clientY)
        if (!point) {
            return null
        }

        const projection = STATE.context.projection
        const maxDist = Math.max((STATE.style.lineWidth || 2) + 4, 8)
        const maxDistSq = maxDist * maxDist
        let bestFeature = null
        let bestDistSq = maxDistSq

        const grid = ensureSpatialGrid(point)
        let candidates = STATE.features
        if (grid) {
            const cx = Math.floor(point.x / GRID_CELL_SIZE)
            const cy = Math.floor(point.y / GRID_CELL_SIZE)
            const nearby = new Set()
            for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    const bucket = grid.cells.get(`${cx + dx},${cy + dy}`)
                    if (!bucket) {
                        continue
                    }
                    for (const feature of bucket) {
                        nearby.add(feature)
                    }
                }
            }
            if (nearby.size > 0) {
                candidates = [...nearby]
            } else {
                return null
            }
        }

        const hitPad = maxDist
        for (const feature of candidates) {
            const screenBbox = feature._screenBbox
            if (
                screenBbox &&
                (point.x < screenBbox.minX - hitPad ||
                    point.x > screenBbox.maxX + hitPad ||
                    point.y < screenBbox.minY - hitPad ||
                    point.y > screenBbox.maxY + hitPad)
            ) {
                continue
            }

            const coords = feature.geometry?.coordinates
            if (!Array.isArray(coords) || coords.length < 2) {
                continue
            }

            let prev = null
            for (let i = 0; i < coords.length; i += 1) {
                const coord = coords[i]
                if (!Array.isArray(coord) || coord.length < 2) {
                    prev = null
                    continue
                }
                const projected = projection(coord)
                if (
                    !projected ||
                    !Number.isFinite(projected[0]) ||
                    !Number.isFinite(projected[1])
                ) {
                    prev = null
                    continue
                }
                if (prev) {
                    const distSq = distSqPointToSegment(
                        point.x,
                        point.y,
                        prev[0],
                        prev[1],
                        projected[0],
                        projected[1],
                    )
                    if (distSq < bestDistSq) {
                        bestDistSq = distSq
                        bestFeature = feature
                    }
                }
                prev = projected
            }
        }

        return bestFeature
    }

    function unbindMapHover() {
        if (STATE.hoverRaf) {
            window.cancelAnimationFrame(STATE.hoverRaf)
            STATE.hoverRaf = 0
        }
        if (STATE.mapHoverTarget) {
            if (STATE.mapHoverHandler) {
                STATE.mapHoverTarget.removeEventListener(
                    'mousemove',
                    STATE.mapHoverHandler,
                )
            }
            if (STATE.mapHoverLeaveHandler) {
                STATE.mapHoverTarget.removeEventListener(
                    'mouseleave',
                    STATE.mapHoverLeaveHandler,
                )
            }
        }
        STATE.mapHoverHandler = null
        STATE.mapHoverLeaveHandler = null
        STATE.mapHoverTarget = null
        STATE.lastHoverFeatureId = null
    }

    function runHoverHitTest() {
        STATE.hoverRaf = 0
        if (!STATE.routesVisible || !STATE.features.length) {
            hideTooltip()
            return
        }
        const feature = findFeatureNearClientPoint(
            STATE.hoverClientX,
            STATE.hoverClientY,
        )
        if (feature) {
            showTooltipAt(
                STATE.hoverClientX,
                STATE.hoverClientY,
                feature.properties || {},
                String(feature.id || ''),
            )
        } else {
            hideTooltip()
        }
    }

    function bindMapHover() {
        unbindMapHover()
        const container = getMapContainer()
        if (!container) {
            return
        }

        STATE.mapHoverHandler = (event) => {
            STATE.hoverClientX = event.clientX
            STATE.hoverClientY = event.clientY
            if (STATE.hoverRaf) {
                return
            }
            STATE.hoverRaf = window.requestAnimationFrame(runHoverHitTest)
        }
        STATE.mapHoverLeaveHandler = () => {
            if (STATE.hoverRaf) {
                window.cancelAnimationFrame(STATE.hoverRaf)
                STATE.hoverRaf = 0
            }
            hideTooltip()
        }
        STATE.mapHoverTarget = container
        container.addEventListener('mousemove', STATE.mapHoverHandler)
        container.addEventListener('mouseleave', STATE.mapHoverLeaveHandler)
    }

    function linePathFromCoordinates(coordinates, projection) {
        if (!coordinates || coordinates.length < 2) {
            return ''
        }
        const parts = []
        for (let i = 0; i < coordinates.length; i += 1) {
            const coord = coordinates[i]
            if (!Array.isArray(coord) || coord.length < 2) {
                continue
            }
            const point = projection(coord)
            if (
                !point ||
                !Number.isFinite(point[0]) ||
                !Number.isFinite(point[1])
            ) {
                continue
            }
            parts.push(
                `${parts.length === 0 ? 'M' : 'L'}${point[0]},${point[1]}`,
            )
        }
        return parts.length >= 2 ? parts.join('') : ''
    }

    function isOverlayEnabledInBackground() {
        if (!STATE.context || !STATE.overlayRegistered) {
            return false
        }
        try {
            const background = STATE.context.background()
            const active = background.overlayLayerSources() || []
            return active.some((source) => source && source.id === OVERLAY_ID)
        } catch {
            return false
        }
    }

    function syncVisibilityFromBackground() {
        const shouldShow =
            STATE.overlayApplied &&
            STATE.features.length > 0 &&
            isOverlayEnabledInBackground()
        STATE.routesVisible = shouldShow
        requestRedraw()
        if (!shouldShow) {
            hideTooltip()
        }
    }

    function requestRedraw() {
        if (!STATE.context) {
            return
        }
        invalidateSpatialGrid()
        try {
            const map = STATE.context.map?.()
            if (map && typeof map.redraw === 'function') {
                map.redraw()
                return
            }
        } catch {
            // fall through
        }
        try {
            STATE.context.layers?.().on?.('change')
        } catch {
            // ignore
        }
    }

    function createDreeveLayer(context) {
        function drawDreeve(selection) {
            const root =
                selection && typeof selection.node === 'function'
                    ? selection.node()
                    : null
            if (!root) {
                return
            }

            let group = root.querySelector('g.dreeve-routes')
            const shouldDraw = STATE.routesVisible && STATE.features.length > 0

            if (!shouldDraw) {
                if (group) {
                    group.remove()
                }
                hideTooltip()
                return
            }

            if (!group) {
                group = document.createElementNS(SVG_NS, 'g')
                group.setAttribute('class', 'dreeve-routes')
                root.appendChild(group)
            }

            const projection = context.projection
            const style = STATE.style
            const view = getViewGeoExtent(24)
            const stride = simplifyStrideForZoom()

            const existing = new Map()
            for (const child of Array.from(group.children)) {
                const id = child.getAttribute('data-feature-id')
                if (id) {
                    existing.set(id, child)
                }
            }

            const seen = new Set()
            for (const feature of STATE.features) {
                const featureId = String(feature.id || '')
                if (!featureId) {
                    continue
                }

                if (
                    view &&
                    feature._bbox &&
                    !bboxesIntersect(feature._bbox, view)
                ) {
                    const hidden = existing.get(featureId)
                    if (hidden) {
                        hidden.remove()
                        existing.delete(featureId)
                    }
                    continue
                }

                seen.add(featureId)
                const coords = simplifyCoordinates(
                    feature.geometry?.coordinates,
                    stride,
                )
                const d = linePathFromCoordinates(coords, projection)
                if (!d) {
                    continue
                }

                let featureGroup = existing.get(featureId)
                if (!featureGroup) {
                    featureGroup = document.createElementNS(SVG_NS, 'g')
                    featureGroup.setAttribute('class', 'dreeve-route')
                    featureGroup.setAttribute('data-feature-id', featureId)
                    group.appendChild(featureGroup)

                    const line = document.createElementNS(SVG_NS, 'path')
                    line.setAttribute('class', 'dreeve-line')
                    line.setAttribute('fill', 'none')
                    line.setAttribute('stroke-linecap', 'round')
                    line.setAttribute('stroke-linejoin', 'round')
                    featureGroup.appendChild(line)
                }

                // Drop legacy hitboxes — routes must not capture pointer events
                const legacyHit = featureGroup.querySelector('.dreeve-hitbox')
                if (legacyHit) {
                    legacyHit.remove()
                }

                const line = featureGroup.querySelector('.dreeve-line')
                if (line) {
                    line.setAttribute('d', d)
                    line.setAttribute('stroke', style.lineColor)
                    line.setAttribute(
                        'stroke-opacity',
                        String(style.lineOpacity),
                    )
                    line.setAttribute('stroke-width', String(style.lineWidth))
                }
            }

            for (const [id, node] of existing.entries()) {
                if (!seen.has(id)) {
                    node.remove()
                }
            }

            invalidateSpatialGrid()
        }

        drawDreeve.enabled = function enabled(val) {
            if (!arguments.length) {
                return STATE.routesVisible
            }
            STATE.routesVisible = Boolean(val)
            requestRedraw()
            return drawDreeve
        }

        return drawDreeve
    }

    function ensureSvgLayer(context) {
        if (STATE.layerAdded) {
            return
        }
        const layers = context.layers?.()
        if (!layers || typeof layers.add !== 'function') {
            throw new Error('iD layers API is unavailable.')
        }
        // Avoid duplicate if a previous inject left one around
        const existing = layers.layer?.(LAYER_ID)
        if (!existing) {
            layers.add([
                {
                    id: LAYER_ID,
                    layer: createDreeveLayer(context),
                },
            ])
        }
        STATE.layerAdded = true
    }

    function injectOverlayCss() {
        let style = document.getElementById('dreeve-overlay-style')
        if (!style) {
            style = document.createElement('style')
            style.id = 'dreeve-overlay-style'
            ;(document.head || document.documentElement).appendChild(style)
        }
        style.textContent = `
            /* Hide broken/empty tile imagery for the dreeve overlay checkbox layer */
            .layer-overlay[data-layer="${OVERLAY_ID}"] img,
            .tiled-overlay.${OVERLAY_ID} img {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            /* Routes are visual-only — clicks pass through to OSM features below */
            g.dreeve-routes,
            g.dreeve-routes * {
                pointer-events: none !important;
            }
        `
    }

    async function registerOverlaySource(context) {
        if (
            !window.iD ||
            typeof window.iD.rendererBackgroundSource !== 'function'
        ) {
            throw new Error('iD.rendererBackgroundSource is unavailable.')
        }

        const background = context.background()
        const imagery = await background.ensureLoaded()

        imagery.backgrounds = (imagery.backgrounds || []).filter(
            (entry) => !entry || entry.id !== OVERLAY_ID,
        )

        const source = window.iD.rendererBackgroundSource({
            id: OVERLAY_ID,
            name: OVERLAY_LABEL,
            description:
                'Self-hosted dreeve activity routes (vector overlay from the dreeve Heatmap Plugin).',
            template: TRANSPARENT_TILE,
            zoomExtent: [0, 22],
            overlay: true,
            type: 'tms',
        })

        // Prefer sitting just below OpenStreetMap GPS traces (id: osm-gps).
        // iD overlay list sorts by area (desc) then name (asc). When osm-gps is
        // present we match its area and use a sort key after its live name() so
        // renames still work. If osm-gps is gone, keep the default name and
        // append to the end of the backgrounds list.
        const gpsSource = (imagery.backgrounds || []).find(
            (entry) => entry && entry.id === 'osm-gps',
        )

        if (gpsSource) {
            const gpsSortName =
                typeof gpsSource.name === 'function'
                    ? String(gpsSource.name())
                    : 'OpenStreetMap GPS traces'
            const sortName = `${gpsSortName}\u0001`

            source.name = function () {
                return sortName
            }
            source.label = function () {
                return function (selection) {
                    if (selection && typeof selection.text === 'function') {
                        selection.text(OVERLAY_LABEL)
                        return
                    }
                    if (selection && selection.textContent !== undefined) {
                        selection.textContent = OVERLAY_LABEL
                    }
                }
            }
            if (typeof gpsSource.area === 'function') {
                const gpsArea = gpsSource.area()
                source.area = function () {
                    return gpsArea
                }
            }

            const gpsIndex = imagery.backgrounds.findIndex(
                (entry) => entry && entry.id === 'osm-gps',
            )
            imagery.backgrounds.splice(gpsIndex + 1, 0, source)
        } else {
            imagery.backgrounds.push(source)
        }

        source.imageryUsed = function () {
            return OVERLAY_NAME
        }
        await background.init()

        try {
            if (
                context.history &&
                typeof context.history === 'function' &&
                !context.history().hasRestorableChanges?.()
            ) {
                await context.ui().restart()
            }
        } catch {
            // UI restart is best-effort; overlay source is still registered
        }

        STATE.overlayRegistered = true

        if (!STATE.backgroundBound) {
            STATE.backgroundBound = true
            try {
                background.on('change.dreeve', () => {
                    syncVisibilityFromBackground()
                })
            } catch {
                // Older iD builds may not support namespaced events
            }
            document.addEventListener('change', (event) => {
                const target = event.target
                if (
                    !(target instanceof HTMLElement) ||
                    !target.matches('input[type="checkbox"][name="layers"]')
                ) {
                    return
                }
                // Defer until iD finishes toggling overlay sources
                window.setTimeout(() => syncVisibilityFromBackground(), 0)
            })
        }

        return source
    }

    async function enableOverlayCheckbox(context) {
        const background = context.background()
        const source = background.findSource?.(OVERLAY_ID)
        if (!source) {
            return
        }
        const alreadyOn = (background.overlayLayerSources() || []).some(
            (entry) => entry && entry.id === OVERLAY_ID,
        )
        if (!alreadyOn) {
            background.toggleOverlayLayer(source)
        }
    }

    async function disableOverlayCheckbox(context) {
        const background = context.background()
        const active = (background.overlayLayerSources() || []).filter(
            (entry) => entry && entry.id === OVERLAY_ID,
        )
        for (const source of active) {
            background.toggleOverlayLayer(source)
        }
    }

    async function unregisterOverlaySource(context) {
        if (!STATE.overlayRegistered) {
            return
        }
        try {
            await disableOverlayCheckbox(context)
            const background = context.background()
            const imagery = await background.ensureLoaded()
            imagery.backgrounds = (imagery.backgrounds || []).filter(
                (entry) => !entry || entry.id !== OVERLAY_ID,
            )
            await background.init()
            try {
                if (
                    context.history &&
                    typeof context.history === 'function' &&
                    !context.history().hasRestorableChanges?.()
                ) {
                    await context.ui().restart()
                }
            } catch {
                // best-effort
            }
        } catch {
            // best-effort cleanup
        }
        STATE.overlayRegistered = false
    }

    async function applyRoutes(routes, style) {
        if (!STATE.context || !STATE.ready) {
            throw new Error('iD editor is not ready yet.')
        }

        const features = toGeoJsonFeatures(routes)
        if (!features.length) {
            throw new Error('No routes to draw.')
        }

        STATE.style = normalizeStyle(style)
        STATE.features = features
        STATE.overlayApplied = true
        invalidateSpatialGrid()

        injectOverlayCss()
        ensureSvgLayer(STATE.context)

        if (!STATE.overlayRegistered) {
            await registerOverlaySource(STATE.context)
        }
        await enableOverlayCheckbox(STATE.context)
        STATE.routesVisible = true
        bindMapHover()
        requestRedraw()

        return features.length
    }

    function updateRoutesStyle(style) {
        if (!STATE.overlayApplied) {
            throw new Error('Overlay is not active.')
        }
        STATE.style = normalizeStyle(style)
        requestRedraw()
    }

    async function disableRoutes() {
        unbindMapHover()
        hideTooltip()
        STATE.features = []
        STATE.overlayApplied = false
        STATE.routesVisible = false
        invalidateSpatialGrid()

        if (STATE.context) {
            await unregisterOverlaySource(STATE.context)
            requestRedraw()
        }
    }

    function setupiDCoreContextListener(initCallback) {
        if (window.__dreeveIdPatched) {
            return
        }
        window.__dreeveIdPatched = true

        let originalCoreContext = null

        function wrappedCoreContext(...args) {
            const context = originalCoreContext.apply(this, args)
            const originalInit = context.init.bind(context)
            context.init = () => {
                const result = originalInit()
                initCallback(context)
                return result
            }
            return context
        }

        function makeProxy(raw) {
            originalCoreContext = raw.coreContext
            return new Proxy(raw, {
                get(target, prop) {
                    if (prop === 'coreContext') {
                        return wrappedCoreContext
                    }
                    return target[prop]
                },
                set(target, prop, value) {
                    target[prop] = value
                    return true
                },
            })
        }

        if (window.iD && typeof window.iD.coreContext === 'function') {
            const proxy = makeProxy(window.iD)
            try {
                Object.defineProperty(window, 'iD', {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: proxy,
                })
            } catch {
                window.iD = proxy
            }
            return
        }

        // Intercept assignment of window.iD (coreContext is a non-configurable getter)
        let heldProxy = null
        Object.defineProperty(window, 'iD', {
            configurable: true,
            enumerable: true,
            get() {
                return heldProxy
            },
            set(val) {
                heldProxy = makeProxy(val)
                try {
                    Object.defineProperty(window, 'iD', {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: heldProxy,
                    })
                } catch {
                    // keep accessor if redefine fails
                }
            },
        })
    }

    function restoreiDContainer() {
        const placeholder = document.querySelector(
            '#id-container[data-dreeve-placeholder="1"]',
        )
        if (placeholder) {
            placeholder.remove()
        }
        document.dispatchEvent(
            new Event('DOMContentLoaded', {
                bubbles: true,
                cancelable: true,
            }),
        )
    }

    function waitForID(timeoutMs = 20000) {
        return new Promise((resolve, reject) => {
            if (window.iD && typeof window.iD.coreContext === 'function') {
                resolve(window.iD)
                return
            }
            const started = Date.now()
            const timer = window.setInterval(() => {
                if (window.iD && typeof window.iD.coreContext === 'function') {
                    window.clearInterval(timer)
                    resolve(window.iD)
                    return
                }
                if (Date.now() - started > timeoutMs) {
                    window.clearInterval(timer)
                    reject(
                        new Error('Timed out waiting for iD editor to load.'),
                    )
                }
            }, 50)
        })
    }

    async function flushPending() {
        if (!STATE.pending || STATE.pending.action !== 'apply') {
            STATE.pending = null
            return
        }
        const pending = STATE.pending
        STATE.pending = null
        try {
            const count = await applyRoutes(pending.routes, pending.style)
            postResponse({
                requestId: pending.requestId,
                ok: true,
                enabled: true,
                routeCount: count,
            })
        } catch (error) {
            postResponse({
                requestId: pending.requestId,
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Overlay bridge failed.',
            })
        }
    }

    window.addEventListener(EVENT_REQUEST, (event) => {
        const detail = event.detail || {}
        const requestId = detail.requestId

        ;(async () => {
            try {
                if (!requestId) {
                    return
                }

                if (detail.action === 'status') {
                    postResponse({
                        requestId,
                        ok: true,
                        ready: STATE.ready,
                        active: STATE.overlayApplied && STATE.routesVisible,
                    })
                    return
                }

                if (detail.action === 'disable') {
                    // Cancel any queued apply so a later boot does not redraw routes
                    STATE.pending = null
                    STATE.overlayApplied = false
                    STATE.features = []
                    STATE.routesVisible = false
                    invalidateSpatialGrid()
                    hideTooltip()

                    if (!STATE.ready) {
                        postResponse({
                            requestId,
                            ok: true,
                            enabled: false,
                            routeCount: 0,
                        })
                        return
                    }
                    await disableRoutes()
                    postResponse({
                        requestId,
                        ok: true,
                        enabled: false,
                        routeCount: 0,
                    })
                    return
                }

                if (detail.action === 'updateStyle') {
                    updateRoutesStyle(detail.style)
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

                const routes = Array.isArray(detail.routes) ? detail.routes : []
                if (!routes.length) {
                    throw new Error('No routes to draw.')
                }

                if (!STATE.ready) {
                    STATE.pending = {
                        action: 'apply',
                        requestId,
                        routes,
                        style: detail.style,
                    }
                    return
                }

                const count = await applyRoutes(routes, detail.style)
                postResponse({
                    requestId,
                    ok: true,
                    enabled: true,
                    routeCount: count,
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
        })()
    })
    ;(async () => {
        try {
            // Install Proxy intercept before/as iD assigns window.iD
            setupiDCoreContextListener(async (context) => {
                try {
                    STATE.context = context
                    await context.ui().ensureLoaded()
                    injectOverlayCss()
                    ensureSvgLayer(context)
                    STATE.ready = true
                    await flushPending()
                } catch (error) {
                    console.error(
                        '[dreeve] Failed to initialize iD overlay bridge:',
                        error,
                    )
                }
            })
            if (!window.iD) {
                await waitForID().catch(() => null)
            }
            restoreiDContainer()
        } catch (error) {
            console.error('[dreeve] iD bridge startup failed:', error)
        }
    })()
})()
