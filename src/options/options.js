const STORAGE_KEYS = {
    endpoint: 'routesEndpoint',
    lineColor: 'lineColor',
    lineOpacity: 'lineOpacity',
    lineWidth: 'lineWidth',
    sportTypes: 'sportTypes',
}

const SPORT_TYPE_OPTIONS = [
    'Run',
    'Ride',
    'EBikeRide',
    'Walk',
    'Hike',
    'TrailRun',
    'MountainBikeRide',
]

const endpointInput = document.getElementById('endpoint')
const lineColorInput = document.getElementById('lineColor')
const lineOpacityInput = document.getElementById('lineOpacity')
const lineWidthInput = document.getElementById('lineWidth')
const sportTypesGroup = document.getElementById('sportTypesGroup')
const sportsSelectAllButton = document.getElementById('sportsSelectAll')
const sportsClearAllButton = document.getElementById('sportsClearAll')
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
    const settings = await chrome.storage.sync.get({
        [STORAGE_KEYS.endpoint]: '',
        [STORAGE_KEYS.lineColor]: '#ff4500',
        [STORAGE_KEYS.lineOpacity]: 0.35,
        [STORAGE_KEYS.lineWidth]: 2,
        [STORAGE_KEYS.sportTypes]: [],
    })
    endpointInput.value = String(settings[STORAGE_KEYS.endpoint] || '')
    lineColorInput.value = String(settings[STORAGE_KEYS.lineColor] || '#ff4500')
    lineOpacityInput.value = String(settings[STORAGE_KEYS.lineOpacity] ?? 0.35)
    lineWidthInput.value = String(settings[STORAGE_KEYS.lineWidth] ?? 2)
    renderSportTypeCheckboxes(settings[STORAGE_KEYS.sportTypes])
}

function normalizeSportTypes(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue.map((item) => String(item).trim()).filter(Boolean)
    }

    if (!rawValue) {
        return []
    }

    return String(rawValue)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

function renderSportTypeCheckboxes(rawValue) {
    const selected = new Set(normalizeSportTypes(rawValue))
    sportTypesGroup.innerHTML = ''

    for (const option of SPORT_TYPE_OPTIONS) {
        const id = `sportTypeOption-${option}`
        const wrapper = document.createElement('label')
        wrapper.className = 'checkbox-item'
        wrapper.setAttribute('for', id)
        wrapper.innerHTML = `<input id="${id}" type="checkbox" value="${option}" /> <span>${option}</span>`
        const checkbox = wrapper.querySelector('input')
        checkbox.checked = selected.has(option)
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

saveButton.addEventListener('click', async () => {
    const endpoint = endpointInput.value.trim()
    if (!isValidEndpoint(endpoint)) {
        setStatus('Enter a valid http/https endpoint.', true)
        return
    }

    const lineColor = String(lineColorInput.value || '').trim()
    const lineOpacity = Number(lineOpacityInput.value)
    const lineWidth = Number(lineWidthInput.value)
    const sportTypes = getSelectedSportTypes()

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

    await chrome.storage.sync.set({
        [STORAGE_KEYS.endpoint]: endpoint,
        [STORAGE_KEYS.lineColor]: lineColor,
        [STORAGE_KEYS.lineOpacity]: lineOpacity,
        [STORAGE_KEYS.lineWidth]: lineWidth,
        [STORAGE_KEYS.sportTypes]: sportTypes,
    })
    setStatus('Settings saved.')
})

sportsSelectAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(true)
})

sportsClearAllButton.addEventListener('click', () => {
    setAllSportTypeSelection(false)
})

init().catch((error) => {
    setStatus(
        error instanceof Error ? error.message : 'Options init failed.',
        true,
    )
})
