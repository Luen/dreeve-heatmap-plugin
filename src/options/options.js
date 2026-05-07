const STORAGE_KEY = 'routesEndpoint'

const endpointInput = document.getElementById('endpoint')
const saveButton = document.getElementById('save')
const statusEl = document.getElementById('status')

function setStatus(message, isError = false) {
    statusEl.textContent = message
    statusEl.style.color = isError ? '#fecaca' : '#86efac'
}

function isValidEndpoint(value) {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

async function init() {
    const settings = await chrome.storage.sync.get({ [STORAGE_KEY]: '' })
    endpointInput.value = String(settings[STORAGE_KEY] || '')
}

saveButton.addEventListener('click', async () => {
    const endpoint = endpointInput.value.trim()
    if (!isValidEndpoint(endpoint)) {
        setStatus('Enter a valid http/https endpoint.', true)
        return
    }

    await chrome.storage.sync.set({ [STORAGE_KEY]: endpoint })
    setStatus('Settings saved.')
})

init().catch((error) => {
    setStatus(
        error instanceof Error ? error.message : 'Options init failed.',
        true,
    )
})
