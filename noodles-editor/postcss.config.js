import { Z_INDEX } from './src/styles/z-index.values.js'

function toCSSVar(key) {
  return `--z-index-${key.toLowerCase().replace(/_/g, '-')}`
}

export default {
  plugins: [
    {
      postcssPlugin: 'z-index-vars',
      AtRule: {
        'z-index-vars': (atRule, { Rule, Declaration }) => {
          const rule = new Rule({ selector: ':root' })
          for (const [key, val] of Object.entries(Z_INDEX)) {
            rule.append(new Declaration({ prop: toCSSVar(key), value: String(val) }))
          }
          atRule.replaceWith(rule)
        },
      },
    },
  ],
}
