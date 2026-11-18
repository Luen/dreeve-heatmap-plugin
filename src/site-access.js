/**
 * Per-site enable helpers shared by the popup and the background service
 * worker (ES module). The content script is a classic script and keeps its own
 * copy of BUILT_IN_HOSTS / normalizeSiteEnabledMap; keep them in sync.
 */

/** Hosts covered by the static `content_scripts` in manifest.json. */
export const BUILT_IN_HOSTS = new Set([
    'gpx.studio',
    'studio.wanderstories.space',
    'www.openstreetmap.org',
])

/** Files injected into a page, in order (manifest, popup and dynamic registration). */
export const CONTENT_SCRIPT_FILES = [
    'src/route-normalize.js',
    'src/content-script.js',
]

export const SITE_ENABLED_STORAGE_KEY = 'siteEnabledByOrigin'

const SITE_SCRIPT_ID_PREFIX = 'dreeve-site:'

export function isBuiltInHost(hostname) {
    return BUILT_IN_HOSTS.has(String(hostname || ''))
}

export function normalizeSiteEnabledMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {}
    }
    const normalized = {}
    for (const [origin, value] of Object.entries(raw)) {
        if (
            typeof origin === 'string' &&
            origin &&
            typeof value === 'boolean'
        ) {
            normalized[origin] = value
        }
    }
    return normalized
}

/**
 * Match pattern for an http(s) origin. Chrome match patterns cannot express a
 * port, so this covers every port on the host; the content script still checks
 * the exact origin against `siteEnabledByOrigin` before doing anything.
 */
function matchPatternForOrigin(origin) {
    try {
        const url = new URL(origin)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null
        }
        return { pattern: `${url.protocol}//${url.hostname}/*`, url }
    } catch {
        return null
    }
}

function sameFiles(a, b) {
    return (
        Array.isArray(a) &&
        a.length === b.length &&
        a.every((file, index) => file === b[index])
    )
}

async function reconcileSiteContentScripts(rawSiteMap) {
    const wanted = new Map()
    for (const [origin, enabled] of Object.entries(
        normalizeSiteEnabledMap(rawSiteMap),
    )) {
        const match = enabled ? matchPatternForOrigin(origin) : null
        if (!match || isBuiltInHost(match.url.hostname)) {
            continue
        }
        wanted.set(`${SITE_SCRIPT_ID_PREFIX}${match.pattern}`, match.pattern)
    }

    const registered = (
        await chrome.scripting.getRegisteredContentScripts()
    ).filter((script) => script.id.startsWith(SITE_SCRIPT_ID_PREFIX))

    // Drop scripts for disabled sites, and ones whose file list is out of date
    // after an extension update (they are re-registered below).
    const stale = registered.filter(
        (script) =>
            !wanted.has(script.id) ||
            !sameFiles(script.js, CONTENT_SCRIPT_FILES),
    )
    if (stale.length > 0) {
        await chrome.scripting.unregisterContentScripts({
            ids: stale.map((script) => script.id),
        })
    }

    const kept = new Set(
        registered
            .filter((script) => !stale.includes(script))
            .map((script) => script.id),
    )
    const toRegister = [...wanted]
        .filter(([id]) => !kept.has(id))
        .map(([id, pattern]) => ({
            id,
            matches: [pattern],
            js: CONTENT_SCRIPT_FILES,
            runAt: 'document_idle',
            persistAcrossSessions: true,
        }))
    if (toRegister.length > 0) {
        await chrome.scripting.registerContentScripts(toRegister)
    }
}

let syncQueue = Promise.resolve()

/**
 * Register a persistent content script for every enabled custom site and
 * remove the rest, so the overlay comes back after a page reload. Calls are
 * serialized so quick toggles cannot race into duplicate script IDs.
 */
export function syncSiteContentScripts(rawSiteMap) {
    syncQueue = syncQueue
        .catch(() => {})
        .then(() => reconcileSiteContentScripts(rawSiteMap))
    return syncQueue
}
