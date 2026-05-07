const STORAGE_KEYS = {
    endpoint: 'routesEndpoint',
    enabled: 'overlayEnabled',
}

const endpointInput = document.getElementById('endpoint')
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
    })
}

async function saveSettings(partial) {
    await chrome.storage.sync.set(partial)
}

async function sendApplyToTab(tabId, endpoint, enabled) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(
            tabId,
            { type: 'APPLY_OVERLAY', endpoint, enabled },
            (response) => {
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
            },
        )
    })
}

function updateToggleLabel(enabled) {
    toggleButton.textContent = enabled ? 'Disable' : 'Enable'
    toggleButton.style.background = enabled ? '#ef4444' : '#22c55e'
}

async function initialize() {
    const settings = await getSettings()
    endpointInput.value = String(settings[STORAGE_KEYS.endpoint] || '')
    updateToggleLabel(Boolean(settings[STORAGE_KEYS.enabled]))
}

saveButton.addEventListener('click', async () => {
    const endpoint = endpointInput.value.trim()
    if (!isValidEndpoint(endpoint)) {
        setStatus('Enter a valid http/https endpoint URL.', true)
        return
    }

    await saveSettings({ [STORAGE_KEYS.endpoint]: endpoint })
    setStatus('Endpoint saved.')
})

toggleButton.addEventListener('click', async () => {
    const tab = await getActiveTab()
    if (!tab || typeof tab.id !== 'number') {
        setStatus('No active tab found.', true)
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

    const response = await sendApplyToTab(tab.id, endpoint, nextEnabled)
    if (!response.ok) {
        setStatus(
            response.error || 'Failed to apply overlay on this tab.',
            true,
        )
        return
    }

    await saveSettings({
        [STORAGE_KEYS.endpoint]: endpoint,
        [STORAGE_KEYS.enabled]: nextEnabled,
    })
    updateToggleLabel(nextEnabled)

    if (nextEnabled) {
        setStatus(`Overlay enabled (${response.routeCount || 0} routes).`)
    } else {
        setStatus('Overlay disabled.')
    }
})

initialize().catch((error) => {
    setStatus(
        error instanceof Error ? error.message : 'Popup init failed.',
        true,
    )
})
