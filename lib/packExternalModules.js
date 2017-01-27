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
      prodModules[module] = moduleVersion;
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

module.exports = {
  packExternalModules(stats) {

    const includes = (
      this.serverless.service.custom &&
        this.serverless.service.custom.webpackIncludeModules
    );

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
    const servicePath = this.serverless.config.servicePath;
    return BbPromise.resolve()
      .then(() => fs.writeJson(path.join(servicePath, 'package.json'), {dependencies: prodModules}))
      .then(() => fs.copy(path.join(servicePath, '..', 'yarn.lock'), path.join(servicePath, 'yarn.lock')))
      .then(() => new BbPromise((resolve, reject) => {
        exec('yarn --frozen-lockfile', {cwd: servicePath}, (error, stdout, stderr) => {
          console.warn(stderr);
          console.log(stdout);
          if (error) {
            reject(error);
          } else {
            resolve(stdout);
          }
        });
      }));
  }
};
