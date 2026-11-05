const STORAGE_KEYS = {
    endpoint: 'routesEndpoint',
    enabled: 'overlayEnabled',
    lineColor: 'lineColor',
    lineOpacity: 'lineOpacity',
    lineWidth: 'lineWidth',
    sportTypes: 'sportTypes',
    showRoutes: 'showRoutes',
    showTiles: 'showTiles',
    siteEnabledByOrigin: 'siteEnabledByOrigin',
}

const BUILT_IN_HOSTS = new Set([
    'gpx.studio',
    'studio.wanderstories.space',
    'www.openstreetmap.org',
])

const SPORT_TYPE_OPTIONS = [
    { value: 'Ride', label: 'Ride' },
    { value: 'Walk', label: 'Walk' },
    { value: 'Water', label: 'Water' },
    { value: 'Winter', label: 'Winter' },
]

const DEBOUNCE_MS = 250

const endpointInput = document.getElementById('endpoint')
const lineColorInput = document.getElementById('lineColor')
const lineOpacityInput = document.getElementById('lineOpacity')
const lineWidthInput = document.getElementById('lineWidth')
const sportTypesGroup = document.getElementById('sportTypesGroup')
const showRoutesInput = document.getElementById('showRoutes')
const showTilesInput = document.getElementById('showTiles')
const showTilesLabel = document.getElementById('showTilesLabel')
const tilesHostNote = document.getElementById('tilesHostNote')
const siteEnabledInput = document.getElementById('siteEnabled')
const siteEnabledLabel = document.getElementById('siteEnabledLabel')
const siteHostNote = document.getElementById('siteHostNote')
const sportsSelectAllButton = document.getElementById('sportsSelectAll')
const sportsClearAllButton = document.getElementById('sportsClearAll')
const toggleButton = document.getElementById('toggle')
const statusEl = document.getElementById('status')
const versionEl = document.getElementById('version')

let numberPersistTimer = null
let persistInFlight = null

function formatOverlayCounts(response) {
    const routes = Number(response?.routeCount) || 0
    const tiles = Number(response?.tileCount) || 0
    let message = `${routes} routes, ${tiles} tiles`
    if (response?.tilesWarning) {
        message += ` — ${response.tilesWarning}`
    }
    return message
}

function setStatus(message, isError = false) {
    statusEl.textContent = message
    statusEl.style.color = isError ? '#fca5a5' : '#a7f3d0'
}

function isValidEndpoint(value) {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab
}

async function getSettings() {
    return chrome.storage.sync.get({
        [STORAGE_KEYS.endpoint]: '',
        [STORAGE_KEYS.enabled]: false,
        [STORAGE_KEYS.lineColor]: '#ff4500',
        [STORAGE_KEYS.lineOpacity]: 0.35,
        [STORAGE_KEYS.lineWidth]: 2,
        [STORAGE_KEYS.sportTypes]: [],
        [STORAGE_KEYS.showRoutes]: true,
        [STORAGE_KEYS.showTiles]: true,
        [STORAGE_KEYS.siteEnabledByOrigin]: {},
    })
}

function normalizeSiteEnabledMap(raw) {
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

function tabOrigin(url) {
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return ''
        }
        return parsed.origin
    } catch {
        return ''
    }
}

function isBuiltInHost(hostname) {
    return BUILT_IN_HOSTS.has(String(hostname || ''))
}

function isSiteEnabledForOrigin(origin, siteEnabledByOrigin) {
    if (!origin) {
        return false
    }
    const map = normalizeSiteEnabledMap(siteEnabledByOrigin)
    if (Object.prototype.hasOwnProperty.call(map, origin)) {
        return map[origin] === true
    }
    try {
        return isBuiltInHost(new URL(origin).hostname)
    } catch {
        return false
    }
}

async function saveSettings(partial) {
    await chrome.storage.sync.set(partial)
}

async function sendApplyToTab(tabId, endpoint, enabled, forceRefresh = false) {
    const message = { type: 'APPLY_OVERLAY', endpoint, enabled, forceRefresh }

    const sendToFrame = (frameId) =>
        new Promise((resolve) => {
            const callback = (response) => {
                if (chrome.runtime.lastError) {
                    resolve({
                        ok: false,
                        error: chrome.runtime.lastError.message,
                    })
                    return
                }
                resolve(
                    response || {
                        ok: false,
                        error: 'No response from content script.',
                    },
                )
            }
            if (typeof frameId === 'number') {
                chrome.tabs.sendMessage(tabId, message, { frameId }, callback)
            } else {
                chrome.tabs.sendMessage(tabId, message, callback)
            }
        })

    // OSM /edit embeds iD in an /id iframe — message that frame when present.
    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId })
        const idFrame = (frames || []).find((frame) => {
            try {
                const parsed = new URL(frame.url)
                return (
                    parsed.hostname === 'www.openstreetmap.org' &&
                    parsed.pathname.startsWith('/id')
                )
            } catch {
                return false
            }
        })
        if (idFrame && typeof idFrame.frameId === 'number') {
            const iframeResponse = await sendToFrame(idFrame.frameId)
            if (iframeResponse.ok) {
                return iframeResponse
            }
        }
    } catch {
        // Fall through to main-frame messaging (gpx / Wanderstories / direct /id)
    }

    return sendToFrame(0)
}

function isOsmTabUrl(url) {
    if (!url) {
        return false
    }
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false
        }
        // Users open /edit; iD itself runs on /id (often in an iframe).
        return (
            parsed.hostname === 'www.openstreetmap.org' &&
            (parsed.pathname.startsWith('/edit') ||
                parsed.pathname.startsWith('/id'))
        )
    } catch {
        return false
    }
}

function updateTilesHostUi(isOsm) {
    showTilesInput.disabled = isOsm
    showTilesLabel.classList.toggle('is-disabled', isOsm)
    tilesHostNote.hidden = !isOsm
}

function updateSiteEnabledUi(tab, siteEnabledByOrigin) {
    const origin = tabOrigin(tab?.url)
    const eligible = Boolean(origin)
    siteEnabledInput.disabled = !eligible
    siteEnabledLabel.classList.toggle('is-disabled', !eligible)
    if (!eligible) {
        siteEnabledInput.checked = false
        siteHostNote.textContent =
            'Open an http(s) page to enable the overlay on that site.'
        return origin
    }
    siteEnabledInput.checked = isSiteEnabledForOrigin(
        origin,
        siteEnabledByOrigin,
    )
    try {
        const hostname = new URL(origin).hostname
        siteHostNote.textContent = isBuiltInHost(hostname)
            ? 'Built-in host (on by default). Uncheck to skip this site.'
            : 'Custom site. Enable here, then Enable the overlay (needs a MapLibre / Mapbox map).'
    } catch {
        siteHostNote.textContent =
            'Enable this site, then Enable the overlay when a map is present.'
    }
    return origin
}

function sendProbeToFrame(tabId, frameId) {
    return new Promise((resolve) => {
        const callback = (response) => {
            if (chrome.runtime.lastError || !response) {
                resolve({ ok: false, ready: false })
                return
            }
            resolve({
                ok: Boolean(response.ok),
                ready: Boolean(response.ready),
                error: response.error || '',
            })
        }
        const message = { type: 'PROBE_MAP' }
        if (typeof frameId === 'number') {
            chrome.tabs.sendMessage(tabId, message, { frameId }, callback)
        } else {
            chrome.tabs.sendMessage(tabId, message, callback)
        }
    })
}

async function probeMapReady(tabId) {
    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId })
        const idFrame = (frames || []).find((frame) => {
            try {
                const parsed = new URL(frame.url)
                return (
                    parsed.hostname === 'www.openstreetmap.org' &&
                    parsed.pathname.startsWith('/id')
                )
            } catch {
                return false
            }
        })
        if (idFrame && typeof idFrame.frameId === 'number') {
            const iframeProbe = await sendProbeToFrame(tabId, idFrame.frameId)
            if (iframeProbe.ok || iframeProbe.ready) {
                return iframeProbe
            }
        }
    } catch {
        // Fall through to main-frame probe
    }
    return sendProbeToFrame(tabId, 0)
}

function pingContentScript(tabId, frameId) {
    return new Promise((resolve) => {
        const callback = (response) => {
            if (chrome.runtime.lastError || !response || !response.ok) {
                resolve(false)
                return
            }
            resolve(true)
        }
        const message = { type: 'GET_OVERLAY_STATUS' }
        if (typeof frameId === 'number') {
            chrome.tabs.sendMessage(tabId, message, { frameId }, callback)
        } else {
            chrome.tabs.sendMessage(tabId, message, callback)
        }
    })
}

async function contentScriptAlive(tabId) {
    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId })
        const idFrame = (frames || []).find((frame) => {
            try {
                const parsed = new URL(frame.url)
                return (
                    parsed.hostname === 'www.openstreetmap.org' &&
                    parsed.pathname.startsWith('/id')
                )
            } catch {
                return false
            }
        })
        if (idFrame && typeof idFrame.frameId === 'number') {
            if (await pingContentScript(tabId, idFrame.frameId)) {
                return true
            }
        }
    } catch {
        // Fall through to main-frame ping
    }
    return pingContentScript(tabId, 0)
}

async function ensureContentScript(tabId) {
    if (await contentScriptAlive(tabId)) {
        return
    }
    await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['src/content-script.js'],
    })
}

function updateToggleLabel(enabled) {
    toggleButton.textContent = enabled ? 'Disable' : 'Enable'
    toggleButton.style.background = enabled ? '#ef4444' : '#22c55e'
}

async function initialize() {
    versionEl.textContent = `Version ${chrome.runtime.getManifest().version}`
    const settings = await getSettings()
    endpointInput.value = String(settings[STORAGE_KEYS.endpoint] || '')
    lineColorInput.value = String(settings[STORAGE_KEYS.lineColor] || '#ff4500')
    lineOpacityInput.value = String(settings[STORAGE_KEYS.lineOpacity] ?? 0.35)
    lineWidthInput.value = String(settings[STORAGE_KEYS.lineWidth] ?? 2)
    showRoutesInput.checked = settings[STORAGE_KEYS.showRoutes] !== false
    showTilesInput.checked = settings[STORAGE_KEYS.showTiles] !== false
    renderSportTypeCheckboxes(settings[STORAGE_KEYS.sportTypes])
    updateToggleLabel(Boolean(settings[STORAGE_KEYS.enabled]))
    const tab = await getActiveTab()
    updateTilesHostUi(isOsmTabUrl(tab?.url))
    updateSiteEnabledUi(tab, settings[STORAGE_KEYS.siteEnabledByOrigin])
}

function normalizeSportTypes(rawValue) {
    const allowed = new Set(SPORT_TYPE_OPTIONS.map((option) => option.value))
    if (!Array.isArray(rawValue)) {
        return []
    }

    const normalized = new Set()
    for (const value of rawValue) {
        const item = String(value).trim()
        if (!item) {
            continue
        }
        if (allowed.has(item)) {
            normalized.add(item)
        }
    }

    return [...normalized]
}

function renderSportTypeCheckboxes(rawValue) {
    const selected = new Set(normalizeSportTypes(rawValue))
    sportTypesGroup.innerHTML = ''

    for (const option of SPORT_TYPE_OPTIONS) {
        const id = `sportType-${option.value}`
        const wrapper = document.createElement('label')
        wrapper.className = 'checkbox-item'
        wrapper.setAttribute('for', id)
        wrapper.innerHTML = `<input id="${id}" type="checkbox" value="${option.value}" /> <span>${option.label}</span>`
        const checkbox = wrapper.querySelector('input')
        checkbox.checked = selected.has(option.value)
        sportTypesGroup.appendChild(wrapper)
    }
}

function getSelectedSportTypes() {
    return Array.from(
        sportTypesGroup.querySelectorAll('input[type="checkbox"]:checked'),
    ).map((el) => el.value)
}

function setAllSportTypeSelection(checked) {
    for (const checkbox of sportTypesGroup.querySelectorAll(
        'input[type="checkbox"]',
    )) {
        checkbox.checked = checked
    }
}

/**
 * @param {{ showTilesOverride?: boolean }} [options]
 */
function getStyleAndFilterInputValues(options = {}) {
    const lineColor = String(lineColorInput.value || '').trim()
    const lineOpacity = Number(lineOpacityInput.value)
    const lineWidth = Number(lineWidthInput.value)
    const sportTypes = getSelectedSportTypes()
    const showRoutes = Boolean(showRoutesInput.checked)
    const showTiles =
        typeof options.showTilesOverride === 'boolean'
            ? options.showTilesOverride
            : Boolean(showTilesInput.checked)

    if (!/^#[0-9a-fA-F]{6}$/.test(lineColor)) {
        throw new Error('Route color must be a valid hex color.')
    }
    if (
        !Number.isFinite(lineOpacity) ||
        lineOpacity < 0.05 ||
        lineOpacity > 1
    ) {
        throw new Error('Opacity must be between 0.05 and 1.')
    }
    if (!Number.isFinite(lineWidth) || lineWidth < 1 || lineWidth > 12) {
        throw new Error('Width must be between 1 and 12.')
    }

    return {
        lineColor,
        lineOpacity,
        lineWidth,
        sportTypes,
        [STORAGE_KEYS.showRoutes]: showRoutes,
        [STORAGE_KEYS.showTiles]: showTiles,
    }
}

async function readStyleAndFilterForActiveTab() {
    const [settings, tab] = await Promise.all([getSettings(), getActiveTab()])
    const showTilesOverride = isOsmTabUrl(tab?.url)
        ? settings[STORAGE_KEYS.showTiles] !== false
        : undefined
    return getStyleAndFilterInputValues({ showTilesOverride })
}

function debounceNumberPersist() {
    if (numberPersistTimer) {
        clearTimeout(numberPersistTimer)
    }
    numberPersistTimer = setTimeout(() => {
        numberPersistTimer = null
        void persistAndMaybeApply()
    }, DEBOUNCE_MS)
}

/**
 * @param {{ includeEndpoint?: boolean }} [options]
 */
async function persistAndMaybeApply(options = {}) {
    const includeEndpoint = Boolean(options.includeEndpoint)
    const run = async () => {
        const settings = await getSettings()
        let styleAndFilter
        try {
            styleAndFilter = await readStyleAndFilterForActiveTab()
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? error.message
                    : 'Invalid style settings.',
                true,
            )
            return
        }

        const inputEndpoint = endpointInput.value.trim()
        let endpoint = String(settings[STORAGE_KEYS.endpoint] || '').trim()

        if (includeEndpoint) {
            if (!isValidEndpoint(inputEndpoint)) {
                // Ignore empty/invalid blur; keep prior stored value.
                return
            }
            endpoint = inputEndpoint
        } else if (isValidEndpoint(inputEndpoint)) {
            endpoint = inputEndpoint
        }

        const partial = { ...styleAndFilter }
        if (includeEndpoint || isValidEndpoint(inputEndpoint)) {
            partial[STORAGE_KEYS.endpoint] = endpoint
        }

        await saveSettings(partial)

        if (!settings[STORAGE_KEYS.enabled]) {
            setStatus('Settings saved.')
            return
        }

        if (!isValidEndpoint(endpoint)) {
            setStatus('Settings saved.')
            return
        }

        const tab = await getActiveTab()
        const origin = tabOrigin(tab?.url)
        if (
            !tab ||
            typeof tab.id !== 'number' ||
            !origin ||
            !isSiteEnabledForOrigin(
                origin,
                settings[STORAGE_KEYS.siteEnabledByOrigin],
            )
        ) {
            setStatus('Settings saved.')
            return
        }

        const endpointChanged =
            endpoint !== String(settings[STORAGE_KEYS.endpoint] || '')
        const sportsChanged =
            JSON.stringify(styleAndFilter.sportTypes.slice().sort()) !==
            JSON.stringify(
                normalizeSportTypes(settings[STORAGE_KEYS.sportTypes]).sort(),
            )
        const forceRefresh = endpointChanged || sportsChanged

        let response = await sendApplyToTab(
            tab.id,
            endpoint,
            true,
            forceRefresh,
        )
        if (
            !response.ok &&
            String(response.error || '')
                .toLowerCase()
                .includes('receiving end does not exist')
        ) {
            try {
                await ensureContentScript(tab.id)
                response = await sendApplyToTab(
                    tab.id,
                    endpoint,
                    true,
                    forceRefresh,
                )
            } catch (error) {
                setStatus(
                    error instanceof Error
                        ? error.message
                        : 'Settings saved, but failed to refresh overlay.',
                    true,
                )
                return
            }
        }

        if (!response.ok) {
            setStatus(
                response.error ||
                    'Settings saved, but failed to refresh overlay.',
                true,
            )
            return
        }

        setStatus(
            `Settings updated (${formatOverlayCounts(response)}).`,
            Boolean(response.tilesWarning),
        )
    }

    const previous = persistInFlight
    persistInFlight = (async () => {
        if (previous) {
            await previous.catch(() => {})
        }
        await run()
    })()
    await persistInFlight
}

toggleButton.addEventListener('click', async () => {
    const tab = await getActiveTab()
    if (!tab || typeof tab.id !== 'number') {
        setStatus('No active tab found.', true)
        return
    }
    const origin = tabOrigin(tab.url)
    if (!origin) {
        setStatus('Open an http(s) page with a map and try again.', true)
        return
    }

    const settings = await getSettings()
    const siteEnabled = isSiteEnabledForOrigin(
        origin,
        settings[STORAGE_KEYS.siteEnabledByOrigin],
    )

    const endpoint =
        endpointInput.value.trim() ||
        String(settings[STORAGE_KEYS.endpoint] || '').trim()
    const currentlyEnabled = Boolean(settings[STORAGE_KEYS.enabled])
    const nextEnabled = !currentlyEnabled

    if (nextEnabled && !siteEnabled) {
        setStatus(
            'Turn on “Enable on this site” before enabling the overlay.',
            true,
        )
        return
    }

    if (nextEnabled && !isValidEndpoint(endpoint)) {
        setStatus('Enter a valid endpoint before enabling overlay.', true)
        return
    }

    let styleAndFilter
    try {
        styleAndFilter = await readStyleAndFilterForActiveTab()
    } catch (error) {
        setStatus(
            error instanceof Error ? error.message : 'Invalid style settings.',
            true,
        )
        return
    }

    await saveSettings({
        [STORAGE_KEYS.endpoint]: endpoint,
        [STORAGE_KEYS.enabled]: nextEnabled,
        ...styleAndFilter,
    })

    let response = await sendApplyToTab(
        tab.id,
        endpoint,
        nextEnabled,
        nextEnabled,
    )
    if (
        !response.ok &&
        String(response.error || '')
            .toLowerCase()
            .includes('receiving end does not exist')
    ) {
        try {
            await ensureContentScript(tab.id)
            response = await sendApplyToTab(
                tab.id,
                endpoint,
                nextEnabled,
                nextEnabled,
            )
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? error.message
                    : 'Failed to initialize page integration.',
                true,
            )
            return
        }
    }
    if (!response.ok) {
        setStatus(
            response.error || 'Failed to apply overlay on this tab.',
            true,
        )
        return
    }
    updateToggleLabel(nextEnabled)

    if (nextEnabled) {
        const probe = await probeMapReady(tab.id)
        if (!probe.ready && !isOsmTabUrl(tab.url)) {
            setStatus(
                `Overlay requested, but no MapLibre/Mapbox map was found on this page.`,
                true,
            )
            return
        }
        setStatus(
            `Overlay enabled (${formatOverlayCounts(response)}).`,
            Boolean(response.tilesWarning),
        )
    } else {
        setStatus('Overlay disabled.')
    }
})

siteEnabledInput.addEventListener('change', async () => {
    const tab = await getActiveTab()
    const origin = tabOrigin(tab?.url)
    if (!origin || typeof tab?.id !== 'number') {
        siteEnabledInput.checked = false
        setStatus('Open an http(s) page to change site settings.', true)
        return
    }

    const settings = await getSettings()
    const siteMap = normalizeSiteEnabledMap(
        settings[STORAGE_KEYS.siteEnabledByOrigin],
    )
    const next = Boolean(siteEnabledInput.checked)
    siteMap[origin] = next
    await saveSettings({ [STORAGE_KEYS.siteEnabledByOrigin]: siteMap })
    updateSiteEnabledUi(tab, siteMap)

    if (!next) {
        if (settings[STORAGE_KEYS.enabled]) {
            try {
                await ensureContentScript(tab.id)
                await sendApplyToTab(
                    tab.id,
                    String(settings[STORAGE_KEYS.endpoint] || ''),
                    false,
                    false,
                )
            } catch {
                // best-effort disable on this tab
            }
        }
        setStatus('Extension disabled on this site.')
        return
    }

    try {
        await ensureContentScript(tab.id)
        const probe = await probeMapReady(tab.id)
        if (probe.ready || isOsmTabUrl(tab.url)) {
            setStatus('Site enabled. Use Enable to draw the overlay.')
        } else {
            setStatus(
                'Site enabled, but no MapLibre/Mapbox map was found yet. Open a map view and try Enable.',
                true,
            )
        }
    } catch (error) {
        setStatus(
            error instanceof Error
                ? error.message
                : 'Failed to inject into this page.',
            true,
        )
    }
})

endpointInput.addEventListener('blur', () => {
    void persistAndMaybeApply({ includeEndpoint: true })
})

lineColorInput.addEventListener('input', () => {
    void persistAndMaybeApply()
})

lineOpacityInput.addEventListener('input', () => {
    debounceNumberPersist()
})

lineWidthInput.addEventListener('input', () => {
    debounceNumberPersist()
})

showRoutesInput.addEventListener('change', () => {
    void persistAndMaybeApply()
})

showTilesInput.addEventListener('change', () => {
    void persistAndMaybeApply()
})

sportTypesGroup.addEventListener('change', (event) => {
    if (
        event.target instanceof HTMLInputElement &&
        event.target.type === 'checkbox'
    ) {
        void persistAndMaybeApply()
    }
})

sportsSelectAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(true)
    void persistAndMaybeApply()
})

sportsClearAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(false)
    void persistAndMaybeApply()
})

initialize().catch((error) => {
    setStatus(
        error instanceof Error ? error.message : 'Popup init failed.',
        true,
    )
})
