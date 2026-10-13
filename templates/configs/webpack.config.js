/* eslint-env node */

const Encore = require('@symfony/webpack-encore');
const ImageminWebpWebpackPlugin = require("imagemin-webp-webpack-plugin");
const Path = require('path');
const fs = require('fs');
const path = require('path');

function cleanupFilesWithPrefix(dir, prefix) {
    fs.readdir(dir, (err, files) => {
        if (err) {
            console.error(`Error reading directory ${dir}:`, err);
            return;
        }
        files.forEach(file => {
            if (file.startsWith(prefix)) {
                const filePath = path.join(dir, file);
                fs.unlink(filePath, (err) => {
                    if (err) {
                        console.error(`Error deleting file ${filePath}:`, err);
                    } else {
                        console.log(`Deleted file: ${filePath}`);
                    }
                });
            }
        });
    });
}

// Manually configure the runtime environment if not already configured yet by the "encore" command.
if (!Encore.isRuntimeEnvironmentConfigured()) {
    Encore.configureRuntimeEnvironment(process.env.NODE_ENV || 'dev');
}

const outputPath = './assets/';

Encore
    // directory where compiled assets will be stored
    .setOutputPath(outputPath)
    // public path used by the web server to access the output path
    .setPublicPath('/assets')

    /*
     * ENTRY CONFIG
     *
     * Add 1 entry for each "page" of your app
     * Each entry will result in one JavaScript file (e.g. app.js)
     * and one CSS file (e.g. app.css) if your JavaScript imports CSS.
    */

    .addEntry('entry-global', './src/entrypoints/global')


    // will require an extra script tag for runtime.js
    // but, you probably want this, unless you're building a single-page app
    .disableSingleRuntimeChunk()

    /*
     * FEATURE CONFIG
    */
    .enableBuildNotifications()
    .enableSourceMaps(!Encore.isProduction())

    // enables @babel/preset-env polyfills
    .configureBabelPresetEnv((config) => {
        config.useBuiltIns = 'entry';
        config.corejs = '3.22.5';
    })

    .enableEslintPlugin(() => {}, {
        lintVue: true,
        eslintPath: 'eslint',
        exclude: [/node_modules/],
    })

    // allow sass/scss files to be processed
    .enableSassLoader()

    // allow shopify asset paths in CSS
    .configureCssLoader((options) => {
        options.url = false
    })

    .enablePostCssLoader((options) => {
        options.postcssOptions = {
            config: './postcss.config.js'
        };
    })
;


if (Encore.isProduction()) {
    cleanupFilesWithPrefix(outputPath, 'entry-');
    Encore.addPlugin(new ImageminWebpWebpackPlugin({
        config: [{
            test: /\.(jpe?g|png)/,
            options: {
                quality: 90
            }
        }],
        overrideExtension: false
    }))
}

// export the final configuration
const webpackConfig = Encore.getWebpackConfig();

webpackConfig.resolve.alias['@'] = Path.resolve(__dirname, './src/');

// export the final configuration
module.exports = webpackConfig;
