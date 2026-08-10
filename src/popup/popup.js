const STORAGE_KEYS = {
    endpoint: 'routesEndpoint',
    enabled: 'overlayEnabled',
    lineColor: 'lineColor',
    lineOpacity: 'lineOpacity',
    lineWidth: 'lineWidth',
    sportTypes: 'sportTypes',
}

const SPORT_TYPE_OPTIONS = [
    { value: 'Ride', label: 'Ride' },
    { value: 'Walk', label: 'Walk' },
    { value: 'Water', label: 'Water' },
    { value: 'Winter', label: 'Winter' },
]

const endpointInput = document.getElementById('endpoint')
const lineColorInput = document.getElementById('lineColor')
const lineOpacityInput = document.getElementById('lineOpacity')
const lineWidthInput = document.getElementById('lineWidth')
const sportTypesGroup = document.getElementById('sportTypesGroup')
const sportsSelectAllButton = document.getElementById('sportsSelectAll')
const sportsClearAllButton = document.getElementById('sportsClearAll')
const saveButton = document.getElementById('save')
const toggleButton = document.getElementById('toggle')
const statusEl = document.getElementById('status')

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
    })
}

async function saveSettings(partial) {
    await chrome.storage.sync.set(partial)
}

async function sendApplyToTab(tabId, endpoint, enabled) {
    const message = { type: 'APPLY_OVERLAY', endpoint, enabled }

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

function isSupportedTabUrl(url) {
    if (!url) {
        return false
    }
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false
        }
        if (
            parsed.hostname === 'gpx.studio' ||
            parsed.hostname === 'studio.wanderstories.space'
        ) {
            return true
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

async function ensureContentScript(tabId) {
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
    const settings = await getSettings()
    endpointInput.value = String(settings[STORAGE_KEYS.endpoint] || '')
    lineColorInput.value = String(settings[STORAGE_KEYS.lineColor] || '#ff4500')
    lineOpacityInput.value = String(settings[STORAGE_KEYS.lineOpacity] ?? 0.35)
    lineWidthInput.value = String(settings[STORAGE_KEYS.lineWidth] ?? 2)
    renderSportTypeCheckboxes(settings[STORAGE_KEYS.sportTypes])
    updateToggleLabel(Boolean(settings[STORAGE_KEYS.enabled]))
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

function getStyleAndFilterInputValues() {
    const lineColor = String(lineColorInput.value || '').trim()
    const lineOpacity = Number(lineOpacityInput.value)
    const lineWidth = Number(lineWidthInput.value)
    const sportTypes = getSelectedSportTypes()

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
    }
}

saveButton.addEventListener('click', async () => {
    const endpoint = endpointInput.value.trim()
    if (!isValidEndpoint(endpoint)) {
        setStatus('Enter a valid http/https endpoint URL.', true)
        return
    }

    try {
        const styleAndFilter = getStyleAndFilterInputValues()
        const settings = await getSettings()
        await saveSettings({
            [STORAGE_KEYS.endpoint]: endpoint,
            ...styleAndFilter,
        })

        if (settings[STORAGE_KEYS.enabled]) {
            const tab = await getActiveTab()
            if (
                tab &&
                typeof tab.id === 'number' &&
                isSupportedTabUrl(tab.url)
            ) {
                let response = await sendApplyToTab(tab.id, endpoint, true)
                if (
                    !response.ok &&
                    String(response.error || '')
                        .toLowerCase()
                        .includes('receiving end does not exist')
                ) {
                    await ensureContentScript(tab.id)
                    response = await sendApplyToTab(tab.id, endpoint, true)
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
                    `Settings saved and overlay refreshed (${response.routeCount || 0} routes).`,
                )
                return
            }
        }
    } catch (error) {
        setStatus(
            error instanceof Error ? error.message : 'Invalid style settings.',
            true,
        )
        return
    }
    setStatus('Endpoint saved.')
})

toggleButton.addEventListener('click', async () => {
    const tab = await getActiveTab()
    if (!tab || typeof tab.id !== 'number') {
        setStatus('No active tab found.', true)
        return
    }
    if (!isSupportedTabUrl(tab.url)) {
        setStatus(
            'Open gpx.studio, studio.wanderstories.space, or openstreetmap.org/edit and try again.',
            true,
        )
        return
    }

    const settings = await getSettings()
    const endpoint =
        endpointInput.value.trim() ||
        String(settings[STORAGE_KEYS.endpoint] || '').trim()
    const currentlyEnabled = Boolean(settings[STORAGE_KEYS.enabled])
    const nextEnabled = !currentlyEnabled

    if (nextEnabled && !isValidEndpoint(endpoint)) {
        setStatus('Save a valid endpoint before enabling overlay.', true)
        return
    }

    let styleAndFilter
    try {
        styleAndFilter = getStyleAndFilterInputValues()
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

    let response = await sendApplyToTab(tab.id, endpoint, nextEnabled)
    if (
        !response.ok &&
        String(response.error || '')
            .toLowerCase()
            .includes('receiving end does not exist')
    ) {
        try {
            await ensureContentScript(tab.id)
            response = await sendApplyToTab(tab.id, endpoint, nextEnabled)
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
        setStatus(`Overlay enabled (${response.routeCount || 0} routes).`)
    } else {
        setStatus('Overlay disabled.')
    }
})

sportsSelectAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(true)
})

sportsClearAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(false)
})

initialize().catch((error) => {
    setStatus(
        error instanceof Error ? error.message : 'Popup init failed.',
        true,
    )
})
