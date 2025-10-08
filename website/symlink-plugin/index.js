export default function () {
  return {
    name: 'symlink-plugin',
    configureWebpack(config) {
      // Symlink docs crash otherwise, see https://github.com/facebook/docusaurus/issues/6257
      config.resolve.symlinks = false
      return {}
    }
  }
}
