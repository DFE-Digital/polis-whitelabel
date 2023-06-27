/** @jsx jsx */
import emoji from 'react-easy-emoji'

function customEmoji(input) {
  return emoji(input, {
    baseUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
    size: '72x72'
  })
}


export default customEmoji