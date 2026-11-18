/**
 * Route normalize worker. The content script builds this worker from
 * `route-normalize.js` followed by this file (see createNormalizeWorker), so
 * self.DreeveRouteNormalize is defined before this runs.
 */
;(() => {
    const { normalizeRoutes } = self.DreeveRouteNormalize

    self.onmessage = (event) => {
        const data = event.data || {}
        const requestId = data.requestId
        try {
            const routes = normalizeRoutes(data.payload, data.filters || {})
            self.postMessage({ requestId, ok: true, routes })
        } catch (error) {
            self.postMessage({
                requestId,
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Failed to normalize routes.',
            })
        }
    }
})()
