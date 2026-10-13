/* eslint-env node */
let plugin = require('tailwindcss/plugin');

module.exports = {
    content: [
        './layout/**/*.liquid',
        './sections/**/*.liquid',
        './snippets/**/*.liquid',
        './templates/**/*.liquid',
        './src/**/*.js',
        './src/entrypoints/**/*.js',
        './src/modules/**/*.js'
    ],
    theme: {
        extend: {
        }
    },
    plugins: [
        plugin(function ({ addVariant }) {
            addVariant('peer-focus-keyboard', 'body.keyboard-focus-is-active :merge(.peer):focus ~ &');
            addVariant('has-hover', '@media (hover: hover) { &:hover }');
            addVariant('group-has-hover', '@media (hover: hover) { .group:hover & }');
        })
    ]
};
