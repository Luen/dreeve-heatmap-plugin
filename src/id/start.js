;(function () {
    const emptyContainer = document.createElement('div')
    emptyContainer.id = 'id-container'
    emptyContainer.setAttribute('data-dreeve-placeholder', '1')
    ;(document.body || document.documentElement).prepend(emptyContainer)
})()
