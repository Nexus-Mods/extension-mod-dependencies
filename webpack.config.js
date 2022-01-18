let webpack = require('vortex-api/bin/webpack').default;

const config = webpack('mod-dependency-manager', __dirname, 5);

config.externals.turbowalk = 'turbowalk';

module.exports = config;
