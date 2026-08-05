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
    }

    const SOURCE_ID = 'strava-routes-source'
    const LAYER_ID = 'strava-routes-layer'
    const HITBOX_LAYER_ID = 'strava-routes-hitbox-layer'
    const EVENT_REQUEST = 'STRAVA_OVERLAY_REQUEST'
    const EVENT_RESPONSE = 'STRAVA_OVERLAY_RESPONSE'

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
        for (const value of Object.values(window)) {
            if (isValidMapCandidate(value)) {
                setMapInstance(value)
                return true
            }
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

    function removeOverlay() {
        if (!STATE.map) {
            return
        }
        hidePopup()
        hideTooltip()
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
        if (STATE.map.getLayer(HITBOX_LAYER_ID)) {
            STATE.map.removeLayer(HITBOX_LAYER_ID)
        }
        if (STATE.map.getLayer(LAYER_ID)) {
            STATE.map.removeLayer(LAYER_ID)
        }
        if (STATE.map.getSource(SOURCE_ID)) {
            STATE.map.removeSource(SOURCE_ID)
        }
        STATE.overlayApplied = false
    }

    function toGeoJsonLineCollection(routes) {
        return {
            type: 'FeatureCollection',
            features: routes.map((route, index) => ({
                type: 'Feature',
                id: route.id || `route-${index}`,
                properties: {
                    activityId: route?.metadata?.activityId || route.id || '',
                    name: route?.metadata?.name || '',
                    startDate: route?.metadata?.startDate || '',
                    distance: route?.metadata?.distance || '',
                    sportType: route?.metadata?.sportType || '',
                    activityUrl: route?.metadata?.activityUrl || '',
                    stravaUrl: route?.metadata?.stravaUrl || '',
                },
                geometry: {
                    type: 'LineString',
                    coordinates: route.points.map((point) => [
                        point[1],
                        point[0],
                    ]),
                },
            })),
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
        const parser = document.createElement('textarea')
        parser.innerHTML = text
        return parser.value
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
            links += `<div><a href="${escapeHtml(activityUrl)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa; text-decoration:underline; font-weight:600; cursor:pointer;">Open in dreeve</a></div>`
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

    function drawOverlay(routes, style) {
        if (!STATE.map) {
            throw new Error('Map instance is not ready yet.')
        }

        const data = toGeoJsonLineCollection(routes)
        removeOverlay()

        STATE.map.addSource(SOURCE_ID, {
            type: 'geojson',
            data,
        })

        const normalizedStyle = normalizeStyle(style)
        const hitboxWidth = Math.max(normalizedStyle.lineWidth + 8, 12)

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
            },
        })

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
            },
        })

        bindLayerInteractions()
        STATE.overlayApplied = true
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
            if (!routes.length) {
                throw new Error('No routes to draw.')
            }

            drawOverlay(routes, detail.style)
            postResponse({
                requestId,
                ok: true,
                enabled: true,
                routeCount: routes.length,
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
