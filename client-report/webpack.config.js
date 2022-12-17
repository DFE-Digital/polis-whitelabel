const path = require("path")
const CopyPlugin = require("copy-webpack-plugin")
const CompressionPlugin = require('compression-webpack-plugin')
const HtmlWebPackPlugin = require('html-webpack-plugin')
const EventHooksPlugin = require('event-hooks-webpack-plugin')
const TerserPlugin = require("terser-webpack-plugin")
const glob = require('glob')
const fs = require('fs')
const pkg = require('./package.json')

const outputDirectory = 'dist'

/**
 * Generates .headersJson files alongside files served by the file-server. Reading these files instructs file-server
 * what HTML headers should be added to each file.
 * 
 * @deprecated
 */
function writeHeadersJsonForOutputFiles(isDev) {
  function writeHeadersJson(matchGlob, headersData = {}) {
    const files = glob.sync(path.resolve(__dirname, outputDirectory, matchGlob))
    files.forEach((f, i) => {
    const headersFilePath = f + '.headersJson'
    fs.writeFileSync(headersFilePath, JSON.stringify(headersData))
    })
  }

  function writeHeadersJsonHtml() {
    const headersData = {
    'x-amz-acl': 'public-read',
    'Content-Type': 'text/html; charset=UTF-8',
    'Cache-Control': 'no-cache'
    }
    writeHeadersJson('*.html', headersData)
  }

  function writeHeadersJsonJs() {
    const headersData = {
    'x-amz-acl': 'public-read',
    ...(!isDev && { 'Content-Encoding': 'gzip' }),
    'Content-Type': 'application/javascript',
    'Cache-Control':
      'no-transform,public,max-age=31536000,s-maxage=31536000'
    }
    writeHeadersJson('js/*.js', headersData)
    writeHeadersJson('*.js', headersData)
  }

  writeHeadersJsonHtml()
  writeHeadersJsonJs()
}

module.exports = (env, options) => {
  const isDevBuild = options.mode === 'development'
  const isDevServer = process.env.WEBPACK_SERVE
  return {
    entry: [
      './src/index'
    ],
    output: {
      publicPath: '/',
      filename: `js/report_bundle.[chunkhash:8].js`,
      path: path.resolve(__dirname, outputDirectory),
      clean: true
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'public', globOptions: { ignore: ['**/index.html'] }, noErrorOnMissing: true }
        ]
      }),
      new HtmlWebPackPlugin({
        template: path.resolve(__dirname, 'public/index.html'),
        filename: 'index_report.html',
        templateParameters: {
          versionString: pkg.version
        }
      }),
      // Generate the .headersJson files ...
      new EventHooksPlugin({
        afterEmit: () => {
          console.log('Writing *.headersJson files...')
          writeHeadersJsonForOutputFiles(isDevBuild || isDevServer)
        }
      }),
      // Only compress files during production builds.
      ...((isDevBuild || isDevServer) ? [] : [
        new CompressionPlugin({
          test: /\.(js|css)$/,
          filename: '[path][base]',
          deleteOriginalAssets: true
        })
      ])
    ],
    // Only minify during production builds
    optimization: {
      minimize: !isDevBuild,
      minimizer: [new TerserPlugin()]
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          exclude: [
            /node_modules/
          ],
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/react'],
              plugins: [
                // The following flags (legacy, loose etc.) are workarounds for an evolving decorators specification
                // see https://stackoverflow.com/a/53249478 for details.
                ['@babel/plugin-proposal-decorators', { legacy: true }],
                ['@babel/plugin-proposal-class-properties', { loose: true }],
                ['@babel/plugin-proposal-private-methods', { loose: true }],
                ['@babel/plugin-proposal-private-property-in-object', { loose: true }]
              ]
            },
          },
        },
      ]
    }
  }
}