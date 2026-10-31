const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

// Stub infrastructure boundaries while executing the real application code.
module.exports = function loadModule(file, stubs = {}, globals = {}) {
    const filename = path.resolve(__dirname, '..', file);
    const module = { exports: {} };
    const requireReal = createRequire(filename);
    vm.runInNewContext(readFileSync(filename, 'utf8'), {
        module, exports: module.exports,
        require: id => Object.hasOwn(stubs, id) ? stubs[id] : requireReal(id),
        process, Buffer, console, setTimeout, clearTimeout, URL, ...globals
    }, { filename });
    return module.exports;
};
