'use strict';

const BbPromise = require('bluebird');
const path = require('path');
const fs = BbPromise.promisifyAll(require('fs-extra'));
const exec = require('child_process').exec;

function getProdModules(externalModules, packagePath) {

  const packageJson = require(path.join(process.cwd(), packagePath));

  const prodModules = {};

  // only process the module stated in dependencies section
  if (!packageJson.dependencies) {
    return []
  }

  externalModules.forEach(module => {

    const moduleVersion = packageJson.dependencies[module];

    if (moduleVersion) {
      prodModules[module] = moduleVersion.replace('file:../', 'file:../../');
    }
  });

  return prodModules;
}

function getExternalModuleName(module) {

  const path = /^external "(.*)"$/.exec(module.identifier())[1];


  const pathComponents = path.split('/');

  const main = pathComponents[0];

  // this is a package within a namespace
  if (main.charAt(0) == '@') {
    return `${main}/${pathComponents[1]}`
  }

  return main
}

function isExternalModule(module) {
  return module.identifier().indexOf('external ') === 0;
}

function getExternalModules(stats) {

  const externals = new Set();

  stats.compilation.chunks.forEach(function(chunk) {
    // Explore each module within the chunk (built inputs):
    chunk.modules.forEach(function(module) {
      // Explore each source file path that was included into the module:
      if (isExternalModule(module)) {
        externals.add(getExternalModuleName(module));
      }
    });
  });

  return Array.from(externals);
}

function run(path, cmd) {
    return new BbPromise((resolve, reject) => {
        exec(cmd, {cwd: path}, (error, stdout, stderr) => {
            console.warn(stderr);
            console.log(stdout);
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

module.exports = {
  packExternalModules(stats) {

    const includes = (
      this.serverless.service.custom &&
        this.serverless.service.custom.webpackIncludeModules
    );

      const removes = (this.serverless.service.custom && this.serverless.service.custom.webpackRemovePaths) || [];

    if (!includes) {
      return BbPromise.resolve();
    }

    const packagePath = includes.packagePath || './package.json';
    const externalModules = getExternalModules(stats);

    // this plugin will only install modules stated in dependencies section of package.json
    const prodModules = getProdModules(externalModules, packagePath);
    if (prodModules.length === 0) {
      return BbPromise.resolve();
    }
    const resolutions = {
      "lodash": "4.17.11",
      "**/lodash": "4.17.11"
    };

    const servicePath = this.serverless.config.servicePath;
    return BbPromise.resolve()
      .then(() => fs.writeJson(path.join(servicePath, 'package.json'), {dependencies: prodModules, resolutions}))
      .then(() => fs.readFileAsync(path.join(servicePath, '..', 'yarn.lock')))
      .then((yarnLockContents) => fs.writeFile(path.join(servicePath, 'yarn.lock'), yarnLockContents.toString().replace(/@file:\.\.\//g, '@file:../../')))
      .then(() => run(servicePath, 'yarn --frozen-lockfile'))
      .then(() => BbPromise.all(removes.map((path) => run(servicePath, 'rm -rf ' + path))))
      .then(() => run(servicePath, 'find node_modules/ -type f -print0 | xargs -0 chmod a+r ; find node_modules/ -type d -print0 | xargs -0 chmod a+x'))
  }
};
