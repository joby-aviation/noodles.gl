// Lets pages import a text file as a string: import text from './file.txt?raw'
// The Claude Code quick start prompt in static/ is shared with the editor this way.
export default function () {
  return {
    name: 'raw-text-plugin',
    configureWebpack() {
      return {
        module: {
          rules: [{ resourceQuery: /raw/, type: 'asset/source' }],
        },
      }
    },
  }
}
