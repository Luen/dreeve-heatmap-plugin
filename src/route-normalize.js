/**
 * Shared route filtering and normalization.
 *
 * Loaded before `content-script.js` (main-thread fallback) and prepended to
 * `normalize-routes-worker.js` when the worker is built, so both paths run
 * identical logic. Exposed on globalThis.DreeveRouteNormalize. Must not use
 * extension APIs: it also runs inside a plain Web Worker.
 */
;(function (global) {
    if (global.DreeveRouteNormalize) {
        return
    }

    /** Never drawn, whatever the sport filter. */
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

        // Evolving Strava ride variants (e.g. EMountainBikeRide): if Ride is
        // selected, include any non-virtual *Ride type.
        return (
            selectedCategories.has('Ride') &&
            /Ride$/i.test(normalizedType) &&
            !EXCLUDED_SPORT_TYPES.has(normalizedType)
        )
    }

    function parseSelectedCategories(rawValue) {
        const selected = new Set()
        if (!Array.isArray(rawValue)) {
            return selected
        }
        for (const value of rawValue) {
            const normalized = String(value || '').trim()
            if (normalized && SPORT_CATEGORY_MAP[normalized]) {
                selected.add(normalized)
            }
        }
        return selected
    }

    /**
     * Build a predicate for `filterables.sportType`. Virtual activities are
     * always excluded; categories only filter when some (not all) are selected.
     */
    function createSportTypeFilter(sportTypes) {
        const selectedCategories = parseSelectedCategories(sportTypes)
        const allCategoriesSelected = Object.keys(SPORT_CATEGORY_MAP).every(
            (category) => selectedCategories.has(category),
        )
        const applyCategoryFilter =
            selectedCategories.size > 0 && !allCategoriesSelected

        return (sportType) => {
            if (EXCLUDED_SPORT_TYPES.has(sportType)) {
                return false
            }
            return (
                !applyCategoryFilter ||
                isSportTypeInSelectedCategories(sportType, selectedCategories)
            )
        }
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

    /**
     * Normalize one API activity into `{ id, points: [lng, lat][], metadata }`,
     * or return null when it is filtered out or has fewer than two points.
     */
    function normalizeRouteItem(item, includeSportType, endpoint) {
        if (!item || !Array.isArray(item.coordinates)) {
            return null
        }

        const sportType = String(item?.filterables?.sportType || '').trim()
        if (!includeSportType(sportType)) {
            return null
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
        if (points.length < 2) {
            return null
        }

        const activityId = String(item.id || '').trim()
        return {
            id: activityId,
            points,
            metadata: {
                activityId,
                name: String(item.name || '').trim(),
                startDate: String(item.startDate || '').trim(),
                distance: String(item.distance || '').trim(),
                sportType,
                activityUrl: resolveActivityUrl(item.activityUrl, endpoint),
                stravaUrl: buildStravaActivityUrl(activityId),
            },
        }
    }

    function assertRoutesPayload(payload) {
        if (!Array.isArray(payload)) {
            throw new Error('Expected routes payload to be an array.')
        }
    }

    /** Synchronous normalize of a whole payload (used by the worker). */
    function normalizeRoutes(payload, filters = {}) {
        assertRoutesPayload(payload)
        const includeSportType = createSportTypeFilter(filters.sportTypes)
        const routes = []
        for (let index = 0; index < payload.length; index += 1) {
            const route = normalizeRouteItem(
                payload[index],
                includeSportType,
                filters.endpoint,
            )
            if (route) {
                routes.push(route)
            }
        }
        return routes
    }

    global.DreeveRouteNormalize = Object.freeze({
        parseSelectedCategories,
        createSportTypeFilter,
        normalizeRouteItem,
        normalizeRoutes,
        assertRoutesPayload,
    })
})(globalThis)
