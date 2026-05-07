;(function () {
    const STATE = {
        map: null,
        ready: false,
        overlayApplied: false,
    }

    const SOURCE_ID = 'strava-routes-source'
    const LAYER_ID = 'strava-routes-layer'
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

    function removeOverlay() {
        if (!STATE.map) {
            return
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
                properties: {},
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

    function drawOverlay(routes) {
        if (!STATE.map) {
            throw new Error('Map instance is not ready yet.')
        }

        const data = toGeoJsonLineCollection(routes)
        removeOverlay()

        STATE.map.addSource(SOURCE_ID, {
            type: 'geojson',
            data,
        })

        STATE.map.addLayer({
            id: LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            paint: {
                'line-color': '#ff4500',
                'line-opacity': 0.35,
                'line-width': 2,
            },
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
            },
        })

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

            drawOverlay(routes)
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
