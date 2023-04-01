
const fs = require('fs').promises
const path = require('path')
const template = require('lodash/template')
const cypressConfig = require('../cypress.config')
const http = require('http')
const url = require('url')

const port = 8001
const host = 'localhost'

async function main() {

    const fileContents = await fs.readFile(path.join(__dirname, 'embed.template'), 'utf8')
    const htmlTemplate = template(fileContents)
    
    const server = http.createServer((req, res) => {
        // If its not the embed.html file, send a 404
        if (!req.url.startsWith('/embed.html')) {
            console.log('Error 404')
            res.writeHead(404)
            res.end()
            return
        } 

        console.log(req.url)

        // Take any URL parameters that start with 'data-' and inject into the template
        const { query } = url.parse(req.url, true)
        const dataAttributes = Object.keys(query)
            .filter(key => key.startsWith('data-'))
            .map(key => ({ attribute: key, value: query[key]}))
        const html = htmlTemplate({ 
            dataAttributes,
            polisDomain: query['polisDomain']
        })
        res.setHeader('Content-Type', 'text/html')
        res.writeHead(200)
        res.end(html)
    })

    server.listen(port, host, () => {
        console.log(`Embed server for iframe tests is running on http://${host}:${port}`)
    })
}

main()