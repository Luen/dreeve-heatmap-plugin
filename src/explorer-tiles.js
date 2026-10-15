/**
 * Zoom-14 explorer tile math (ported from Dreeve v5.6.0).
 * Exposed on globalThis.DreeveExplorerTiles for the page bridge.
 */
;(function (global) {
    const ZOOM = 14
    const TILES_PER_AXIS = 1 << ZOOM

    const tileToLongitude = (x) => (x / TILES_PER_AXIS) * 360 - 180
    const tileToLatitude = (y) =>
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILES_PER_AXIS))) * 180) /
        Math.PI

    function tileX(key) {
        return Math.floor(key / TILES_PER_AXIS)
    }

    function tileY(key) {
        return key % TILES_PER_AXIS
    }

    function tileKey(x, y) {
        return x * TILES_PER_AXIS + y
    }

    function neighbours(key) {
        const x = tileX(key)
        const y = tileY(key)

        return [
            x > 0 ? key - TILES_PER_AXIS : null,
            x < TILES_PER_AXIS - 1 ? key + TILES_PER_AXIS : null,
            y > 0 ? key - 1 : null,
            y < TILES_PER_AXIS - 1 ? key + 1 : null,
        ]
    }

    function clusters(visitedTiles) {
        const clusterTiles = new Set(
            [...visitedTiles].filter((tile) =>
                neighbours(tile).every((neighbour) =>
                    visitedTiles.has(neighbour),
                ),
            ),
        )

        let maxCluster = new Set()
        const seen = new Set()
        clusterTiles.forEach((start) => {
            if (seen.has(start)) {
                return
            }

            const cluster = new Set([start])
            const queue = [start]
            seen.add(start)
            while (queue.length > 0) {
                neighbours(queue.pop()).forEach((neighbour) => {
                    if (!clusterTiles.has(neighbour) || seen.has(neighbour)) {
                        return
                    }
                    seen.add(neighbour)
                    cluster.add(neighbour)
                    queue.push(neighbour)
                })
            }

            if (cluster.size > maxCluster.size) {
                maxCluster = cluster
            }
        })

        return { clusterTiles, maxCluster }
    }

    function maxSquare(visitedTiles) {
        const sizes = new Map()
        let max = null
        ;[...visitedTiles]
            .sort((a, b) => a - b)
            .forEach((tile) => {
                const x = tileX(tile)
                const y = tileY(tile)
                const size =
                    1 +
                    Math.min(
                        x > 0 ? (sizes.get(tile - TILES_PER_AXIS) ?? 0) : 0,
                        y > 0 ? (sizes.get(tile - 1) ?? 0) : 0,
                        x > 0 && y > 0
                            ? (sizes.get(tile - TILES_PER_AXIS - 1) ?? 0)
                            : 0,
                    )
                sizes.set(tile, size)

                if (!max || size > max.size) {
                    max = { x: x - size + 1, y: y - size + 1, size }
                }
            })

        return max
    }

    /**
     * @returns {[[number, number], [number, number]]} [[south, west], [north, east]]
     */
    function tileBounds(key) {
        const x = tileX(key)
        const y = tileY(key)

        return [
            [tileToLatitude(y + 1), tileToLongitude(x)],
            [tileToLatitude(y), tileToLongitude(x + 1)],
        ]
    }

    global.DreeveExplorerTiles = {
        ZOOM,
        TILES_PER_AXIS,
        tileX,
        tileY,
        tileKey,
        tileBounds,
        clusters,
        maxSquare,
    }
})(typeof globalThis !== 'undefined' ? globalThis : window)
