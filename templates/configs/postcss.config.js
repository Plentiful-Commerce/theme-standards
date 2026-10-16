const tailwindcss = require('tailwindcss');
const postcssPresetEnv = require('postcss-preset-env');

module.exports = {
    plugins: [
        require('postcss-import'),
        require('tailwindcss/nesting'),
        tailwindcss('./tailwind.config.js'),
        require('autoprefixer'),
        postcssPresetEnv({
            features: {
                'custom-media-queries': true
            }
        })
    ]
}
