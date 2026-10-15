const STORAGE_KEYS = {
    endpoint: 'routesEndpoint',
    lineColor: 'lineColor',
    lineOpacity: 'lineOpacity',
    lineWidth: 'lineWidth',
    sportTypes: 'sportTypes',
    showRoutes: 'showRoutes',
    showTiles: 'showTiles',
}

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
const sportsSelectAllButton = document.getElementById('sportsSelectAll')
const sportsClearAllButton = document.getElementById('sportsClearAll')
const statusEl = document.getElementById('status')

let numberPersistTimer = null

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
    const settings = await chrome.storage.sync.get({
        [STORAGE_KEYS.endpoint]: '',
        [STORAGE_KEYS.lineColor]: '#ff4500',
        [STORAGE_KEYS.lineOpacity]: 0.35,
        [STORAGE_KEYS.lineWidth]: 2,
        [STORAGE_KEYS.sportTypes]: [],
        [STORAGE_KEYS.showRoutes]: true,
        [STORAGE_KEYS.showTiles]: true,
    })
    endpointInput.value = String(settings[STORAGE_KEYS.endpoint] || '')
    lineColorInput.value = String(settings[STORAGE_KEYS.lineColor] || '#ff4500')
    lineOpacityInput.value = String(settings[STORAGE_KEYS.lineOpacity] ?? 0.35)
    lineWidthInput.value = String(settings[STORAGE_KEYS.lineWidth] ?? 2)
    showRoutesInput.checked = settings[STORAGE_KEYS.showRoutes] !== false
    showTilesInput.checked = settings[STORAGE_KEYS.showTiles] !== false
    renderSportTypeCheckboxes(settings[STORAGE_KEYS.sportTypes])
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
        const id = `sportTypeOption-${option.value}`
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
 * @param {{ includeEndpoint?: boolean }} [options]
 */
async function persistSettings(options = {}) {
    const includeEndpoint = Boolean(options.includeEndpoint)
    const lineColor = String(lineColorInput.value || '').trim()
    const lineOpacity = Number(lineOpacityInput.value)
    const lineWidth = Number(lineWidthInput.value)
    const sportTypes = getSelectedSportTypes()
    const inputEndpoint = endpointInput.value.trim()

    if (!/^#[0-9a-fA-F]{6}$/.test(lineColor)) {
        setStatus('Route color must be a valid hex color.', true)
        return
    }
    if (
        !Number.isFinite(lineOpacity) ||
        lineOpacity < 0.05 ||
        lineOpacity > 1
    ) {
        setStatus('Opacity must be between 0.05 and 1.', true)
        return
    }
    if (!Number.isFinite(lineWidth) || lineWidth < 1 || lineWidth > 12) {
        setStatus('Width must be between 1 and 12.', true)
        return
    }

    if (includeEndpoint && !isValidEndpoint(inputEndpoint)) {
        // Ignore empty/invalid blur; keep prior stored value.
        return
    }

    const partial = {
        [STORAGE_KEYS.lineColor]: lineColor,
        [STORAGE_KEYS.lineOpacity]: lineOpacity,
        [STORAGE_KEYS.lineWidth]: lineWidth,
        [STORAGE_KEYS.sportTypes]: sportTypes,
        [STORAGE_KEYS.showRoutes]: Boolean(showRoutesInput.checked),
        [STORAGE_KEYS.showTiles]: Boolean(showTilesInput.checked),
    }

    if (includeEndpoint || isValidEndpoint(inputEndpoint)) {
        partial[STORAGE_KEYS.endpoint] = inputEndpoint
    }

    await chrome.storage.sync.set(partial)
    setStatus('Settings saved.')
}

function debounceNumberPersist() {
    if (numberPersistTimer) {
        clearTimeout(numberPersistTimer)
    }
    numberPersistTimer = setTimeout(() => {
        numberPersistTimer = null
        void persistSettings()
    }, DEBOUNCE_MS)
}

endpointInput.addEventListener('blur', () => {
    void persistSettings({ includeEndpoint: true })
})

lineColorInput.addEventListener('input', () => {
    void persistSettings()
})

lineOpacityInput.addEventListener('input', () => {
    debounceNumberPersist()
})

lineWidthInput.addEventListener('input', () => {
    debounceNumberPersist()
})

showRoutesInput.addEventListener('change', () => {
    void persistSettings()
})

showTilesInput.addEventListener('change', () => {
    void persistSettings()
})

sportTypesGroup.addEventListener('change', (event) => {
    if (
        event.target instanceof HTMLInputElement &&
        event.target.type === 'checkbox'
    ) {
        void persistSettings()
    }
})

sportsSelectAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(true)
    void persistSettings()
})

sportsClearAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(false)
    void persistSettings()
})

init().catch((error) => {
    setStatus(
        error instanceof Error ? error.message : 'Options init failed.',
        true,
    )
})
