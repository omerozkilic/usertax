var tiny = require('./node_modules/tiny-pkg/index.js');
exports.main = function main() {
  return 'usertax ' + String(tiny.multiply(6, 7));
};
