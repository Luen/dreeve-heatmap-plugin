import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

const chromeGlobals = {
    chrome: 'readonly',
}

export default [
    {
        ignores: ['node_modules/**', '**/*.min.js'],
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...chromeGlobals,
            },
        },
        rules: {
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            'prefer-const': 'error',
            'no-var': 'error',
        },
    },
    // Page-world bridges use host-page globals (MapLibre / Mapbox / iD).
    {
        files: ['src/page-bridge.js', 'src/page-bridge-id.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                ...globals.browser,
                maplibregl: 'readonly',
                mapboxgl: 'readonly',
                iD: 'writable',
            },
        },
    },
    {
        files: ['src/id/start.js'],
        languageOptions: {
            sourceType: 'script',
        },
    },
    eslintConfigPrettier,
]
