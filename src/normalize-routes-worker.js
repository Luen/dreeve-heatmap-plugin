;(() => {
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
        if (!selectedCategories || selectedCategories.size === 0) {
            return true
        }
        const category = getCategoryForSportType(sportType)
        return Boolean(category && selectedCategories.has(category))
    }

    function parseSelectedCategories(sportTypes) {
        const selected = new Set()
        if (!Array.isArray(sportTypes)) {
            return selected
        }
        for (const value of sportTypes) {
            const item = String(value || '').trim()
            if (item && SPORT_CATEGORY_MAP[item]) {
                selected.add(item)
            }
        }
        return selected
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
        const applyCategoryFilter =
            shouldFilterByCategory && !allCategoriesSelected

        const routes = []
        for (let index = 0; index < payload.length; index += 1) {
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
