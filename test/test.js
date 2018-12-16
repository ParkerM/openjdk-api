const assert = require('assert');
const _ = require('underscore');
const fs = require('fs');
const Q = require('q');

const mocha = require('mocha');
const describe = mocha.describe;
const it = mocha.it;

setUpTestCache();

function setUpTestCache() {

  if (!fs.existsSync('cache')) {
    fs.mkdirSync('cache');
  }

  function updateCacheTimes(cacheData) {
    for (const cacheEntry in cacheData) {
      if (cacheData[cacheEntry].hasOwnProperty("cacheTime")) {
        cacheData[cacheEntry].cacheTime = Date.now() + 60 * 1000;
      }
    }
  }

  const newCacheData = JSON.parse(fs.readFileSync('./test/asset/cache/newCache.cache.json'));
  updateCacheTimes(newCacheData);
  fs.writeFileSync('./cache/newCache.cache.json', JSON.stringify(newCacheData));


  const oldCacheData = JSON.parse(fs.readFileSync('./test/asset/cache/oldCache.cache.json'));
  updateCacheTimes(oldCacheData);
  fs.writeFileSync('./cache/oldCache.cache.json', JSON.stringify(oldCacheData));

  console.log('Test cache setup')
}

const v2 = require('../app/routes/v2');

function mockRequest(requestType, buildtype, version, openjdk_impl, os, arch, release, type, heap_size) {
  return {
    params: {
      requestType: requestType,
      buildtype: buildtype,
      version: version,
    },

    query: {
      openjdk_impl: openjdk_impl,
      os: os,
      arch: arch,
      release: release,
      type: type,
      heap_size: heap_size,
    }
  }
}

function mockRequestWithSingleQuery(requestType, buildtype, version, queryName, queryValue) {
  const request = mockRequest(requestType, buildtype, version);
  request.query[queryName] = queryValue;
  return request;
}

function performRequest(request, doAssert) {
  const codePromise = Q.defer();
  const msgPromise = Q.defer();
  const res = {
    status: function (code) {
      codePromise.resolve(code);
    },
    send: function (msg) {
      msgPromise.resolve(msg);
    },
    json: function (msg) {
      msgPromise.resolve(JSON.stringify(msg));
    }, redirect: function (url) {
      codePromise.resolve(302);
      msgPromise.resolve(url);
    }
  };

  v2(request, res);

  return Q
    .allSettled([codePromise.promise, msgPromise.promise])
    .then(function (result) {
      const code = result[0].value;
      const msg = result[1].value;
      doAssert(code, msg);
    });
}

function forAllPermutations(doTest) {
  _
    .chain(["openjdk8", "openjdk9", "openjdk10", "openjdk11"])
    .each(function (jdk) {
      _
        .chain(["nightly", "releases"])
        .each(function (release) {
          doTest(jdk, release);
        })
    });
}

/*
TODO: uncomment when fixed
describe('dinoguns binary request works', function () {
  it("works", function () {
    const request = mockRequest("binary", "nightly", "openjdk8", "hotspot", "linux", "aarch64", "latest", "jdk");
    return performRequest(request, function (code, msg) {
      assert.equal(302, code);
    });
  })
});
*/

// request http://localhost:3000/info/release/openjdk8
describe('200 for simple case', function () {
  forAllPermutations(function (jdk, release) {
    it(jdk + ' ' + release, function () {
      const request = mockRequest("info", release, jdk);
      return performRequest(request, function (code, msg) {
        assert.strictEqual(code, 200);
      });
    })
  });
});

// request http://localhost:3000/info/release/openjdk8
describe('has all expected properties on binary assets', function () {
  forAllPermutations(function (jdk, release) {
    it(jdk + ' ' + release, function () {

      const request = mockRequest("info", release, jdk);
      return performRequest(request, function (code, msg) {
        assert.strictEqual(code, 200);

        let releases;
        try {
          releases = JSON.parse(msg);
        } catch (e) {
          console.log("Failed to read :" + msg);
          assert.fail()
        }

        _.chain(releases)
          .map(function (release) {
            return release.binaries;
          })
          .flatten()
          .each(function (binary) {

            _.chain([
              "architecture",
              "binary_link",
              "binary_name",
              "binary_size",
              "binary_type",
              "heap_size",
              "openjdk_impl",
              "os",
              "version"])
              .each(function (property) {
                assert.strictEqual(binary.hasOwnProperty(property), true, "missing property " + property + " on json: " + JSON.stringify(binary));
              });
          })
      });
    })
  });
});

function checkCanFilterOnProperty(propertyName, returnedPropertyName, propertyValue) {
  forAllPermutations(function (jdk, release) {
    const request = mockRequestWithSingleQuery("info", release, jdk, propertyName, propertyValue);
    it('Checking can filter for params: ' + jdk + ' ' + release + ' ' + propertyName + ' ' + propertyValue, function () {
      return performRequest(request, function (code, msg) {
        assert.strictEqual(code, 200);
        const releases = JSON.parse(msg);
        _.chain(releases)
          .map(function (release) {
            return release.binaries;
          })
          .flatten()
          .each(function (binary) {
            assert.strictEqual(binary[returnedPropertyName], propertyValue);
          })
      });
    })
  });
}

// request http://localhost:3000/info/release/openjdk8?os=windows
describe('can filter on os', function () {
  checkCanFilterOnProperty("os", "os", "windows");
});

// request http://localhost:3000/info/release/openjdk8?openjdk_impl=hotspot
describe('can filter on openjdk_impl', function () {
  checkCanFilterOnProperty("openjdk_impl", "openjdk_impl", "hotspot")
});

// request http://localhost:3000/info/release/openjdk8?arch=x64
describe('can filter on arch', function () {
  checkCanFilterOnProperty("arch", "architecture", "x64")
});

// request http://localhost:3000/info/release/openjdk8?type=jdk
describe('can filter on type', function () {
  checkCanFilterOnProperty("type", "binary_type", "jdk")
});

describe('binary redirect returns 302', function () {
  forAllPermutations(function (jdk, release) {
    const request = mockRequest("binary", release, jdk, "hotspot", "linux", "x64", "latest", "jdk");

    it('returns 302 for redirect ' + JSON.stringify(request), function () {
      return performRequest(request, function (code, msg) {
        assert.equal(302, code);
      })
    });
  })
});

describe('filters releases correctly', function () {
  forAllPermutations(function (jdk, release) {
    const request = mockRequest("info", release, jdk, "hotspot", "linux", "x64", undefined, "jdk");

    const isRelease = release.indexOf("releases") >= 0;

    it('release is set correctly ' + JSON.stringify(request), function () {
      return performRequest(request, function (code, data) {
        const releases = JSON.parse(data);
        _.chain(releases)
          .each(function (release) {
            if (release.hasOwnProperty('binaries')) {
              _.chain(releases.binaries)
                .each(function (binary) {
                  const isNightlyRepo = binary.binary_link.indexOf("-nightly") >= 0;
                  const isBinaryRepo = binary.binary_link.indexOf("-binaries") >= 0;
                  if (isRelease) {
                    assert.strictEqual(isNightlyRepo, false)
                  } else {
                    assert.strictEqual(isNightlyRepo || isBinaryRepo, true)
                  }
                })
            }

            assert.strictEqual(release.release, isRelease);
          })
      })
    });
  })
});

describe('filters heap_size', function () {
  const request = mockRequest("info", "nightly", "openjdk8", undefined, undefined, undefined, undefined, undefined, "large");
  it('only large heaps are returned', function () {
    return performRequest(request, function (code, data) {
      const releases = JSON.parse(data);
      _.chain(releases)
        .each(function (release) {
          if (release.hasOwnProperty('binaries')) {
            _.chain(releases.binaries)
              .each(function (binary) {
                assert.strictEqual(binary.binary_link.indexOf("linuxXL") >= 0, true);
                assert.strictEqual(binary.heap_size, "large");
              })
          }
        })
    })
  });
});

describe('does not show linuxlh as an os', function () {
  it("is not linuxlh", function () {
    const request = mockRequest("info", "releases", "openjdk8", "openj9", undefined, undefined, undefined, undefined, undefined);
    return performRequest(request, function (code, data) {
      const releases = JSON.parse(data);
      _.chain(releases)
        .each(function (release) {
          if (release.hasOwnProperty('binaries')) {
            _.chain(releases.binaries)
              .each(function (binary) {
                assert.notStrictEqual(binary.os.toLowerCase(), "linuxlh");
              })
          }
        })
    });
  })
});

describe('latestAssets returns correct results', function () {
  forAllPermutations(function (jdk, release) {
    const request = mockRequest("latestAssets", release, jdk, "hotspot", "linux", "x64", undefined, undefined, undefined);

    it("returns correct assets", function () {
      return performRequest(request, function (code, data) {
        const binaries = JSON.parse(data);
        _.chain(binaries)
          .each(function (binary) {
            assert.strictEqual(binary.openjdk_impl, "hotspot");
            assert.strictEqual(binary.os, "linux");
            assert.strictEqual(binary.architecture, "x64");
          })
      });
    })
  });
});

describe('gives 404 for invalid version', function () {
  it("returns 404", function () {
    const request = mockRequest("info", "releases", "openjdk50", "hotspot", undefined, undefined, undefined, undefined, undefined);
    return performRequest(request, function (code, data) {
      assert.strictEqual(code, 404);
    });
  })
});
